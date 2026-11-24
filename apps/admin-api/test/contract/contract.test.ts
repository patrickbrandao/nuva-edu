import { formatContractReport } from '@nuva-edu/api-kit';
import { afterAll, describe, expect, it } from 'vitest';
import { CSRF_EXCEPTIONS } from '../../src/contract.ts';
import { createTestApp } from '../helpers.ts';

describe('contrato da admin-api', () => {
  const test = createTestApp();
  afterAll(() => test.close());

  it('toda rota registrada existe no openapi.yaml e vice-versa, e toda escrita exige csrfToken', () => {
    const report = test.app.checkContract({ csrfExceptions: CSRF_EXCEPTIONS });
    // A mensagem lista cada divergência; vazia quando não há nenhuma.
    expect(formatContractReport(report)).toBe('');
    expect(report.ok).toBe(true);
  });

  it('só /metrics fica fora do contrato', () => {
    const declared = new Set(test.app.contract.operations.map((operation) => operation.routePath));
    const outside = test.app
      .registeredRoutes()
      .filter((route) => !declared.has(route.path))
      .map((route) => `${route.method} ${route.path}`);
    expect(outside).toEqual(['GET /metrics']);
  });

  it('o serviço sobe com o contrato atual', async () => {
    await expect(test.app.ready()).resolves.toBeDefined();
  });
});
