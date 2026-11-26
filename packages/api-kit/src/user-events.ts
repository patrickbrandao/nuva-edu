import { formatSseComment, formatSseEvent } from './sse.ts';

// Eventos de usuário do canal `nuva_user_events` (specs 003, 004 e 024; ADRs 0008 e 0028): o
// formato da carga, o dos frames SSE, o reenvio por `Last-Event-ID` e o filtro por tipo. A base
// não conhece os tipos do domínio: cada serviço diz quais reconhece e quais entrega.

/** Um evento destinado a um usuário, já conferido. */
export interface UserStreamEvent<Kind extends string = string> {
  /** Destinatário: só as conexões dele recebem. */
  userId: string;
  /** Campo `id` do SSE: inteiro crescente por usuário. */
  id: number;
  /** Campo `event` do SSE. */
  event: Kind;
  /** Campo `data` do SSE: só identificadores. */
  data: Record<string, unknown>;
}

/**
 * O filtro de tipos do serviço (ADR 0028). O `admin-api`, por exemplo, reconhece todos os tipos
 * do núcleo mas entrega só `notification.created`; os demais saem como `foreign_kind`, sem
 * entrega e sem reenvio.
 */
export interface UserEventKinds<Kind extends string> {
  /** Tipos que o serviço reconhece (`isKnownKind` do núcleo). Padrão: os aceitos. */
  isKnownKind?: (kind: string) => boolean;
  /** Tipos que este serviço entrega às conexões. */
  acceptsKind: (kind: string) => kind is Kind;
}

/** Por que uma carga do canal foi recusada. */
export type UserStreamEventRejection =
  | 'invalid_json'
  | 'invalid_shape'
  | 'unknown_kind'
  | 'foreign_kind';

export type ParsedUserStreamEvent<Kind extends string = string> =
  | { ok: true; event: UserStreamEvent<Kind> }
  | { ok: false; reason: UserStreamEventRejection };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lê a carga do `NOTIFY nuva_user_events`: `{ userId, kind, id, data? }`, em que `kind` é o
 * nome do evento, `id` o identificador crescente por usuário (número ou texto só de dígitos) e
 * `data` o objeto do evento (vazio quando ausente). Nunca lança: carga fora do formato é
 * recusada com o motivo, sem repetir o conteúdo.
 *
 * Tipo conhecido que este serviço não entrega sai como `foreign_kind` (descartado em silêncio);
 * tipo que o serviço nem reconhece, como `unknown_kind` (aviso no log).
 */
export function parseUserStreamEventPayload<Kind extends string>(
  payload: string,
  kinds: UserEventKinds<Kind>,
): ParsedUserStreamEvent<Kind> {
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
  const isKnown = kinds.isKnownKind ?? kinds.acceptsKind;
  if (!isKnown(kind)) {
    return { ok: false, reason: 'unknown_kind' };
  }
  if (!kinds.acceptsKind(kind)) {
    return { ok: false, reason: 'foreign_kind' };
  }
  return { ok: true, event: { userId: userId.toLowerCase(), id: eventId, event: kind, data } };
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

/** O evento como o contrato o descreve (esquema `StreamEvent`): o `id` vai em texto. */
export interface StreamEventBody<Kind extends string = string> {
  id: string;
  event: Kind;
  data: Record<string, unknown>;
}

/** O que o cliente lê do fio; é o valor conferido com o `StreamEvent` do contrato. */
export function toStreamEventBody<Kind extends string>(
  event: UserStreamEvent<Kind>,
): StreamEventBody<Kind> {
  return { id: String(event.id), event: event.event, data: event.data };
}

/** O evento no fio: campos `id`, `event` e `data` (JSON numa linha), fechado por linha em branco. */
export function userEventFrame<Kind extends string>(event: UserStreamEvent<Kind>): string {
  return formatSseEvent(toStreamEventBody(event));
}

/** Batimento: sem `id`, para não alterar o `Last-Event-ID` do navegador. */
export const PING_FRAME = formatSseEvent({ event: 'ping' });

/** Comentário SSE enviado ao abrir: faz os cabeçalhos saírem já e é ignorado pelo cliente. */
export const OPEN_FRAME = formatSseComment();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
