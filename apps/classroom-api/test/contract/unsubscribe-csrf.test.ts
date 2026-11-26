import { afterAll, describe, expect, it } from 'vitest';
import { CSRF_EXCEPTIONS } from '../../src/contract.ts';
import { createTestApp } from '../helpers.ts';

// Descadastro por token (spec 024, "Links com token", RF-07): o link chega do cliente de e-mail,
// sem sessão e sem token CSRF. A exceção é por `operationId`, mas o teste fixa método e caminho:
// renomear a operação no contrato não pode alargar a dispensa em silêncio.
describe('exceção de CSRF do descadastro por token', () => {
  const test = createTestApp();
  afterAll(() => test.close());

  it('a exceção é a operação exata POST /api/v1/unsubscribe/{token}, pública', () => {
    expect(CSRF_EXCEPTIONS).toContain('unsubscribe');

    const operation = test.app.contract.operation('unsubscribe');
    expect(operation.method).toBe('post');
    expect(operation.path).toBe('/api/v1/unsubscribe/{token}');
    expect(operation.isWrite).toBe(true);
    // Sem alternativa de segurança: o tratador de CSRF não roda e o token do caminho autentica.
    expect(operation.security).toEqual([]);
  });

  it('com a exceção, o contrato não acusa escrita sem csrfToken nem exceção ociosa', () => {
    const report = test.app.checkContract({ csrfExceptions: CSRF_EXCEPTIONS });
    expect(report.writesWithoutCsrf).toEqual([]);
    expect(report.staleCsrfExceptions).toEqual([]);
  });

  it('sem a exceção, só o descadastro fica sem csrfToken: as demais escritas continuam exigindo', () => {
    const report = test.app.checkContract({
      csrfExceptions: CSRF_EXCEPTIONS.filter((id) => id !== 'unsubscribe'),
    });
    // Exatamente uma divergência: a dispensa não alcança nenhuma outra escrita.
    expect(report.writesWithoutCsrf).toEqual(['unsubscribe']);
    expect(report.staleCsrfExceptions).toEqual([]);
  });
});
