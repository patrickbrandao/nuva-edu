import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import {
  CLEAR_URL,
  LIST_URL,
  notificationItem,
  notificationPage,
  READ_ALL_URL,
  readUrl,
  UNREAD_URL,
  uuid,
} from '../test/notifications';
import {
  apiRoutes,
  jsonResponse,
  makeSession,
  problemResponse,
  renderApp,
} from '../test/renderApp';

const session = makeSession();
const t = ptBR.notifications;

/** A região da lista da central (o componente de @nuva-edu/ui). */
function list(): HTMLElement {
  return screen.getByRole('region', { name: t.list.region });
}

/** As rotas da página: sem notificações e sino zerado, salvo o que o teste mudar. */
const routes = (extra: Parameters<typeof apiRoutes>[0] = {}) =>
  apiRoutes({
    [LIST_URL]: () => jsonResponse(notificationPage([])),
    [UNREAD_URL]: () => jsonResponse({ unreadCount: 0 }),
    ...extra,
  });

const grouped = (count: number) => t.grouped_other.replace('{{count}}', String(count));

describe('/notificacoes', () => {
  it('lista tipo, texto, agrupamento, tempo e o link do alvo; marca as não lidas', async () => {
    const forum = notificationItem({ count: 4 });
    const order = notificationItem({
      id: uuid(2),
      type: 'order.approved',
      group: 'purchase',
      actor: null,
      targetType: 'order',
      targetId: uuid(30),
      data: { title: 'Pedido nº 1042' },
      readAt: '2026-11-19T12:00:00Z',
    });
    renderApp(
      '/notificacoes',
      routes({
        [UNREAD_URL]: () => jsonResponse({ unreadCount: 1 }),
        [LIST_URL]: () => jsonResponse(notificationPage([forum, order])),
      }),
      { session },
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: ptBR.menu.items.notifications }),
    ).toBeTruthy();
    const region = list();

    const forumLink = await within(region).findByRole('link', {
      name: new RegExp(t.types.forumReply),
    });
    expect(forumLink.getAttribute('href')).toBe(`/forum/t/${forum.targetId}`);
    expect(within(forumLink).getByText('Como começar')).toBeTruthy();
    expect(within(forumLink).getByText(grouped(3))).toBeTruthy();
    expect(forumLink.querySelector('time')?.getAttribute('dateTime')).toBe(forum.createdAt);
    expect(within(region).getAllByText(t.unread)).toHaveLength(1);

    const orderLink = within(region).getByRole('link', { name: new RegExp(t.types.orderApproved) });
    expect(orderLink.getAttribute('href')).toBe(`/pedidos/${order.targetId}`);
    expect(within(orderLink).getByText('Pedido nº 1042')).toBeTruthy();

    await expectNoAxeViolations();
  });

  it('abre o item sem alvo, marca como lido e zera o sino sem recarregar', async () => {
    const user = userEvent.setup();
    const item = notificationItem({ targetType: null, targetId: null, actor: null });
    const read = { ...item, readAt: '2026-11-25T12:00:00Z' };
    const { calls } = renderApp(
      '/notificacoes',
      routes({
        [UNREAD_URL]: () => jsonResponse({ unreadCount: 1 }),
        [LIST_URL]: () => jsonResponse(notificationPage([item])),
        [readUrl(item.id)]: () => jsonResponse({ notification: read, unreadCount: 0 }),
      }),
      { session },
    );

    expect(
      await screen.findByRole('button', { name: t.bell.button_one.replace('{{count}}', '1') }),
    ).toBeTruthy();
    await user.click(
      await within(list()).findByRole('button', { name: new RegExp(t.types.forumReply) }),
    );

    await waitFor(() =>
      expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toContain(
        `/api/v1/notifications/${item.id}/read`,
      ),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: t.bell.none })).toBeTruthy());
    expect(within(list()).queryByText(t.unread)).toBeNull();
  });

  it('marca todas como lidas: a API recebe o pedido e o sino zera', async () => {
    const user = userEvent.setup();
    const first = notificationItem({ id: uuid(1) });
    const second = notificationItem({ id: uuid(2), type: 'dm.received', group: 'messages' });
    const { calls } = renderApp(
      '/notificacoes',
      routes({
        [UNREAD_URL]: () => jsonResponse({ unreadCount: 2 }),
        [LIST_URL]: () => jsonResponse(notificationPage([first, second])),
        [READ_ALL_URL]: () => jsonResponse({ updated: 2, unreadCount: 0 }),
      }),
      { session },
    );

    const region = await screen.findByRole('region', { name: t.list.region });
    await within(region).findAllByText(t.unread);
    await user.click(within(region).getByRole('button', { name: t.markAll }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/read-all'))).toBe(
        true,
      ),
    );
    await waitFor(() => expect(within(region).queryByText(t.unread)).toBeNull());
    expect(screen.getByRole('button', { name: t.bell.none })).toBeTruthy();
  });

  it('limpar todas pede confirmação e só então apaga na API', async () => {
    const user = userEvent.setup();
    const item = notificationItem();
    const { calls } = renderApp(
      '/notificacoes',
      routes({
        [UNREAD_URL]: () => jsonResponse({ unreadCount: 1 }),
        [LIST_URL]: () => jsonResponse(notificationPage([item])),
        [CLEAR_URL]: () => jsonResponse({ deleted: 1 }),
      }),
      { session },
    );

    const region = await screen.findByRole('region', { name: t.list.region });
    await within(region).findByRole('link', { name: new RegExp(t.types.forumReply) });
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    await user.click(within(region).getByRole('button', { name: t.clearAll }));
    const dialog = await screen.findByRole('alertdialog', { name: t.clearTitle });
    expect(within(dialog).getByText(t.clearItem)).toBeTruthy();
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);

    await user.click(within(dialog).getByRole('button', { name: t.clearConfirm }));

    await waitFor(() =>
      expect(
        calls.some((call) => call.method === 'DELETE' && call.path === '/api/v1/notifications'),
      ).toBe(true),
    );
    expect(await within(region).findByText(t.emptyTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: t.bell.none })).toBeTruthy();
  });

  it('sem notificações mostra o vazio', async () => {
    renderApp('/notificacoes', routes(), { session });
    const region = await screen.findByRole('region', { name: t.list.region });
    expect(await within(region).findByText(t.emptyTitle)).toBeTruthy();
    expect(within(region).getByText(t.emptyText)).toBeTruthy();
  });

  it('abrir um item com alvo marca como lido e leva ao destino', async () => {
    const user = userEvent.setup();
    const item = notificationItem();
    const read = { ...item, readAt: '2026-11-25T12:00:00Z' };
    const { calls, router } = renderApp(
      '/notificacoes',
      routes({
        [UNREAD_URL]: () => jsonResponse({ unreadCount: 1 }),
        [LIST_URL]: () => jsonResponse(notificationPage([item])),
        [readUrl(item.id)]: () => jsonResponse({ notification: read, unreadCount: 0 }),
      }),
      { session },
    );

    const region = await screen.findByRole('region', { name: t.list.region });
    await user.click(
      await within(region).findByRole('link', { name: new RegExp(t.types.forumReply) }),
    );

    await waitFor(() => expect(router.state.location.pathname).toBe(`/forum/t/${item.targetId}`));
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.path)).toContain(
      `/api/v1/notifications/${item.id}/read`,
    );
  });

  it('mostra o conteúdo de `data` como texto, nunca como HTML', async () => {
    const item = notificationItem({
      data: { topicTitle: '<img src=x onerror="alert(1)">Resposta <b>nova</b>' },
    });
    renderApp(
      '/notificacoes',
      routes({ [LIST_URL]: () => jsonResponse(notificationPage([item])) }),
      { session },
    );

    const region = await screen.findByRole('region', { name: t.list.region });
    const text = await within(region).findByText(
      '<img src=x onerror="alert(1)">Resposta <b>nova</b>',
    );
    expect(text.querySelector('img')).toBeNull();
    expect(text.querySelector('b')).toBeNull();
  });

  it('falha na lista mostra o erro e tenta de novo', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const item = notificationItem();
    renderApp(
      '/notificacoes',
      routes({
        [LIST_URL]: () => {
          attempts += 1;
          return attempts === 1
            ? problemResponse(503, 'database_unavailable')
            : jsonResponse(notificationPage([item]));
        },
      }),
      { session },
    );

    const region = await screen.findByRole('region', { name: t.list.region });
    expect(await within(region).findByText(t.errorTitle)).toBeTruthy();
    await user.click(within(region).getByRole('button', { name: ptBR.common.retry }));
    expect(
      await within(region).findByRole('link', { name: new RegExp(t.types.forumReply) }),
    ).toBeTruthy();
  });

  it('carrega a próxima página da central', async () => {
    const user = userEvent.setup();
    const first = notificationItem();
    const older = notificationItem({
      id: uuid(2),
      type: 'certificate.issued',
      group: 'courses',
      actor: null,
      targetType: 'certificate',
      targetId: 'CERT-123',
      data: { courseTitle: 'React do zero' },
      createdAt: '2026-10-01T12:00:00Z',
    });
    renderApp(
      '/notificacoes',
      routes({
        [LIST_URL]: (request) =>
          jsonResponse(
            new URL(request.url).searchParams.get('cursor')
              ? notificationPage([older])
              : notificationPage([first], 'pagina-2'),
          ),
      }),
      { session },
    );

    const region = await screen.findByRole('region', { name: t.list.region });
    await within(region).findByRole('link', { name: new RegExp(t.types.forumReply) });
    await user.click(screen.getByRole('button', { name: t.loadMore }));
    expect(
      await within(region).findByRole('link', { name: new RegExp(t.types.certificateIssued) }),
    ).toBeTruthy();
    expect(within(region).getByText('React do zero')).toBeTruthy();
  });
});
