/** Canal do `NOTIFY` de quem grava mensagem ou notificação (spec 004, "Fluxo SSE"). */
export const USER_EVENTS_CHANNEL = 'nuva_user_events';

/**
 * Eventos que chegam pelo canal, com os nomes do esquema `StreamEvent` do contrato. `ping` fica
 * de fora: é gerado pela própria API. O teste de contrato confere esta lista com o contrato.
 */
export const USER_EVENT_NAMES = [
  'dm.message.created',
  'dm.message.read',
  'dm.message.deleted',
  'notification.created',
  'forum.post.created',
  'announcement.published',
  'presence',
] as const;

export type UserEventName = (typeof USER_EVENT_NAMES)[number];

/** Um evento destinado a um usuário, já conferido. */
export interface UserEvent {
  /** Destinatário: só as conexões dele recebem. */
  userId: string;
  /** Campo `id` do SSE: inteiro crescente por usuário. */
  id: number;
  /** Campo `event` do SSE. */
  event: UserEventName;
  /** Campo `data` do SSE: só identificadores. */
  data: Record<string, unknown>;
}

export type ParsedUserEvent =
  | { ok: true; event: UserEvent }
  | { ok: false; reason: 'invalid_json' | 'invalid_shape' | 'unknown_kind' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAMES: ReadonlySet<string> = new Set(USER_EVENT_NAMES);

/**
 * Lê a carga do `NOTIFY nuva_user_events`: `{ userId, kind, id, data? }`, em que `kind` é o
 * nome do evento, `id` o identificador crescente por usuário (número ou texto só de dígitos) e
 * `data` o objeto do evento (vazio quando ausente). Nunca lança: carga fora do formato é
 * recusada com o motivo, sem repetir o conteúdo.
 */
export function parseUserEventPayload(payload: string): ParsedUserEvent {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  if (!isRecord(raw)) {
    return { ok: false, reason: 'invalid_shape' };
  }
  const { userId, kind, id } = raw;
  const data = raw.data ?? {};
  const eventId = parseEventId(id);
  if (
    typeof userId !== 'string' ||
    !UUID_PATTERN.test(userId) ||
    typeof kind !== 'string' ||
    eventId === undefined ||
    !isRecord(data)
  ) {
    return { ok: false, reason: 'invalid_shape' };
  }
  if (!NAMES.has(kind)) {
    return { ok: false, reason: 'unknown_kind' };
  }
  return {
    ok: true,
    event: { userId: userId.toLowerCase(), id: eventId, event: kind as UserEventName, data },
  };
}

/** Lê um `id` de evento (ou o cabeçalho `Last-Event-ID`): inteiro não negativo, ou nada. */
export function parseEventId(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[0-9]+$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * O evento no fio: campos `id`, `event` e `data` (JSON numa linha), fechado por linha em branco.
 * O `JSON.stringify` escapa quebras de linha, então `data` nunca ocupa mais de uma linha.
 */
export function formatEvent(event: Pick<UserEvent, 'id' | 'event' | 'data'>): string {
  return `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/** Batimento: sem `id`, para não alterar o `Last-Event-ID` do navegador. */
export const PING_FRAME = 'event: ping\ndata: {}\n\n';

/** Comentário SSE enviado ao abrir: faz os cabeçalhos saírem já e é ignorado pelo cliente. */
export const OPEN_FRAME = ': ok\n\n';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
