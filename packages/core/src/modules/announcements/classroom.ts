import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { notFound, unauthenticated } from '../../errors/domain-error.ts';
import {
  type CatalogPage,
  type CatalogPageInput,
  readCatalogPageParams,
  toCatalogPage,
} from '../catalog/read-common.ts';
import {
  type AudienceViewer,
  audienceAccess,
  getAudienceViewer,
} from '../entitlements/audience.ts';
import {
  ANNOUNCEMENT_AUDIENCE,
  ANNOUNCEMENT_PAGE_DEFAULT_LIMIT,
  type AnnouncementRow,
  announcementId,
  unreadAnnouncementsCount,
} from './rules.ts';

// Mural do aluno (spec 025; leituras da classroom-api e a escrita de
// `profiles.announcements_seen_at`). Só novidades publicadas, do público do usuário; a equipe
// vê todas. Sem login não há novidade.

const LIST_SCOPE = 'announcements.mine';

async function viewer(db: Database, userId: string): Promise<AudienceViewer> {
  const user = await getAudienceViewer(db, userId);
  if (!user) throw unauthenticated();
  return user;
}

export interface Announcement {
  id: string;
  title: string;
  bodyHtml: string;
  coverImageId: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  pinned: boolean;
  publishedAt: Date;
  /** Publicada depois da última abertura do mural (ou do cadastro). */
  unread: boolean;
}

interface VisibleRow extends AnnouncementRow {
  unread: boolean;
}

function shape(row: VisibleRow): Announcement {
  return {
    id: row.id,
    title: row.title,
    bodyHtml: row.bodyHtml,
    coverImageId: row.coverImageId,
    linkUrl: row.linkUrl,
    linkLabel: row.linkLabel,
    pinned: row.pinned,
    publishedAt: row.publishedAt as Date,
    unread: row.unread,
  };
}

/** Data a partir da qual uma novidade conta como não lida para o usuário. */
const SEEN_BASELINE = (user: AudienceViewer) => sql<Date>`greatest(coalesce(
  (SELECT pr.announcements_seen_at FROM profiles pr WHERE pr.user_id = ${user.id}),
  ${user.createdAt}::timestamptz), ${user.createdAt}::timestamptz)`;

function visible(db: Database, user: AudienceViewer) {
  return db
    .selectFrom('announcements as an')
    .selectAll('an')
    .select(sql<boolean>`an.published_at > ${SEEN_BASELINE(user)}`.as('unread'))
    .where('an.status', '=', 'published')
    .where(audienceAccess(ANNOUNCEMENT_AUDIENCE, { id: sql`${user.id}`, role: sql`${user.role}` }));
}

/**
 * `GET /announcements`: as novidades do público do usuário, fixadas no topo e depois da mais
 * recente para a mais antiga (20 por página). Não marca nada como lido: isso é
 * `markAnnouncementsSeen`.
 */
export async function listMyAnnouncements(
  db: Database,
  userId: string,
  query: Pick<CatalogPageInput, 'limit' | 'cursor'> = {},
): Promise<CatalogPage<Announcement>> {
  const user = await viewer(db, userId);
  const params = readCatalogPageParams(
    { limit: query.limit ?? ANNOUNCEMENT_PAGE_DEFAULT_LIMIT, cursor: query.cursor },
    LIST_SCOPE,
    ['recent'] as const,
    'recent',
  );
  let select = visible(db, user)
    .orderBy('an.pinned', 'desc')
    .orderBy('an.publishedAt', 'desc')
    .orderBy('an.id', 'desc')
    .limit(params.limit + 1);
  if (params.afterId !== undefined) {
    select = select.where(
      sql<boolean>`(an.pinned, an.published_at, an.id) < (
        SELECT p.pinned, p.published_at, p.id FROM announcements p WHERE p.id = ${params.afterId}
      )`,
    );
  }
  const rows = (await select.execute()) as VisibleRow[];
  return toCatalogPage(rows, params, LIST_SCOPE, shape);
}

/** `GET /announcements/{id}`. Rascunho, arquivada ou fora do público do usuário: `404`. */
export async function readMyAnnouncement(
  db: Database,
  userId: string,
  id: unknown,
): Promise<Announcement> {
  const user = await viewer(db, userId);
  const row = (await visible(db, user)
    .where('an.id', '=', announcementId(id))
    .executeTakeFirst()) as VisibleRow | undefined;
  if (!row) throw notFound('Novidade não encontrada.');
  return shape(row);
}

/**
 * `GET /announcements/unread-count`: publicadas, visíveis ao usuário e posteriores à última
 * abertura do mural ou ao cadastro, o que for mais recente. Quem perde o acesso deixa de
 * contar as novidades do produto.
 */
export async function countUnreadAnnouncements(
  db: Database,
  userId: string,
): Promise<{ unreadCount: number }> {
  const user = await viewer(db, userId);
  const result = await sql<{ unreadCount: number }>`
    SELECT ${unreadAnnouncementsCount({
      id: sql.ref<string>('u.id'),
      role: sql.ref<string>('u.role'),
      createdAt: sql.ref<Date>('u.created_at'),
      seenAt: sql.ref<Date | null>('pr.announcements_seen_at'),
    })} AS unread_count
    FROM users u LEFT JOIN profiles pr ON pr.user_id = u.id
    WHERE u.id = ${user.id}
  `.execute(db);
  return { unreadCount: result.rows[0]?.unreadCount ?? 0 };
}

/**
 * `POST /announcements/seen`: abrir a lista marca todas as visíveis como lidas, gravando
 * `profiles.announcements_seen_at = now()`. Não há leitura por item.
 */
export async function markAnnouncementsSeen(
  db: Database,
  userId: string,
): Promise<{ seenAt: Date; unreadCount: number }> {
  const user = await viewer(db, userId);
  const row = await db
    .insertInto('profiles')
    .values({ userId: user.id, announcementsSeenAt: sql<Date>`now()` })
    .onConflict((oc) => oc.column('userId').doUpdateSet({ announcementsSeenAt: sql<Date>`now()` }))
    .returning('announcementsSeenAt')
    .executeTakeFirstOrThrow();
  return { seenAt: row.announcementsSeenAt as Date, unreadCount: 0 };
}
