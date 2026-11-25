import { type RawBuilder, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import type { Role } from '../permissions/roles.ts';
import { type EntitlementProductType, isUuid } from './types.ts';

// Verificação de acesso (spec 010, "Verificação de acesso"): a mesma função para admin-api,
// classroom-api, worker e MCP (RF-08). O vencimento é decidido na leitura, por `now()` do banco
// (RF-09): nada é gravado quando um direito vence.

/** Motivos da negativa, os de `AccessDenialReason` no contrato do classroom. */
export const ACCESS_DENIAL_REASONS = [
  'not_authenticated',
  'suspended',
  'no_entitlement',
  'expired',
  'unpublished',
] as const;
export type AccessDenialReason = (typeof ACCESS_DENIAL_REASONS)[number];

/**
 * O que liberou o acesso: `staff` (admin ou gerente), `owner` (instrutor dono do curso),
 * `sample` (aula amostra), `open` (produto aberto), `public` (programa de curso publicado e não
 * privado) ou `entitlement` (direito ativo).
 */
export type AccessBasis = 'staff' | 'owner' | 'sample' | 'open' | 'public' | 'entitlement';

/**
 * Alvo da verificação: `lesson` (conteúdo da aula), `course` (conteúdo do curso),
 * `course_program` (módulos e títulos) e `ebook` (download). Pacote não tem conteúdo próprio.
 */
export type AccessTargetType = 'lesson' | 'course' | 'course_program' | 'ebook';

export interface AccessTarget {
  type: AccessTargetType;
  id: string;
}

/** Quem pede: só o id importa; papel e suspensão são lidos do banco na mesma consulta. */
export interface AccessUser {
  readonly id: string;
}

export type AccessDecision =
  | {
      allowed: true;
      reason: null;
      basis: AccessBasis;
      /**
       * Fim do acesso mais longo, quando ele vem de direito com validade; `null` vitalício e nas
       * demais bases (equipe, amostra, aberto, público).
       */
      expiresAt: Date | null;
    }
  | { allowed: false; reason: AccessDenialReason; basis: null; expiresAt: null };

/**
 * Situação dos direitos não revogados de um usuário a um produto, no instante da leitura:
 * `active` (algum vigente; `expiresAt` é o fim do mais longo, `null` vitalício), `expired`
 * (nenhum vigente, ao menos um vencido) ou `none`. Direito agendado conta como `none`.
 */
export type EntitlementStatus =
  | { state: 'active'; expiresAt: Date | null }
  | { state: 'expired' }
  | { state: 'none' };

/** Fatos que a decisão usa; `decideAccess` é pura, para quem já os leu em lote (estante, vitrine). */
export interface AccessFacts {
  target: AccessTargetType;
  /** `null`: visitante, ou conta inexistente ou excluída. */
  user: { id: string; role: Role; suspended: boolean } | null;
  /** O produto (curso ou ebook) e, na aula, também a aula estão publicados e não arquivados. */
  published: boolean;
  accessMode: 'open' | 'paid' | 'private';
  /** Dono do curso (`courses.owner_id`); ebook não tem dono. */
  ownerId: string | null;
  /** Só na aula. */
  isSample?: boolean;
  entitlement: EntitlementStatus;
}

const DENY = (reason: AccessDenialReason): AccessDecision => ({
  allowed: false,
  reason,
  basis: null,
  expiresAt: null,
});

const ALLOW = (basis: AccessBasis, expiresAt: Date | null = null): AccessDecision => ({
  allowed: true,
  reason: null,
  basis,
  expiresAt,
});

/**
 * A regra da tabela "Verificação de acesso" da 010, nesta ordem:
 *
 * 1. programa de curso publicado e não `private`: liberado para todos, inclusive o visitante;
 * 2. sem usuário: `not_authenticated` (programa em rascunho: `unpublished`); suspensão `full`: `suspended` (007);
 * 3. admin e gerente: tudo; instrutor: os próprios cursos e as aulas deles (008), mesmo em
 *    rascunho. Nos demais, e em ebook (sem dono), vale a regra de aluno;
 * 4. produto ou aula não publicados (ou arquivados): `unpublished`, mesmo com direito ativo;
 * 5. aula amostra, ou produto `open` (exceto o programa privado): liberado;
 * 6. direito ativo: liberado; só vencido: `expired`; senão `no_entitlement`.
 */
export function decideAccess(facts: AccessFacts): AccessDecision {
  const { user } = facts;
  if (facts.target === 'course_program' && facts.published && facts.accessMode !== 'private') {
    return ALLOW('public');
  }
  if (!user) {
    // Programa em rascunho não é revelado ao visitante: a API responde 404.
    return DENY(
      facts.target === 'course_program' && !facts.published ? 'unpublished' : 'not_authenticated',
    );
  }
  if (user.suspended) return DENY('suspended');
  if (user.role === 'admin' || user.role === 'manager') return ALLOW('staff');
  if (
    user.role === 'instructor' &&
    facts.target !== 'ebook' &&
    facts.ownerId !== null &&
    facts.ownerId === user.id
  ) {
    return ALLOW('owner');
  }
  if (!facts.published) return DENY('unpublished');
  if (facts.target === 'lesson' && facts.isSample) return ALLOW('sample');
  if (facts.accessMode === 'open' && facts.target !== 'course_program') return ALLOW('open');
  if (facts.entitlement.state === 'active')
    return ALLOW('entitlement', facts.entitlement.expiresAt);
  return DENY(facts.entitlement.state === 'expired' ? 'expired' : 'no_entitlement');
}

interface AccessRow {
  found: boolean;
  published: boolean;
  accessMode: 'open' | 'paid' | 'private';
  ownerId: string | null;
  isSample: boolean;
  userRole: string | null;
  userSuspendedKind: string | null;
  hasActive: boolean | null;
  hasLifetime: boolean | null;
  activeUntil: Date | null;
  hasExpired: boolean | null;
}

const ACTIVE = sql`e.starts_at <= now() AND (e.expires_at IS NULL OR e.expires_at > now())`;

function entitlementLateral(
  userId: string | null,
  productType: EntitlementProductType,
  productId: RawBuilder<unknown>,
) {
  return sql`LEFT JOIN LATERAL (
    SELECT bool_or(${ACTIVE}) AS has_active,
           bool_or(e.starts_at <= now() AND e.expires_at IS NULL) AS has_lifetime,
           max(e.expires_at) FILTER (WHERE ${ACTIVE}) AS active_until,
           bool_or(e.expires_at <= now()) AS has_expired
      FROM entitlements e
     WHERE e.user_id = ${userId}::uuid AND e.product_type = ${productType}
       AND e.product_id = ${productId} AND e.revoked_at IS NULL
  ) ent ON true`;
}

const USER_COLUMNS = sql`u.role AS user_role, u.suspended_kind AS user_suspended_kind`;
const ENT_COLUMNS = sql`ent.has_active, ent.has_lifetime, ent.active_until, ent.has_expired`;

function accessQuery(target: AccessTarget, userId: string | null) {
  const userJoin = sql`LEFT JOIN users u ON u.id = ${userId}::uuid AND u.deleted_at IS NULL`;
  if (target.type === 'lesson') {
    return sql<AccessRow>`
      SELECT true AS found,
             (l.status = 'published' AND c.status = 'published' AND c.archived_at IS NULL) AS published,
             c.access_mode, c.owner_id, l.is_sample, ${USER_COLUMNS}, ${ENT_COLUMNS}
        FROM lessons l
        JOIN modules m ON m.id = l.module_id
        JOIN courses c ON c.id = m.course_id
        ${userJoin}
        ${entitlementLateral(userId, 'course', sql`c.id`)}
       WHERE l.id = ${target.id}::uuid`;
  }
  if (target.type === 'ebook') {
    return sql<AccessRow>`
      SELECT true AS found, (k.status = 'published' AND k.archived_at IS NULL) AS published,
             k.access_mode, NULL::uuid AS owner_id, false AS is_sample, ${USER_COLUMNS}, ${ENT_COLUMNS}
        FROM ebooks k
        ${userJoin}
        ${entitlementLateral(userId, 'ebook', sql`k.id`)}
       WHERE k.id = ${target.id}::uuid`;
  }
  return sql<AccessRow>`
    SELECT true AS found, (c.status = 'published' AND c.archived_at IS NULL) AS published,
           c.access_mode, c.owner_id, false AS is_sample, ${USER_COLUMNS}, ${ENT_COLUMNS}
      FROM courses c
      ${userJoin}
      ${entitlementLateral(userId, 'course', sql`c.id`)}
     WHERE c.id = ${target.id}::uuid`;
}

/** Converte os agregados da consulta em `EntitlementStatus`. */
export function toEntitlementStatus(row: {
  hasActive: boolean | null;
  hasLifetime: boolean | null;
  activeUntil: Date | null;
  hasExpired: boolean | null;
}): EntitlementStatus {
  if (row.hasActive)
    return { state: 'active', expiresAt: row.hasLifetime ? null : row.activeUntil };
  if (row.hasExpired) return { state: 'expired' };
  return { state: 'none' };
}

/**
 * O usuário acessa o alvo agora? Uma única consulta ao banco (RNF-01), com o produto, a conta
 * (papel e suspensão, lidos agora) e os direitos ao curso ou ao ebook. Sem usuário, nega com
 * `not_authenticated` sem consultar (exceto no programa, que é público). Alvo inexistente (ou
 * id fora do formato): `404 not_found`. Despublicado: `unpublished`, que a API responde como
 * `404` ao aluno conforme o contrato.
 */
export async function canAccess(
  db: Database,
  user: AccessUser | null | undefined,
  target: AccessTarget,
): Promise<AccessDecision> {
  if (!user && target.type !== 'course_program') return DENY('not_authenticated');
  if (!isUuid(target.id)) throw notFound();
  const userId = user && isUuid(user.id) ? user.id.toLowerCase() : null;
  if (user && userId === null) return DENY('not_authenticated');
  const result = await accessQuery(
    { type: target.type, id: target.id.toLowerCase() },
    userId,
  ).execute(db);
  const row = result.rows[0];
  if (!row) throw notFound();
  return decideAccess({
    target: target.type,
    user:
      userId !== null && row.userRole !== null
        ? { id: userId, role: row.userRole as Role, suspended: row.userSuspendedKind === 'full' }
        : null,
    published: row.published,
    accessMode: row.accessMode,
    ownerId: row.ownerId,
    isSample: row.isSample,
    entitlement: toEntitlementStatus(row),
  });
}

export interface EntitlementStatusQuery {
  productType: EntitlementProductType;
  productIds: readonly string[];
}

/**
 * Situação dos direitos de um usuário a vários produtos de um tipo, numa consulta (estante,
 * vitrine, programa com estado de acesso). Devolve um mapa por id de produto; os sem direito
 * vêm como `none`. Junto com `decideAccess`, dá a mesma decisão de `canAccess` sem uma
 * consulta por item.
 */
export async function getEntitlementStatuses(
  db: Database,
  userId: string,
  query: EntitlementStatusQuery,
): Promise<Map<string, EntitlementStatus>> {
  const ids = [...new Set(query.productIds.filter(isUuid).map((id) => id.toLowerCase()))];
  const map = new Map<string, EntitlementStatus>(ids.map((id) => [id, { state: 'none' }]));
  if (ids.length === 0 || !isUuid(userId)) return map;
  const result = await sql<{
    productId: string;
    hasActive: boolean;
    hasLifetime: boolean;
    activeUntil: Date | null;
    hasExpired: boolean;
  }>`
    SELECT e.product_id,
           bool_or(${ACTIVE}) AS has_active,
           bool_or(e.starts_at <= now() AND e.expires_at IS NULL) AS has_lifetime,
           max(e.expires_at) FILTER (WHERE ${ACTIVE}) AS active_until,
           bool_or(e.expires_at <= now()) AS has_expired
      FROM entitlements e
     WHERE e.user_id = ${userId.toLowerCase()}::uuid AND e.product_type = ${query.productType}
       AND e.product_id = ANY(${ids}::uuid[]) AND e.revoked_at IS NULL
     GROUP BY e.product_id`.execute(db);
  for (const row of result.rows) map.set(row.productId, toEntitlementStatus(row));
  return map;
}

/**
 * "Acesso ativo" (fórum, mensagens diretas, eventos; spec 010): ao menos um direito ativo de
 * qualquer fonte, ou papel da equipe (sem consulta). Curso `open` não conta. Sem usuário: `false`.
 */
export async function hasActiveAccess(
  db: Database,
  user: { readonly id: string; readonly role: Role } | null | undefined,
): Promise<boolean> {
  if (!user || !isUuid(user.id)) return false;
  if (user.role !== 'student') return true;
  const row = await sql<{ active: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM entitlements e
       WHERE e.user_id = ${user.id.toLowerCase()}::uuid AND e.revoked_at IS NULL AND ${ACTIVE}
    ) AS active`.execute(db);
  return row.rows[0]?.active === true;
}
