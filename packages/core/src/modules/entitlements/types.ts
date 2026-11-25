import { sql } from 'kysely';

// Tipos e constantes dos direitos de acesso (spec 010, "Fontes", "Algoritmo de revogação" e
// "Dados"). Os valores repetem as restrições da migration 0010.

export const ENTITLEMENT_PRODUCT_TYPES = ['course', 'bundle', 'ebook'] as const;
/** Tipo do produto de um direito (`entitlements.product_type`). */
export type EntitlementProductType = (typeof ENTITLEMENT_PRODUCT_TYPES)[number];

export const ENTITLEMENT_SOURCES = ['order', 'subscription', 'grant', 'cascade'] as const;
export type EntitlementSource = (typeof ENTITLEMENT_SOURCES)[number];

/** Fontes das raízes; `cascade` é sempre derivado. */
export const ENTITLEMENT_ROOT_SOURCES = ['order', 'subscription', 'grant'] as const;
export type EntitlementRootSource = (typeof ENTITLEMENT_ROOT_SOURCES)[number];

export const ENTITLEMENT_REVOKE_REASONS = [
  'refund',
  'chargeback',
  'subscription_ended',
  'manual',
  'recalculation',
  'account_deleted',
] as const;
export type EntitlementRevokeReason = (typeof ENTITLEMENT_REVOKE_REASONS)[number];

/**
 * Estado de um direito, calculado no instante da leitura (RF-09: vencer não grava nada):
 * `active` (vigente), `scheduled` (`starts_at` no futuro), `expired` (passou de `expires_at`) ou
 * `revoked`.
 */
export const ENTITLEMENT_STATES = ['active', 'scheduled', 'expired', 'revoked'] as const;
export type EntitlementState = (typeof ENTITLEMENT_STATES)[number];

/** Profundidade máxima da cascata: pacote → curso → ebook (spec 010, passo 4). */
export const ENTITLEMENT_MAX_DEPTH = 2;

/** Raízes processadas por transação no recálculo (spec 010, "Recalcular a cascata"). */
export const ENTITLEMENT_RECALCULATION_BATCH_SIZE = 500;

/** Motivo da concessão manual: 1 a 500 caracteres (restrição da 0010 e contrato). */
export const ENTITLEMENT_REASON_MAX_LENGTH = 500;

export const ENTITLEMENT_PAGE_DEFAULT_LIMIT = 25;
export const ENTITLEMENT_PAGE_MAX_LIMIT = 100;

/** Uma linha de `entitlements`. */
export interface Entitlement {
  id: string;
  userId: string;
  productType: EntitlementProductType;
  productId: string;
  source: EntitlementSource;
  sourceId: string;
  parentEntitlementId: string | null;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokeReason: EntitlementRevokeReason | null;
  grantedReason: string | null;
  createdAt: Date;
  version: number;
}

/** Produto citado por um direito, com o título atual. */
export interface EntitlementProductRef {
  type: EntitlementProductType;
  id: string;
  title: string;
}

/** Título usado quando o produto não existe mais (não deveria acontecer: exclusão dá `409`). */
export const ENTITLEMENT_MISSING_PRODUCT_TITLE = 'produto removido';

/** Nome de quem concedeu quando a conta foi excluída (o mesmo da auditoria). */
export const ENTITLEMENT_DELETED_USER_NAME = 'usuário removido';

export function isEntitlementProductType(value: unknown): value is EntitlementProductType {
  return (
    typeof value === 'string' && (ENTITLEMENT_PRODUCT_TYPES as readonly string[]).includes(value)
  );
}

export function isEntitlementState(value: unknown): value is EntitlementState {
  return typeof value === 'string' && (ENTITLEMENT_STATES as readonly string[]).includes(value);
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Estado do direito em SQL, sobre a tabela (ou apelido) `alias`. Usa `now()` do banco, a mesma
 * referência de `canAccess`.
 */
export function entitlementStateSql(alias = 'entitlements') {
  const t = sql.table(alias);
  return sql<EntitlementState>`CASE
    WHEN ${t}.revoked_at IS NOT NULL THEN 'revoked'
    WHEN ${t}.starts_at > now() THEN 'scheduled'
    WHEN ${t}.expires_at IS NOT NULL AND ${t}.expires_at <= now() THEN 'expired'
    ELSE 'active' END`;
}

/** Converte a linha lida pelo Kysely (texto nas colunas de enumeração) no tipo do módulo. */
export function toEntitlement(row: {
  id: string;
  userId: string;
  productType: string;
  productId: string;
  source: string;
  sourceId: string;
  parentEntitlementId: string | null;
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokeReason: string | null;
  grantedReason: string | null;
  createdAt: Date;
  version: number;
}): Entitlement {
  return {
    id: row.id,
    userId: row.userId,
    productType: row.productType as EntitlementProductType,
    productId: row.productId,
    source: row.source as EntitlementSource,
    sourceId: row.sourceId,
    parentEntitlementId: row.parentEntitlementId,
    startsAt: row.startsAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokeReason: row.revokeReason as EntitlementRevokeReason | null,
    grantedReason: row.grantedReason,
    createdAt: row.createdAt,
    version: row.version,
  };
}

/** Colunas de `entitlements` lidas por `toEntitlement`, sem prefixo (consulta de uma tabela). */
export const ENTITLEMENT_FIELDS = [
  'id',
  'userId',
  'productType',
  'productId',
  'source',
  'sourceId',
  'parentEntitlementId',
  'startsAt',
  'expiresAt',
  'revokedAt',
  'revokeReason',
  'grantedReason',
  'createdAt',
  'version',
] as const;

/** As mesmas colunas, com o prefixo da tabela (consulta com junção). */
export const ENTITLEMENT_COLUMNS = [
  'entitlements.id',
  'entitlements.userId',
  'entitlements.productType',
  'entitlements.productId',
  'entitlements.source',
  'entitlements.sourceId',
  'entitlements.parentEntitlementId',
  'entitlements.startsAt',
  'entitlements.expiresAt',
  'entitlements.revokedAt',
  'entitlements.revokeReason',
  'entitlements.grantedReason',
  'entitlements.createdAt',
  'entitlements.version',
] as const;
