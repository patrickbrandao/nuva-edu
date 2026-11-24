import { describe, expect, it } from 'vitest';
import {
  ContractMismatchError,
  checkContract,
  findWritesWithoutCsrf,
  formatContractReport,
  formatContractWarnings,
  parseContract,
  type RegisteredRoute,
} from '../src/index.ts';
import { fixtureContract } from './helpers.ts';

const contract = fixtureContract();
const allRoutes: RegisteredRoute[] = [
  ...contract.operations.map((operation) => ({
    method: operation.method.toUpperCase(),
    path: operation.routePath,
  })),
  { method: 'GET', path: '/metrics' },
];
const exceptions = { csrfExceptions: ['login', 'deleteItem'] };

describe('checkContract', () => {
  it('passa quando rotas e contrato coincidem e as exceções de CSRF estão listadas', () => {
    expect(checkContract(contract, allRoutes, exceptions)).toEqual({
      routesMissingInContract: [],
      operationsMissingInApp: [],
      writesWithoutCsrf: [],
      staleCsrfExceptions: [],
      pendingOperations: [],
      pendingWithRoute: [],
      pendingNotAllowed: [],
      ok: true,
    });
  });

  it('acusa rota registrada que não está no contrato', () => {
    const report = checkContract(
      contract,
      [...allRoutes, { method: 'post', path: '/api/v1/items/:id/publish' }],
      exceptions,
    );
    expect(report.ok).toBe(false);
    expect(report.routesMissingInContract).toEqual(['POST /api/v1/items/{id}/publish']);
  });

  it('acusa operação do contrato sem rota', () => {
    const report = checkContract(
      contract,
      allRoutes.filter((route) => route.path !== '/api/v1/items/:id'),
      exceptions,
    );
    expect(report.operationsMissingInApp).toEqual([
      'DELETE /api/v1/items/{id}',
      'GET /api/v1/items/{id}',
    ]);
  });

  it('só /metrics fica fora do contrato, salvo o que o serviço declarar', () => {
    const extra = [...allRoutes, { method: 'GET', path: '/interno' }];
    expect(checkContract(contract, extra, exceptions).routesMissingInContract).toEqual([
      'GET /interno',
    ]);
    expect(
      checkContract(contract, extra, {
        ...exceptions,
        internalRoutes: ['GET /metrics', 'GET /interno'],
      }).ok,
    ).toBe(true);
  });

  it('exige csrfToken em toda escrita, em todas as alternativas do security', () => {
    // `login` é pública; `deleteItem` aceita chave de API no lugar de sessão e CSRF.
    expect(findWritesWithoutCsrf(contract)).toEqual(['deleteItem', 'login']);
    const report = checkContract(contract, allRoutes);
    expect(report.ok).toBe(false);
    expect(report.writesWithoutCsrf).toEqual(['deleteItem', 'login']);
  });

  it('acusa exceção de CSRF que não se aplica mais', () => {
    const report = checkContract(contract, allRoutes, {
      csrfExceptions: ['login', 'deleteItem', 'createItem', 'removida'],
    });
    expect(report.ok).toBe(false);
    expect(report.staleCsrfExceptions).toEqual(['createItem', 'removida']);
  });

  it('descreve as divergências uma por linha', () => {
    const report = checkContract(contract, [{ method: 'GET', path: '/fora' }]);
    const text = formatContractReport(report);
    expect(text).toContain('rota registrada fora do contrato: GET /fora');
    expect(text).toContain('operação do contrato sem rota: GET /healthz');
    expect(text).toContain('escrita sem csrfToken no security: login');
    expect(new ContractMismatchError('openapi.yaml', report).message).toContain(text);
    expect(formatContractReport(checkContract(contract, allRoutes, exceptions))).toBe('');
  });
});

