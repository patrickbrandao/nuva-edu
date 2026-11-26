import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  CLEAR_URL,
  FakeEventSource,
  LIST_URL,
  notificationItem,
  notificationPage,
  UNREAD_URL,
  uuid,
} from '../test/notifications';
import { apiRoutes, jsonResponse, makeSession, RUNTIME_CONFIG, renderApp } from '../test/renderApp';

const session = makeSession();
const t = ptBR.notifications;

const bell = (count: number) =>
  screen.getByRole('button', { name: t.bell.button_other.replace('{{count}}', String(count)) });

const stream = () => FakeEventSource.latest;

describe('sino de notificações', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    FakeEventSource.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.reset();
  });

  it('abre uma conexão por aba, com cookie, no fluxo da classroom-api', async () => {
    renderApp(
      '/',
      apiRoutes({
        [UNREAD_URL]: () => jsonResponse({ unreadCount: 2 }),
        [LIST_URL]: () => jsonResponse(notificationPage([])),
      }),
      { session },
    );

    await screen.findByRole('button', { name: t.bell.button_other.replace('{{count}}', '2') });
    const source = stream();
    expect(source.url).toBe('/api/v1/stream');
    expect(source.withCredentials).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('o contador muda com notification.created, sem recarregar a página', async () => {
    const { calls } = renderApp(
      '/',
      apiRoutes({
        [UNREAD_URL]: () => jsonResponse({ unreadCount: 1 }),
        [LIST_URL]: () => jsonResponse(notificationPage([])),
      }),
      { session },
    );

    await screen.findByRole('button', { name: t.bell.button_one.replace('{{count}}', '1') });
    const source = stream();
    act(() => source.open());

    act(() =>
      source.emit('notification.created', {
        notificationId: uuid(7),
        type: 'forum.reply',
        unreadCount: 4,
      }),
    );
    await waitFor(() => expect(bell(4)).toBeTruthy());

    // outro evento do fluxo não mexe no sino
    act(() => source.emit('presence', { online: true }));
    expect(
      screen.getByRole('button', { name: t.bell.button_other.replace('{{count}}', '4') }),
    ).toBeTruthy();
    // a página não foi recarregada: nada além da sessão, do meta, do contador e da lista
    expect(calls.filter((call) => call.path === '/api/v1/notifications')).toHaveLength(0);
  });

  it('o painel mostra a lista e o item novo da SSE aparece sem recarregar', async () => {
    const user = userEvent.setup();
    const existing = notificationItem({ id: uuid(1) });
    const incoming = notificationItem({
      id: uuid(2),
      type: 'certificate.issued',
      group: 'courses',
      actor: null,
      targetType: 'certificate',
      targetId: 'CERT-9',
      data: { courseTitle: 'React do zero' },
    });
    let current = [existing];
    renderApp(
      '/',
      apiRoutes({
        [UNREAD_URL]: () => jsonResponse({ unreadCount: 1 }),
        [LIST_URL]: () => jsonResponse(notificationPage(current)),
      }),
      { session },
    );

    await screen.findByRole('button', { name: t.bell.button_one.replace('{{count}}', '1') });
    act(() => stream().open());

    await user.click(
      screen.getByRole('button', { name: t.bell.button_one.replace('{{count}}', '1') }),
    );
    const panel = await screen.findByRole('dialog', { name: t.title });
    expect(within(panel).getByText(t.types.forumReply)).toBeTruthy();
    await expectNoAxeViolations();

    current = [incoming, existing];
    act(() =>
      stream().emit('notification.created', {
        notificationId: incoming.id,
        type: incoming.type,
        unreadCount: 2,
      }),
    );

    expect(await within(panel).findByText(t.types.certificateIssued)).toBeTruthy();
    expect(within(panel).getByText('React do zero')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: t.bell.viewAll }).getAttribute('href')).toBe(
      '/notificacoes',
    );
  });

  it('"limpar todas" pede confirmação e não fecha o painel do sino', async () => {
    const user = userEvent.setup();
    const item = notificationItem();
    const { calls } = renderApp(
      '/',
      apiRoutes({
        [UNREAD_URL]: () => jsonResponse({ unreadCount: 1 }),
        [LIST_URL]: () => jsonResponse(notificationPage([item])),
        [CLEAR_URL]: () => jsonResponse({ deleted: 1 }),
      }),
      { session },
    );

    await screen.findByRole('button', { name: t.bell.button_one.replace('{{count}}', '1') });
    await user.click(
      screen.getByRole('button', { name: t.bell.button_one.replace('{{count}}', '1') }),
    );
    const panel = await screen.findByRole('dialog', { name: t.title });
    await within(panel).findByText(t.types.forumReply);

    await user.click(within(panel).getByRole('button', { name: t.clearAll }));
    const dialog = await screen.findByRole('alertdialog', { name: t.clearTitle });
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: t.clearConfirm }));

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('dialog', { name: t.title })).toBeTruthy();
    expect(
      within(screen.getByRole('dialog', { name: t.title })).getByText(t.emptyTitle),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: t.bell.none })).toBeTruthy();
  });

  it('ao reconectar recarrega o contador e a lista (nada depende de ter recebido tudo)', async () => {
    const { calls } = renderApp(
      '/',
      apiRoutes({
        [UNREAD_URL]: () => jsonResponse({ unreadCount: 1 }),
        [LIST_URL]: () => jsonResponse(notificationPage([])),
      }),
      { session },
    );

    await screen.findByRole('button', { name: t.bell.button_one.replace('{{count}}', '1') });
    act(() => stream().open());
    const counts = () =>
      calls.filter((call) => call.path === '/api/v1/notifications/unread-count').length;
    const before = counts();

    act(() => stream().fail());
    act(() => stream().open());

    await waitFor(() => expect(counts()).toBeGreaterThan(before));
  });

  it('sem sessão não abre o fluxo e o sino leva ao login', async () => {
    renderApp('/', apiRoutes({}), { session: null, config: RUNTIME_CONFIG });
    // o sino do visitante é o link da barra (o menu também tem um "Notificações", com texto)
    const link = await screen.findByTitle(ptBR.shell.notifications);
    expect(link.getAttribute('href')).toBe('/notificacoes');
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
