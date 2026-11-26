import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';

/*
 * Dados da central de notificações no formato do contrato da classroom-api (spec 024), para os
 * testes do site, mais um `EventSource` falso: o jsdom não tem o do navegador e o fluxo SSE é
 * uma parte do comportamento a cobrir.
 */

export type NotificationItem = ClassroomSchemas['NotificationItem'];
export type NotificationPage = ClassroomSchemas['NotificationPage'];
export type NotificationPrefs = ClassroomSchemas['NotificationPrefs'];
export type NotificationGroup = ClassroomSchemas['NotificationGroup'];

export const LIST_URL = 'GET /api/v1/notifications';
export const CLEAR_URL = 'DELETE /api/v1/notifications';
export const UNREAD_URL = 'GET /api/v1/notifications/unread-count';
export const READ_ALL_URL = 'POST /api/v1/notifications/read-all';
export const PREFS_URL = 'GET /api/v1/me/notification-prefs';
export const SAVE_PREFS_URL = 'PUT /api/v1/me/notification-prefs';

export const readUrl = (id: string) => `POST /api/v1/notifications/${id}/read`;
export const unsubscribeUrl = (token: string) => `POST /api/v1/unsubscribe/${token}`;

/** Identificador no formato do esquema `Uuid`, com o número no fim para variar. */
export const uuid = (n: number) =>
  `0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f${String(n).padStart(2, '0')}`;

/** Token do link de descadastro: 64 hexadecimais, como no contrato. */
export const UNSUBSCRIBE_TOKEN = '0123456789abcdef'.repeat(4);

/** Um item da central (esquema `NotificationItem`). */
export function notificationItem(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: uuid(1),
    type: 'forum.reply',
    group: 'forum',
    actor: { id: uuid(90), name: 'Ana Souza', avatarUrl: null },
    targetType: 'topic',
    targetId: uuid(20),
    data: { topicTitle: 'Como começar' },
    count: 1,
    readAt: null,
    createdAt: '2026-11-20T12:00:00Z',
    ...overrides,
  };
}

/** Uma página da central (esquema `NotificationPage`). */
export function notificationPage(
  items: NotificationItem[],
  nextCursor: string | null = null,
): NotificationPage {
  return { items, nextCursor };
}

const BOOLEAN_GROUPS: readonly NotificationGroup[] = [
  'account',
  'purchase',
  'courses',
  'forum',
  'messages',
  'community',
  'events',
  'support',
  'announcements',
  'moderation',
  'staff',
];

const REQUIRED: readonly NotificationGroup[] = ['account', 'purchase', 'support', 'moderation'];

/** Preferências efetivas dos onze grupos, com os obrigatórios travados como a API devolve. */
export function notificationPrefs(
  overrides: Partial<
    Record<NotificationGroup, Partial<ClassroomSchemas['NotificationGroupPrefs']>>
  > = {},
): NotificationPrefs {
  const prefs = {} as NotificationPrefs;
  for (const group of BOOLEAN_GROUPS) {
    prefs[group] = {
      inApp: group !== 'account',
      email: true,
      emailRequired: REQUIRED.includes(group),
      inAppAvailable: group !== 'account',
      ...overrides[group],
    };
  }
  return prefs;
}

type Listener = (event: Event) => void;

/**
 * `EventSource` falso: registra as conexões e entrega os eventos que o teste mandar. `open`
 * simula a abertura (e a reconexão do navegador) e `fail` a queda, com `readyState` de queda.
 */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  static instances: FakeEventSource[] = [];

  static reset(): void {
    FakeEventSource.instances = [];
  }

  static get latest(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1);
    if (!source) throw new Error('nenhum EventSource foi aberto');
    return source;
  }

  readyState = FakeEventSource.CONNECTING;
  readonly withCredentials: boolean;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    readonly url: string,
    init: { withCredentials?: boolean } = {},
  ) {
    this.withCredentials = init.withCredentials ?? false;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: Listener): void {
    const set = this.listeners.get(name) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(name, set);
  }

  removeEventListener(name: string, listener: Listener): void {
    this.listeners.get(name)?.delete(listener);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
  }

  /** Conexão aberta (a primeira ou uma reconexão). */
  open(): void {
    this.readyState = FakeEventSource.OPEN;
    this.dispatch('open', new Event('open'));
  }

  /** Conexão caiu; o navegador tentaria de novo por conta própria. */
  fail(): void {
    this.readyState = FakeEventSource.CONNECTING;
    this.dispatch('error', new Event('error'));
  }

  /** Evento nomeado, com o `data` em JSON e um `id`, como o SSE entrega. */
  emit(name: string, data: unknown, id = '1'): void {
    const event = new MessageEvent(name, { data: JSON.stringify(data), lastEventId: id });
    this.dispatch(name, event);
  }

  private dispatch(name: string, event: Event): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}
