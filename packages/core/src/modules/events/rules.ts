import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { businessRule, type DomainError, notFound } from '../../errors/domain-error.ts';
import {
  type Audience,
  type AudienceSource,
  listAudienceMembers,
} from '../entitlements/audience.ts';
import { assertMarkdownWithinLimit, renderMarkdownToHtml } from '../markdown/render.ts';

// Regras comuns do calendário (spec 018): tipos, status pelo relógio, janela do link e
// validação dos campos. A gestão fica em `admin.ts`, as leituras do aluno em `classroom.ts` e
// o lembrete em `reminders.ts`.

export const EVENT_KINDS = ['live', 'meeting', 'workshop', 'other'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_STATUSES = ['upcoming', 'live', 'past', 'canceled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_TITLE_MAX_LENGTH = 160;
export const EVENT_DESCRIPTION_MAX_LENGTH = 20_000;
export const EVENT_STREAM_URL_MAX_LENGTH = 2_000;
/** Duração máxima (spec 018, "Regras"). */
export const EVENT_MAX_DURATION_MS = 12 * 60 * 60 * 1000;
/** O link é entregue a partir de 15 minutos antes do início (RF-04). */
export const EVENT_JOIN_LEAD_MS = 15 * 60 * 1000;
export const EVENT_REPEAT_MAX_WEEKS = 26;
export const EVENT_TARGET_TYPE = 'event';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const EVENT_AUDIENCE_TABLE = {
  productsTable: 'event_products',
  ownerColumn: 'event_id',
} as const;

/** Público do evento sobre a tabela `events` com o apelido `ev`. */
export const EVENT_AUDIENCE: AudienceSource = {
  ...EVENT_AUDIENCE_TABLE,
  audience: sql.ref('ev.audience'),
  ownerId: sql.ref('ev.id'),
};

/** Status pelo relógio; só o cancelamento é guardado (spec 018, "Status"). */
export function eventStatus(
  event: { startsAt: Date; endsAt: Date; canceledAt: Date | null },
  now: Date,
): EventStatus {
  if (event.canceledAt !== null) return 'canceled';
  if (now.getTime() < event.startsAt.getTime()) return 'upcoming';
  return now.getTime() < event.endsAt.getTime() ? 'live' : 'past';
}

/** Instante em que o link passa a ser entregue. */
export function eventJoinOpensAt(startsAt: Date): Date {
  return new Date(startsAt.getTime() - EVENT_JOIN_LEAD_MS);
}

export function eventId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw notFound('Evento não encontrado.');
  }
  return value.toLowerCase();
}

export function eventInvalid(code: string, detail: string): DomainError {
  return businessRule(code, detail);
}

export function eventTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title || [...title].length > EVENT_TITLE_MAX_LENGTH) {
    throw eventInvalid(
      'event_title_invalid',
      `O título deve ter de 1 a ${EVENT_TITLE_MAX_LENGTH} caracteres.`,
    );
  }
  return title;
}

/** Descrição em Markdown saneado (ADR 0027), com o HTML gravado junto. */
export function eventDescription(value: unknown): {
  descriptionMd: string;
  descriptionHtml: string;
} {
  const descriptionMd = assertMarkdownWithinLimit(value, EVENT_DESCRIPTION_MAX_LENGTH).trim();
  const descriptionHtml = renderMarkdownToHtml(descriptionMd);
  if (!descriptionMd || !descriptionHtml.trim()) {
    throw eventInvalid('markdown_invalid', 'Escreva a descrição do evento.');
  }
  return { descriptionMd, descriptionHtml };
}

export function eventKind(value: unknown): EventKind {
  if (typeof value !== 'string' || !(EVENT_KINDS as readonly string[]).includes(value)) {
    throw eventInvalid('event_kind_invalid', 'Tipo de evento inválido.');
  }
  return value as EventKind;
}

export function eventDate(value: unknown): Date {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string'
        ? new Date(value)
        : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) {
    throw eventInvalid('event_time_invalid', 'Informe o início e o fim do evento.');
  }
  return date;
}

/** Fim depois do início e duração de até 12 horas; fora disso, `422`. */
export function assertEventWindow(startsAt: Date, endsAt: Date): void {
  const duration = endsAt.getTime() - startsAt.getTime();
  if (duration <= 0 || duration > EVENT_MAX_DURATION_MS) {
    throw eventInvalid(
      'event_time_invalid',
      'O fim deve ser depois do início, com duração de até 12 horas.',
    );
  }
}

/** Link de transmissão: URL `https` (ou nulo enquanto não existe). */
export function eventStreamUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const invalid = () =>
    eventInvalid('event_stream_url_invalid', 'O link de transmissão deve ser uma URL https.');
  if (typeof value !== 'string' || value.length > EVENT_STREAM_URL_MAX_LENGTH) throw invalid();
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw invalid();
  }
  if (url.protocol !== 'https:' || !url.hostname) throw invalid();
  return value.trim();
}

export function optionalEventUuid(value: unknown, code: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw eventInvalid(code, 'O vínculo informado não existe.');
  }
  return value.toLowerCase();
}

export interface EventRow {
  id: string;
  title: string;
  descriptionMd: string;
  descriptionHtml: string;
  kind: string;
  startsAt: Date;
  endsAt: Date;
  streamUrl: string | null;
  audience: string;
  courseId: string | null;
  recordingLessonId: string | null;
  seriesId: string | null;
  coverImageId: string | null;
  canceledAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type EventAudience = Audience;

/** Quem é avisado: os usuários ativos que pertencem ao público agora (sem a equipe à parte). */
export function eventAudienceMembers(db: Database, id: string): Promise<string[]> {
  return listAudienceMembers(db, EVENT_AUDIENCE_TABLE, { table: 'events', id });
}

/** Hora do banco: a mesma que decide a janela do link e o status devolvido. */
export async function serverNow(db: Database): Promise<Date> {
  const result = await sql<{ now: Date }>`SELECT now() AS now`.execute(db);
  return (result.rows[0] as { now: Date }).now;
}
