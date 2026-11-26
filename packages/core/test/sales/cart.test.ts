import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addCartItem,
  buildCart,
  closeDatabase,
  createDatabase,
  type Database,
  getMyBilling,
  readCart,
  removeCartCoupon,
  removeCartItem,
  saveMyBilling,
  setCartCoupon,
} from '../../src/index.ts';
import {
  expectError,
  first,
  grantLifetime,
  makeBundle,
  makeCourse,
  makeEbook,
  makeUser,
  type TestUser,
} from './fixtures.ts';

// Cesta e dados do comprador (spec 011). Banco próprio: as cestas de um teste não escapam para o
// outro nem para os arquivos que rodam em paralelo.

const CURRENCY = 'BRL';

let testDb: TestDatabase;
let db: Database;
let student: TestUser;

beforeAll(async () => {
  loadEnvFiles();
  testDb = await createTestDatabase();
  db = createDatabase({ connectionString: testDb.url, maxConnections: 4 });
});

afterAll(async () => {
  await closeDatabase(db);
  await testDb.drop();
});

beforeEach(async () => {
  student = await makeUser(db);
});

describe('cesta', () => {
  it('começa vazia para quem nunca abriu', async () => {
    const cart = await readCart(db, student.id, CURRENCY);
    expect(cart).toMatchObject({ items: [], itemCount: 0, subtotalCents: 0, totalCents: 0 });
    expect(cart.coupon).toBeNull();
  });

  it('acrescenta produto vendável e mostra o preço atual', async () => {
    const courseId = await makeCourse(db, { priceCents: 4_900 });
    const cart = await addCartItem(
      db,
      student.id,
      { productType: 'course', productId: courseId },
      CURRENCY,
    );
    expect(cart.itemCount).toBe(1);
    expect(cart.subtotalCents).toBe(4_900);
    expect(cart.items[0]).toMatchObject({
      productType: 'course',
      productId: courseId,
      unitPriceCents: 4_900,
      sellable: true,
      warnings: [],
    });
  });

  it('recusa produto não vendável', async () => {
    const unpublished = await makeCourse(db, { published: false });
    await expectError(
      addCartItem(db, student.id, { productType: 'course', productId: unpublished }, CURRENCY),
      409,
      'product_not_sellable',
    );
    const open = await makeCourse(db, { priceCents: null });
    await expectError(
      addCartItem(db, student.id, { productType: 'course', productId: open }, CURRENCY),
      409,
      'product_not_sellable',
    );
  });

  it('recusa repetir o item e o produto que o aluno já tem', async () => {
    const courseId = await makeCourse(db);
    await addCartItem(db, student.id, { productType: 'course', productId: courseId }, CURRENCY);
    await expectError(
      addCartItem(db, student.id, { productType: 'course', productId: courseId }, CURRENCY),
      409,
      'product_already_in_cart',
    );

    const ebookId = await makeEbook(db);
    await grantLifetime(db, student.id, 'ebook', ebookId);
    await expectError(
      addCartItem(db, student.id, { productType: 'ebook', productId: ebookId }, CURRENCY),
      409,
      'product_already_owned',
    );
  });

  it('avisa quando o pacote tem item já concedido', async () => {
    const courseId = await makeCourse(db);
    const bundleId = await makeBundle(db, [{ type: 'course', id: courseId }]);
    await grantLifetime(db, student.id, 'course', courseId);
    const cart = await addCartItem(
      db,
      student.id,
      { productType: 'bundle', productId: bundleId },
      CURRENCY,
    );
    expect(first(cart.items).warnings).toContain('bundle_item_owned');
  });

  it('remove o item da própria cesta e recusa o da outra', async () => {
    const courseId = await makeCourse(db);
    const cart = await addCartItem(
      db,
      student.id,
      { productType: 'course', productId: courseId },
      CURRENCY,
    );
    await removeCartItem(db, student.id, first(cart.items).id);

    const other = await makeUser(db);
    const otherCart = await addCartItem(
      db,
      other.id,
      { productType: 'course', productId: courseId },
      CURRENCY,
    );
    await expectError(removeCartItem(db, student.id, first(otherCart.items).id), 404, 'not_found');
  });

  it('aplica cupom, rateia o desconto e remove', async () => {
    const courseId = await makeCourse(db, { priceCents: 10_000 });
    await addCartItem(db, student.id, { productType: 'course', productId: courseId }, CURRENCY);
    await db
      .insertInto('coupons')
      .values({
        code: 'DEZPORCENTO',
        kind: 'percent',
        percentOff: 10,
        createdBy: student.id,
        appliesTo: 'orders',
      })
      .execute();

    const withCoupon = await setCartCoupon(db, student.id, 'dezporcento', CURRENCY);
    expect(withCoupon.coupon).toMatchObject({ code: 'DEZPORCENTO', valid: true });
    expect(withCoupon.discountCents).toBe(1_000);
    expect(withCoupon.totalCents).toBe(9_000);

    const withoutCoupon = await removeCartCoupon(db, student.id, CURRENCY);
    expect(withoutCoupon.coupon).toBeNull();
    expect(withoutCoupon.totalCents).toBe(10_000);
  });

  it('recusa cupom inexistente ou sem item elegível', async () => {
    const courseId = await makeCourse(db);
    await expectError(setCartCoupon(db, student.id, 'NAOEXISTE', CURRENCY), 422, 'coupon_invalid');

    await db
      .insertInto('coupons')
      .values({
        code: 'SOOUTRO',
        kind: 'fixed',
        amountOffCents: 500,
        createdBy: student.id,
        appliesTo: 'orders',
      })
      .execute();
    await db
      .insertInto('couponProducts')
      .values({
        couponId: (
          await db
            .selectFrom('coupons')
            .select('id')
            .where('code', '=', 'SOOUTRO')
            .executeTakeFirstOrThrow()
        ).id,
        productType: 'ebook',
        productId: await makeEbook(db),
      })
      .execute();
    await addCartItem(db, student.id, { productType: 'course', productId: courseId }, CURRENCY);
    await expectError(setCartCoupon(db, student.id, 'SOOUTRO', CURRENCY), 422, 'coupon_invalid');
  });

  it('exige e-mail confirmado para comprar', async () => {
    const pending = await makeUser(db, 'student', { emailVerified: false });
    const courseId = await makeCourse(db);
    await expectError(readCart(db, pending.id, CURRENCY), 403, 'email_not_verified');
    await expectError(
      addCartItem(db, pending.id, { productType: 'course', productId: courseId }, CURRENCY),
      403,
      'email_not_verified',
    );
  });

  it('buildCart não cria a linha de carts para cesta vazia', async () => {
    const built = await buildCart(db, student.id, CURRENCY);
    expect(built.cartId).toBeNull();
    const row = await db
      .selectFrom('carts')
      .select('id')
      .where('userId', '=', student.id)
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });
});

