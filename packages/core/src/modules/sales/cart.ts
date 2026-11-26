import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import {
  type CouponWithProducts,
  couponInvalidReason,
  findCouponByCode,
  findCouponById,
} from './coupons.ts';
import {
  cartEmpty,
  cartFull,
  cartInvalid,
  couponInvalid,
  emailNotVerified,
  productAlreadyInCart,
  productAlreadyOwned,
  productNotSellable,
} from './errors.ts';
import {
  allocateCouponDiscount,
  type DiscountableLine,
  isCouponProductEligible,
} from './pricing.ts';
import {
  bundleChildKeys,
  isSellable,
  loadCartUnlocks,
  loadSalesProduct,
  loadSalesProducts,
  salesProductKey,
  unsellableReason,
} from './products.ts';
import {
  CART_MAX_ITEMS,
  type CartCouponView,
  type CartItemView,
  type CartItemWarning,
  type CartUnlock,
  type CartView,
  type CouponKind,
  type SalesProductRef,
  type SalesProductType,
} from './types.ts';

// Cesta (spec 011, "Cesta"): uma por usuário, persistida no servidor. O item guarda só o
// produto; preço, avisos, cupom e cascata são lidos agora, a cada abertura. Quem recusa a
// compra é a finalização (`checkout.ts`); aqui o item não vendável continua com o motivo.

