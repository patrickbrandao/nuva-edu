import { afterAll, describe, expect, it } from 'vitest';
import { CSRF_EXCEPTIONS } from '../../src/contract.ts';
import { createTestApp } from '../helpers.ts';

// Webhook do Mercado Pago (spec 013, "Webhook"): público e sem CSRF porque quem chama é o
// provedor, autenticado pela assinatura `x-signature`. A exceção é por `operationId`, mas o teste
// fixa método e caminho: renomear a operação no contrato não pode alargar a dispensa em silêncio.
describe('exceção de CSRF do webhook do Mercado Pago', () => {
  const test = createTestApp();
  afterAll(() => test.close());

  it('a exceção é a operação exata POST /api/v1/webhooks/mercadopago, pública', () => {
    expect(CSRF_EXCEPTIONS).toContain('receiveMercadoPagoWebhook');

    const operation = test.app.contract.operation('receiveMercadoPagoWebhook');
    expect(operation.method).toBe('post');
    expect(operation.path).toBe('/api/v1/webhooks/mercadopago');
    expect(operation.isWrite).toBe(true);
    // Sem alternativa de segurança: o tratador de CSRF não roda e a assinatura é a autenticação.
    expect(operation.security).toEqual([]);
  });

  it('com a exceção, o contrato não acusa escrita sem csrfToken nem exceção ociosa', () => {
    const report = test.app.checkContract({ csrfExceptions: CSRF_EXCEPTIONS });
    expect(report.writesWithoutCsrf).toEqual([]);
    expect(report.staleCsrfExceptions).toEqual([]);
  });

  it('sem a exceção, só o webhook fica sem csrfToken: as demais escritas continuam exigindo', () => {
    const report = test.app.checkContract({
      csrfExceptions: CSRF_EXCEPTIONS.filter((id) => id !== 'receiveMercadoPagoWebhook'),
    });
    // Exatamente uma divergência: a dispensa não alcança nenhuma outra escrita.
    expect(report.writesWithoutCsrf).toEqual(['receiveMercadoPagoWebhook']);
    expect(report.staleCsrfExceptions).toEqual([]);
  });
});
