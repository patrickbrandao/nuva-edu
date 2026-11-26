import { randomUUID } from 'node:crypto';
import { FakePaymentProvider, grantEntitlement } from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Browser,
  createUser,
  isolatedDatabase,
  type Reply,
  TEST_PASSWORD,
  type TestUser,
} from '../accounts.ts';
import { createTestApp, type TestApp } from '../helpers.ts';

// Cesta, cupons e dados de comprador na classroom-api (spec 011; tarefa 540).

const CPF = '52998224725';
const CPF_FORMATTED = '529.982.247-25';
const CNPJ_ALPHA = '12.abc.345/01de-35';
const CNPJ_ALPHA_NORMALIZED = '12ABC34501DE35';

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let test: TestApp;
let provider: FakePaymentProvider;
let admin: TestUser;

function scan(reply: Reply): void {
  expect(JSON.stringify(reply.headers) + reply.body).not.toContain(TEST_PASSWORD);
}

const browser = () => new Browser(test.app, scan);

function slug(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 12)}`;
}

async function studentSession(options: { verified?: boolean } = {}) {
  const user = await createUser(test.db, { verified: options.verified ?? true });
  const session = browser();
  expect((await session.login(user.email)).statusCode).toBe(200);
  return { user, browser: session };
}

async function makeCourse(
  input: {
    title?: string;
    accessMode?: 'open' | 'paid' | 'private';
    priceCents?: number | null;
    accessDays?: number | null;
    published?: boolean;
    archived?: boolean;
  } = {},
): Promise<string> {
  const accessMode = input.accessMode ?? 'paid';
  const published = input.published ?? true;
  const row = await test.db
    .insertInto('courses')
    .values({
      slug: slug('curso'),
      title: input.title ?? 'Curso de Teste',
      summary: 'Resumo',
      accessMode,
      priceCents:
        input.priceCents !== undefined ? input.priceCents : accessMode === 'open' ? null : 5_000,
      accessDays: input.accessDays ?? null,
      status: published ? 'published' : 'draft',
      publishedAt: published ? new Date() : null,
      archivedAt: input.archived ? new Date() : null,
      level: 'beginner',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function makeEbook(input: { title?: string; priceCents?: number } = {}): Promise<string> {
  const row = await test.db
    .insertInto('ebooks')
    .values({
      slug: slug('ebook'),
      title: input.title ?? 'Ebook de Teste',
      summary: 'Resumo',
      accessMode: 'paid',
      priceCents: input.priceCents ?? 2_000,
      status: 'published',
      publishedAt: new Date(),
      fileUrl: 'https://arquivos.exemplo.test/ebook.pdf',
      pages: 60,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function makeBundle(
  input: {
    title?: string;
    priceCents?: number;
    courseIds?: readonly string[];
    ebookIds?: readonly string[];
  } = {},
): Promise<string> {
  const bundle = await test.db
    .insertInto('bundles')
    .values({
      slug: slug('pacote'),
      title: input.title ?? 'Pacote Completo',
      summary: 'Resumo',
      accessMode: 'paid',
      priceCents: input.priceCents ?? 8_000,
      status: 'published',
      publishedAt: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const items = [
    ...(input.courseIds ?? []).map((productId) => ({ productType: 'course' as const, productId })),
    ...(input.ebookIds ?? []).map((productId) => ({ productType: 'ebook' as const, productId })),
  ];
  if (items.length > 0) {
    await test.db
      .insertInto('bundleItems')
      .values(items.map((item, position) => ({ bundleId: bundle.id, ...item, position })))
      .execute();
  }
  return bundle.id;
}

async function makeCoupon(input: {
  code: string;
  kind: 'percent' | 'fixed';
  percentOff?: number;
  amountOffCents?: number;
  appliesTo?: 'orders' | 'subscriptions' | 'both';
  active?: boolean;
  endsAt?: Date;
  maxUses?: number;
  usesCount?: number;
  products?: readonly { productType: 'course' | 'bundle' | 'ebook'; productId: string }[];
}): Promise<string> {
  const coupon = await test.db
    .insertInto('coupons')
    .values({
      code: input.code,
      kind: input.kind,
      percentOff: input.percentOff ?? null,
      amountOffCents: input.amountOffCents ?? null,
      appliesTo: input.appliesTo ?? 'orders',
      active: input.active ?? true,
      endsAt: input.endsAt ?? null,
      maxUses: input.maxUses ?? null,
      usesCount: input.usesCount ?? 0,
      createdBy: admin.id,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (input.products && input.products.length > 0) {
    await test.db
      .insertInto('couponProducts')
      .values(input.products.map((item) => ({ couponId: coupon.id, ...item })))
      .execute();
  }
  return coupon.id;
}

beforeAll(async () => {
  database = await isolatedDatabase();
  provider = new FakePaymentProvider({ currency: 'BRL' });
  test = createTestApp(
    { DATABASE_URL: database.url, NUVA_PAYMENT_PROVIDER: 'fake' },
    { paymentProvider: provider },
  );
  admin = await createUser(test.db, { role: 'admin' });
});

afterAll(async () => {
  const logs = test.logText();
  expect(logs).not.toContain(TEST_PASSWORD);
  expect(logs).not.toContain(CPF);
  expect(logs).not.toContain(CPF_FORMATTED);
  expect(logs).not.toContain(CNPJ_ALPHA);
  expect(logs).not.toContain(CNPJ_ALPHA_NORMALIZED);
  await test.close();
  await database.drop();
});

describe('cesta do aluno (/api/v1/cart)', () => {
  it('exige sessão, CSRF nas escritas e e-mail confirmado', async () => {
    expect((await browser().request('GET', '/api/v1/cart')).statusCode).toBe(401);
    const courseId = await makeCourse();

    const { browser: unverified } = await studentSession({ verified: false });
    const getUnverified = await unverified.request('GET', '/api/v1/cart');
    expect(getUnverified.statusCode).toBe(403);
    expect(getUnverified.json().code).toBe('email_not_verified');

    const postUnverified = await unverified.request('POST', '/api/v1/cart/items', {
      payload: { productType: 'course', productId: courseId },
    });
    expect(postUnverified.statusCode).toBe(403);
    expect(postUnverified.json().code).toBe('email_not_verified');

    const { browser: verified } = await studentSession();
    const noCsrf = await verified.request('POST', '/api/v1/cart/items', {
      payload: { productType: 'course', productId: courseId },
      csrf: false,
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json().code).toBe('csrf_token_invalid');
  });

  it('devolve cesta vazia, acrescenta pacote com cascata e avisos, e remove item', async () => {
    const { user, browser: session } = await studentSession();
    const empty = await session.request('GET', '/api/v1/cart');
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({
      items: [],
      coupon: null,
      itemCount: 0,
      subtotalCents: 0,
      discountCents: 0,
      totalCents: 0,
      currency: 'BRL',
    });

    const courseEbookId = await makeEbook({ title: 'Apostila do Curso' });
    const courseId = await makeCourse({ title: 'Curso do Pacote', priceCents: 6_000 });
    await test.db
      .insertInto('productEbooks')
      .values({ targetType: 'course', targetId: courseId, ebookId: courseEbookId })
      .execute();
    const directEbookId = await makeEbook({ title: 'Ebook Direto' });
    const bundleId = await makeBundle({
      title: 'Pacote Trilha',
      priceCents: 9_000,
      courseIds: [courseId],
      ebookIds: [directEbookId],
    });

    // Direito com prazo num item do pacote: dispara `bundle_item_owned` sem bloquear a compra.
    await test.db.transaction().execute((trx) =>
      grantEntitlement(trx, {
        userId: user.id,
        productType: 'course',
        productId: courseId,
        source: 'grant',
        grantedReason: 'Acesso de teste',
        sourceId: randomUUID(),
        expiresAt: new Date(Date.now() + 86_400_000),
        notify: false,
      }),
    );

    const added = await session.request('POST', '/api/v1/cart/items', {
      payload: { productType: 'bundle', productId: bundleId },
    });
    expect(added.statusCode).toBe(201);
    const cart = added.json();
    expect(cart).toMatchObject({
      itemCount: 1,
      subtotalCents: 9_000,
      discountCents: 0,
      totalCents: 9_000,
    });
    expect(cart.items[0].warnings).toContain('bundle_item_owned');
    expect(cart.items[0].unlocks).toEqual(
      expect.arrayContaining([
        { productType: 'course', productId: courseId, title: 'Curso do Pacote', via: null },
        { productType: 'ebook', productId: directEbookId, title: 'Ebook Direto', via: null },
        {
          productType: 'ebook',
          productId: courseEbookId,
          title: 'Apostila do Curso',
          via: { productType: 'course', title: 'Curso do Pacote' },
        },
      ]),
    );

    const itemId = cart.items[0].id as string;
    // Outra aluna não remove item alheio.
    const { browser: other } = await studentSession();
    expect((await other.request('DELETE', `/api/v1/cart/items/${itemId}`)).statusCode).toBe(404);

    const removed = await session.request('DELETE', `/api/v1/cart/items/${itemId}`);
    expect(removed.statusCode).toBe(204);
    expect((await session.request('DELETE', `/api/v1/cart/items/${itemId}`)).statusCode).toBe(404);
    expect((await session.request('GET', '/api/v1/cart')).json().items).toEqual([]);
  });

  it('recusa produto open, private, rascunho, arquivado, repetido ou já possuído vitalício', async () => {
    const { user, browser: session } = await studentSession();
    const openId = await makeCourse({ accessMode: 'open' });
    const privateId = await makeCourse({ accessMode: 'private' });
    const draftId = await makeCourse({ published: false });
    const archivedId = await makeCourse({ archived: true });

    for (const productId of [openId, privateId, draftId, archivedId, randomUUID()]) {
      const reply = await session.request('POST', '/api/v1/cart/items', {
        payload: { productType: 'course', productId },
      });
      expect(reply.statusCode).toBe(409);
      expect(reply.json().code).toBe('product_not_sellable');
    }

    const paidId = await makeCourse({ priceCents: 4_000 });
    expect(
      (
        await session.request('POST', '/api/v1/cart/items', {
          payload: { productType: 'course', productId: paidId },
        })
      ).statusCode,
    ).toBe(201);
    const duplicate = await session.request('POST', '/api/v1/cart/items', {
      payload: { productType: 'course', productId: paidId },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().code).toBe('product_already_in_cart');

    const ownedId = await makeCourse({ priceCents: 3_000 });
    await test.db.transaction().execute((trx) =>
      grantEntitlement(trx, {
        userId: user.id,
        productType: 'course',
        productId: ownedId,
        source: 'grant',
        grantedReason: 'Acesso de teste',
        sourceId: randomUUID(),
        expiresAt: null,
        notify: false,
      }),
    );
    const owned = await session.request('POST', '/api/v1/cart/items', {
      payload: { productType: 'course', productId: ownedId },
    });
    expect(owned.statusCode).toBe(409);
    expect(owned.json().code).toBe('product_already_owned');
  });

  it('aplica cupom percent e fixed com rateio, preserva cupom anterior quando recusado e remove', async () => {
    const { browser: session } = await studentSession();
    const courseA = await makeCourse({ title: 'Curso A', priceCents: 1_000 });
    const courseB = await makeCourse({ title: 'Curso B', priceCents: 2_000 });
    const ebookOut = await makeEbook({ title: 'Fora do Cupom', priceCents: 500 });

    for (const [productType, productId] of [
      ['course', courseA],
      ['course', courseB],
      ['ebook', ebookOut],
    ] as const) {
      expect(
        (
          await session.request('POST', '/api/v1/cart/items', {
            payload: { productType, productId },
          })
        ).statusCode,
      ).toBe(201);
    }

    const fixedCode = `FIXO-${randomUUID().slice(0, 6).toUpperCase()}`;
    await makeCoupon({
      code: fixedCode,
      kind: 'fixed',
      amountOffCents: 1_000,
      products: [
        { productType: 'course', productId: courseA },
        { productType: 'course', productId: courseB },
      ],
    });

    const applied = await session.request('PUT', '/api/v1/cart/coupon', {
      payload: { code: fixedCode.toLowerCase() },
    });
    expect(applied.statusCode).toBe(200);
    // 1000 rateado entre 1000 e 2000: floor(1000 * 1000 / 3000) = 333, resto 667 no último elegível.
    const byProduct = new Map<string, { discountCents: number; couponEligible: boolean }>(
      applied
        .json()
        .items.map(
          (item: { productId: string; discountCents: number; couponEligible: boolean }) => [
            item.productId,
            item,
          ],
        ),
    );
    expect(byProduct.get(courseA)).toMatchObject({ discountCents: 333, couponEligible: true });
    expect(byProduct.get(courseB)).toMatchObject({ discountCents: 667, couponEligible: true });
    expect(byProduct.get(ebookOut)).toMatchObject({ discountCents: 0, couponEligible: false });
    expect(applied.json()).toMatchObject({
      subtotalCents: 3_500,
      discountCents: 1_000,
      totalCents: 2_500,
      coupon: { code: fixedCode, valid: true, invalidReason: null },
    });

    // Cupom inválido devolve a mesma mensagem em todos os motivos e mantém o cupom anterior.
    const subOnly = `SUB-${randomUUID().slice(0, 6).toUpperCase()}`;
    await makeCoupon({
      code: subOnly,
      kind: 'percent',
      percentOff: 20,
      appliesTo: 'subscriptions',
    });
    const missingReply = await session.request('PUT', '/api/v1/cart/coupon', {
      payload: { code: 'NAO-EXISTE-999' },
    });
    const subOnlyReply = await session.request('PUT', '/api/v1/cart/coupon', {
      payload: { code: subOnly },
    });
    expect(missingReply.statusCode).toBe(422);
    expect(subOnlyReply.statusCode).toBe(422);
    expect(missingReply.json()).toMatchObject({ code: 'coupon_invalid' });
    expect(subOnlyReply.json().detail).toBe(missingReply.json().detail);
    expect((await session.request('GET', '/api/v1/cart')).json().coupon.code).toBe(fixedCode);

    const cleared = await session.request('DELETE', '/api/v1/cart/coupon');
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toMatchObject({ coupon: null, discountCents: 0, totalCents: 3_500 });
  });
});

describe('dados de comprador (/api/v1/me/billing)', () => {
  it('lê vazio, grava CPF e CNPJ alfanumérico normalizados, recusa dígito inválido e não vaza em log', async () => {
    const { browser: session } = await studentSession();

    const initial = await session.request('GET', '/api/v1/me/billing');
    expect(initial.statusCode).toBe(200);
    expect(initial.headers['cache-control']).toBe('no-store');
    expect(initial.json()).toEqual({
      fullName: null,
      taxIdType: null,
      taxId: null,
      complete: false,
    });

    const invalidCpf = await session.request('PUT', '/api/v1/me/billing', {
      payload: { fullName: 'Compradora', taxIdType: 'cpf', taxId: '111.111.111-11' },
    });
    expect(invalidCpf.statusCode).toBe(422);
    expect(invalidCpf.json().code).toBe('tax_id_invalid');

    const savedCpf = await session.request('PUT', '/api/v1/me/billing', {
      payload: { fullName: '  Maria   Compradora  ', taxIdType: 'cpf', taxId: CPF_FORMATTED },
    });
    expect(savedCpf.statusCode).toBe(200);
    expect(savedCpf.headers['cache-control']).toBe('no-store');
    expect(savedCpf.json()).toEqual({
      fullName: 'Maria Compradora',
      taxIdType: 'cpf',
      taxId: CPF,
      complete: true,
    });

    const savedCnpj = await session.request('PUT', '/api/v1/me/billing', {
      payload: { fullName: 'Escola LTDA', taxIdType: 'cnpj', taxId: CNPJ_ALPHA },
    });
    expect(savedCnpj.statusCode).toBe(200);
    expect(savedCnpj.json()).toEqual({
      fullName: 'Escola LTDA',
      taxIdType: 'cnpj',
      taxId: CNPJ_ALPHA_NORMALIZED,
      complete: true,
    });
  });
});
