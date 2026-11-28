import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calls, defaultRoutes, problem, type Routes } from '../../test/api';
import { expectNoAxeViolations } from '../../test/axe';
import {
  NOTIFICATION_ID,
  NOTIFICATION_ID_2,
  NOTIFICATION_TARGET_ID,
  notificationItem,
  notificationPage,
  notificationPrefs,
} from '../../test/notifications';
import { renderApp } from '../../test/render';

type Listener = (event: unknown) => void;

/**
 * `EventSource` falso, no formato que `@nuva-edu/api-client` usa: `emit('open')` e
 * `emit('notification.created', { data, lastEventId })` reproduzem o navegador.
 */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static last: FakeEventSource | undefined;

  readyState = FakeEventSource.CONNECTING;
  readonly listeners = new Map<string, Listener[]>();

  constructor(
    readonly url: string,
    readonly init?: EventSourceInit,
  ) {
    FakeEventSource.last = this;
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(type: string, event: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function created(count: number, id = NOTIFICATION_ID) {
  return {
    data: JSON.stringify({ notificationId: id, type: 'ticket.opened', unreadCount: count }),
    lastEventId: String(count),
  };
}

function bell() {
  return screen.getByRole('button', { name: /^Notificações: \d+ não lida/ });
}

function notificationsRoutes(extra: Routes = {}) {
  const routes: Routes = {
    ...defaultRoutes(),
    'GET /api/v1/notifications/unread-count': { unreadCount: 3 },
    'GET /api/v1/notifications': notificationPage([notificationItem()]),
    'GET /api/v1/me/notification-prefs': notificationPrefs(),
    ...extra,
  };
  return routes;
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.last = undefined;
});

describe('sino e central da equipe', () => {
  it('mostra o contador e o atualiza pelo SSE, sem recarregar', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    renderApp('/', notificationsRoutes());

    expect(await screen.findByRole('button', { name: 'Notificações: 3 não lidas' })).toBeTruthy();
    await waitFor(() => expect(FakeEventSource.last).toBeDefined());
    const source = FakeEventSource.last as FakeEventSource;
    expect(source.url).toContain('/api/v1/stream');

    source.emit('open');
    source.emit('notification.created', created(4));

    expect(await screen.findByRole('button', { name: 'Notificações: 4 não lidas' })).toBeTruthy();
  });

  it('recarrega contador e lista ao reconectar', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    let unreadCalls = 0;
    let listCalls = 0;
    const routes = notificationsRoutes({
      'GET /api/v1/notifications/unread-count': () => {
        unreadCalls += 1;
        return { unreadCount: 3 };
      },
      'GET /api/v1/notifications': () => {
        listCalls += 1;
        return notificationPage([notificationItem()]);
      },
    });
    renderApp('/', routes);
    await screen.findByRole('button', { name: 'Notificações: 3 não lidas' });
    await waitFor(() => expect(FakeEventSource.last).toBeDefined());
    const source = FakeEventSource.last as FakeEventSource;

    // Primeira abertura do fluxo: as consultas iniciais já bastam.
    const firstUnread = unreadCalls;
    source.emit('open');
    expect(unreadCalls).toBe(firstUnread);

    // O painel aberto busca a lista; a reconexão confere os dois no servidor.
    await userEvent.setup().click(bell());
    await screen.findByRole('dialog', { name: 'Notificações' });
    await waitFor(() => expect(listCalls).toBeGreaterThan(0));
    await expectNoAxeViolations();
    const firstList = listCalls;

    source.emit('open');
    await waitFor(() => expect(unreadCalls).toBeGreaterThan(firstUnread));
    await waitFor(() => expect(listCalls).toBeGreaterThan(firstList));
  });

  it('abre o painel, marca todas como lidas e limpa com confirmação', async () => {
    const user = userEvent.setup();
    let unread = 3;
    const routes = notificationsRoutes({
      'GET /api/v1/notifications/unread-count': () => ({ unreadCount: unread }),
      'GET /api/v1/notifications': () =>
        notificationPage([
          notificationItem(),
          notificationItem({
            id: NOTIFICATION_ID_2,
            type: 'ticket.opened',
            group: 'staff',
            actor: null,
            targetType: null,
            targetId: null,
            data: { protocol: 'TCK-2026-0001' },
            count: 4,
            readAt: '2026-11-25T13:00:00Z',
          }),
        ]),
      'POST /api/v1/notifications/read-all': () => {
        unread = 0;
        return { updated: 2, unreadCount: 0 };
      },
      'DELETE /api/v1/notifications': { deleted: 2 },
    });
    const { fetchMock } = renderApp('/notificacoes', routes);

    expect(await screen.findByRole('heading', { level: 1, name: 'Notificações' })).toBeTruthy();
    expect(await screen.findByText('Nova resposta no fórum')).toBeTruthy();
    expect(screen.getByText('Boas-vindas ao fórum')).toBeTruthy();
    expect(screen.getByText('Novo chamado aberto')).toBeTruthy();
    expect(screen.getByText('TCK-2026-0001')).toBeTruthy();
    expect(screen.getByText('e mais 3')).toBeTruthy();
    expect(screen.getAllByText('Não lida')).toHaveLength(1);
    await expectNoAxeViolations();

    await user.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }));
    expect(
      await screen.findByText('Todas as notificações foram marcadas como lidas.'),
    ).toBeTruthy();
    expect(calls(fetchMock)).toContain('POST /api/v1/notifications/read-all');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^Notificações:/ }).getAttribute('aria-label'),
      ).toBe('Notificações: nenhuma não lida'),
    );

    await user.click(screen.getByRole('button', { name: 'Limpar todas' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Limpar notificações')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Limpar todas' }));
    expect(await screen.findByText('Notificações apagadas.')).toBeTruthy();
    expect(calls(fetchMock)).toContain('DELETE /api/v1/notifications');
  });

  it('abrir um item sem link marca como lido', async () => {
    const user = userEvent.setup();
    const routes = notificationsRoutes({
      'GET /api/v1/notifications': notificationPage([
        notificationItem({
          type: 'ops.job_failed',
          group: 'staff',
          actor: null,
          targetType: null,
          targetId: null,
          data: { jobType: 'email.send' },
        }),
      ]),
      [`POST /api/v1/notifications/${NOTIFICATION_ID}/read`]: {
        notification: notificationItem({ readAt: '2026-11-25T14:00:00Z' }),
        unreadCount: 0,
      },
    });
    const { fetchMock } = renderApp('/notificacoes', routes);

    await user.click(await screen.findByRole('button', { name: /Tarefa da fila falhou/ }));
    await waitFor(() =>
      expect(calls(fetchMock)).toContain(`POST /api/v1/notifications/${NOTIFICATION_ID}/read`),
    );
  });

  it('mostra as preferências, trava os grupos obrigatórios e grava só o canal mudado', async () => {
    const user = userEvent.setup();
    let saved: unknown = null;
    const routes = notificationsRoutes({
      'PUT /api/v1/me/notification-prefs': async (request: Request) => {
        saved = await request.json();
        return notificationPrefs({ forum: { ...notificationPrefs().forum, email: false } });
      },
    });
    renderApp('/notificacoes/preferencias', routes);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Preferências de notificação' }),
    ).toBeTruthy();
    expect(await screen.findByText('Conta')).toBeTruthy();
    expect(screen.getAllByText('Equipe').length).toBeGreaterThan(0);

    const required = screen.getByRole('switch', { name: 'Conta: Por e-mail' });
    expect((required as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('switch', { name: 'Conta: Na plataforma' })).toBeNull();
    expect(screen.getAllByText('Não se aplica')).toHaveLength(1);

    await user.click(screen.getByRole('switch', { name: 'Fórum: Por e-mail' }));
    await waitFor(() => expect(saved).toEqual({ forum: { email: false } }));
    expect(await screen.findByText('Preferências salvas.')).toBeTruthy();
    await expectNoAxeViolations();
  });

  it('mantém a recusa da API visível e não inventa estado', async () => {
    const user = userEvent.setup();
    const routes = notificationsRoutes({
      'PUT /api/v1/me/notification-prefs': problem(409, 'validation_failed'),
    });
    renderApp('/notificacoes/preferencias', routes);

    await user.click(await screen.findByRole('switch', { name: 'Fórum: Por e-mail' }));
    expect(await screen.findByText('Confira os dados e tente de novo.')).toBeTruthy();
    expect(
      (screen.getByRole('switch', { name: 'Fórum: Por e-mail' }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('mostra o aviso de endereço indisponível e a orientação de recuperação', async () => {
    const routes = notificationsRoutes({
      'GET /api/v1/notifications': notificationPage([
        notificationItem({
          type: 'account.email_undeliverable',
          group: 'account',
          actor: null,
          targetType: null,
          targetId: null,
          data: {},
        }),
      ]),
    });
    renderApp('/notificacoes', routes);
    expect(await screen.findByText('E-mail indisponível')).toBeTruthy();
    expect(
      screen.getByText('Confira o endereço cadastrado para voltar a receber mensagens.'),
    ).toBeTruthy();
  });

  it('tipo que o site não conhece cai no rótulo genérico', async () => {
    const routes = notificationsRoutes({
      'GET /api/v1/notifications': notificationPage([
        notificationItem({
          type: 'future.kind',
          group: 'staff',
          actor: null,
          targetType: null,
          targetId: null,
          data: {},
        }),
      ]),
    });
    renderApp('/notificacoes', routes);

    expect(await screen.findByText('Notificação')).toBeTruthy();
  });

  it('carrega a próxima página da central por cursor', async () => {
    const user = userEvent.setup();
    const cursors: (string | null)[] = [];
    const routes = notificationsRoutes({
      'GET /api/v1/notifications': (request: Request) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        cursors.push(cursor);
        if (cursor === 'page-2') {
          return notificationPage([
            notificationItem({
              id: NOTIFICATION_ID_2,
              type: 'forum.mention',
              data: { topicTitle: 'Segundo tópico' },
            }),
          ]);
        }
        return notificationPage([notificationItem()], 'page-2');
      },
    });
    renderApp('/notificacoes', routes);

    expect(await screen.findByText('Nova resposta no fórum')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Carregar mais' }));

    expect(await screen.findByText('Segundo tópico')).toBeTruthy();
    expect(cursors.at(-1)).toBe('page-2');
  });

  it('a equipe sem ops.manage continua com a central e sem o item de operação', async () => {
    renderApp('/notificacoes', { ...notificationsRoutes(), ...defaultRoutes('manager') });
    expect(await screen.findByRole('heading', { level: 1, name: 'Notificações' })).toBeTruthy();
    const menu = await screen.findByRole('navigation', { name: 'Menu' });
    expect(within(menu).queryByRole('link', { name: /Operação/ })).toBeNull();
  });

  it('leva ao tópico e ao caso denunciado pelos itens de fórum e denúncia', async () => {
    const contentId = '0193a5b2-0000-7000-8000-0000000000c9';
    const routes = notificationsRoutes({
      'GET /api/v1/notifications': () =>
        notificationPage([
          notificationItem({ targetType: 'forum_topic' }),
          notificationItem({
            id: NOTIFICATION_ID_2,
            type: 'report.created',
            group: 'staff',
            targetType: 'report',
            data: { contentType: 'forum_post', contentId },
          }),
        ]),
    });
    renderApp('/notificacoes', routes);

    await screen.findByRole('heading', { level: 1, name: 'Notificações' });
    await waitFor(() => {
      const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
      expect(hrefs).toContain(`/forum/t/${NOTIFICATION_TARGET_ID}`);
      expect(hrefs).toContain(`/denuncias/forum_post/${contentId}`);
    });
  });
});