describe('operações pendentes (x-nuva-pending)', () => {
  /** O contrato de teste com `getItem` e `deleteItem` marcadas como pendentes. */
  function pendingContract(mark: unknown = true) {
    const document = structuredClone(contract.document) as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    for (const method of ['get', 'delete']) {
      const operation = document.paths['/api/v1/items/{id}']?.[method];
      if (operation) {
        operation['x-nuva-pending'] = mark;
      }
    }
    return parseContract(document, 'pendente.yaml');
  }
  const withoutPending = allRoutes.filter((route) => route.path !== '/api/v1/items/:id');

  it('o contrato lê a marca; sem ela a operação não é pendente', () => {
    expect(contract.operations.every((operation) => !operation.pending)).toBe(true);
    const pending = pendingContract();
    expect(pending.operation('getItem').pending).toBe(true);
    expect(pending.operation('listItems').pending).toBe(false);
    expect(pendingContract(false).operation('getItem').pending).toBe(false);
    expect(() => pendingContract('sim')).toThrow(/x-nuva-pending/);
  });

  it('operação pendente sem rota não é divergência: vira aviso', () => {
    const report = checkContract(pendingContract(), withoutPending, exceptions);
    expect(report.ok).toBe(true);
    expect(report.operationsMissingInApp).toEqual([]);
    expect(report.pendingOperations).toEqual([
      'DELETE /api/v1/items/{id}',
      'GET /api/v1/items/{id}',
    ]);
    expect(report.pendingWithRoute).toEqual([]);
    // O texto das divergências continua vazio: o teste de contrato de cada API passa.
    expect(formatContractReport(report)).toBe('');
    expect(formatContractReport(report, { warnings: true }).split('\n')).toEqual([
      'aviso: operação pendente (x-nuva-pending) ainda sem rota: DELETE /api/v1/items/{id}',
      'aviso: operação pendente (x-nuva-pending) ainda sem rota: GET /api/v1/items/{id}',
    ]);
  });

  it('operação pendente com rota também é aceita, com aviso para tirar a marca', () => {
    const report = checkContract(pendingContract(), allRoutes, exceptions);
    expect(report.ok).toBe(true);
    expect(report.routesMissingInContract).toEqual([]);
    expect(report.pendingOperations).toEqual([]);
    expect(report.pendingWithRoute).toEqual([
      'DELETE /api/v1/items/{id}',
      'GET /api/v1/items/{id}',
    ]);
    expect(formatContractWarnings(report)[0]).toBe(
      'aviso: operação pendente (x-nuva-pending) já tem rota; remova a marca: DELETE /api/v1/items/{id}',
    );
  });

  it('as outras regras continuam valendo para a operação pendente e para as demais', () => {
    const pending = pendingContract();
    // `deleteItem` segue precisando estar nas exceções de CSRF.
    expect(checkContract(pending, withoutPending).writesWithoutCsrf).toEqual([
      'deleteItem',
      'login',
    ]);
    const report = checkContract(
      pending,
      withoutPending.filter((route) => route.path !== '/api/v1/items'),
      exceptions,
    );
    expect(report.ok).toBe(false);
    expect(report.operationsMissingInApp).toEqual(['GET /api/v1/items', 'POST /api/v1/items']);
    expect(formatContractReport(report, { warnings: true })).toContain(
      'operação do contrato sem rota: GET /api/v1/items\n',
    );
  });
});

describe('conferência sem pendentes (check-contract --no-pending)', () => {
  it('com allowPending: false, toda operação pendente é divergência, com ou sem rota', () => {
    const document = structuredClone(contract.document) as {
      paths: Record<string, Record<string, Record<string, unknown>>>;
    };
    const getItem = document.paths['/api/v1/items/{id}']?.get;
    const listItems = document.paths['/api/v1/items']?.get;
    if (getItem && listItems) {
      getItem['x-nuva-pending'] = true;
      listItems['x-nuva-pending'] = true;
    }
    const pending = parseContract(document, 'pendente.yaml');
    const routes = allRoutes.filter(
      (route) => !(route.method === 'GET' && route.path === '/api/v1/items/:id'),
    );
    expect(checkContract(pending, routes, exceptions).ok).toBe(true);
    const report = checkContract(pending, routes, { ...exceptions, allowPending: false });
    expect(report.ok).toBe(false);
    expect(report.pendingNotAllowed).toEqual(['GET /api/v1/items', 'GET /api/v1/items/{id}']);
    expect(formatContractReport(report).split('\n')).toEqual([
      'operação ainda marcada com x-nuva-pending: GET /api/v1/items',
      'operação ainda marcada com x-nuva-pending: GET /api/v1/items/{id}',
    ]);
    // Sem operação pendente, a opção não muda nada.
    expect(checkContract(contract, allRoutes, { ...exceptions, allowPending: false }).ok).toBe(
      true,
    );
  });
});
