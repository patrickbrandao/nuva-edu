import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { defaultRoutes, problem, type Routes } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import { WEBHOOK_ID, webhookEvent } from '../../test/payments';
import { findMenu, renderApp } from '../../test/render';

const REJECTED = webhookEvent({
  id: '0193a5b2-0000-7000-8000-0000000000e2',
  eventId: null,
  resourceType: null,
  resourceId: null,
  status: 'rejected',
  attempts: 0,
  error: 'invalid_signature',
});

function operationsRoutes(extra: Routes = {}) {
  const queries: URLSearchParams[] = [];
  const routes: Routes = {
    ...defaultRoutes(),
    'GET /api/v1/webhook-events': (request: Request) => {
      const params = new URL(request.url).searchParams;
      queries.push(params);
      return params.get('status') === 'rejected'
        ? { items: [REJECTED], nextCursor: null }
        : { items: [webhookEvent()], nextCursor: null };
    },
    ...extra,
  };
  return { routes, queries };
}

describe('operação (/operacao)', () => {
  it('lista os webhooks com falha e permite reprocessar, sem violações do axe', async () => {
    const { routes, queries } = operationsRoutes();
    renderApp('/operacao', routes);

    expect(await screen.findByRole('heading', { name: 'Operação', level: 1 })).toBeTruthy();
    const table = (await screen.findByRole('table')) as HTMLElement;
    expect(within(table).getByText('evt-1')).toBeTruthy();
    expect(within(table).getByText('Cobrança mp-123')).toBeTruthy();
    expect(within(table).getByText('Falhou')).toBeTruthy();
    expect(within(table).getByText('8')).toBeTruthy();
    expect(within(table).getByText('amount_mismatch')).toBeTruthy();
    expect(within(table).getByRole('button', { name: 'Reprocessar' })).toBeTruthy();
    expect(queries[0]?.get('status')).toBe('failed');
    await expectNoAxeViolations();
  });

  it('reprocessa o aviso e recarrega a fila', async () => {
    const user = userEvent.setup();
    let retried: string | null = null;
    const { routes } = operationsRoutes({
      [`POST /api/v1/webhook-events/${WEBHOOK_ID}/retry`]: (request: Request) => {
        retried = new URL(request.url).pathname;
        return webhookEvent({ status: 'received', attempts: 0 });
      },
    });
    renderApp('/operacao', routes);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Reprocessar' }));
    await waitFor(() => expect(retried).toBe(`/api/v1/webhook-events/${WEBHOOK_ID}/retry`));
    expect(await screen.findByText('Aviso enfileirado de novo.')).toBeTruthy();
  });

  it('mostra a trilha de recusados somente leitura, sem ação de reprocessar', async () => {
    const user = userEvent.setup();
    const { routes, queries } = operationsRoutes();
    renderApp('/operacao', routes);
    await screen.findByRole('table');

    await user.click(screen.getByRole('tab', { name: 'Recusados' }));
    await waitFor(() => expect(queries.at(-1)?.get('status')).toBe('rejected'));
    const table = (await screen.findByRole('table')) as HTMLElement;
    expect(await within(table).findByText('invalid_signature')).toBeTruthy();
    expect(within(table).getByText('Recusado')).toBeTruthy();
    expect(within(table).queryByRole('button', { name: 'Reprocessar' })).toBeNull();
    expect(within(table).queryByText('Tentativas')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reprocessar' })).toBeNull();
  });

  it('avisa quando a API recusa o reprocessamento', async () => {
    const user = userEvent.setup();
    const { routes } = operationsRoutes({
      [`POST /api/v1/webhook-events/${WEBHOOK_ID}/retry`]: problem(
        409,
        'webhook_event_not_retryable',
      ),
    });
    renderApp('/operacao', routes);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Reprocessar' }));
    expect(await screen.findByText('Este aviso não pode ser reprocessado.')).toBeTruthy();
  });

  it('esconde a operação do gerente e recusa o endereço aberto à força', async () => {
    renderApp('/operacao', defaultRoutes('manager'));
    const menu = await findMenu();
    expect(within(menu).queryByRole('link', { name: 'Operação' })).toBeNull();
    expect(await screen.findByText('Sem permissão')).toBeTruthy();
  });
});
