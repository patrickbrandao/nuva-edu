import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { DomainError } from '../../errors/domain-error.ts';

// Eventos em tempo real para o navegador do aluno (spec 004, "Fluxo SSE"). Quem grava a mudança
// publica aqui, na mesma transação; a classroom-api escuta o canal e repassa às conexões SSE do
// destinatário. É um atalho: evento perdido é coberto pela recarga das listas na interface.

/** Canal do `NOTIFY` dos eventos de usuário. */
export const USER_EVENTS_CHANNEL = 'nuva_user_events';

/**
 * Sequência que numera os eventos (migration 0003): uma só para todos os usuários, então o `id`
 * é crescente por usuário, com saltos. Num banco sem a migration, o gerador padrão recusa com
 * `user_event_sequence_missing`.
 */
export const USER_EVENTS_SEQUENCE = 'user_event_id_seq';

/** O NOTIFY do PostgreSQL recusa carga de 8000 bytes ou mais. */
export const USER_EVENT_MAX_PAYLOAD_BYTES = 7_999;

/** Eventos da tabela da spec 004. `ping` fica de fora: é gerado pela própria classroom-api. */
export const USER_EVENT_KINDS = [
  'dm.message.created',
  'dm.message.read',
  'dm.message.deleted',
  'notification.created',
  'forum.post.created',
  'announcement.published',
  'presence',
] as const;

export type UserEventKind = (typeof USER_EVENT_KINDS)[number];

/**
 * O `data` de cada evento: o mesmo mapa dos esquemas `Stream*Data` do contrato da classroom-api
 * (spec 004). Evento com formato errado não compila. Os identificadores são UUID em texto.
 */
export interface UserEventData {
  'dm.message.created': { conversationId: string; messageId: string };
  'dm.message.read': { conversationId: string; messageId: string };
  'dm.message.deleted': { conversationId: string; messageId: string };
  'notification.created': { notificationId: string; type: string; unreadCount: number };
  'forum.post.created': { topicId: string; postId: string };
  'announcement.published': { announcementId: string; unreadCount: number };
  presence: { userId: string; online: boolean };
}

export interface UserEventInput<K extends UserEventKind = UserEventKind> {
  /** Destinatário: só as conexões SSE dele recebem. */
  userId: string;
  kind: K;
  /** Só identificadores (spec 004): o conteúdo é buscado pela rota normal, que checa permissão. */
  data: Readonly<UserEventData[K]>;
}

/** A carga do `NOTIFY`, no formato que a classroom-api lê. */
export interface PublishedUserEvent<K extends UserEventKind = UserEventKind> {
  userId: string;
  kind: K;
  /** Inteiro crescente gerado no banco; vira o campo `id` do SSE. */
  id: number;
  data: Readonly<UserEventData[K]>;
}

/** Devolve o próximo `id` de evento, usando a mesma conexão ou transação da publicação. */
export type UserEventIdGenerator = (db: Database) => Promise<number>;

export interface PublishUserEventOptions {
  /** Padrão: `nextUserEventId`, que lê a sequência `USER_EVENTS_SEQUENCE`. */
  nextId?: UserEventIdGenerator;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: ReadonlySet<string> = new Set(USER_EVENT_KINDS);

export function isUserEventKind(kind: string): kind is UserEventKind {
  return KINDS.has(kind);
}

/**
 * Gerador padrão: `nextval` da sequência `USER_EVENTS_SEQUENCE`. Sem a sequência, lança
 * `user_event_sequence_missing` (500) sem abortar a transação de quem chamou: a ausência é
 * conferida com `to_regclass`, que devolve nulo em vez de falhar.
 */
export async function nextUserEventId(db: Database): Promise<number> {
  const result = await sql<{ id: string | null }>`
    SELECT nextval(to_regclass(${USER_EVENTS_SEQUENCE}))::text AS id
  `.execute(db);
  const raw = result.rows[0]?.id ?? null;
  if (raw === null) {
    throw new DomainError({
      code: 'user_event_sequence_missing',
      status: 500,
      title: 'Sequência de eventos ausente',
      detail: `A sequência "${USER_EVENTS_SEQUENCE}" não existe no banco: aplique as migrations (pnpm db:migrate up). Sem ela não há como numerar o evento.`,
    });
  }
  return Number(raw);
}

/**
 * Publica um evento para um usuário: `pg_notify` no canal `nuva_user_events` com a carga
 * `{ userId, kind, id, data }`. Passe a transação da escrita de negócio: o aviso só sai no
 * COMMIT, e não sai se a transação for desfeita.
 *
 * O `data` é tipado pelo `kind` (`UserEventData`); em execução só se confere que é um objeto.
 * Lança `TypeError` para `userId`, `kind` ou `data` fora do formato (erro de quem chama) e
 * `user_event_too_large` (500) quando a carga não cabe no NOTIFY; nesse caso nada é publicado.
 */
export async function publishUserEvent<K extends UserEventKind>(
  db: Database,
  input: UserEventInput<K>,
  options: PublishUserEventOptions = {},
): Promise<PublishedUserEvent<K>> {
  if (typeof input.userId !== 'string' || !UUID_PATTERN.test(input.userId)) {
    throw new TypeError('publishUserEvent: userId precisa ser um UUID.');
  }
  if (!isUserEventKind(input.kind)) {
    throw new TypeError(`publishUserEvent: evento desconhecido "${String(input.kind)}".`);
  }
  const data = input.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new TypeError('publishUserEvent: data precisa ser um objeto.');
  }
  const base = { userId: input.userId.toLowerCase(), kind: input.kind };
  // Confere o tamanho antes de gastar um número, com o maior `id` possível no lugar do real.
  assertFits(JSON.stringify({ ...base, id: Number.MAX_SAFE_INTEGER, data }), input.kind);

  const id = await (options.nextId ?? nextUserEventId)(db);
  if (!Number.isSafeInteger(id) || id < 0) {
    throw new TypeError('publishUserEvent: o gerador devolveu um id que não é inteiro válido.');
  }
  const event: PublishedUserEvent<K> = { ...base, id, data };
  await sql`SELECT pg_notify(${USER_EVENTS_CHANNEL}, ${JSON.stringify(event)})`.execute(db);
  return event;
}

function assertFits(payload: string, kind: UserEventKind): void {
  const bytes = Buffer.byteLength(payload, 'utf8');
  if (bytes > USER_EVENT_MAX_PAYLOAD_BYTES) {
    throw new DomainError({
      code: 'user_event_too_large',
      status: 500,
      title: 'Evento grande demais',
      detail: `O evento "${kind}" tem ${bytes} bytes; o NOTIFY do PostgreSQL aceita até ${USER_EVENT_MAX_PAYLOAD_BYTES}. O evento leva só identificadores: o conteúdo é buscado pela rota normal.`,
    });
  }
}
