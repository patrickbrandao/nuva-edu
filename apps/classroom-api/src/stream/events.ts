import { formatSseComment, formatSseEvent } from '@nuva-edu/api-kit';
import { isUserEventKind, type UserEventKind } from '@nuva-edu/core';

/** Um evento destinado a um usuário, já conferido. */
export interface UserEvent {
  /** Destinatário: só as conexões dele recebem. */
  userId: string;
  /** Campo `id` do SSE: inteiro crescente por usuário. */
  id: number;
  /** Campo `event` do SSE. */
  event: UserEventKind;
  /** Campo `data` do SSE: só identificadores. */
  data: Record<string, unknown>;
}

export type ParsedUserEvent =
  | { ok: true; event: UserEvent }
  | { ok: false; reason: 'invalid_json' | 'invalid_shape' | 'unknown_kind' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (!isUserEventKind(kind)) {
    return { ok: false, reason: 'unknown_kind' };
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
export interface StreamEventBody {
  id: string;
  event: UserEventKind;
  data: Record<string, unknown>;
}

/** O que o cliente lê do fio; é o valor conferido com `app.contractSchema('StreamEvent')`. */
export function toStreamEvent(event: UserEvent): StreamEventBody {
  return { id: String(event.id), event: event.event, data: event.data };
}

/** O evento no fio: campos `id`, `event` e `data` (JSON numa linha), fechado por linha em branco. */
export function eventFrame(event: UserEvent): string {
  return formatSseEvent(toStreamEvent(event));
}

/** Batimento: sem `id`, para não alterar o `Last-Event-ID` do navegador. */
export const PING_FRAME = formatSseEvent({ event: 'ping' });

/** Comentário SSE enviado ao abrir: faz os cabeçalhos saírem já e é ignorado pelo cliente. */
export const OPEN_FRAME = formatSseComment();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
