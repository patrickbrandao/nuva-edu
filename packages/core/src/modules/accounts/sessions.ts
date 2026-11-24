import { createHash, randomBytes } from 'node:crypto';
import { type SqlBool, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { notFound, unauthenticated } from '../../errors/domain-error.ts';
import { recordAudit } from '../audit/record.ts';
import type { Role } from '../permissions/roles.ts';
import { type AccountSite, auditContextFor, type RequestContext, requireIp } from './context.ts';
import { safeTextEqual } from './credentials.ts';
import { csrfTokenInvalid } from './errors.ts';
import { parseUserAgent } from './user-agent.ts';

// Sessões (spec 007, "Sessões" e "Cookies"). O cookie leva um identificador aleatório de 256
// bits; o banco guarda só o SHA-256 dele (`sessions.id_hash`). Dono de `sessions`: a API do
// respectivo site; a `admin-api` também encerra sessões dos dois sites (suspensão, papel, senha).

/** Validade padrão: 30 dias sem uso (`NUVA_RETENTION_SESSION_DAYS`, `config.retention.sessionDays`). */
export const SESSION_TTL_DAYS_DEFAULT = 30;
/** `last_used_at` e `expires_at` são renovados no máximo uma vez por este intervalo. */
export const SESSION_RENEW_INTERVAL_SECONDS = 60;

export const SESSION_COOKIE_NAMES: { readonly [S in AccountSite]: string } = {
  classroom: 'nuva_classroom_session',
  admin: 'nuva_admin_session',
};

/** Cabeçalho que leva o token CSRF nas escritas. */
export const CSRF_HEADER = 'x-csrf-token';

const TOKEN_BYTES = 32;
/** 32 bytes em base64url, sem preenchimento: 43 caracteres. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const USER_AGENT_MAX_LENGTH = 1024;

export function sessionCookieName(site: AccountSite): string {
  return SESSION_COOKIE_NAMES[site];
}

/** Atributos do cookie de sessão (spec 007, "Cookies"): sem `Domain`, só o host do site. */
export interface SessionCookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: 'lax';
  path: '/';
  /** Segundos. */
  maxAge: number;
}

export function sessionCookieOptions(ttlDays = SESSION_TTL_DAYS_DEFAULT): SessionCookieOptions {
  return { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: ttlDays * 86_400 };
}

/** SHA-256 em hexadecimal minúsculo, como `sessions.id_hash`. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function randomToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function ttlInterval(ttlDays: number) {
  if (!Number.isInteger(ttlDays) || ttlDays < 1) {
    throw new TypeError('ttlDays precisa ser um inteiro positivo.');
  }
  return sql<Date>`now() + make_interval(days => ${ttlDays})`;
}

export interface CreateSessionInput {
  userId: string;
  site: AccountSite;
  context: RequestContext;
  /** Padrão: `SESSION_TTL_DAYS_DEFAULT`. */
  ttlDays?: number;
}

export interface CreatedSession {
  /** Valor do cookie. Em claro só aqui: nunca em log nem no banco. */
  token: string;
  /** `sessions.id`, o identificador público. */
  id: string;
  csrfToken: string;
  expiresAt: Date;
}

/** Abre uma sessão. Prefira `openLoginSession`, que faz também o resto do login. */
export async function createSession(
  trx: Database,
  input: CreateSessionInput,
): Promise<CreatedSession> {
  const token = randomToken();
  const csrfToken = randomToken();
  const row = await trx
    .insertInto('sessions')
    .values({
      idHash: hashSessionToken(token),
      userId: input.userId,
      site: input.site,
      ip: requireIp(input.context.ip),
      userAgent: input.context.userAgent?.slice(0, USER_AGENT_MAX_LENGTH) ?? null,
      csrfToken,
      expiresAt: ttlInterval(input.ttlDays ?? SESSION_TTL_DAYS_DEFAULT),
    })
    .returning(['id', 'expiresAt'])
    .executeTakeFirstOrThrow();
  return { token, id: row.id, csrfToken, expiresAt: row.expiresAt };
}