describe('dados do comprador', () => {
  it('grava e lê nome, tipo e documento válidos', async () => {
    const saved = await saveMyBilling(db, student.id, {
      fullName: 'Ana  Maria   da Silva',
      taxIdType: 'cpf',
      taxId: '529.982.247-25',
    });
    expect(saved).toEqual({
      fullName: 'Ana Maria da Silva',
      taxIdType: 'cpf',
      taxId: '52998224725',
      complete: true,
    });
    expect(await getMyBilling(db, student.id)).toEqual(saved);
  });

  it('recusa documento com dígito errado e campo obrigatório vazio', async () => {
    await expectError(
      saveMyBilling(db, student.id, { fullName: 'Ana', taxIdType: 'cpf', taxId: '111.111.111-11' }),
      422,
      'tax_id_invalid',
    );
    const error = await saveMyBilling(db, student.id, {
      fullName: '',
      taxIdType: 'cpf',
      taxId: '',
    }).then(
      () => undefined,
      (caught: unknown) => caught as { status: number; code: string },
    );
    expect(error).toMatchObject({ status: 400, code: 'validation_failed' });
  });

  it('mostra como incompleto o documento ainda ausente', async () => {
    expect(await getMyBilling(db, student.id)).toEqual({
      fullName: null,
      taxIdType: null,
      taxId: null,
      complete: false,
    });
  });
});
