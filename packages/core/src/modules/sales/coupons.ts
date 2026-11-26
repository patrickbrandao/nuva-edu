import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { type FieldError, validationFailed } from '../../errors/domain-error.ts';
import {
  type ManagementRequest,
  managementAuditContext,
  requirePermission,
} from '../accounts/management/common.ts';
import { recordAudit } from '../audit/record.ts';
import { couponCodeTaken, couponNotFound, couponRule } from './errors.ts';
import { salesProductKey } from './products.ts';
import {
  COUPON_CODE_PATTERN,
  COUPON_INVALID_REASONS,
  COUPON_KINDS,
  COUPON_MAX_PRODUCTS,
  type Coupon,
  type CouponAppliesTo,
  type CouponInvalidReason,
  type CouponKind,
  cents,
  centsOrNull,
  decodeSalesCursor,
  encodeSalesCursor,
  isCouponAppliesTo,
  isCouponKind,
  isSalesProductType,
  isUuid,
  SALES_PAGE_DEFAULT_LIMIT,
  SALES_PAGE_MAX_LIMIT,
  SALES_QUERY_MAX_LENGTH,
  type SalesCursorValue,
  type SalesPage,
  type SalesProductRef,
  type SalesProductType,
} from './types.ts';

// Cupons (spec 011, "Cupons"): criação, edição, desativação e a validação usada pela cesta e
// pelo fechamento. Dono da escrita: admin-api. O código é único sem diferenciar maiúsculas; o
// uso só é contado quando o pedido é pago. O rateio em si fica em `pricing.ts`.

/** Um produto elegível do cupom, com o título atual (`CouponProduct`). */
export interface CouponProductView extends SalesProductRef {
  title: string;
}

/** O cupom como o admin o vê (`Coupon`). */
export interface CouponView {
  id: string;
  code: string;
  kind: CouponKind;
  percentOff: number | null;
  amountOffCents: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  maxUsesPerUser: number;
  usesCount: number;
  appliesTo: CouponAppliesTo;
  products: CouponProductView[];
  active: boolean;
  createdBy: { id: string; name: string };
  createdAt: Date;
  updatedAt: Date;
}

/** Cupom com a lista de produtos, como a validação da cesta precisa dele. */
export interface CouponWithProducts extends Coupon {
  products: SalesProductRef[];
}

export interface CouponQuery {
  q?: unknown;
  active?: unknown;
  appliesTo?: unknown;
  limit?: unknown;
  cursor?: unknown;
}

export interface CouponInput {
  code: string;
  kind: CouponKind;
  percentOff?: number | null;
  amountOffCents?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  maxUses?: number | null;
  maxUsesPerUser?: number;
  appliesTo?: CouponAppliesTo;
  products?: readonly SalesProductRef[];
  active?: boolean;
}

export type CouponUpdateInput = Partial<CouponInput>;

const COUPON_CURSOR_SCOPE = 'coupons';
const DELETED_USER_NAME = 'usuário removido';

