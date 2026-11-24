import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  apiRoutes,
  jsonResponse,
  makeSession,
  problemResponse,
  renderApp,
} from '../test/renderApp';

const IMAGE = {
  id: '0193a5b2-0000-7000-8000-0000000000f1',
  purpose: 'avatar',
  width: 800,
  height: 800,
  variants: [{ width: 256, height: 256, url: '/api/v1/images/f1/256.webp' }],
};
const AVATAR_URL = '/api/v1/images/0193a5b2-0000-7000-8000-0000000000f1/256.webp';

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:http://classroom.test/1');
  URL.revokeObjectURL = vi.fn();
});

const photo = (type = 'image/png', size = 1024) =>
  new File([new Uint8Array(size)], 'foto.png', { type });

function choose(file: File) {
  fireEvent.change(screen.getByTestId('image-picker-input'), { target: { files: [file] } });
}

/** API em que a sessão acompanha o avatar gravado. */
function profileApi(overrides: Parameters<typeof apiRoutes>[0] = {}) {
  let avatarUrl: string | null = null;
  return apiRoutes({
    'GET /api/v1/session': () => jsonResponse(makeSession({ user: { avatarUrl } })),
    'POST /api/v1/images': () => jsonResponse(IMAGE, 201),
    'PUT /api/v1/me/profile/avatar': async (request) => {
      const { imageId } = (await request.json()) as { imageId: string | null };
      avatarUrl = imageId ? AVATAR_URL : null;
      return jsonResponse({ avatarUrl });
    },
    ...overrides,
  });
}

describe('/conta/perfil', () => {
  it('sem sessão leva a /entrar', async () => {
    const { router } = renderApp('/conta/perfil', profileApi());
    await waitFor(() => expect(router.state.location.pathname).toBe('/entrar'));
    expect(router.state.location.search).toBe('?destino=%2Fconta%2Fperfil');
  });

  it('envia a foto (multipart, finalidade avatar), associa e atualiza o avatar da sessão', async () => {
    const { calls } = renderApp('/conta/perfil', profileApi(), { session: 'fetch' });
    expect(await screen.findByRole('group', { name: ptBR.profile.avatar.label })).toBeTruthy();
    expect(
      within(screen.getByRole('group', { name: ptBR.profile.avatar.label })).getByText('AS'),
    ).toBeTruthy();
    await expectNoAxeViolations();

    choose(photo());
    expect(await screen.findByText(ptBR.profile.saved)).toBeTruthy();
    const upload = calls.find((call) => call.path === '/api/v1/images');
    expect(upload?.method).toBe('POST');
    expect(String(upload?.body)).toContain('name="purpose"');
    expect(String(upload?.body)).toContain('avatar');
    expect(upload?.csrf).toBe('csrf-teste-1');
    expect(calls.find((call) => call.path === '/api/v1/me/profile/avatar')?.body).toEqual({
      imageId: IMAGE.id,
    });
    await waitFor(() =>
      expect(screen.getByAltText(ptBR.profile.avatar.previewAlt).getAttribute('src')).toBe(
        AVATAR_URL,
      ),
    );
  });

  it('remove a foto com imageId nulo', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      '/conta/perfil',
      apiRoutes({
        'PUT /api/v1/me/profile/avatar': () => jsonResponse({ avatarUrl: null }),
      }),
      { session: makeSession({ user: { avatarUrl: AVATAR_URL } }) },
    );
    await user.click(await screen.findByRole('button', { name: ptBR.profile.avatar.remove }));
    expect(await screen.findByText(ptBR.profile.removed)).toBeTruthy();
    expect(calls.find((call) => call.path === '/api/v1/me/profile/avatar')?.body).toEqual({
      imageId: null,
    });
  });

  it('recusa no navegador arquivo grande ou de outro tipo, sem enviar', async () => {
    const { calls } = renderApp('/conta/perfil', profileApi(), { session: 'fetch' });
    await screen.findByRole('group', { name: ptBR.profile.avatar.label });
    choose(photo('image/gif'));
    expect((await screen.findByRole('alert')).textContent).toBe(ptBR.profile.errors.wrongType);
    choose(photo('image/png', 6 * 1024 * 1024));
    expect((await screen.findByRole('alert')).textContent).toBe(ptBR.profile.errors.tooLarge);
    expect(calls.some((call) => call.path === '/api/v1/images')).toBe(false);
  });

  it.each([
    [413, 'payload_too_large', ptBR.profile.errors.tooLarge, {}],
    [415, 'image_type_unsupported', ptBR.profile.errors.wrongType, {}],
    [422, 'image_dimensions_exceeded', ptBR.profile.errors.dimensions, {}],
    [422, 'image_too_heavy', ptBR.profile.errors.tooHeavy, {}],
    [
      429,
      'rate_limited',
      'Você enviou muitas imagens na última hora. Tente de novo em 20 minutos.',
      { headers: { 'Retry-After': '1200' } },
    ],
  ])('envio recusado com %s %s mostra a mensagem', async (status, code, message, extra) => {
    renderApp(
      '/conta/perfil',
      profileApi({ 'POST /api/v1/images': () => problemResponse(status, code, extra) }),
      { session: 'fetch' },
    );
    await screen.findByRole('group', { name: ptBR.profile.avatar.label });
    choose(photo());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(message);
    // a prévia da imagem recusada some
    expect(screen.queryByAltText(ptBR.profile.avatar.previewAlt)).toBeNull();
  });

  it('image_purpose_mismatch (422) na associação mostra um erro tratado', async () => {
    renderApp(
      '/conta/perfil',
      profileApi({
        'PUT /api/v1/me/profile/avatar': () => problemResponse(422, 'image_purpose_mismatch'),
      }),
      { session: 'fetch' },
    );
    await screen.findByRole('group', { name: ptBR.profile.avatar.label });
    choose(photo());
    expect((await screen.findByRole('alert')).textContent).toContain(ptBR.profile.errors.generic);
  });

  it('com as rotas ainda inexistentes (404) mostra um erro tratado', async () => {
    renderApp('/conta/perfil', apiRoutes({}), { session: makeSession() });
    const group = await screen.findByRole('group', { name: ptBR.profile.avatar.label });
    choose(photo());
    // o seletor é remontado depois da falha (some a prévia): procura de novo na página
    expect(group).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toContain(ptBR.errors.notAvailable);
  });
});
