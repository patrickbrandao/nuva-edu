import { type SqlBool, sql } from 'kysely';
import type { Database } from '../../../db/database.ts';
import {
  type FieldError,
  notFound,
  permissionDenied,
  validationFailed,
} from '../../../errors/domain-error.ts';
import { AUDIT_DELETED_USER_NAME } from '../../audit/query.ts';
import { recordDenied } from '../../audit/record.ts';
import { permissionScope } from '../../permissions/matrix.ts';
import { isRole, type Role } from '../../permissions/roles.ts';
import { type Identity, listIdentities } from '../identities.ts';
import { avatarUrlFor } from '../session-view.ts';
import { loadTarget, type ManagementRequest, managementAuditContext } from './common.ts';

// Lista e ficha dos usuários no site admin (spec 007, "Esquemas comuns": `UserSummary` e
// `UserDetail`; `GET /users` e `GET /users/{id}`). Nenhum esquema tem campo de senha.

export const USER_LIST_SORTS = ['name', '-createdAt', '-lastLoginAt'] as const;
export type UserListSort = (typeof USER_LIST_SORTS)[number];

export const USER_LIST_STATUSES = ['active', 'suspended', 'unverified'] as const;
export type UserListStatus = (typeof USER_LIST_STATUSES)[number];

export const USER_LIST_DEFAULT_LIMIT = 25;
export const USER_LIST_MAX_LIMIT = 100;
export const USER_LIST_QUERY_MAX_LENGTH = 200;

export type UserStatus = 'active' | 'suspended';
export type SuspensionKind = 'posting' | 'full';

/** `UserSummary` do contrato. */
export interface UserSummary {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: Role;
  avatarUrl: string | null;
  status: UserStatus;
  createdAt: Date;
  lastLoginAt: Date | null;
}

/** `UserSuspension` do contrato: a suspensão vigente. */
export interface UserSuspension {
  kind: SuspensionKind;
  /** Motivo interno, visível só à equipe. */
  reason: string;
  startsAt: Date;
  endsAt: Date | null;
  createdBy: { id: string; name: string } | null;
}

/** `UserDetail` do contrato. */
export interface UserDetail extends UserSummary {
  fullName: string | null;
  hasPassword: boolean;
  identities: Identity[];
  suspension: UserSuspension | null;
  version: number;
}

export interface UserListPage {
  items: UserSummary[];
  nextCursor: string | null;
}