/** Lê uma linha de `coupons`, sem os produtos (que vêm à parte). */
export function couponFromRow(row: {
  id: string;
  code: string;
  kind: string;
  percentOff: number | null;
  amountOffCents: string | number | bigint | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  maxUsesPerUser: number;
  usesCount: number;
  appliesTo: string;
  active: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}): Coupon {
  return {
    id: row.id,
    code: row.code,
    kind: row.kind as CouponKind,
    percentOff: row.percentOff,
    amountOffCents: centsOrNull(row.amountOffCents),
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    maxUses: row.maxUses,
    maxUsesPerUser: row.maxUsesPerUser,
    usesCount: row.usesCount,
    appliesTo: row.appliesTo as CouponAppliesTo,
    active: row.active,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Cupom pelo identificador, ou `undefined`. */
export async function findCouponById(
  db: Database,
  couponId: string,
): Promise<CouponWithProducts | undefined> {
  if (!isUuid(couponId)) return undefined;
  const row = await db
    .selectFrom('coupons')
    .selectAll()
    .where('id', '=', couponId.toLowerCase())
    .executeTakeFirst();
  if (!row) return undefined;
  return withProducts(db, couponFromRow(row));
}

/** Cupom pelo código, sem diferenciar maiúsculas, ou `undefined`. */
export async function findCouponByCode(
  db: Database,
  code: string,
): Promise<CouponWithProducts | undefined> {
  const row = await db
    .selectFrom('coupons')
    .selectAll()
    .where(sql<boolean>`lower(coupons.code) = lower(${code})`)
    .executeTakeFirst();
  if (!row) return undefined;
  return withProducts(db, couponFromRow(row));
}

async function withProducts(db: Database, coupon: Coupon): Promise<CouponWithProducts> {
  const rows = await db
    .selectFrom('couponProducts')
    .select(['productType', 'productId'])
    .where('couponId', '=', coupon.id)
    .orderBy('productType')
    .orderBy('productId')
    .execute();
  return {
    ...coupon,
    products: rows.map((row) => ({
      productType: row.productType as SalesProductType,
      productId: row.productId,
    })),
  };
}

/**
 * Motivo de o cupom não valer para esta cesta agora (`null` quando vale). A ordem segue o
 * contrato: inativo, fora da janela, esgotado, sem item elegível. `max_uses_per_user` conta os
 * pedidos pagos e não cancelados do mesmo comprador.
 */
export async function couponInvalidReason(
  db: Database,
  coupon: CouponWithProducts,
  userId: string,
  items: readonly SalesProductRef[],
  now: Date = new Date(),
): Promise<CouponInvalidReason | null> {
  if (!coupon.active) return 'inactive';
  if (coupon.startsAt !== null && coupon.startsAt > now) return 'expired';
  if (coupon.endsAt !== null && coupon.endsAt <= now) return 'expired';
  if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) return 'exhausted';
  if (coupon.maxUsesPerUser > 0) {
    const used = await db
      .selectFrom('orders')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('userId', '=', userId)
      .where('couponId', '=', coupon.id)
      .where('paidAt', 'is not', null)
      .executeTakeFirstOrThrow();
    if (used.n >= coupon.maxUsesPerUser) return 'exhausted';
  }
  if (coupon.appliesTo === 'subscriptions') return 'not_eligible';
  const eligible = items.some(
    (item) =>
      coupon.products.length === 0 ||
      coupon.products.some(
        (product) =>
          product.productType === item.productType && product.productId === item.productId,
      ),
  );
  if (!eligible) return 'not_eligible';
  return null;
}

/** Soma um uso ao cupom. Chamado só na transição para `paid`, uma única vez por pedido. */
export async function incrementCouponUse(trx: Database, couponId: string): Promise<void> {
  await trx
    .updateTable('coupons')
    .set({ usesCount: sql<number>`uses_count + 1` })
    .where('id', '=', couponId)
    .execute();
}

/** Lista os cupons do admin, do mais novo ao mais antigo (`GET /coupons`). */
export async function listCoupons(
  db: Database,
  request: ManagementRequest,
  query: CouponQuery,
): Promise<SalesPage<CouponView>> {
  await requirePermission(db, request, 'coupon.manage', { action: 'coupon.list' });
  const errors: FieldError[] = [];
  let q: string | undefined;
  if (query.q !== undefined) {
    const text = typeof query.q === 'string' ? query.q.trim() : '';
    if (text === '' || text.length > SALES_QUERY_MAX_LENGTH) {
      errors.push({ path: 'q', message: 'deve ter de 1 a 200 caracteres' });
    } else {
      q = text;
    }
  }
  let active: boolean | undefined;
  if (query.active !== undefined) {
    if (typeof query.active === 'boolean') active = query.active;
    else if (query.active === 'true' || query.active === 'false') active = query.active === 'true';
    else errors.push({ path: 'active', message: 'deve ser booleano' });
  }
  let appliesTo: CouponAppliesTo | undefined;
  if (query.appliesTo !== undefined) {
    if (isCouponAppliesTo(query.appliesTo)) appliesTo = query.appliesTo;
    else errors.push({ path: 'appliesTo', message: 'valor inválido' });
  }
  let limit = SALES_PAGE_DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    const value =
      typeof query.limit === 'number'
        ? query.limit
        : typeof query.limit === 'string' && /^\d+$/.test(query.limit)
          ? Number(query.limit)
          : Number.NaN;
    if (!Number.isInteger(value) || value < 1 || value > SALES_PAGE_MAX_LIMIT) {
      errors.push({ path: 'limit', message: 'deve ser um inteiro de 1 a 100' });
    } else {
      limit = value;
    }
  }
  let after: SalesCursorValue | undefined;
  if (query.cursor !== undefined) {
    after = decodeSalesCursor(query.cursor, COUPON_CURSOR_SCOPE);
    if (!after) errors.push({ path: 'cursor', message: 'cursor inválido' });
  }
  if (errors.length > 0) throw validationFailed(errors);

  let statement = db.selectFrom('coupons').selectAll();
  if (q !== undefined) {
    statement = statement.where(sql<boolean>`coupons.code ILIKE ${`%${escapeLike(q)}%`}`);
  }
  if (active !== undefined) statement = statement.where('active', '=', active);
  if (appliesTo !== undefined) statement = statement.where('appliesTo', '=', appliesTo);
  if (after !== undefined) {
    statement = statement.where((eb) =>
      eb.or([
        eb('createdAt', '<', after.createdAt),
        eb.and([eb('createdAt', '=', after.createdAt), eb('id', '<', after.id)]),
      ]),
    );
  }
  const rows = await statement
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1)
    .execute();
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const items = await Promise.all(
    pageRows.map(async (row) => couponView(db, await withProducts(db, couponFromRow(row)))),
  );
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? encodeSalesCursor(COUPON_CURSOR_SCOPE, last.createdAt, last.id)
        : null,
  };
}

