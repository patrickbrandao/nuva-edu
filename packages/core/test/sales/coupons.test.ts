import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type CouponWithProducts,
  closeDatabase,
  couponInvalidReason,
  createCoupon,
  createDatabase,
  type Database,
  findCouponByCode,
  getCoupon,
  incrementCouponUse,
  listCoupons,
  updateCoupon,
} from '../../src/index.ts';
import {
  adminRequest,
  expectError,
  makeCourse,
  makeEbook,
  makeUser,
  type TestUser,
} from './fixtures.ts';

// Cupons do admin e validade para a cesta (spec 011, "Cupons"). Banco próprio deste arquivo.

let testDb: TestDatabase;
let db: Database;
let admin: TestUser;
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
  admin = await makeUser(db, 'admin');
  student = await makeUser(db);
});

function coupon(code: string, overrides: Partial<Parameters<typeof createCoupon>[2]> = {}) {
  return {
    code,
    kind: 'percent' as const,
    percentOff: 10,
    appliesTo: 'orders' as const,
    ...overrides,
  };
}

describe('cupons do admin', () => {
  it('cria cupom, mostra o criador e audita', async () => {
    const view = await createCoupon(db, adminRequest(admin), coupon('BEMVINDA'));
    expect(view).toMatchObject({
      code: 'BEMVINDA',
      kind: 'percent',
      percentOff: 10,
      usesCount: 0,
      active: true,
      products: [],
      createdBy: { id: admin.id },
    });
    const audit = await sql<{ action: string; outcome: string }>`
      SELECT action, outcome FROM audit_log WHERE target_id = ${view.id}`.execute(db);
    expect(audit.rows).toEqual([{ action: 'coupon.create', outcome: 'ok' }]);
  });

  it('recusa código repetido sem diferenciar maiúsculas', async () => {
    await createCoupon(db, adminRequest(admin), coupon('UNICO'));
    await expectError(
      createCoupon(db, adminRequest(admin), coupon('unico')),
      409,
      'coupon_code_taken',
    );
  });

  it('valida a combinação de campos', async () => {
    await expectError(
      createCoupon(db, adminRequest(admin), coupon('ZERO', { percentOff: 0 })),
      400,
      'validation_failed',
    );
    await expectError(
      createCoupon(db, adminRequest(admin), coupon('MISTO', { amountOffCents: 100 })),
      400,
      'validation_failed',
    );
    await expectError(
      createCoupon(
        db,
        adminRequest(admin),
        coupon('JANELA', {
          startsAt: new Date('2026-12-01T00:00:00Z'),
          endsAt: new Date('2026-11-01T00:00:00Z'),
        }),
      ),
      422,
      'coupon_invalid',
    );
  });

  it('exige produto existente na lista', async () => {
    const courseId = await makeCourse(db);
    const created = await createCoupon(
      db,
      adminRequest(admin),
      coupon('COMITEM', { products: [{ productType: 'course', productId: courseId }] }),
    );
    expect(created.products).toEqual([
      { productType: 'course', productId: courseId, title: expect.any(String) },
    ]);
    await expectError(
      createCoupon(
        db,
        adminRequest(admin),
        coupon('FANTASMA', {
          products: [{ productType: 'course', productId: '11111111-1111-4111-8111-111111111111' }],
        }),
      ),
      422,
      'coupon_invalid',
    );
  });

  it('edita campos e substitui a lista de produtos', async () => {
    const courseId = await makeCourse(db);
    const ebookId = await makeEbook(db);
    const created = await createCoupon(
      db,
      adminRequest(admin),
      coupon('EDITAVEL', { products: [{ productType: 'course', productId: courseId }] }),
    );
    const updated = await updateCoupon(db, adminRequest(admin), created.id, {
      active: false,
      products: [{ productType: 'ebook', productId: ebookId }],
    });
    expect(updated).toMatchObject({ id: created.id, active: false });
    expect(updated.products).toHaveLength(1);
    expect(updated.products[0]).toMatchObject({ productType: 'ebook', productId: ebookId });
  });

  it('lista com filtro e página seguinte', async () => {
    for (const code of ['PAG1', 'PAG2', 'PAG3']) {
      await createCoupon(db, adminRequest(admin), coupon(code, { appliesTo: 'both' }));
    }
    const first = await listCoupons(db, adminRequest(admin), { limit: 2, appliesTo: 'both' });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await listCoupons(db, adminRequest(admin), {
      limit: 2,
      appliesTo: 'both',
      cursor: first.nextCursor,
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('lê um cupom pelo id e devolve 404 quando não existe', async () => {
    const created = await createCoupon(db, adminRequest(admin), coupon('LIDO'));
    expect((await getCoupon(db, adminRequest(admin), created.id)).code).toBe('LIDO');
    await expectError(
      getCoupon(db, adminRequest(admin), '11111111-1111-4111-8111-111111111111'),
      404,
      'not_found',
    );
  });

  it('nega a quem não é admin e audita a negativa', async () => {
    await expectError(
      createCoupon(db, adminRequest(student), coupon('NEGADO')),
      403,
      'permission_denied',
    );
    const denied = await sql<{ n: number }>`
      SELECT count(*)::int AS n FROM audit_log
       WHERE actor_user_id = ${student.id} AND action = 'coupon.create' AND outcome = 'denied'`.execute(
      db,
    );
    expect(denied.rows[0]?.n).toBe(1);
  });
});

describe('validade do cupom na cesta', () => {
  async function stored(overrides: Partial<CouponWithProducts> = {}): Promise<CouponWithProducts> {
    const created = await createCoupon(
      db,
      adminRequest(admin),
      coupon(`C${Date.now() % 100000}`, { appliesTo: 'orders' }),
    );
    const row = await db
      .selectFrom('coupons')
      .selectAll()
      .where('id', '=', created.id)
      .executeTakeFirstOrThrow();
    return {
      id: row.id,
      code: row.code,
      kind: row.kind as CouponWithProducts['kind'],
      percentOff: row.percentOff,
      amountOffCents: row.amountOffCents === null ? null : Number(row.amountOffCents),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      maxUses: row.maxUses,
      maxUsesPerUser: row.maxUsesPerUser,
      usesCount: row.usesCount,
      appliesTo: row.appliesTo as CouponWithProducts['appliesTo'],
      active: row.active,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      products: [],
      ...overrides,
    };
  }

  it('devolve o motivo na ordem do contrato', async () => {
    const courseId = await makeCourse(db);
    const item = [{ productType: 'course' as const, productId: courseId }];
    expect(await couponInvalidReason(db, await stored(), student.id, item)).toBeNull();
    expect(await couponInvalidReason(db, await stored({ active: false }), student.id, item)).toBe(
      'inactive',
    );
    expect(
      await couponInvalidReason(
        db,
        await stored({ endsAt: new Date('2020-01-01T00:00:00Z') }),
        student.id,
        item,
      ),
    ).toBe('expired');
    expect(
      await couponInvalidReason(db, await stored({ maxUses: 1, usesCount: 1 }), student.id, item),
    ).toBe('exhausted');
    expect(
      await couponInvalidReason(
        db,
        await stored({ products: [{ productType: 'ebook', productId: await makeEbook(db) }] }),
        student.id,
        item,
      ),
    ).toBe('not_eligible');
  });

  it('conta uso e esgota por comprador', async () => {
    const couponWithRow = await stored({ maxUsesPerUser: 1 });
    await db
      .insertInto('orders')
      .values({
        userId: student.id,
        status: 'paid',
        subtotalCents: 1000,
        discountCents: 0,
        totalCents: 1000,
        currency: 'BRL',
        couponId: couponWithRow.id,
        couponCode: couponWithRow.code,
        buyerName: 'Aluna',
        buyerTaxIdType: 'cpf',
        buyerTaxId: '52998224725',
        paidAt: new Date(),
      })
      .execute();
    const courseId = await makeCourse(db);
    expect(
      await couponInvalidReason(db, couponWithRow, student.id, [
        { productType: 'course', productId: courseId },
      ]),
    ).toBe('exhausted');

    await db.transaction().execute((trx) => incrementCouponUse(trx, couponWithRow.id));
    const row = await db
      .selectFrom('coupons')
      .select('usesCount')
      .where('id', '=', couponWithRow.id)
      .executeTakeFirstOrThrow();
    expect(row.usesCount).toBe(1);
  });

  it('encontra pelo código sem diferenciar maiúsculas', async () => {
    await createCoupon(db, adminRequest(admin), coupon('CAIXA'));
    expect((await findCouponByCode(db, 'caixa'))?.code).toBe('CAIXA');
    expect(await findCouponByCode(db, 'inexistente')).toBeUndefined();
  });
});
