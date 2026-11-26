import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, auditOf, type CallOptions, callAs, createActor, deniedBy } from '../actors.ts';
import { createTestApp, type TestApp } from '../helpers.ts';
import { createPaidCourseAs, createPaidEbookAs } from './fixtures.ts';

// Cupons na admin-api (spec 011, "Cupons"; specs 008 e 028): `coupon.manage` exclusiva do `admin`,
// código único sem diferenciar maiúsculas (`409 coupon_code_taken`), combinações inválidas em `422
// coupon_invalid`, substituição da lista de produtos, desativação e auditoria.

const test: TestApp = createTestApp();
afterAll(() => test.close());

let admin: Actor;
let manager: Actor;
let instructor: Actor;
let student: Actor;

beforeAll(async () => {
  [admin, manager, instructor, student] = await Promise.all([
    createActor(test, 'admin'),
    createActor(test, 'manager'),
    createActor(test, 'instructor'),
    createActor(test, 'student'),
  ]);
});

const call = (options: CallOptions) => callAs(test, options);

function uniqueCode(prefix = 'CUPOM'): string {
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

describe('gestão de cupons', () => {
  it('cria, consulta, lista com filtros e cursor, edita, restringe produtos, desativa e audita', async () => {
    const course = await createPaidCourseAs(test, admin, { title: 'Curso Elegível' });
    const ebook = await createPaidEbookAs(test, admin, { title: 'Ebook Elegível' });
    const code = uniqueCode('PROMO25');

    const created = await call({
      method: 'POST',
      url: '/api/v1/coupons',
      as: admin,
      payload: {
        code,
        kind: 'percent',
        percentOff: 25,
        startsAt: '2026-01-01T00:00:00.000Z',
        endsAt: '2027-01-01T00:00:00.000Z',
        maxUses: 100,
        maxUsesPerUser: 2,
        appliesTo: 'both',
        products: [{ productType: 'course', productId: course.id }],
        active: true,
      },
    });
    expect(created.statusCode).toBe(201);
    const coupon = created.json();
    expect(coupon).toMatchObject({
      code,
      kind: 'percent',
      percentOff: 25,
      amountOffCents: null,
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2027-01-01T00:00:00.000Z',
      maxUses: 100,
      maxUsesPerUser: 2,
      usesCount: 0,
      appliesTo: 'both',
      products: [{ productType: 'course', productId: course.id, title: 'Curso Elegível' }],
      active: true,
      createdBy: { id: admin.id, name: 'Pessoa de Teste' },
    });

    const createAudit = await auditOf(test, coupon.id, 'coupon.create');
    expect(createAudit).toHaveLength(1);
    expect(createAudit[0]).toMatchObject({ actorUserId: admin.id, targetType: 'coupon' });

    const fetched = await call({
      method: 'GET',
      url: `/api/v1/coupons/${coupon.id}`,
      as: admin,
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toEqual(coupon);

    // Cupom de valor fixo para testar paginação e filtros.
    const fixedCode = uniqueCode('FIXO50');
    const fixedRes = await call({
      method: 'POST',
      url: '/api/v1/coupons',
      as: admin,
      payload: {
        code: fixedCode,
        kind: 'fixed',
        amountOffCents: 5_000,
      },
    });
    expect(fixedRes.statusCode).toBe(201);
    expect(fixedRes.json()).toMatchObject({
      code: fixedCode,
      kind: 'fixed',
      percentOff: null,
      amountOffCents: 5_000,
      maxUses: null,
      maxUsesPerUser: 1,
      appliesTo: 'orders',
      products: [],
      active: true,
    });

    // Busca sem diferenciar maiúsculas e filtro por `appliesTo`.
    const byCode = await call({
      method: 'GET',
      url: `/api/v1/coupons?q=${encodeURIComponent(code.toLowerCase())}&appliesTo=both`,
      as: admin,
    });
    expect(byCode.statusCode).toBe(200);
    expect(byCode.json().items.map((item: { id: string }) => item.id)).toEqual([coupon.id]);

    // Paginação por cursor.
    const page1 = await call({
      method: 'GET',
      url: '/api/v1/coupons?limit=1',
      as: admin,
    });
    expect(page1.statusCode).toBe(200);
    expect(page1.json().items).toHaveLength(1);
    expect(page1.json().nextCursor).not.toBeNull();

    const page2 = await call({
      method: 'GET',
      url: `/api/v1/coupons?limit=1&cursor=${encodeURIComponent(page1.json().nextCursor)}`,
      as: admin,
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json().items).toHaveLength(1);
    expect(page2.json().items[0].id).not.toBe(page1.json().items[0].id);

    // Substitui a lista de produtos, reduz `maxUses` abaixo de `usesCount` e desativa.
    await test.db
      .updateTable('coupons')
      .set({ usesCount: 5 })
      .where('id', '=', coupon.id)
      .execute();

    const updated = await call({
      method: 'PATCH',
      url: `/api/v1/coupons/${coupon.id}`,
      as: admin,
      payload: {
        maxUses: 3,
        active: false,
        products: [{ productType: 'ebook', productId: ebook.id }],
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      id: coupon.id,
      maxUses: 3,
      usesCount: 5,
      active: false,
      products: [{ productType: 'ebook', productId: ebook.id, title: 'Ebook Elegível' }],
    });

    // `products: []` volta a valer para todos os produtos.
    const cleared = await call({
      method: 'PATCH',
      url: `/api/v1/coupons/${coupon.id}`,
      as: admin,
      payload: { products: [] },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().products).toEqual([]);

    const updateAudit = await auditOf(test, coupon.id, 'coupon.update');
    expect(updateAudit).toHaveLength(2);

    const inactive = await call({
      method: 'GET',
      url: `/api/v1/coupons?q=${encodeURIComponent(code)}&active=false`,
      as: admin,
    });
    expect(inactive.json().items.map((item: { id: string }) => item.id)).toEqual([coupon.id]);
  });

  it('recusa código duplicado sem diferenciar maiúsculas (409) e combinações inválidas (422)', async () => {
    const code = uniqueCode('UNICO');
    const first = await call({
      method: 'POST',
      url: '/api/v1/coupons',
      as: admin,
      payload: { code, kind: 'percent', percentOff: 10 },
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await call({
      method: 'POST',
      url: '/api/v1/coupons',
      as: admin,
      payload: { code: code.toLowerCase(), kind: 'percent', percentOff: 15 },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: 'coupon_code_taken' });

    const other = await call({
      method: 'POST',
      url: '/api/v1/coupons',
      as: admin,
      payload: { code: uniqueCode('OUTRO'), kind: 'percent', percentOff: 15 },
    });
    expect(other.statusCode).toBe(201);
    const renameTaken = await call({
      method: 'PATCH',
      url: `/api/v1/coupons/${other.json().id}`,
      as: admin,
      payload: { code: code.toLowerCase() },
    });
    expect(renameTaken.statusCode).toBe(409);
    expect(renameTaken.json()).toMatchObject({ code: 'coupon_code_taken' });

    // `percent` sem `percentOff`, `percent` com os dois descontos e `fixed` sem `amountOffCents`.
    for (const invalidPayload of [
      { code: uniqueCode('INV'), kind: 'percent' },
      { code: uniqueCode('INV'), kind: 'percent', percentOff: 10, amountOffCents: 500 },
      { code: uniqueCode('INV'), kind: 'fixed' },
      {
        code: uniqueCode('INV'),
        kind: 'percent',
        percentOff: 10,
        startsAt: '2026-06-01T00:00:00.000Z',
        endsAt: '2026-05-01T00:00:00.000Z',
      },
      {
        code: uniqueCode('INV'),
        kind: 'percent',
        percentOff: 10,
        products: [{ productType: 'course', productId: randomUUID() }],
      },
    ]) {
      const response = await call({
        method: 'POST',
        url: '/api/v1/coupons',
        as: admin,
        payload: invalidPayload,
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: 'coupon_invalid' });
    }

    // Edição que deixa o desconto incompatível com `kind`: `422 coupon_invalid`.
    const mismatchPatch = await call({
      method: 'PATCH',
      url: `/api/v1/coupons/${first.json().id}`,
      as: admin,
      payload: { kind: 'fixed' },
    });
    expect(mismatchPatch.statusCode).toBe(422);
    expect(mismatchPatch.json()).toMatchObject({ code: 'coupon_invalid' });

    // Cupom inexistente: `404` na leitura e na edição; cursor inválido: `400`.
    expect(
      (await call({ method: 'GET', url: `/api/v1/coupons/${randomUUID()}`, as: admin })).statusCode,
    ).toBe(404);
    expect(
      (
        await call({
          method: 'PATCH',
          url: `/api/v1/coupons/${randomUUID()}`,
          as: admin,
          payload: { active: false },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call({ method: 'GET', url: '/api/v1/coupons?cursor=invalido', as: admin })).statusCode,
    ).toBe(400);
  });

  it('recusa gerente, instrutor e aluno com 403 auditado e escrita sem CSRF', async () => {
    const created = await call({
      method: 'POST',
      url: '/api/v1/coupons',
      as: admin,
      payload: { code: uniqueCode('PERM'), kind: 'percent', percentOff: 10 },
    });
    const couponId = created.json().id as string;

    for (const actor of [manager, instructor, student]) {
      const listRes = await call({ method: 'GET', url: '/api/v1/coupons', as: actor });
      expect(listRes.statusCode).toBe(403);
      expect(listRes.json()).toMatchObject({ code: 'permission_denied' });

      const getRes = await call({
        method: 'GET',
        url: `/api/v1/coupons/${couponId}`,
        as: actor,
      });
      expect(getRes.statusCode).toBe(403);

      const postRes = await call({
        method: 'POST',
        url: '/api/v1/coupons',
        as: actor,
        payload: { code: uniqueCode('NEG'), kind: 'percent', percentOff: 10 },
      });
      expect(postRes.statusCode).toBe(403);

      const patchRes = await call({
        method: 'PATCH',
        url: `/api/v1/coupons/${couponId}`,
        as: actor,
        payload: { active: false },
      });
      expect(patchRes.statusCode).toBe(403);

      const denials = await deniedBy(test, actor.id);
      expect(denials.length).toBeGreaterThanOrEqual(4);
    }

    const noCsrf = await call({
      method: 'POST',
      url: '/api/v1/coupons',
      as: admin,
      payload: { code: uniqueCode('CSRF'), kind: 'percent', percentOff: 10 },
      csrf: null,
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toMatchObject({ code: 'csrf_token_invalid' });
  });
});