/** Confere o direito de comprar: conta existente e e-mail confirmado (spec 007 e 008). */
export async function assertPurchaseAllowed(db: Database, userId: string): Promise<void> {
  const user = await db
    .selectFrom('users')
    .select(['emailVerifiedAt', 'deletedAt'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user || user.deletedAt !== null) throw notFound('Usuário não encontrado.');
  if (user.emailVerifiedAt === null) throw emailNotVerified();
}

interface CartRow {
  id: string;
  couponId: string | null;
  updatedAt: Date;
}

async function findCart(db: Database, userId: string): Promise<CartRow | undefined> {
  const row = await db
    .selectFrom('carts')
    .select(['id', 'couponId', 'updatedAt'])
    .where('userId', '=', userId)
    .executeTakeFirst();
  return row;
}

async function ensureCart(trx: Database, userId: string): Promise<CartRow> {
  await trx
    .insertInto('carts')
    .values({ userId })
    .onConflict((oc) => oc.column('userId').doNothing())
    .execute();
  const cart = await findCart(trx, userId);
  if (!cart) throw new Error('Cesta não criada.');
  return cart;
}

interface CartItemRow {
  id: string;
  productType: string;
  productId: string;
  addedAt: Date;
}

async function loadCartItems(db: Database, cartId: string): Promise<CartItemRow[]> {
  return db
    .selectFrom('cartItems')
    .select(['id', 'productType', 'productId', 'addedAt'])
    .where('cartId', '=', cartId)
    .orderBy('addedAt')
    .orderBy('id')
    .execute();
}

interface AccessFact {
  productType: SalesProductType;
  productId: string;
  rootSource: string;
  expiresAt: Date | null;
}

/**
 * Direitos ativos do usuário, com a fonte da raiz e a validade. A cesta usa para os avisos que
 * não bloqueiam a compra; o vínculo da cascata não muda o aviso.
 */
async function loadAccessFacts(db: Database, userId: string): Promise<AccessFact[]> {
  const result = await sql<{
    productType: SalesProductType;
    productId: string;
    rootSource: string;
    expiresAt: Date | null;
  }>`
    WITH RECURSIVE tree AS (
      SELECT e.id, e.product_type, e.product_id, e.source AS root_source,
             e.expires_at, e.starts_at, e.revoked_at
        FROM entitlements e
       WHERE e.user_id = ${userId}::uuid AND e.parent_entitlement_id IS NULL
      UNION ALL
      SELECT c.id, c.product_type, c.product_id, t.root_source,
             c.expires_at, c.starts_at, c.revoked_at
        FROM entitlements c
        JOIN tree t ON c.parent_entitlement_id = t.id
    )
    SELECT DISTINCT product_type AS "productType", product_id AS "productId",
           root_source AS "rootSource", expires_at AS "expiresAt"
      FROM tree
     WHERE revoked_at IS NULL AND starts_at <= now()
       AND (expires_at IS NULL OR expires_at > now())`.execute(db);
  return result.rows;
}

function warningsFor(
  facts: readonly AccessFact[],
  productType: SalesProductType,
  productId: string,
  ownedBundleItems: ReadonlySet<string>,
): CartItemWarning[] {
  const key = salesProductKey(productType, productId);
  const own = facts.filter((fact) => salesProductKey(fact.productType, fact.productId) === key);
  const warnings: CartItemWarning[] = [];
  if (productType === 'bundle' && ownedBundleItems.has(key)) warnings.push('bundle_item_owned');
  if (own.some((fact) => fact.rootSource === 'subscription')) warnings.push('subscription_covered');
  if (own.some((fact) => fact.expiresAt !== null)) warnings.push('time_limited_access');
  return warnings;
}

/** `true` quando o usuário tem direito ativo e vitalício ao produto. */
function hasLifetimeAccess(
  facts: readonly AccessFact[],
  productType: SalesProductType,
  productId: string,
): boolean {
  const key = salesProductKey(productType, productId);
  return facts.some(
    (fact) => salesProductKey(fact.productType, fact.productId) === key && fact.expiresAt === null,
  );
}

export interface BuiltCart {
  view: CartView;
  /** A linha de `carts`; `null` quando o aluno nunca usou a cesta. */
  cartId: string | null;
  /** Itens vendáveis com o preço atual, para a finalização reaproveitar a leitura. */
  lines: Array<{
    id: string;
    productType: SalesProductType;
    productId: string;
    title: string;
    accessDays: number | null;
    unitPriceCents: number;
    discountCents: number;
  }>;
  coupon: CouponWithProducts | null;
  itemCount: number;
}

/**
 * Monta a cesta do usuário com os preços atuais. Não cria a linha de `carts`: cesta nunca usada
 * é a vazia. `coupon` volta com a validade de agora; quando inválido, nenhum desconto é aplicado.
 */
export async function buildCart(
  db: Database,
  userId: string,
  currency: string,
): Promise<BuiltCart> {
  const cart = await findCart(db, userId);
  const updatedAt = cart?.updatedAt ?? new Date();
  if (!cart) {
    return {
      view: {
        items: [],
        coupon: null,
        itemCount: 0,
        subtotalCents: 0,
        discountCents: 0,
        totalCents: 0,
        currency,
        updatedAt,
      },
      cartId: null,
      lines: [],
      coupon: null,
      itemCount: 0,
    };
  }
  const rows = await loadCartItems(db, cart.id);
  const refs: SalesProductRef[] = rows.map((row) => ({
    productType: row.productType as SalesProductType,
    productId: row.productId,
  }));
  const products = await loadSalesProducts(db, refs);
  const facts = await loadAccessFacts(db, userId);

  // Produtos de pacote: para o aviso "já tem um item do pacote".
  const bundleChildren = new Map<string, string[]>();
  for (const ref of refs) {
    if (ref.productType !== 'bundle') continue;
    bundleChildren.set(
      salesProductKey(ref.productType, ref.productId),
      await bundleChildKeys(db, ref.productId),
    );
  }
  const ownedBundleItems = new Set<string>();
  for (const [bundleKey, keys] of bundleChildren) {
    const owned = keys.some((key) =>
      facts.some((fact) => salesProductKey(fact.productType, fact.productId) === key),
    );
    if (owned) ownedBundleItems.add(bundleKey);
  }

  const coupon = cart.couponId ? await findCouponById(db, cart.couponId) : undefined;
  const validity =
    coupon === undefined ? null : await couponInvalidReason(db, coupon, userId, refs);
  const couponValid = coupon !== undefined && validity === null;
  const couponView: CartCouponView | null = coupon
    ? {
        code: coupon.code,
        kind: coupon.kind as CouponKind,
        percentOff: coupon.percentOff,
        amountOffCents: coupon.amountOffCents,
        valid: couponValid,
        invalidReason: validity,
      }
    : null;

  const lines: BuiltCart['lines'] = [];
  for (const row of rows) {
    const productType = row.productType as SalesProductType;
    const product = products.get(salesProductKey(productType, row.productId));
    const reason = product ? unsellableReason(product) : 'unpublished';
    const price = product?.priceCents ?? 0;
    if (product && reason === null) {
      lines.push({
        id: row.id,
        productType,
        productId: row.productId,
        title: product.title,
        accessDays: product.accessDays,
        unitPriceCents: price,
        discountCents: 0,
      });
    }
  }
  const discountLines: DiscountableLine[] = lines.map((line) => ({
    id: line.id,
    productType: line.productType,
    productId: line.productId,
    unitPriceCents: line.unitPriceCents,
  }));
  const allocation =
    couponValid && coupon
      ? allocateCouponDiscount(
          {
            kind: coupon.kind,
            percentOff: coupon.percentOff,
            amountOffCents: coupon.amountOffCents,
            products: coupon.products,
          },
          discountLines,
        )
      : new Map<string, number>();
  for (const line of lines) line.discountCents = allocation.get(line.id) ?? 0;

  const items: CartItemView[] = [];
  for (const row of rows) {
    const productType = row.productType as SalesProductType;
    const product = products.get(salesProductKey(productType, row.productId));
    const reason = product ? unsellableReason(product) : 'unpublished';
    const eligible =
      coupon !== undefined && isCouponProductEligible(coupon, productType, row.productId);
    const unlocks: CartUnlock[] = product
      ? await loadCartUnlocks(db, productType, row.productId)
      : [];
    items.push({
      id: row.id,
      productType,
      productId: row.productId,
      title: product?.title ?? 'produto removido',
      cover: product?.cover ?? null,
      accessMode: product?.accessMode ?? 'private',
      accessDays: product?.accessDays ?? null,
      unitPriceCents: product?.priceCents ?? null,
      discountCents: allocation.get(row.id) ?? 0,
      couponEligible: eligible,
      sellable: product !== undefined && reason === null,
      unsellableReason: reason,
      warnings: product ? warningsFor(facts, productType, row.productId, ownedBundleItems) : [],
      unlocks,
      addedAt: row.addedAt,
    });
  }
  const subtotalCents = lines.reduce((total, line) => total + line.unitPriceCents, 0);
  let discountCents = 0;
  for (const value of allocation.values()) discountCents += value;
  return {
    view: {
      items,
      coupon: couponView,
      itemCount: items.length,
      subtotalCents,
      discountCents,
      totalCents: Math.max(0, subtotalCents - discountCents),
      currency,
      updatedAt,
    },
    cartId: cart.id,
    lines,
    coupon: coupon ?? null,
    itemCount: items.length,
  };
}

/** A cesta aberta do aluno (`GET /cart`). */
export async function readCart(db: Database, userId: string, currency: string): Promise<CartView> {
  await assertPurchaseAllowed(db, userId);
  return (await buildCart(db, userId, currency)).view;
}

export interface AddCartItemInput {
  productType: SalesProductType;
  productId: string;
}

/** Acrescenta um produto à cesta (`POST /cart/items`), com as recusas da spec 011. */
export async function addCartItem(
  db: Database,
  userId: string,
  input: AddCartItemInput,
  currency: string,
): Promise<CartView> {
  const { view } = await db.transaction().execute(async (trx) => {
    await assertPurchaseAllowed(trx, userId);
    const product = await loadSalesProduct(trx, input.productType, input.productId);
    if (!product || !isSellable(product)) throw productNotSellable();
    const cart = await ensureCart(trx, userId);
    const existing = await trx
      .selectFrom('cartItems')
      .select('id')
      .where('cartId', '=', cart.id)
      .where('productType', '=', input.productType)
      .where('productId', '=', input.productId)
      .executeTakeFirst();
    if (existing) throw productAlreadyInCart();
    const facts = await loadAccessFacts(trx, userId);
    if (hasLifetimeAccess(facts, input.productType, input.productId)) throw productAlreadyOwned();
    const count = await trx
      .selectFrom('cartItems')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('cartId', '=', cart.id)
      .executeTakeFirstOrThrow();
    if (count.n >= CART_MAX_ITEMS) throw cartFull();
    try {
      await trx
        .insertInto('cartItems')
        .values({
          cartId: cart.id,
          productType: input.productType,
          productId: input.productId,
        })
        .execute();
    } catch (error) {
      if (isUniqueViolation(error)) throw productAlreadyInCart();
      throw error;
    }
    return buildCart(trx, userId, currency);
  });
  return view;
}

/** Remove um item da própria cesta (`DELETE /cart/items/{id}`); de outra cesta é `404`. */
export async function removeCartItem(db: Database, userId: string, itemId: string): Promise<void> {
  await assertPurchaseAllowed(db, userId);
  const cart = await findCart(db, userId);
  if (!cart) throw notFound('Item da cesta não encontrado.');
  const removed = await db
    .deleteFrom('cartItems')
    .where('id', '=', itemId)
    .where('cartId', '=', cart.id)
    .executeTakeFirst();
  if (Number(removed.numDeletedRows ?? 0n) === 0) throw notFound('Item da cesta não encontrado.');
}

/** Aplica um cupom à cesta (`PUT /cart/coupon`), comparando o código sem diferenciar maiúsculas. */
export async function setCartCoupon(
  db: Database,
  userId: string,
  code: string,
  currency: string,
): Promise<CartView> {
  const { view } = await db.transaction().execute(async (trx) => {
    await assertPurchaseAllowed(trx, userId);
    const cart = await ensureCart(trx, userId);
    const coupon = await findCouponByCode(trx, code);
    if (!coupon) throw couponInvalid();
    const rows = await loadCartItems(trx, cart.id);
    const refs: SalesProductRef[] = rows.map((row) => ({
      productType: row.productType as SalesProductType,
      productId: row.productId,
    }));
    if (refs.length === 0) throw couponInvalid();
    const reason = await couponInvalidReason(trx, coupon, userId, refs);
    if (reason !== null) throw couponInvalid();
    await trx.updateTable('carts').set({ couponId: coupon.id }).where('id', '=', cart.id).execute();
    return buildCart(trx, userId, currency);
  });
  return view;
}

/** Remove o cupom da cesta; sem cupom, devolve a cesta como está (`DELETE /cart/coupon`). */
export async function removeCartCoupon(
  db: Database,
  userId: string,
  currency: string,
): Promise<CartView> {
  const cart = await findCart(db, userId);
  if (cart && cart.couponId !== null) {
    await db.updateTable('carts').set({ couponId: null }).where('id', '=', cart.id).execute();
  }
  return readCart(db, userId, currency);
}

/** Reaproveita a leitura da cesta no fechamento, sem outra consulta de produtos. */
export async function readCartForCheckout(
  trx: Database,
  userId: string,
  currency: string,
): Promise<BuiltCart> {
  return buildCart(trx, userId, currency);
}

/** Recusa a finalização quando algum item deixou de ser vendável (spec 011, `cart_invalid`). */
export function assertCartSellable(built: BuiltCart): void {
  if (built.itemCount === 0) throw cartEmpty();
  const invalid = built.view.items.find((item) => !item.sellable);
  if (invalid) throw cartInvalid();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  );
}
