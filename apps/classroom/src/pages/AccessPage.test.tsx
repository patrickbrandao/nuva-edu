import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browser } from '../lib/browser';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  apiRoutes,
  jsonResponse,
  META,
  makeSession,
  noContent,
  problemResponse,
  renderApp,
} from '../test/renderApp';

afterEach(() => vi.restoreAllMocks());

const IDENTITIES = {
  hasPassword: true,
  items: [{ provider: 'google', email: 'ana@gmail.test', createdAt: '2026-11-02T12:00:00Z' }],
};
const SESSIONS = {
  items: [
    {
      id: '0193a5b2-0000-7000-8000-0000000000a1',
      site: 'classroom',
      ip: '203.0.113.10',
      browser: 'Chrome',
      os: 'macOS',
      createdAt: '2026-11-20T12:00:00Z',
      lastUsedAt: '2026-11-24T12:00:00Z',
      current: true,
    },
    {
      id: '0193a5b2-0000-7000-8000-0000000000a2',
      site: 'admin',
      ip: null,
      browser: 'Firefox',
      os: 'Linux',
      createdAt: '2026-11-10T12:00:00Z',
      lastUsedAt: '2026-11-22T12:00:00Z',
      current: false,
    },
  ],
};

type Handlers = Parameters<typeof apiRoutes>[0];
function accessApi(overrides: Handlers = {}) {
  return apiRoutes({
    'GET /api/v1/meta': () => jsonResponse({ ...META, authProviders: ['google', 'apple'] }),
    'GET /api/v1/account/identities': () => jsonResponse(IDENTITIES),
    'GET /api/v1/account/sessions': () => jsonResponse(SESSIONS),
    ...overrides,
  });
}

const section = async (title: string) =>
  within(
    (await screen.findByRole('heading', { level: 2, name: title })).closest(
      'section',
    ) as HTMLElement,
  );