/** O dono da sessão, como a sessão precisa dele. */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: Role;
  hasPassword: boolean;
  avatarImageId: string | null;
  /** `posting` não impede a sessão; `full` não chega aqui. */
  suspendedKind: 'posting' | null;
}

export interface AuthenticatedSession {
  /** `sessions.id`, o identificador público. */
  id: string;
  site: AccountSite;
  csrfToken: string;
  expiresAt: Date;
  lastUsedAt: Date;
  /** `expires_at` foi renovado nesta chamada: a API regrava o cookie com o `Max-Age` cheio. */
  renewed: boolean;
  user: SessionUser;
}

export interface AuthenticateSessionInput {
  /** Valor do cookie do site (`sessionCookieName(site)`); ausente: `401`. */
  token: string | null | undefined;
  /** Site da API que recebeu a requisição. */
  site: AccountSite;
  ttlDays?: number;
}

/**
 * Validação a cada requisição (spec 007, "Sessões"): a sessão existe, não venceu, é do site da
 * API, e o usuário não está excluído nem com suspensão `full`. Caso contrário, `401`
 * `unauthenticated` (a API apaga o cookie). Renova `last_used_at` e `expires_at` no máximo uma
 * vez por minuto. O tratador de `sessionCookie` das duas APIs chama esta função.
 */
export async function authenticateSession(
  db: Database,
  input: AuthenticateSessionInput,
): Promise<AuthenticatedSession> {
  const { token } = input;
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    throw unauthenticated();
  }
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.userId')
    .leftJoin('profiles', 'profiles.userId', 'users.id')
    .select([
      'sessions.id',
      'sessions.site',
      'sessions.csrfToken',
      'sessions.expiresAt',
      'sessions.lastUsedAt',
      'users.id as userId',
      'users.name',
      'users.email',
      'users.emailVerifiedAt',
      'users.role',
      'users.suspendedKind',
      sql<boolean>`users.password IS NOT NULL`.as('hasPassword'),
      'profiles.avatarImageId',
      sql<boolean>`sessions.expires_at > now()`.as('valid'),
      sql<boolean>`sessions.last_used_at <= now() - make_interval(secs => ${SESSION_RENEW_INTERVAL_SECONDS})`.as(
        'stale',
      ),
    ])
    .where('sessions.idHash', '=', hashSessionToken(token))
    .where('users.deletedAt', 'is', null)
    .executeTakeFirst();
  if (!row?.valid || row.site !== input.site || row.suspendedKind === 'full') {
    throw unauthenticated();
  }
  let { expiresAt, lastUsedAt } = row;
  let renewed = false;
  if (row.stale) {
    const updated = await db
      .updateTable('sessions')
      .set({
        lastUsedAt: sql<Date>`now()`,
        expiresAt: ttlInterval(input.ttlDays ?? SESSION_TTL_DAYS_DEFAULT),
      })
      .where('id', '=', row.id)
      .where(
        sql<SqlBool>`last_used_at <= now() - make_interval(secs => ${SESSION_RENEW_INTERVAL_SECONDS})`,
      )
      .returning(['expiresAt', 'lastUsedAt'])
      .executeTakeFirst();
    if (updated) {
      ({ expiresAt, lastUsedAt } = updated);
      renewed = true;
    }
  }
  return {
    id: row.id,
    site: row.site as AccountSite,
    csrfToken: row.csrfToken,
    expiresAt,
    lastUsedAt,
    renewed,
    user: {
      id: row.userId,
      name: row.name,
      email: row.email,
      emailVerified: row.emailVerifiedAt !== null,
      role: row.role as Role,
      hasPassword: row.hasPassword,
      avatarImageId: row.avatarImageId,
      suspendedKind: row.suspendedKind === 'posting' ? 'posting' : null,
    },
  };
}

/**
 * Conferência do CSRF nas escritas (tratador de `csrfToken`): o cabeçalho `X-CSRF-Token` igual
 * ao token da sessão, comparado em tempo constante. Ausente ou diferente: `403`
 * `csrf_token_invalid`.
 */