/** Um cupom do admin (`GET /coupons/{id}`); `404` quando não existe. */
export async function getCoupon(
  db: Database,
  request: ManagementRequest,
  couponId: string,
): Promise<CouponView> {
  await requirePermission(db, request, 'coupon.manage', { action: 'coupon.view' });
  const coupon = await findCouponById(db, couponId);
  if (!coupon) throw couponNotFound();
  return couponView(db, coupon);
}

/** Cria um cupom (`POST /coupons`), auditado na mesma transação. */
export async function createCoupon(
  db: Database,
  request: ManagementRequest,
  input: CouponInput,
): Promise<CouponView> {
  await requirePermission(db, request, 'coupon.manage', { action: 'coupon.create' });
  const normalized = normalizeCouponInput(input);
  const code = typeof input.code === 'string' ? input.code : '';
  await assertCodeAvailable(db, code);

  return db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto('coupons')
      .values({
        code: normalized.code,
        kind: normalized.kind,
        percentOff: normalized.percentOff,
        amountOffCents: normalized.amountOffCents,
        startsAt: normalized.startsAt,
        endsAt: normalized.endsAt,
        maxUses: normalized.maxUses,
        maxUsesPerUser: normalized.maxUsesPerUser,
        appliesTo: normalized.appliesTo,
        active: normalized.active,
        createdBy: request.actor.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const products = await normalizeProducts(trx, input.products);
    if (products.length > 0) {
      await trx
        .insertInto('couponProducts')
        .values(
          products.map((product) => ({
            couponId: inserted.id,
            productType: product.productType,
            productId: product.productId,
          })),
        )
        .execute();
    }
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'coupon.create',
      targetType: 'coupon',
      targetId: inserted.id,
      details: {
        code: normalized.code,
        kind: normalized.kind,
        percentOff: normalized.percentOff,
        amountOffCents: normalized.amountOffCents,
        startsAt: normalized.startsAt,
        endsAt: normalized.endsAt,
        maxUses: normalized.maxUses,
        maxUsesPerUser: normalized.maxUsesPerUser,
        appliesTo: normalized.appliesTo,
        active: normalized.active,
        products,
      },
    });
    const coupon = await findCouponById(trx, inserted.id);
    if (!coupon) throw couponNotFound();
    return couponView(trx, coupon);
  });
}

