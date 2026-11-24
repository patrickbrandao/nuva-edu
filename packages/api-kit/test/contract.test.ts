import { describe, expect, it } from 'vitest';
import {
  ContractError,
  createContractValidator,
  loadContract,
  parseContract,
  toContractPath,
  toRoutePath,
} from '../src/index.ts';
import { fixtureContract } from './helpers.ts';

describe('loadContract', () => {
  it('lista as operações com método, caminho e rota do Fastify', () => {
    const contract = fixtureContract();
    expect(contract.operations.map((operation) => operation.key)).toEqual([
      'GET /healthz',
      'GET /readyz',
      'GET /api/v1/items',
      'POST /api/v1/items',
      'GET /api/v1/items/{id}',
      'DELETE /api/v1/items/{id}',
      'POST /api/v1/auth/login',
    ]);
    const getItem = contract.operation('getItem');
    expect(getItem.routePath).toBe('/api/v1/items/:id');
    expect(getItem.isWrite).toBe(false);
    expect(contract.find('delete', '/api/v1/items/{id}')?.operationId).toBe('deleteItem');
    expect(contract.find('get', '/nao-existe')).toBeUndefined();
  });

  it('resolve a segurança: a da operação, a padrão do contrato ou nenhuma', () => {
    const contract = fixtureContract();
    expect(contract.operation('getItem').security).toEqual([{ sessionCookie: [] }]);
    expect(contract.operation('listItems').security).toEqual([]);
    expect(contract.operation('deleteItem').security).toEqual([
      { sessionCookie: [], csrfToken: [] },
      { apiKey: [] },
    ]);
  });

  it('junta parâmetros do caminho com os da operação e segue $ref de componentes', () => {
    const contract = fixtureContract();
    expect(contract.operation('getItem').parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
    ]);
    const limit = contract.operation('listItems').parameters.find((p) => p.name === 'limit');
    expect(limit).toMatchObject({ in: 'query', required: false, schema: { default: 25 } });
    expect(Object.keys(contract.operation('createItem').requestBody?.content ?? {})).toEqual([
      'application/json',
    ]);
    const statuses = contract.operation('createItem').responses.map((r) => r.status);
    expect(statuses).toEqual([
      '201',
      '400',
      '401',
      '403',
      '413',
      '415',
      '422',
      '429',
      '500',
      '503',
    ]);
    expect(contract.operation('deleteItem').responses[0]?.content).toEqual({});
  });

  it('lança para operação inexistente e para arquivo ausente', () => {
    expect(() => fixtureContract().operation('naoExiste')).toThrow(ContractError);
    expect(() => loadContract('/caminho/que/nao/existe.yaml')).toThrow(/Não consegui ler/);
  });

  it('recusa documento que não sabe aplicar', () => {
    const base = { openapi: '3.1.0', paths: {} };
    expect(() => parseContract({ swagger: '2.0' })).toThrow(/não é um documento OpenAPI/);
    expect(() => parseContract({ openapi: '3.0.3', paths: {} })).toThrow(/só OpenAPI 3.1/);
    expect(() =>
      parseContract({ ...base, paths: { '/a': { get: { responses: { 200: {} } } } } }),
    ).toThrow(/falta o operationId/);
    expect(() =>
      parseContract({
        ...base,
        paths: {
          '/a': { get: { operationId: 'x', responses: { 200: {} } } },
          '/b': { get: { operationId: 'x', responses: { 200: {} } } },
        },
      }),
    ).toThrow(/repetido/);
    expect(() =>
      parseContract({
        ...base,
        paths: {
          '/a': { get: { operationId: 'x', security: [{ fantasma: [] }], responses: { 200: {} } } },
        },
      }),
    ).toThrow(/"fantasma" não declarado/);
    expect(() =>
      parseContract({ ...base, paths: { '/a': { get: { operationId: 'x', responses: {} } } } }),
    ).toThrow(/não declara respostas/);
    expect(() =>
      parseContract({
        ...base,
        paths: {
          '/a': {
            get: { operationId: 'x', responses: { 200: { $ref: '#/components/responses/Nada' } } },
          },
        },
      }),
    ).toThrow(/referência sem destino/);
  });

  it('converte caminhos entre o contrato e o Fastify', () => {
    expect(toRoutePath('/users/{id}/badges/{badgeId}')).toBe('/users/:id/badges/:badgeId');
    expect(toContractPath('/users/:id/badges/:badgeId')).toBe('/users/{id}/badges/{badgeId}');
  });
});

describe('contratos do repositório', () => {
  // A base precisa aceitar os dois contratos reais: todos os esquemas compilam.
  it.each(['admin-api', 'classroom-api'])('carrega e compila o de %s', (app) => {
    const contract = loadContract(new URL(`../../../apps/${app}/openapi.yaml`, import.meta.url));
    const validator = createContractValidator(contract);
    expect(contract.operations.length).toBeGreaterThan(0);
    for (const operation of contract.operations) {
      expect(() => validator.for(operation)).not.toThrow();
    }
    expect(contract.find('get', '/healthz')).toBeDefined();
    expect(contract.find('get', '/readyz')).toBeDefined();
  });
});
