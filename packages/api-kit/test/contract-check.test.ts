import { describe, expect, it } from 'vitest';
import {
  ContractMismatchError,
  checkContract,
  findMissingErrorResponses,
  findWritesWithoutCsrf,
  formatContractReport,
  formatContractWarnings,
  parseContract,
  type RegisteredRoute,
  requiredErrorResponses,
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
      missingErrorResponses: [],
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

describe('respostas de erro declaradas (spec 003)', () => {
  type Document = { paths: Record<string, Record<string, { responses: Record<string, unknown> }>> };
  /** O contrato de teste sem alguns status numa operação. */
  function without(
    path: string,
    method: string,
    statuses: string[],
    extra?: (d: Document) => void,
  ) {
    const document = structuredClone(contract.document) as Document;
    for (const status of statuses) {
      delete document.paths[path]?.[method]?.responses[status];
    }
    extra?.(document);
    return parseContract(document, 'sem-erros.yaml');
  }

  it('o que cada operação precisa declarar segue a tabela da spec', () => {
    const required = (id: string) => requiredErrorResponses(contract.operation(id));
    // Pública, sem corpo e sem parâmetro de caminho: só as de toda operação de /api/v1.
    expect(required('listItems')).toEqual(['400', '429', '500', '503']);
    // Com sessão e corpo.
    expect(required('createItem')).toEqual([
      '400',
      '401',
      '403',
      '413',
      '415',
      '429',
      '500',
      '503',
    ]);
    // Com sessão e parâmetro de caminho.
    expect(required('getItem')).toEqual(['400', '401', '403', '404', '429', '500', '503']);
    expect(required('deleteItem')).toEqual(['400', '401', '403', '404', '429', '500', '503']);
    // Pública com corpo.
    expect(required('login')).toEqual(['400', '413', '415', '429', '500', '503']);
    // Sondas, fora de /api/v1: só as próprias.
    expect(required('getHealth')).toEqual([]);
    expect(required('getReadiness')).toEqual([]);
  });

  it('o contrato de teste declara tudo', () => {
    expect(findMissingErrorResponses(contract)).toEqual([]);
  });

  it('acusa cada operação com os status que faltam, e o relatório reprova', () => {
    const broken = without('/api/v1/items/{id}', 'get', ['404', '429'], (document) => {
      delete document.paths['/api/v1/items']?.post?.responses['415'];
      delete document.paths['/api/v1/items']?.get?.responses['503'];
    });
    const report = checkContract(broken, allRoutes, exceptions);
    expect(report.ok).toBe(false);
    expect(report.missingErrorResponses).toEqual([
      'GET /api/v1/items/{id}: 404, 429',
      'GET /api/v1/items: 503',
      'POST /api/v1/items: 415',
    ]);
    expect(formatContractReport(report).split('\n')).toEqual([
      'resposta de erro não declarada: GET /api/v1/items/{id}: 404, 429',
      'resposta de erro não declarada: GET /api/v1/items: 503',
      'resposta de erro não declarada: POST /api/v1/items: 415',
    ]);
  });

  it('401 e 403 só são exigidos de operação com sessão', () => {
    expect(findMissingErrorResponses(without('/api/v1/items/{id}', 'get', ['401', '403']))).toEqual(
      ['GET /api/v1/items/{id}: 401, 403'],
    );
    // `login` é pública e não declara 401 nem 403: nada a acusar.
    expect(contract.operation('login').responses.map((r) => r.status)).not.toContain('401');
  });

  it('faixa de status e default não substituem o status escrito', () => {
    const ranged = without('/api/v1/items', 'get', ['400', '500'], (document) => {
      const responses = document.paths['/api/v1/items']?.get?.responses;
      if (responses) {
        responses['4XX'] = { $ref: '#/components/responses/Problem' };
        responses.default = { $ref: '#/components/responses/Problem' };
      }
    });
    expect(findMissingErrorResponses(ranged)).toEqual(['GET /api/v1/items: 400, 500']);
  });

  it('vale também para operação pendente', () => {
    const pending = without('/api/v1/items/{id}', 'get', ['404'], (document) => {
      const getItem = document.paths['/api/v1/items/{id}']?.get as Record<string, unknown>;
      getItem['x-nuva-pending'] = true;
    });
    const report = checkContract(
      pending,
      allRoutes.filter((r) => !(r.method === 'GET' && r.path === '/api/v1/items/:id')),
      exceptions,
    );
    expect(report.pendingOperations).toEqual(['GET /api/v1/items/{id}']);
    expect(report.missingErrorResponses).toEqual(['GET /api/v1/items/{id}: 404']);
    expect(report.ok).toBe(false);
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