/** Edita um cupom (`PATCH /coupons/{id}`); `products` enviada substitui a lista inteira. */
export async function updateCoupon(
  db: Database,
  request: ManagementRequest,
  couponId: string,
  input: CouponUpdateInput,
): Promise<CouponView> {
  await requirePermission(db, request, 'coupon.manage', { action: 'coupon.update' });
  const current = await findCouponById(db, couponId);
  if (!current) throw couponNotFound();
  const normalized = normalizeCouponInput({
    code: input.code ?? current.code,
    kind: input.kind ?? current.kind,
    percentOff: input.percentOff !== undefined ? input.percentOff : current.percentOff,
    amountOffCents:
      input.amountOffCents !== undefined ? input.amountOffCents : current.amountOffCents,
    startsAt: input.startsAt !== undefined ? input.startsAt : current.startsAt,
    endsAt: input.endsAt !== undefined ? input.endsAt : current.endsAt,
    maxUses: input.maxUses !== undefined ? input.maxUses : current.maxUses,
    maxUsesPerUser:
      input.maxUsesPerUser !== undefined ? input.maxUsesPerUser : current.maxUsesPerUser,
    appliesTo: input.appliesTo ?? current.appliesTo,
    active: input.active !== undefined ? input.active : current.active,
  });
  if (normalized.code.toLowerCase() !== current.code.toLowerCase()) {
    await assertCodeAvailable(db, normalized.code);
  }

  return db.transaction().execute(async (trx) => {
    await trx
      .updateTable('coupons')
      .set({
        code: normalized.code,
        kind: normalized.kind,
        percentOff: normalized.percentOff,
        amountOffCents: normalized.amountOffCents,
        startsAt: normalized.startsAt,
        endsAt: normalized.endsAt,
        maxUses: normalized.maxUses,
        maxUsesPerUser: normalized.maxUsesPerUser,
        appliesTo: normalized.appliesTo,
        active: normalized.active,
      })
      .where('id', '=', current.id)
      .execute();
    if (input.products !== undefined) {
      const products = await normalizeProducts(trx, input.products);
      await trx.deleteFrom('couponProducts').where('couponId', '=', current.id).execute();
      if (products.length > 0) {
        await trx
          .insertInto('couponProducts')
          .values(
            products.map((product) => ({
              couponId: current.id,
              productType: product.productType,
              productId: product.productId,
            })),
          )
          .execute();
      }
    }
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'coupon.update',
      targetType: 'coupon',
      targetId: current.id,
      details: {
        code: normalized.code,
        kind: normalized.kind,
        percentOff: normalized.percentOff,
        amountOffCents: normalized.amountOffCents,
        startsAt: normalized.startsAt,
        endsAt: normalized.endsAt,
        maxUses: normalized.maxUses,
        maxUsesPerUser: normalized.maxUsesPerUser,
        appliesTo: normalized.appliesTo,
        active: normalized.active,
      },
    });
    const updated = await findCouponById(trx, current.id);
    if (!updated) throw couponNotFound();
    return couponView(trx, updated);
  });
}

interface NormalizedCoupon {
  code: string;
  kind: CouponKind;
  percentOff: number | null;
  amountOffCents: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  maxUses: number | null;
  maxUsesPerUser: number;
  appliesTo: CouponAppliesTo;
  active: boolean;
}

function normalizeCouponInput(input: CouponInput): NormalizedCoupon {
  const errors: FieldError[] = [];
  if (typeof input.code !== 'string' || !COUPON_CODE_PATTERN.test(input.code)) {
    errors.push({ path: 'code', message: 'deve ter de 3 a 40 letras, números ou hífen' });
  }
  if (!isCouponKind(input.kind) || !COUPON_KINDS.includes(input.kind)) {
    errors.push({ path: 'kind', message: 'deve ser percent ou fixed' });
  }
  const kind = input.kind;
  const percentOff = input.percentOff ?? null;
  const amountOffCents = input.amountOffCents ?? null;
  if (kind === 'percent') {
    if (
      typeof percentOff !== 'number' ||
      !Number.isInteger(percentOff) ||
      percentOff < 1 ||
      percentOff > 100
    ) {
      errors.push({ path: 'percentOff', message: 'deve ser um inteiro de 1 a 100' });
    }
    if (amountOffCents !== null) {
      errors.push({ path: 'amountOffCents', message: 'proibido em cupom percentual' });
    }
  } else {
    if (
      typeof amountOffCents !== 'number' ||
      !Number.isSafeInteger(amountOffCents) ||
      amountOffCents < 1
    ) {
      errors.push({ path: 'amountOffCents', message: 'deve ser um inteiro positivo em centavos' });
    }
    if (percentOff !== null) {
      errors.push({ path: 'percentOff', message: 'proibido em cupom de valor fixo' });
    }
  }
  const startsAt = readOptionalDate(input.startsAt, 'startsAt', errors);
  const endsAt = readOptionalDate(input.endsAt, 'endsAt', errors);
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw couponRule('endsAt deve ser posterior a startsAt.');
  }
  let maxUses: number | null = null;
  if (input.maxUses !== undefined && input.maxUses !== null) {
    if (!Number.isInteger(input.maxUses) || input.maxUses < 1) {
      errors.push({ path: 'maxUses', message: 'deve ser um inteiro positivo ou nulo' });
    } else {
      maxUses = input.maxUses;
    }
  }
  const maxUsesPerUser = input.maxUsesPerUser ?? 1;
  if (!Number.isInteger(maxUsesPerUser) || maxUsesPerUser < 1) {
    errors.push({ path: 'maxUsesPerUser', message: 'deve ser um inteiro positivo' });
  }
  const appliesTo = input.appliesTo ?? 'orders';
  if (!isCouponAppliesTo(appliesTo)) {
    errors.push({ path: 'appliesTo', message: 'deve ser orders, subscriptions ou both' });
  }
  if (errors.length > 0) throw validationFailed(errors);
  return {
    code: (input.code as string).trim(),
    kind,
    percentOff: kind === 'percent' ? percentOff : null,
    amountOffCents: kind === 'fixed' ? amountOffCents : null,
    startsAt,
    endsAt,
    maxUses,
    maxUsesPerUser,
    appliesTo,
    active: input.active ?? true,
  };
}

