import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { defaultRoutes } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { paymentSettings } from '../../test/payments';
import { renderApp } from '../../test/render';
import { PaymentSettingsSection } from './PaymentSettingsSection';

const SECTION_ROUTES = [{ path: '/configuracoes', element: <PaymentSettingsSection /> }];

describe('pagamento em configurações', () => {
  it('mostra o provedor, o modo de teste e o aviso de produção', async () => {
    renderApp(
      '/configuracoes',
      {
        ...defaultRoutes(),
        'GET /api/v1/settings/payments': paymentSettings({
          testMode: true,
          productionWarning: true,
        }),
      },
      { routes: SECTION_ROUTES },
    );

    expect(
      await screen.findByText(
        'Esta instalação está em produção e usa um token de teste: nenhuma cobrança é real.',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Pagamentos em modo de teste: as cobranças são simuladas.'),
    ).toBeTruthy();
    expect(screen.getByText('Mercado Pago')).toBeTruthy();
    expect(screen.getByText('Teste')).toBeTruthy();
    expect(
      screen.getByText(
        'As credenciais ficam nas variáveis de ambiente do servidor e nunca são exibidas.',
      ),
    ).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('em produção sem token de teste, mostra o modo real e a última reconciliação', async () => {
    renderApp(
      '/configuracoes',
      { ...defaultRoutes(), 'GET /api/v1/settings/payments': paymentSettings() },
      { routes: SECTION_ROUTES },
    );

    expect(await screen.findByText('Produção')).toBeTruthy();
    expect(
      screen.queryByText('Pagamentos em modo de teste: as cobranças são simuladas.'),
    ).toBeNull();
    expect(screen.queryByText(/token de teste/)).toBeNull();
    expect(screen.getByText('Última reconciliação')).toBeTruthy();
  });

  it('mostra "ainda não houve" quando a reconciliação nunca rodou', async () => {
    renderApp(
      '/configuracoes',
      {
        ...defaultRoutes(),
        'GET /api/v1/settings/payments': paymentSettings({ lastReconciliationAt: null }),
      },
      { routes: SECTION_ROUTES },
    );
    expect(await screen.findByText('Ainda não houve')).toBeTruthy();
  });
});