export function assertCsrfToken(
  session: Pick<AuthenticatedSession, 'csrfToken'>,
  header: string | readonly string[] | null | undefined,
): void {
  const value = typeof header === 'string' ? header : null;
  if (value === null || value === '' || !safeTextEqual(value, session.csrfToken)) {
    throw csrfTokenInvalid();
  }
}

/** Uma sessão aberta (`SessionInfo` do contrato). */
export interface SessionInfo {
  id: string;
  site: AccountSite;
  ip: string | null;
  browser: string | null;
  os: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  current: boolean;
}

/**
 * Sessões válidas do usuário nos dois sites, a mais recente primeiro (`GET /account/sessions` e,
 * na `admin-api`, `GET /users/{id}/sessions`). `currentSessionId` marca `current`.
 */
export async function listSessions(
  db: Database,
  userId: string,
  currentSessionId: string | null = null,
): Promise<SessionInfo[]> {
  const rows = await db
    .selectFrom('sessions')
    .select(['id', 'site', 'ip', 'userAgent', 'createdAt', 'lastUsedAt'])
    .where('userId', '=', userId)
    .where(sql<SqlBool>`expires_at > now()`)
    .orderBy('lastUsedAt', 'desc')
    .orderBy('id', 'desc')
    .execute();
  return rows.map((row) => {
    const { browser, os } = parseUserAgent(row.userAgent);
    return {
      id: row.id,
      site: row.site as AccountSite,
      ip: row.ip,
      browser,
      os,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      current: row.id === currentSessionId,
    };
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Encerra uma sessão do próprio usuário (`DELETE /account/sessions/{id}`). Alheia ou inexistente: `404`. */
export async function revokeSession(
  db: Database,
  input: { userId: string; sessionId: string },
): Promise<void> {
  if (!UUID_PATTERN.test(input.sessionId)) {
    throw notFound('Sessão não encontrada.');
  }
  const result = await db
    .deleteFrom('sessions')
    .where('id', '=', input.sessionId.toLowerCase())
    .where('userId', '=', input.userId)
    .executeTakeFirst();
  if (result.numDeletedRows === 0n) {
    throw notFound('Sessão não encontrada.');
  }
}

export interface RevokeSessionsOptions {
  /** Só as sessões deste site (mudança de papel: as do admin). */
  site?: AccountSite;
  /** Mantém esta sessão (troca de senha e "encerrar as outras": a atual). */
  exceptSessionId?: string | null;
}

/**
 * Encerra as sessões do usuário: todas (suspensão `full`, exclusão, redefinição de senha, senha
 * definida pelo admin), as de um site (mudança de papel) ou todas menos a atual. Devolve
 * quantas encerrou.
 */
export async function revokeUserSessions(
  db: Database,
  userId: string,
  options: RevokeSessionsOptions = {},
): Promise<number> {
  let query = db.deleteFrom('sessions').where('userId', '=', userId);
  if (options.site !== undefined) {
    query = query.where('site', '=', options.site);
  }
  if (options.exceptSessionId) {
    query = query.where('id', '<>', options.exceptSessionId);
  }
  const result = await query.executeTakeFirst();
  return Number(result.numDeletedRows);
}

/** `DELETE /account/sessions`: encerra as outras sessões do usuário, nos dois sites. */
export async function revokeOtherSessions(
  db: Database,
  session: Pick<AuthenticatedSession, 'id' | 'user'>,
): Promise<number> {
  return revokeUserSessions(db, session.user.id, { exceptSessionId: session.id });
}

/** `POST /auth/logout`: encerra a sessão atual e grava `auth.logout`. */
export async function logout(
  db: Database,
  session: Pick<AuthenticatedSession, 'id' | 'site' | 'user'>,
  context: RequestContext,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('sessions').where('id', '=', session.id).execute();
    await recordAudit(trx, {
      context: auditContextFor(session.site, context, session.user),
      action: 'auth.logout',
      targetType: 'user',
      targetId: session.user.id,
    });
  });
}