function readOptionalDate(value: unknown, path: string, errors: FieldError[]): Date | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  errors.push({ path, message: 'deve ser uma data ISO 8601 ou nula' });
  return null;
}

async function normalizeProducts(
  db: Database,
  products: readonly SalesProductRef[] | undefined,
): Promise<SalesProductRef[]> {
  if (products === undefined || products.length === 0) return [];
  if (products.length > COUPON_MAX_PRODUCTS) {
    throw couponRule('A lista de produtos passa de 500 itens.');
  }
  const unique = new Map<string, SalesProductRef>();
  for (const product of products) {
    if (!isSalesProductType(product.productType) || !isUuid(product.productId)) {
      throw couponRule('Produto do cupom inválido.');
    }
    const ref = {
      productType: product.productType,
      productId: product.productId.toLowerCase(),
    };
    unique.set(salesProductKey(ref.productType, ref.productId), ref);
  }
  const refs = [...unique.values()];
  const existing = new Set<string>();
  for (const type of ['course', 'bundle', 'ebook'] as const) {
    const ids = refs.filter((ref) => ref.productType === type).map((ref) => ref.productId);
    if (ids.length === 0) continue;
    const table = type === 'course' ? 'courses' : type === 'bundle' ? 'bundles' : 'ebooks';
    const rows = await db.selectFrom(table).select('id').where('id', 'in', ids).execute();
    for (const row of rows) existing.add(salesProductKey(type, row.id));
  }
  const missing = refs.filter(
    (ref) => !existing.has(salesProductKey(ref.productType, ref.productId)),
  );
  if (missing.length > 0) throw couponRule('Há produto inexistente na lista do cupom.');
  return refs;
}

async function assertCodeAvailable(db: Database, code: string): Promise<void> {
  const existing = await db
    .selectFrom('coupons')
    .select('id')
    .where(sql<boolean>`lower(coupons.code) = lower(${code})`)
    .executeTakeFirst();
  if (existing) throw couponCodeTaken();
}

async function couponView(db: Database, coupon: CouponWithProducts): Promise<CouponView> {
  const products = await productViews(db, coupon.products);
  const creator = await db
    .selectFrom('users')
    .select(['id', 'name', 'deletedAt'])
    .where('id', '=', coupon.createdBy)
    .executeTakeFirst();
  return {
    ...coupon,
    products,
    createdBy: creator
      ? { id: creator.id, name: creator.deletedAt === null ? creator.name : DELETED_USER_NAME }
      : { id: coupon.createdBy, name: DELETED_USER_NAME },
  };
}

async function productViews(
  db: Database,
  products: readonly SalesProductRef[],
): Promise<CouponProductView[]> {
  if (products.length === 0) return [];
  const titles = new Map<string, string>();
  for (const type of ['course', 'bundle', 'ebook'] as const) {
    const ids = products
      .filter((product) => product.productType === type)
      .map((product) => product.productId);
    if (ids.length === 0) continue;
    const table = type === 'course' ? 'courses' : type === 'bundle' ? 'bundles' : 'ebooks';
    const rows = await db
      .selectFrom(table)
      .select(['id', 'title'])
      .where('id', 'in', ids)
      .execute();
    for (const row of rows) titles.set(salesProductKey(type, row.id), row.title);
  }
  return products.map((product) => ({
    productType: product.productType,
    productId: product.productId,
    title:
      titles.get(salesProductKey(product.productType, product.productId)) ?? 'produto removido',
  }));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Reexporta os motivos para o consumidor que valida sem consultar o banco. */
/** Converte a linha do banco em `Coupon`, útil a quem lê `coupons` direto. */
export { COUPON_INVALID_REASONS, COUPON_KINDS, cents };