export interface ListUsersQuery {
  q?: string | undefined;
  role?: string | undefined;
  status?: string | undefined;
  sort?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

/**
 * Exige `users.list` com alcance total: na Fase 1, `manager` e `admin`; o `instructor` (alcance
 * só dos próprios cursos, servido pelas rotas do curso na Fase 2) recebe `403`, com a negação
 * gravada na auditoria (spec 008, "Identificadores das ações").
 */
async function requireFullUserList(
  db: Database,
  request: ManagementRequest,
  targetId: string | null,
): Promise<void> {
  if (permissionScope(request.actor, 'users.list') === 'all') {
    return;
  }
  await recordDenied(db, {
    context: managementAuditContext(request),
    permission: 'users.list',
    targetType: targetId ? 'user' : null,
    targetId,
  });
  throw permissionDenied();
}

const CURSOR_PREFIX = 'users:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function encodeCursor(sort: UserListSort, id: string): string {
  return Buffer.from(`${CURSOR_PREFIX}${sort}:${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string, sort: UserListSort): string | undefined {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const prefix = `${CURSOR_PREFIX}${sort}:`;
  if (!text.startsWith(prefix)) {
    return undefined;
  }
  const id = text.slice(prefix.length);
  return UUID.test(id) ? id : undefined;
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * `GET /users`: busca por trecho do nome ou do e-mail (`q`), filtros por papel e situação
 * (`active` sem suspensão, `suspended` com suspensão vigente, `unverified` com e-mail não
 * confirmado), ordem (`name`, `-createdAt` padrão, `-lastLoginAt` com quem nunca entrou no fim)
 * e cursor opaco. Contas excluídas não aparecem. Parâmetro fora do formato: `400
 * validation_failed`.
 */
export async function listUsers(
  db: Database,
  request: ManagementRequest,
  query: ListUsersQuery = {},
): Promise<UserListPage> {
  await requireFullUserList(db, request, null);
  const errors: FieldError[] = [];
  const q = query.q?.trim();
  if (query.q !== undefined && (!q || query.q.length > USER_LIST_QUERY_MAX_LENGTH)) {
    errors.push({
      path: 'query.q',
      message: `Use de 1 a ${USER_LIST_QUERY_MAX_LENGTH} caracteres.`,
    });
  }
  if (query.role !== undefined && !isRole(query.role)) {
    errors.push({ path: 'query.role', message: 'Papel desconhecido.' });
  }
  if (
    query.status !== undefined &&
    !(USER_LIST_STATUSES as readonly string[]).includes(query.status)
  ) {
    errors.push({ path: 'query.status', message: 'Situação desconhecida.' });
  }
  const sort = (query.sort ?? '-createdAt') as UserListSort;
  if (!USER_LIST_SORTS.includes(sort)) {
    errors.push({ path: 'query.sort', message: 'Ordem desconhecida.' });
  }
  const limit = query.limit ?? USER_LIST_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > USER_LIST_MAX_LIMIT) {
    errors.push({ path: 'query.limit', message: `Use de 1 a ${USER_LIST_MAX_LIMIT}.` });
  }
  let afterId: string | undefined;
  if (query.cursor !== undefined && errors.length === 0) {
    afterId = decodeCursor(query.cursor, sort);
    if (afterId === undefined) {
      errors.push({ path: 'query.cursor', message: 'Cursor inválido.' });
    }
  }
  if (errors.length > 0) {
    throw validationFailed(errors);
  }

  let select = summaryQuery(db).where('users.deletedAt', 'is', null);
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    select = select.where((eb) =>
      eb.or([eb('users.name', 'ilike', pattern), eb('users.email', 'ilike', pattern)]),
    );
  }
  if (query.role !== undefined) {
    select = select.where('users.role', '=', query.role);
  }
  if (query.status === 'active') {
    select = select.where('users.suspendedAt', 'is', null);
  } else if (query.status === 'suspended') {
    select = select.where('users.suspendedAt', 'is not', null);
  } else if (query.status === 'unverified') {
    select = select.where('users.emailVerifiedAt', 'is', null);
  }
  if (afterId !== undefined) {
    // O valor de ordenação vem da própria linha do cursor (sem perda de precisão da data).
    const after = AFTER_CURSOR[sort];
    select = select.where(
      sql<SqlBool>`EXISTS (SELECT 1 FROM users c WHERE c.id = ${afterId} AND ${after})`,
    );
  }
  if (sort === 'name') {
    select = select.orderBy('users.name', 'asc').orderBy('users.id', 'asc');
  } else if (sort === '-createdAt') {
    select = select.orderBy('users.createdAt', 'desc').orderBy('users.id', 'desc');
  } else {
    select = select.orderBy(sql`users.last_login_at DESC NULLS LAST`).orderBy('users.id', 'desc');
  }
  const rows = await select.limit(limit + 1).execute();
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(toSummary);
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? encodeCursor(sort, last.id) : null };
}

const AFTER_CURSOR: Readonly<Record<UserListSort, ReturnType<typeof sql>>> = {
  name: sql`(users.name, users.id) > (c.name, c.id)`,
  '-createdAt': sql`(users.created_at, users.id) < (c.created_at, c.id)`,
  '-lastLoginAt': sql`(
    (c.last_login_at IS NOT NULL AND (
      users.last_login_at IS NULL OR (users.last_login_at, users.id) < (c.last_login_at, c.id)
    ))
    OR (c.last_login_at IS NULL AND users.last_login_at IS NULL AND users.id < c.id)
  )`,
};

function summaryQuery(db: Database) {
  return db
    .selectFrom('users')
    .leftJoin('profiles', 'profiles.userId', 'users.id')
    .select([
      'users.id',
      'users.name',
      'users.email',
      'users.emailVerifiedAt',
      'users.role',
      'users.suspendedAt',
      'users.createdAt',
      'users.lastLoginAt',
      'profiles.avatarImageId',
    ]);
}

interface SummaryRow {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: Date | null;
  role: string;
  suspendedAt: Date | null;
  createdAt: Date;
  lastLoginAt: Date | null;
  avatarImageId: string | null;
}

function toSummary(row: SummaryRow): UserSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    role: row.role as Role,
    avatarUrl: avatarUrlFor(row.avatarImageId),
    status: row.suspendedAt === null ? 'active' : 'suspended',
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
  };
}

/**
 * `GET /users/{id}`: a ficha, com a mesma exigência da lista (`users.view` = `users.list`, com
 * alcance total na Fase 1). Inexistente ou excluído: `404`.
 */
export async function getUser(
  db: Database,
  request: ManagementRequest,
  userId: string,
): Promise<UserDetail> {
  await requireFullUserList(db, request, null);
  return readUserDetail(db, userId);
}

/**
 * Monta o `UserDetail` sem conferir permissão: as escritas da gestão devolvem a ficha com ela.
 * Inexistente ou excluído: `404`.
 */
export async function readUserDetail(db: Database, userId: string): Promise<UserDetail> {
  const target = await loadTarget(db, userId);
  const row = await summaryQuery(db)
    .select([
      'users.fullName',
      'users.version',
      'users.suspendedKind',
      'users.suspendedReason',
      'users.suspendedBy',
      sql<boolean>`users.password IS NOT NULL`.as('hasPassword'),
    ])
    .where('users.id', '=', target.id)
    .executeTakeFirst();
  if (!row) {
    throw notFound('Usuário não encontrado.');
  }
  const identities = await listIdentities(db, row.id);
  return {
    ...toSummary(row),
    fullName: row.fullName,
    hasPassword: row.hasPassword,
    identities: identities.items,
    suspension: row.suspendedAt === null ? null : await readSuspension(db, row),
    version: row.version,
  };
}

async function readSuspension(
  db: Database,
  user: {
    id: string;
    suspendedAt: Date | null;
    suspendedKind: string | null;
    suspendedReason: string | null;
    suspendedBy: string | null;
  },
): Promise<UserSuspension> {
  const open = await db
    .selectFrom('userSuspensions')
    .select(['kind', 'reason', 'startsAt', 'endsAt', 'createdBy'])
    .where('userId', '=', user.id)
    .where('liftedAt', 'is', null)
    .orderBy('startsAt', 'desc')
    .limit(1)
    .executeTakeFirst();
  // Sem a linha do histórico (espelho gravado por outro caminho), vale o espelho de `users`.
  const createdById = open?.createdBy ?? user.suspendedBy;
  return {
    kind: (open?.kind ?? user.suspendedKind) as SuspensionKind,
    reason: open?.reason ?? user.suspendedReason ?? '',
    startsAt: open?.startsAt ?? (user.suspendedAt as Date),
    endsAt: open?.endsAt ?? null,
    createdBy: createdById === null ? null : await userRef(db, createdById),
  };
}

async function userRef(db: Database, id: string): Promise<{ id: string; name: string }> {
  const row = await db
    .selectFrom('users')
    .select(['id', 'name', 'deletedAt'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) {
    return { id, name: AUDIT_DELETED_USER_NAME };
  }
  return { id: row.id, name: row.deletedAt === null ? row.name : AUDIT_DELETED_USER_NAME };
}
