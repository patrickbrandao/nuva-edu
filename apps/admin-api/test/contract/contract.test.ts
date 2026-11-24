import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { formatContractReport, formatContractWarnings } from '@nuva-edu/api-kit';
import { afterAll, describe, expect, it } from 'vitest';
import { CSRF_EXCEPTIONS } from '../../src/contract.ts';
import { createTestApp } from '../helpers.ts';

describe('contrato da admin-api', () => {
  const test = createTestApp();
  afterAll(() => test.close());

  it('toda rota registrada existe no openapi.yaml e vice-versa, e toda escrita exige csrfToken', () => {
    const report = test.app.checkContract({ csrfExceptions: CSRF_EXCEPTIONS });
    // Operação com `x-nuva-pending` não reprova o teste, mas aparece na saída (spec 003).
    for (const warning of formatContractWarnings(report)) {
      console.warn(`contrato da admin-api: ${warning}`);
    }
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

  it('o comando check-contract confere o mesmo, sem banco e sem subir o servidor', async () => {
    // Sem `--no-pending`: operação pendente é esperada durante uma janela de contrato.
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../../src/check-contract.ts', import.meta.url))],
      // Banco inalcançável de propósito: o comando não pode depender dele.
      { env: { PATH: process.env.PATH, DATABASE_URL: 'postgres://x@127.0.0.1:1/x' } },
    );
    expect(stdout).toMatch(/^check-contract admin-api: contrato e rotas conferem \(\d+ operações/);
    expect(stderr.split('\n').filter((line) => line !== '' && !line.includes('aviso:'))).toEqual(
      [],
    );
  });
});