describe('/conta/acesso', () => {
  it('sem sessão leva a /entrar guardando o destino', async () => {
    const { router } = renderApp('/conta/acesso?x=1', accessApi());
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?destino=%2Fconta%2Facesso%3Fx%3D1');
  });

  it('mostra senha, provedores e sessões, sem violações do axe', async () => {
    renderApp('/conta/acesso', accessApi(), { session: makeSession() });
    expect(await screen.findByRole('heading', { level: 1, name: ptBR.access.title })).toBeTruthy();
    const providers = await section(ptBR.access.providers.title);
    expect(await providers.findByText(/Vinculado a ana@gmail.test desde/)).toBeTruthy();
    expect(providers.getByRole('button', { name: 'Remover Google' })).toBeTruthy();
    expect(providers.getByRole('button', { name: 'Vincular Apple' })).toBeTruthy();
    // Facebook não está em authProviders nem vinculado
    expect(providers.queryByText('Facebook')).toBeNull();
    const sessions = await section(ptBR.access.sessions.title);
    expect(await sessions.findByText('Chrome em macOS')).toBeTruthy();
    expect(sessions.getByText(ptBR.access.sessions.current)).toBeTruthy();
    expect(sessions.getByText(/Administração · IP desconhecido · último uso em/)).toBeTruthy();
    expect(sessions.queryByRole('button', { name: /Encerrar a sessão Chrome/ })).toBeNull();
    await expectNoAxeViolations();
  });

  describe('senha', () => {
    it('troca a senha com a atual e recarrega as sessões', async () => {
      const user = userEvent.setup();
      let sessionLists = 0;
      const { calls } = renderApp(
        '/conta/acesso',
        accessApi({
          'PUT /api/v1/account/password': () => noContent(),
          'GET /api/v1/account/sessions': () => {
            sessionLists += 1;
            return jsonResponse(SESSIONS);
          },
        }),
        { session: makeSession() },
      );
      const password = await section(ptBR.access.password.title);
      await user.type(await password.findByLabelText(ptBR.access.password.current), 'senha-antiga');
      await user.type(password.getByLabelText(ptBR.access.password.new), 'senha-nova-1');
      await user.click(password.getByRole('button', { name: ptBR.access.password.change }));

      expect(await password.findByText(ptBR.access.password.saved)).toBeTruthy();
      const put = calls.find((call) => call.path === '/api/v1/account/password');
      expect(put?.body).toEqual({ newPassword: 'senha-nova-1', currentPassword: 'senha-antiga' });
      expect(put?.csrf).toBe('csrf-teste-1');
      await waitFor(() => expect(sessionLists).toBeGreaterThan(1));
    });

    it('conta sem senha define a primeira, sem a senha atual', async () => {
      const user = userEvent.setup();
      const { calls } = renderApp(
        '/conta/acesso',
        accessApi({
          'GET /api/v1/account/identities': () =>
            jsonResponse({ ...IDENTITIES, hasPassword: false }),
          'PUT /api/v1/account/password': () => noContent(),
        }),
        { session: makeSession({ user: { hasPassword: false } }) },
      );
      const password = await section(ptBR.access.password.title);
      expect(password.getByText(ptBR.access.password.setLead)).toBeTruthy();
      expect(password.queryByLabelText(ptBR.access.password.current)).toBeNull();
      await user.type(password.getByLabelText(ptBR.access.password.new), 'senha-nova-1');
      await user.click(password.getByRole('button', { name: ptBR.access.password.set }));
      await waitFor(() =>
        expect(calls.find((call) => call.path === '/api/v1/account/password')?.body).toEqual({
          newPassword: 'senha-nova-1',
        }),
      );
    });

    it.each([
      [422, 'current_password_invalid', ptBR.access.password.currentInvalid, 'current'],
      [400, 'password_invalid', ptBR.password.invalid, 'new'],
    ] as const)('%s %s marca o campo', async (status, code, message, field) => {
      const user = userEvent.setup();
      renderApp(
        '/conta/acesso',
        accessApi({ 'PUT /api/v1/account/password': () => problemResponse(status, code) }),
        { session: makeSession() },
      );
      const password = await section(ptBR.access.password.title);
      await user.type(await password.findByLabelText(ptBR.access.password.current), 'senha-antiga');
      await user.type(password.getByLabelText(ptBR.access.password.new), 'senha-nova-1');
      await user.click(password.getByRole('button', { name: ptBR.access.password.change }));
      expect(await password.findByText(message)).toBeTruthy();
      const input = password.getByLabelText(ptBR.access.password[field]);
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(input);
    });

    it('too_many_attempts (429) mostra o tempo restante', async () => {
      const user = userEvent.setup();
      renderApp(
        '/conta/acesso',
        accessApi({
          'PUT /api/v1/account/password': () =>
            problemResponse(429, 'too_many_attempts', { headers: { 'Retry-After': '600' } }),
        }),
        { session: makeSession() },
      );
      const password = await section(ptBR.access.password.title);
      await user.type(await password.findByLabelText(ptBR.access.password.current), 'x');
      await user.type(password.getByLabelText(ptBR.access.password.new), 'senha-nova-1');
      await user.click(password.getByRole('button', { name: ptBR.access.password.change }));
      expect((await password.findByRole('alert')).textContent).toContain(
        'tente de novo em 10 minutos',
      );
    });

    it('confere os campos antes de enviar', async () => {
      const user = userEvent.setup();
      const { calls } = renderApp('/conta/acesso', accessApi(), { session: makeSession() });
      const password = await section(ptBR.access.password.title);
      await user.click(await password.findByRole('button', { name: ptBR.access.password.change }));
      expect(password.getByText(ptBR.access.password.currentRequired)).toBeTruthy();
      expect(password.getByText(ptBR.password.invalid)).toBeTruthy();
      expect(calls.some((call) => call.path === '/api/v1/account/password')).toBe(false);
    });
  });

  describe('provedores', () => {
    it('"Vincular" navega para startOAuth com intent=link e volta a /conta/acesso', async () => {
      const user = userEvent.setup();
      const assign = vi.spyOn(browser, 'assign').mockImplementation(() => {});
      renderApp('/conta/acesso', accessApi(), { session: makeSession() });
      const providers = await section(ptBR.access.providers.title);
      await user.click(await providers.findByRole('button', { name: 'Vincular Apple' }));
      expect(assign).toHaveBeenCalledWith(
        '/api/v1/auth/apple/start?intent=link&returnTo=%2Fconta%2Facesso',
      );
    });

    it('"Remover" pede confirmação e remove', async () => {
      const user = userEvent.setup();
      let linked = true;
      const { calls } = renderApp(
        '/conta/acesso',
        accessApi({
          'GET /api/v1/account/identities': () =>
            jsonResponse(linked ? IDENTITIES : { ...IDENTITIES, items: [] }),
          'DELETE /api/v1/account/identities/google': () => {
            linked = false;
            return noContent();
          },
        }),
        { session: makeSession() },
      );
      const providers = await section(ptBR.access.providers.title);
      await user.click(await providers.findByRole('button', { name: 'Remover Google' }));
      const dialog = screen.getByRole('alertdialog', { name: ptBR.access.providers.confirmTitle });
      expect(within(dialog).getByText('Google')).toBeTruthy();
      await user.click(within(dialog).getByRole('button', { name: ptBR.access.providers.unlink }));
      expect(await providers.findByRole('button', { name: 'Vincular Google' })).toBeTruthy();
      expect(calls.find((call) => call.method === 'DELETE')?.csrf).toBe('csrf-teste-1');
    });

    it('last_login_method (422) explica que é a única forma de entrar', async () => {
      const user = userEvent.setup();
      renderApp(
        '/conta/acesso',
        accessApi({
          'DELETE /api/v1/account/identities/google': () =>
            problemResponse(422, 'last_login_method'),
        }),
        { session: makeSession() },
      );
      const providers = await section(ptBR.access.providers.title);
      await user.click(await providers.findByRole('button', { name: 'Remover Google' }));
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: ptBR.access.providers.unlink,
        }),
      );
      expect((await providers.findByRole('alert')).textContent).toContain(
        ptBR.access.providers.lastMethod,
      );
    });

    it.each([
      ['identity_in_use', ptBR.login.oauth.codes.identity_in_use],
      ['oauth_denied', ptBR.login.oauth.codes.oauth_denied],
      ['outro', ptBR.login.oauth.codes.unknown],
    ])('mostra o ?erro=%s da volta do vínculo', async (code, message) => {
      renderApp(`/conta/acesso?erro=${code}`, accessApi(), { session: makeSession() });
      const alert = (await screen.findByText(ptBR.access.providers.linkErrorTitle)).closest(
        '[role="alert"]',
      );
      expect(alert?.textContent).toContain(message);
    });
  });

  describe('sessões', () => {
    it('encerra uma sessão', async () => {
      const user = userEvent.setup();
      const { calls } = renderApp(
        '/conta/acesso',
        accessApi({
          'DELETE /api/v1/account/sessions/0193a5b2-0000-7000-8000-0000000000a2': () => noContent(),
        }),
        { session: makeSession() },
      );
      const sessions = await section(ptBR.access.sessions.title);
      await user.click(
        await sessions.findByRole('button', { name: 'Encerrar a sessão Firefox em Linux' }),
      );
      expect(await sessions.findByText('Sessão Firefox em Linux encerrada.')).toBeTruthy();
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
    });

    it('encerra as outras, com confirmação', async () => {
      const user = userEvent.setup();
      const { calls } = renderApp(
        '/conta/acesso',
        accessApi({ 'DELETE /api/v1/account/sessions': () => noContent() }),
        { session: makeSession() },
      );
      const sessions = await section(ptBR.access.sessions.title);
      await user.click(
        await sessions.findByRole('button', { name: ptBR.access.sessions.revokeOthers }),
      );
      const dialog = screen.getByRole('alertdialog', { name: ptBR.access.sessions.confirmTitle });
      expect(within(dialog).getByText('1 outra sessão')).toBeTruthy();
      await user.click(
        within(dialog).getByRole('button', { name: ptBR.access.sessions.revokeOthers }),
      );
      expect(await sessions.findByText(ptBR.access.sessions.othersRevoked)).toBeTruthy();
      expect(
        calls.some((call) => call.method === 'DELETE' && call.path === '/api/v1/account/sessions'),
      ).toBe(true);
    });

    it('com as rotas ainda inexistentes (404) cada seção mostra um erro tratado', async () => {
      renderApp('/conta/acesso', apiRoutes({ 'GET /api/v1/meta': () => jsonResponse(META) }), {
        session: makeSession(),
      });
      const sessions = await section(ptBR.access.sessions.title);
      expect((await sessions.findByRole('alert')).textContent).toContain(ptBR.errors.notAvailable);
      const providers = await section(ptBR.access.providers.title);
      expect((await providers.findByRole('alert')).textContent).toContain(
        ptBR.access.providers.errorTitle,
      );
      // a troca de senha continua disponível
      expect(screen.getByLabelText(ptBR.access.password.new)).toBeTruthy();
    });
  });
});
