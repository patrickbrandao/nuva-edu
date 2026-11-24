import { describe, expect, it } from 'vitest';
import {
  ContractMismatchError,
  checkContract,
  findWritesWithoutCsrf,
  formatContractReport,
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
