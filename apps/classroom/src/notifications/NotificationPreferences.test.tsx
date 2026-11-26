import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { notificationPrefs, PREFS_URL, SAVE_PREFS_URL } from '../test/notifications';
import {
  apiRoutes,
  findAlert,
  jsonResponse,
  makeSession,
  problemResponse,
  renderApp,
} from '../test/renderApp';

const session = makeSession();
const t = ptBR.notifications.preferences;

const section = () =>
  screen.getByRole('heading', { name: t.title, level: 2 }).closest('section') as HTMLElement;

describe('/conta/notificacoes', () => {
  it('sem sessão leva a /entrar com o destino', async () => {
    const { router } = renderApp('/conta/notificacoes');
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?destino=%2Fconta%2Fnotificacoes');
  });

  it('mostra os onze grupos, com o e-mail obrigatório travado e o motivo ao leitor de tela', async () => {
    renderApp(
      '/conta/notificacoes',
      apiRoutes({ [PREFS_URL]: () => jsonResponse(notificationPrefs()) }),
      { session },
    );

    expect(await screen.findByRole('heading', { level: 1, name: t.title })).toBeTruthy();
    const region = section();

    for (const group of Object.values(t.groups)) {
      expect(within(region).getByText(group)).toBeTruthy();
    }
    // conta, compras, suporte e moderação: e-mail sempre ligado, com o motivo no texto oculto
    const locked = within(region)
      .getAllByRole('switch', { name: /: E-mail$/ })
      .filter((item) => (item as HTMLInputElement).disabled);
    expect(locked).toHaveLength(4);
    expect(within(region).getAllByText(t.required)).toHaveLength(4);
    expect(within(region).getAllByText(t.requiredReason)).toHaveLength(4);
    // o grupo de conta não tem canal de plataforma
    expect(
      within(region).queryByRole('switch', { name: `${t.groups.account}: ${t.inApp}` }),
    ).toBeNull();

    await expectNoAxeViolations();
  });

  it('desligar o e-mail do fórum grava só aquele canal e anuncia que salvou', async () => {
    const user = userEvent.setup();
    const prefs = notificationPrefs({
      forum: { email: false },
    });
    const { calls } = renderApp(
      '/conta/notificacoes',
      apiRoutes({
        [PREFS_URL]: () => jsonResponse(notificationPrefs()),
        [SAVE_PREFS_URL]: () => jsonResponse(prefs),
      }),
      { session },
    );

    const toggle = (await screen.findByRole('switch', {
      name: `${t.groups.forum}: ${t.email}`,
    })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await user.click(toggle);

    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        forum: { email: false },
      }),
    );
    await waitFor(() => expect(toggle.checked).toBe(false));
    expect(await screen.findByText(t.saved)).toBeTruthy();
  });

  it('a API recusando devolve o canal ao estado anterior e avisa', async () => {
    const user = userEvent.setup();
    renderApp(
      '/conta/notificacoes',
      apiRoutes({
        [PREFS_URL]: () => jsonResponse(notificationPrefs()),
        [SAVE_PREFS_URL]: () => problemResponse(400, 'validation_failed'),
      }),
      { session },
    );

    const toggle = (await screen.findByRole('switch', {
      name: `${t.groups.forum}: ${t.email}`,
    })) as HTMLInputElement;
    await user.click(toggle);

    expect(await findAlert()).toBeTruthy();
    await waitFor(() => expect(toggle.checked).toBe(true));
    expect(screen.queryByText(t.saved)).toBeNull();
  });

  it('desligar a plataforma do fórum mantém o e-mail e manda só o canal mexido', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      '/conta/notificacoes',
      apiRoutes({
        [PREFS_URL]: () => jsonResponse(notificationPrefs()),
        [SAVE_PREFS_URL]: () => jsonResponse(notificationPrefs({ forum: { inApp: false } })),
      }),
      { session },
    );

    await user.click(await screen.findByRole('switch', { name: `${t.groups.forum}: ${t.inApp}` }));
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        forum: { inApp: false },
      }),
    );
  });
});
