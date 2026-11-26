import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  ADMIN_STREAM_PATH,
  type AdminPaths,
  type AdminSchemas,
  type AdminStreamEvent,
  type AdminStreamEventName,
  type AdminStreamEventOf,
  adminStreamEventNames,
  type ClassroomPaths,
  type ClassroomSchemas,
  createAdminClient,
  createClassroomClient,
  openAdminStream,
} from '../src/index';

const BASE_URL = 'http://api.test';
const ID = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70';

type Listener = (event: unknown) => void;

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

function openAdmin(overrides: Partial<Parameters<typeof openAdminStream>[0]> = {}) {
  const events: AdminStreamEvent[] = [];
  const stream = openAdminStream({
    EventSource: FakeEventSource as unknown as typeof EventSource,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
  const source = FakeEventSource.last;
  if (!source) throw new Error('EventSource não foi criado');
  return { stream, source, events };
}

function fakeFetch(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetch = async (request: Request) => {
    requests.push(request);
    return respond(request);
  };
  return { fetch, requests };
}

describe('central, preferências e descadastro da janela 580', () => {
  it('expõe as rotas da central e das preferências nos dois contratos', () => {
    for (const path of [
      '/api/v1/notifications',
      '/api/v1/notifications/unread-count',
      '/api/v1/notifications/{id}/read',
      '/api/v1/notifications/read-all',
      '/api/v1/me/notification-prefs',
    ] as const) {
      expectTypeOf<ClassroomPaths>().toHaveProperty(path);
      expectTypeOf<AdminPaths>().toHaveProperty(path);
    }
    expectTypeOf<ClassroomPaths>().toHaveProperty('/api/v1/unsubscribe/{token}');
  });

  it('usa o verbo do contrato em cada operação', () => {
    expectTypeOf<ClassroomPaths['/api/v1/notifications']['delete']>().not.toBeNever();
    expectTypeOf<ClassroomPaths['/api/v1/notifications/{id}/read']['post']>().not.toBeNever();
    expectTypeOf<ClassroomPaths['/api/v1/notifications/read-all']['post']>().not.toBeNever();
    expectTypeOf<ClassroomPaths['/api/v1/me/notification-prefs']['put']>().not.toBeNever();
    expectTypeOf<ClassroomPaths['/api/v1/unsubscribe/{token}']['post']>().not.toBeNever();

    expectTypeOf<AdminPaths['/api/v1/notifications']['delete']>().not.toBeNever();
  });

  it('a central devolve o item com autor, alvo, dados, contagem e leitura', () => {
    expectTypeOf<ClassroomSchemas['NotificationItem']['actor']>().toEqualTypeOf<
      ClassroomSchemas['NotificationActor'] | null
    >();
    expectTypeOf<ClassroomSchemas['NotificationItem']['targetId']>().toEqualTypeOf<string | null>();
    expectTypeOf<ClassroomSchemas['NotificationItem']['count']>().toEqualTypeOf<number>();
    expectTypeOf<ClassroomSchemas['NotificationItem']['readAt']>().toEqualTypeOf<string | null>();
    expectTypeOf<ClassroomSchemas['NotificationPage']['items']>().toEqualTypeOf<
      ClassroomSchemas['NotificationItem'][]
    >();
    expectTypeOf<
      ClassroomSchemas['NotificationsReadAllResult']['unreadCount']
    >().toEqualTypeOf<0>();
  });

  it('as preferências listam os onze grupos com as regras que a tela precisa', () => {
    expectTypeOf<AdminSchemas['NotificationGroup']>().toEqualTypeOf<
      ClassroomSchemas['NotificationGroup']
    >();
    expectTypeOf<AdminSchemas['NotificationPrefs']>().toEqualTypeOf<
      ClassroomSchemas['NotificationPrefs']
    >();
    expectTypeOf<ClassroomSchemas['NotificationPrefs']>().toHaveProperty('staff');
    expectTypeOf<ClassroomSchemas['NotificationGroupPrefs']>().toEqualTypeOf<{
      inApp: boolean;
      email: boolean;
      emailRequired: boolean;
      inAppAvailable: boolean;
    }>();
    expectTypeOf<ClassroomSchemas['NotificationChannelUpdate']>().toEqualTypeOf<{
      inApp?: boolean;
      email?: boolean;
    }>();
  });

  it('o descadastro devolve só o grupo do token e os canais depois da mudança', () => {
    expectTypeOf<ClassroomSchemas['UnsubscribeResult']['group']>().toEqualTypeOf<
      ClassroomSchemas['NotificationGroup']
    >();
    expectTypeOf<ClassroomSchemas['UnsubscribeResult']['prefs']>().toEqualTypeOf<
      ClassroomSchemas['NotificationChannelPrefs']
    >();
  });

  it('o PUT das preferências manda o corpo por grupo e o CSRF; o descadastro é público', async () => {
    const { fetch, requests } = fakeFetch(() =>
      Response.json({
        account: { inApp: true, email: true, emailRequired: true, inAppAvailable: false },
      }),
    );
    const api = createClassroomClient({ baseUrl: BASE_URL, csrfToken: () => 'tok', fetch });

    await api.PUT('/api/v1/me/notification-prefs', { body: { forum: { email: false } } });
    await api.POST('/api/v1/unsubscribe/{token}', { params: { path: { token: 'token-1' } } });

    expect(requests[0]?.method).toBe('PUT');
    expect(requests[0]?.url).toBe(`${BASE_URL}/api/v1/me/notification-prefs`);
    expect(requests[0]?.headers.get('X-CSRF-Token')).toBe('tok');
    expect(await requests[0]?.json()).toEqual({ forum: { email: false } });
    expect(requests[1]?.url).toBe(`${BASE_URL}/api/v1/unsubscribe/token-1`);
  });
});

describe('operação e marca da equipe na janela 580', () => {
  it('expõe a operação e o branding no admin', () => {
    for (const path of [
      '/api/v1/ops/summary',
      '/api/v1/ops/jobs',
      '/api/v1/ops/jobs/{id}/retry',
      '/api/v1/ops/jobs/{id}',
      '/api/v1/ops/emails',
      '/api/v1/ops/emails/{id}/retry',
      '/api/v1/settings/branding',
    ] as const) {
      expectTypeOf<AdminPaths>().toHaveProperty(path);
    }
    expectTypeOf<AdminPaths['/api/v1/ops/jobs/{id}']['delete']>().not.toBeNever();
    expectTypeOf<AdminPaths['/api/v1/ops/emails/{id}/retry']['post']>().not.toBeNever();
  });

  it('o resumo traz o bloco do sistema com backup e expurgo anuláveis', () => {
    expectTypeOf<AdminSchemas['OpsSummary']['system']['lastPurgeAt']>().toEqualTypeOf<
      string | null
    >();
    expectTypeOf<AdminSchemas['OpsSummary']['system']['lastBackup']>().toEqualTypeOf<{
      finishedAt: string;
      sizeBytes: number;
      status: 'ok' | 'failed';
    } | null>();
    expectTypeOf<AdminSchemas['OpsEmail']['lastError']>().toEqualTypeOf<string | null>();
  });

  it('o branding entra por identificador de imagem e sai por URL', async () => {
    expectTypeOf<AdminSchemas['SchoolBrandingInput']>().toHaveProperty('logoImageId');
    expectTypeOf<AdminSchemas['SchoolBrandingInput']>().not.toHaveProperty('logoUrl');
    expectTypeOf<AdminSchemas['SchoolBranding']['logoUrl']>().toEqualTypeOf<string | null>();

    const { fetch, requests } = fakeFetch(() =>
      Response.json({
        schoolName: 'Escola Teste',
        logoUrl: null,
        accentColor: '#1F6FEB',
        footer: 'Até logo',
      }),
    );
    const api = createAdminClient({ baseUrl: BASE_URL, csrfToken: () => 'tok', fetch });

    await api.PUT('/api/v1/settings/branding', {
      body: { schoolName: 'Escola Teste', logoImageId: null, accentColor: null, footer: null },
    });

    expect(requests[0]?.url).toBe(`${BASE_URL}/api/v1/settings/branding`);
    expect(requests[0]?.headers.get('X-CSRF-Token')).toBe('tok');
  });
});

describe('fluxo SSE da equipe (janela 580)', () => {
  it('os nomes gerados cobrem exatamente a união StreamEvent do admin', () => {
    expectTypeOf<(typeof adminStreamEventNames)[number]>().toEqualTypeOf<AdminStreamEventName>();
    expectTypeOf<AdminStreamEventName>().toEqualTypeOf<'notification.created' | 'ping'>();
    expectTypeOf<AdminStreamEventOf<'notification.created'>>().toEqualTypeOf<
      AdminSchemas['StreamEventNotificationCreated']
    >();
    expectTypeOf<AdminStreamEventOf<'ping'>>().toEqualTypeOf<AdminSchemas['StreamEventPing']>();
    expect(ADMIN_STREAM_PATH).toBe('/api/v1/stream');
  });

  it('abre /api/v1/stream com o cookie do admin e escuta os eventos do contrato', () => {
    const { source } = openAdmin({ baseUrl: 'http://admin.test' });

    expect(source.url).toBe('http://admin.test/api/v1/stream');
    expect(source.init).toEqual({ withCredentials: true });
    for (const name of adminStreamEventNames) expect(source.listeners.has(name)).toBe(true);
  });

  it('entrega notification.created com id e contador tipados', () => {
    const { source, events } = openAdmin();
    const data = { notificationId: ID, type: 'ticket.opened', unreadCount: 3 };

    source.emit('notification.created', { data: JSON.stringify(data), lastEventId: '42' });

    expect(events).toEqual([{ id: '42', event: 'notification.created', data }]);
    const [event] = events;
    if (event?.event === 'notification.created') {
      expectTypeOf(event.data.unreadCount).toBeNumber();
      expect(event.data.notificationId).toBe(ID);
    }
  });

  it('entrega ping sem id, mesmo com Last-Event-ID anterior', () => {
    const { source, events } = openAdmin();

    source.emit('ping', { data: '{}', lastEventId: '42' });

    expect(events).toEqual([{ event: 'ping', data: {} }]);
  });

  it('avisa a queda com reconexão e o encerramento definitivo', () => {
    const log: string[] = [];
    const { source, stream } = openAdmin({
      onOpen: () => log.push('open'),
      onError: ({ closed }) => log.push(closed ? 'closed' : 'reconnecting'),
    });

    source.emit('open');
    source.emit('error');
    source.readyState = FakeEventSource.CLOSED;
    source.emit('error');
    expect(log).toEqual(['open', 'reconnecting', 'closed']);

    stream.close();
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });
});
