import { type RawBuilder, sql } from 'kysely';
import { businessRule, conflict, type DomainError, notFound } from '../../errors/domain-error.ts';
import { type AudienceSource, audienceAccess } from '../entitlements/audience.ts';
import { assertMarkdownWithinLimit, renderMarkdownToHtml } from '../markdown/render.ts';

// Regras comuns das novidades (spec 025): estados, limites, texto, link e a regra de "não
// lida". A gestão fica em `admin.ts`, a publicação em `publish.ts` e o mural em `classroom.ts`.

export const ANNOUNCEMENT_STATUSES = ['draft', 'scheduled', 'published', 'archived'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

export const ANNOUNCEMENT_TITLE_MIN_LENGTH = 5;
export const ANNOUNCEMENT_TITLE_MAX_LENGTH = 150;
export const ANNOUNCEMENT_BODY_MAX_LENGTH = 20_000;
export const ANNOUNCEMENT_LINK_URL_MAX_LENGTH = 2_000;
export const ANNOUNCEMENT_LINK_LABEL_MAX_LENGTH = 100;
/** RNF-02: novidades fixadas ao mesmo tempo. */
export const ANNOUNCEMENT_PINNED_MAX = 3;
/** RNF-01: tamanho padrão da lista do aluno. */
export const ANNOUNCEMENT_PAGE_DEFAULT_LIMIT = 20;
export const ANNOUNCEMENT_TARGET_TYPE = 'announcement';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ANNOUNCEMENT_AUDIENCE_TABLE = {
  productsTable: 'announcement_products',
  ownerColumn: 'announcement_id',
} as const;

/** Público da novidade sobre a tabela `announcements` com o apelido `an`. */
export const ANNOUNCEMENT_AUDIENCE: AudienceSource = {
  ...ANNOUNCEMENT_AUDIENCE_TABLE,
  audience: sql.ref('an.audience'),
  ownerId: sql.ref('an.id'),
};

export function isAnnouncementStatus(value: unknown): value is AnnouncementStatus {
  return typeof value === 'string' && (ANNOUNCEMENT_STATUSES as readonly string[]).includes(value);
}

export function announcementId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw notFound('Novidade não encontrada.');
  }
  return value.toLowerCase();
}

export function optionalAnnouncementUuid(value: unknown, code: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw businessRule(code, 'O vínculo informado não existe.');
  }
  return value.toLowerCase();
}

export function announcementTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  const length = [...title].length;
  if (length < ANNOUNCEMENT_TITLE_MIN_LENGTH || length > ANNOUNCEMENT_TITLE_MAX_LENGTH) {
    throw businessRule(
      'announcement_title_invalid',
      `O título deve ter de ${ANNOUNCEMENT_TITLE_MIN_LENGTH} a ${ANNOUNCEMENT_TITLE_MAX_LENGTH} caracteres.`,
    );
  }
  return title;
}

/** Corpo em Markdown saneado (ADR 0027), com o HTML gravado junto. */
export function announcementBody(value: unknown): { bodyMd: string; bodyHtml: string } {
  const bodyMd = assertMarkdownWithinLimit(value, ANNOUNCEMENT_BODY_MAX_LENGTH).trim();
  const bodyHtml = renderMarkdownToHtml(bodyMd);
  if (!bodyMd || !bodyHtml.trim()) {
    throw businessRule('markdown_invalid', 'Escreva o texto da novidade.');
  }
  return { bodyMd, bodyHtml };
}

/** Link de destino: rota interna (`/...`, nunca `//`) ou URL `https` externa. */
export function announcementLinkUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const invalid = () =>
    businessRule(
      'announcement_link_invalid',
      'O link deve ser uma rota interna (começando com /) ou uma URL https.',
    );
  if (typeof value !== 'string') throw invalid();
  const url = value.trim();
  if (url.length > ANNOUNCEMENT_LINK_URL_MAX_LENGTH || /[\s\\]/.test(url)) throw invalid();
  if (/^\/[^/]/.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname) throw invalid();
  } catch {
    throw invalid();
  }
  return url;
}

export function announcementLinkLabel(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const label = typeof value === 'string' ? value.trim() : '';
  if (!label || [...label].length > ANNOUNCEMENT_LINK_LABEL_MAX_LENGTH) {
    throw businessRule(
      'announcement_link_invalid',
      `O texto do botão deve ter de 1 a ${ANNOUNCEMENT_LINK_LABEL_MAX_LENGTH} caracteres.`,
    );
  }
  return label;
}

/** `409 announcement_archived`: novidade arquivada não é editada nem republicada. */
export function announcementArchived(): DomainError {
  return conflict('announcement_archived', 'Esta novidade foi arquivada.');
}

/** `422 announcement_pinned_limit`: já há três fixadas (RNF-02). */
export function announcementPinnedLimit(): DomainError {
  return businessRule(
    'announcement_pinned_limit',
    `No máximo ${ANNOUNCEMENT_PINNED_MAX} novidades fixadas ao mesmo tempo.`,
  );
}

/** A recusa do gatilho `announcements_guard_pinned` (corrida entre duas fixações). */
export function isPinnedLimitViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { constraint?: unknown }).constraint === 'announcements_pinned_limit'
  );
}

export interface AnnouncementRow {
  id: string;
  title: string;
  bodyMd: string;
  bodyHtml: string;
  coverImageId: string | null;
  audience: string;
  linkUrl: string | null;
  linkLabel: string | null;
  status: string;
  pinned: boolean;
  publishAt: Date | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  notify: boolean;
  authorId: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Novidades não lidas de um usuário (spec 025, "Não lidas"): publicadas, visíveis a ele (o
 * público, ou a equipe, que vê todas) e posteriores à última abertura do mural ou ao cadastro,
 * o que for mais recente. `user` e `seenAt` são colunas da consulta de quem chama.
 */
export function unreadAnnouncementsCount(user: {
  id: RawBuilder<string>;
  role: RawBuilder<string>;
  createdAt: RawBuilder<Date>;
  seenAt: RawBuilder<Date | null>;
}): RawBuilder<number> {
  return sql<number>`(
    SELECT count(*)::int FROM announcements an
    WHERE an.status = 'published'
      AND an.published_at > greatest(coalesce(${user.seenAt}, ${user.createdAt}), ${user.createdAt})
      AND ${audienceAccess(ANNOUNCEMENT_AUDIENCE, user)}
  )`;
}
