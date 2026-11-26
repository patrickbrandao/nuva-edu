import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, tableExists, unique } from './helpers.ts';

const dir = defaultMigrationsDir;

type Row = Record<string, unknown>;

describe('0014: vendas e pagamentos', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 14 });
  });
  after(async () => {
    await db.drop();
  });

  const query = (text: string, values: unknown[] = []) => db.client.query(text, values);

  async function insertRow(table: string, row: Row): Promise<Row> {
    const columns = Object.keys(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    const { rows } = await query(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      Object.values(row),
    );
    return rows[0] as Row;
  }

  async function rejects(table: string, row: Row, constraint: string) {
    await assert.rejects(insertRow(table, row), (error: { constraint?: string }) => {
      assert.equal(error.constraint, constraint);
      return true;
    });
  }

  /** Cópia para reinserir sem a chave primária devolvida pelo INSERT anterior. */
  function withoutId(row: Row): Row {
    const copy = { ...row };
    delete copy.id;
    return copy;
  }

  async function insertUser(): Promise<string> {
    const user = await insertRow('users', {
      email: `vendas-${unique()}@example.com`,
      name: 'Pessoa',
    });
    return user.id as string;
  }

  async function insertCoupon(overrides: Row = {}): Promise<Row> {
    return insertRow('coupons', {
      code: `CUPOM-${unique().toUpperCase()}`,
      kind: 'percent',
      percent_off: 10,
      created_by: await insertUser(),
      ...overrides,
    });
  }

  async function insertCart(userId: string, overrides: Row = {}): Promise<Row> {
    return insertRow('carts', { user_id: userId, ...overrides });
  }

  async function insertOrder(userId: string, overrides: Row = {}): Promise<Row> {
    return insertRow('orders', {
      user_id: userId,
      status: 'pending',
      subtotal_cents: 10_000,
      discount_cents: 1_000,
      total_cents: 9_000,
      currency: 'BRL',
      buyer_name: 'Ana Souza',
      buyer_tax_id_type: 'cpf',
      buyer_tax_id: '12345678901',
      provider: 'mercadopago',
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      ...overrides,
    });
  }

  async function insertOrderItem(orderId: string, overrides: Row = {}): Promise<Row> {
    return insertRow('order_items', {
      order_id: orderId,
      product_type: 'course',
      product_id: randomUUID(),
      title_snapshot: 'Curso de exemplo',
      unit_price_cents: 1_000,
      discount_cents: 100,
      paid_cents: 900,
      ...overrides,
    });
  }

  async function insertPayment(orderId: string | null, overrides: Row = {}): Promise<Row> {
    return insertRow('payments', {
      order_id: orderId,
      provider: 'mercadopago',
      provider_payment_id: `pay-${unique()}`,
      status: 'pending',
      method: 'pix',
      amount_cents: 9_000,
      currency: 'BRL',
      raw_status: 'pending',
      ...overrides,
    });
  }

  async function insertRefund(paymentId: string, requestedBy: string, overrides: Row = {}) {
    return insertRow('refunds', {
      payment_id: paymentId,
      amount_cents: 1_000,
      reason: 'Solicitação do aluno',
      requested_by: requestedBy,
      ...overrides,
    });
  }

  async function insertWebhook(overrides: Row = {}): Promise<Row> {
    return insertRow('webhook_events', {
      provider: 'mercadopago',
      event_id: `evt-${unique()}`,
      resource_type: 'payment',
      resource_id: `pay-${unique()}`,
      ...overrides,
    });
  }

  async function countRows(table: string, where = 'true', values: unknown[] = []): Promise<number> {
    const { rows } = await query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, values);
    return rows[0].n as number;
  }

  test('down e up da 0014 removem e recriam as tabelas', async () => {
    const tables = [
      'coupons',
      'coupon_products',
      'carts',
      'cart_items',
      'orders',
      'order_items',
      'payments',
      'refunds',
      'webhook_events',
    ];
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), true, table);
    }
    await migrateDown(db.client, { dir });
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), false, table);
    }
    assert.equal(await tableExists(db.client, 'entitlements'), true);
    await migrateUp(db.client, { dir, to: 14 });
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), true, table);
    }
  });

  test('padrões, UUID v7 e updated_at pelo gatilho', async () => {
    const user = await insertUser();
    const coupon = await insertCoupon();
    assert.equal(coupon.kind, 'percent');
    assert.equal(coupon.percent_off, 10);
    assert.equal(coupon.amount_off_cents, null);
    assert.equal(coupon.max_uses, null);
    assert.equal(coupon.max_uses_per_user, 1);
    assert.equal(coupon.uses_count, 0);
    assert.equal(coupon.applies_to, 'orders');
    assert.equal(coupon.active, true);
    assert.ok(coupon.created_at instanceof Date);
    const { rows: v } = await query('SELECT uuid_extract_version($1::uuid) AS v', [coupon.id]);
    assert.equal(v[0].v, 7);

    const cart = await insertCart(user);
    assert.equal(cart.coupon_id, null);
    await query(`UPDATE carts SET updated_at = now() - interval '1 day' WHERE id = $1`, [cart.id]);
    const { rows: fresh } = await query(
      "SELECT updated_at > now() - interval '1 minute' AS fresh FROM carts WHERE id = $1",
      [cart.id],
    );
    assert.equal(fresh[0].fresh, true);

    const draft = await insertOrder(user, {
      status: 'draft',
      subtotal_cents: 0,
      discount_cents: 0,
      total_cents: 0,
      provider: 'none',
      expires_at: null,
    });
    assert.equal(draft.status, 'draft');
    assert.equal(draft.provider, 'none');
    assert.equal(draft.paid_at, null);
    assert.ok(Number(draft.number) > 0);

    const payment = await insertPayment(draft.id as string, {
      status: 'approved',
      paid_at: new Date().toISOString(),
    });
    assert.equal(Number(payment.refunded_cents), 0);
    assert.ok(payment.created_at instanceof Date);
    await query(`UPDATE payments SET updated_at = now() - interval '1 day' WHERE id = $1`, [
      payment.id,
    ]);
    const { rows: paymentFresh } = await query(
      "SELECT updated_at > now() - interval '1 minute' AS fresh FROM payments WHERE id = $1",
      [payment.id],
    );
    assert.equal(paymentFresh[0].fresh, true);
  });

  test('cupons: código sem diferenciar maiúsculas, desconto, janela e limites', async () => {
    const code = `PROMO-${unique().toUpperCase()}`;
    const coupon = await insertCoupon({ code });
    const fixed = await insertCoupon({
      kind: 'fixed',
      percent_off: null,
      amount_off_cents: 500,
    });
    assert.equal(Number(fixed.amount_off_cents), 500);
    await insertCoupon({ max_uses: 1, uses_count: 2 });

    await rejects(
      'coupons',
      {
        code: code.toLowerCase(),
        kind: 'percent',
        percent_off: 5,
        created_by: await insertUser(),
      },
      'coupons_code_unique',
    );

    for (const invalid of ['ab', 'codigo_com_underscore', 'x'.repeat(41), 'com espaço']) {
      await rejects(
        'coupons',
        {
          code: invalid,
          kind: 'percent',
          percent_off: 5,
          created_by: await insertUser(),
        },
        'coupons_code_format',
      );
    }

    const createdBy = await insertUser();
    const invalidCoupons: [Row, string][] = [
      [{ kind: 'value', percent_off: 5 }, 'coupons_kind_valid'],
      [{ kind: 'percent', percent_off: 0 }, 'coupons_discount_matches_kind'],
      [{ kind: 'percent', percent_off: 101 }, 'coupons_discount_matches_kind'],
      [{ kind: 'percent', percent_off: 5, amount_off_cents: 100 }, 'coupons_discount_matches_kind'],
      [{ kind: 'fixed', percent_off: null, amount_off_cents: 0 }, 'coupons_discount_matches_kind'],
      [{ kind: 'fixed', percent_off: 5, amount_off_cents: 100 }, 'coupons_discount_matches_kind'],
      [
        { starts_at: '2030-01-02T00:00:00Z', ends_at: '2030-01-01T00:00:00Z' },
        'coupons_window_valid',
      ],
      [{ max_uses: 0 }, 'coupons_max_uses_range'],
      [{ max_uses_per_user: 0 }, 'coupons_max_uses_per_user_range'],
      [{ uses_count: -1 }, 'coupons_uses_count_range'],
      [{ applies_to: 'products' }, 'coupons_applies_to_valid'],
    ];
    for (const [fields, constraint] of invalidCoupons) {
      await rejects(
        'coupons',
        {
          code: `CUPOM-${unique().toUpperCase()}`,
          kind: 'percent',
          percent_off: 5,
          created_by: createdBy,
          ...fields,
        },
        constraint,
      );
    }
    await insertCoupon({
      starts_at: '2030-01-01T00:00:00Z',
      ends_at: '2030-02-01T00:00:00Z',
      max_uses: 10,
      max_uses_per_user: 2,
      applies_to: 'both',
    });

    await insertRow('coupon_products', {
      coupon_id: coupon.id,
      product_type: 'course',
      product_id: randomUUID(),
    });
    await insertRow('coupon_products', {
      coupon_id: coupon.id,
      product_type: 'ebook',
      product_id: randomUUID(),
    });
    const product = { coupon_id: coupon.id, product_type: 'course', product_id: randomUUID() };
    await insertRow('coupon_products', product);
    await rejects('coupon_products', product, 'coupon_products_pkey');
    await rejects(
      'coupon_products',
      { coupon_id: coupon.id, product_type: 'lesson', product_id: randomUUID() },
      'coupon_products_product_type_valid',
    );
    await query('DELETE FROM coupons WHERE id = $1', [coupon.id]);
    assert.equal(await countRows('coupon_products', 'coupon_id = $1', [coupon.id]), 0);
  });

  test('cesta: uma por usuário, itens únicos, gatilho de updated_at e cascata', async () => {
    const user = await insertUser();
    const coupon = await insertCoupon();
    const cart = await insertCart(user, { coupon_id: coupon.id });

    await rejects('carts', { user_id: user }, 'carts_user_id_unique');
    await rejects(
      'carts',
      { user_id: await insertUser(), coupon_id: randomUUID() },
      'carts_coupon_id_fkey',
    );

    const item = { cart_id: cart.id, product_type: 'course', product_id: randomUUID() };
    await insertRow('cart_items', item);
    await rejects('cart_items', item, 'cart_items_cart_product_unique');
    await rejects(
      'cart_items',
      { cart_id: cart.id, product_type: 'lesson', product_id: randomUUID() },
      'cart_items_product_type_valid',
    );

    const otherUser = await insertUser();
    const otherCart = await insertCart(otherUser);
    const before = otherCart.updated_at as Date;
    await query('SELECT pg_sleep(0.01)');
    await insertRow('cart_items', {
      cart_id: otherCart.id,
      product_type: 'ebook',
      product_id: randomUUID(),
    });
    const { rows: bumped } = await query(
      'SELECT updated_at > $1::timestamptz AS bumped FROM carts WHERE id = $2',
      [before, otherCart.id],
    );
    assert.equal(bumped[0].bumped, true);

    assert.equal(await countRows('cart_items', 'cart_id = $1', [cart.id]), 1);
    await query('DELETE FROM carts WHERE id = $1', [cart.id]);
    assert.equal(await countRows('cart_items', 'cart_id = $1', [cart.id]), 0);

    const thirdUser = await insertUser();
    await insertCart(thirdUser);
    await query('DELETE FROM users WHERE id = $1', [thirdUser]);
    assert.equal(await countRows('carts', 'user_id = $1', [thirdUser]), 0);
  });

  test('pedido: número, preços congelados, estados e dados do comprador', async () => {
    const user = await insertUser();
    const first = await insertOrder(user);
    const second = await insertOrder(user);
    assert.ok(Number(second.number) > Number(first.number));
    assert.equal(first.status, 'pending');
    assert.equal(first.paid_at, null);
    assert.ok(first.expires_at instanceof Date);
    assert.equal(first.provider, 'mercadopago');
    assert.equal(Number(first.subtotal_cents), 10_000);
    assert.equal(Number(first.discount_cents), 1_000);
    assert.equal(Number(first.total_cents), 9_000);
    const order = withoutId(first);

    await rejects('orders', { ...order, number: first.number }, 'orders_number_unique');
    await rejects('orders', { ...order, total_cents: 9_500 }, 'orders_total_matches');
    await rejects(
      'orders',
      { ...order, discount_cents: 11_000, total_cents: -1_000 },
      'orders_discount_range',
    );
    await rejects('orders', { ...order, status: 'processing' }, 'orders_status_valid');
    await rejects('orders', { ...order, expires_at: null }, 'orders_pending_has_expiry');
    await rejects('orders', { ...order, status: 'paid' }, 'orders_paid_at_matches_status');
    await rejects(
      'orders',
      { ...order, paid_at: new Date().toISOString() },
      'orders_paid_at_matches_status',
    );
    await rejects(
      'orders',
      { ...order, subtotal_cents: 0, discount_cents: 0, total_cents: 0 },
      'orders_free_order_without_provider',
    );
    await insertOrder(user, {
      subtotal_cents: 0,
      discount_cents: 0,
      total_cents: 0,
      provider: 'none',
    });
    await insertOrder(user, {
      status: 'paid',
      paid_at: new Date().toISOString(),
      provider: 'fake',
    });

    await rejects('orders', { ...order, currency: 'brl' }, 'orders_currency_format');
    await rejects('orders', { ...order, buyer_name: '   ' }, 'orders_buyer_name_length');
    await rejects(
      'orders',
      { ...order, buyer_tax_id_type: 'rg' },
      'orders_buyer_tax_id_type_valid',
    );
    await rejects('orders', { ...order, buyer_tax_id: '   ' }, 'orders_buyer_tax_id_format');
    await rejects('orders', { ...order, provider: 'pagseguro' }, 'orders_provider_valid');
    const noNumber = { ...order };
    delete noNumber.number;
    await rejects('orders', { ...noNumber, user_id: randomUUID() }, 'orders_user_id_fkey');

    const coupon = await insertCoupon();
    const withCoupon = await insertOrder(user, {
      coupon_id: coupon.id,
      coupon_code: coupon.code,
    });
    assert.equal(withCoupon.coupon_code, coupon.code);
    await rejects('orders', { ...order, coupon_id: coupon.id }, 'orders_coupon_code_matches');
    await rejects(
      'orders',
      { ...order, coupon_code: 'invalido_com_underscore' },
      'orders_coupon_code_format',
    );
    await query('DELETE FROM coupons WHERE id = $1', [coupon.id]);
    const { rows: kept } = await query('SELECT coupon_id, coupon_code FROM orders WHERE id = $1', [
      withCoupon.id,
    ]);
    assert.equal(kept[0].coupon_id, null);
    assert.equal(kept[0].coupon_code, coupon.code);
  });

  test('itens do pedido: valor pago, reembolso por item e cascata', async () => {
    const order = await insertOrder(await insertUser());
    const item = await insertOrderItem(order.id as string);
    assert.equal(item.title_snapshot, 'Curso de exemplo');
    assert.equal(Number(item.paid_cents), 900);
    assert.equal(Number(item.refunded_cents), 0);

    await insertOrderItem(order.id as string, { product_type: 'ebook' });
    await rejects(
      'order_items',
      {
        order_id: order.id,
        product_type: 'course',
        product_id: item.product_id,
        title_snapshot: 'Outro',
        unit_price_cents: 500,
        discount_cents: 0,
        paid_cents: 500,
      },
      'order_items_order_product_unique',
    );
    await rejects(
      'order_items',
      {
        order_id: order.id,
        product_type: 'course',
        product_id: randomUUID(),
        title_snapshot: 'Curso',
        unit_price_cents: 1_000,
        discount_cents: 100,
        paid_cents: 800,
      },
      'order_items_paid_matches',
    );
    await rejects(
      'order_items',
      {
        order_id: order.id,
        product_type: 'course',
        product_id: randomUUID(),
        title_snapshot: 'Curso',
        unit_price_cents: 1_000,
        discount_cents: 1_100,
        paid_cents: -100,
      },
      'order_items_discount_range',
    );
    await rejects(
      'order_items',
      {
        order_id: order.id,
        product_type: 'course',
        product_id: randomUUID(),
        title_snapshot: 'Curso',
        unit_price_cents: 1_000,
        discount_cents: 0,
        paid_cents: 1_000,
        refunded_cents: 1_001,
      },
      'order_items_refunded_range',
    );
    await rejects(
      'order_items',
      {
        order_id: order.id,
        product_type: 'course',
        product_id: randomUUID(),
        title_snapshot: 'Curso',
        access_days_snapshot: 0,
        unit_price_cents: 1_000,
        discount_cents: 0,
        paid_cents: 1_000,
      },
      'order_items_access_days_range',
    );
    await rejects(
      'order_items',
      {
        order_id: order.id,
        product_type: 'course',
        product_id: randomUUID(),
        title_snapshot: '   ',
        unit_price_cents: 1_000,
        discount_cents: 0,
        paid_cents: 1_000,
      },
      'order_items_title_snapshot_length',
    );
    await rejects(
      'order_items',
      {
        order_id: order.id,
        product_type: 'lesson',
        product_id: randomUUID(),
        title_snapshot: 'Aula',
        unit_price_cents: 1_000,
        discount_cents: 0,
        paid_cents: 1_000,
      },
      'order_items_product_type_valid',
    );

    assert.equal(await countRows('order_items', 'order_id = $1', [order.id]), 2);
    await query('DELETE FROM orders WHERE id = $1', [order.id]);
    assert.equal(await countRows('order_items', 'order_id = $1', [order.id]), 0);
  });

  test('pagamentos: dono único, idempotência do provedor e estados', async () => {
    const order = await insertOrder(await insertUser());
    const payment = await insertPayment(order.id as string);
    assert.equal(payment.status, 'pending');
    assert.equal(Number(payment.refunded_cents), 0);
    assert.equal(payment.paid_at, null);

    const subscriptionPayment = await insertPayment(null, { subscription_id: randomUUID() });
    assert.equal(subscriptionPayment.order_id, null);

    await rejects(
      'payments',
      {
        order_id: null,
        provider: 'fake',
        provider_payment_id: `pay-${unique()}`,
        status: 'pending',
        method: 'pix',
        amount_cents: 1,
        currency: 'BRL',
        raw_status: 'pending',
      },
      'payments_owner_exactly_one',
    );
    await rejects(
      'payments',
      {
        order_id: order.id,
        subscription_id: randomUUID(),
        provider: 'fake',
        provider_payment_id: `pay-${unique()}`,
        status: 'pending',
        method: 'pix',
        amount_cents: 1,
        currency: 'BRL',
        raw_status: 'pending',
      },
      'payments_owner_exactly_one',
    );

    const providerPaymentId = `pay-dup-${unique()}`;
    await insertPayment(order.id as string, { provider_payment_id: providerPaymentId });
    await rejects(
      'payments',
      {
        order_id: order.id,
        provider: 'mercadopago',
        provider_payment_id: providerPaymentId,
        status: 'approved',
        method: 'card',
        amount_cents: 9_000,
        currency: 'BRL',
        raw_status: 'approved',
        paid_at: new Date().toISOString(),
      },
      'payments_provider_payment_unique',
    );
    await insertPayment(order.id as string, {
      provider: 'fake',
      provider_payment_id: providerPaymentId,
      status: 'approved',
      paid_at: new Date().toISOString(),
      raw_status: 'approved',
    });

    const base = {
      order_id: order.id,
      provider: 'mercadopago',
      provider_payment_id: `pay-${unique()}`,
      status: 'pending',
      method: 'pix',
      amount_cents: 1_000,
      currency: 'BRL',
      raw_status: 'pending',
    };
    const invalid: [Row, string][] = [
      [{ ...base, status: 'expired' }, 'payments_status_valid'],
      [{ ...base, method: 'cash' }, 'payments_method_valid'],
      [{ ...base, currency: 'R$' }, 'payments_currency_format'],
      [{ ...base, amount_cents: -1 }, 'payments_amount_range'],
      [
        {
          ...base,
          status: 'charged_back',
          paid_at: new Date().toISOString(),
          refunded_cents: 1_001,
        },
        'payments_refunded_range',
      ],
      [
        {
          ...base,
          status: 'refunded',
          refunded_cents: 900,
          paid_at: new Date().toISOString(),
        },
        'payments_refunded_matches_status',
      ],
      [
        {
          ...base,
          status: 'partially_refunded',
          refunded_cents: 0,
          paid_at: new Date().toISOString(),
        },
        'payments_refunded_matches_status',
      ],
      [
        {
          ...base,
          status: 'partially_refunded',
          refunded_cents: 1_000,
          paid_at: new Date().toISOString(),
        },
        'payments_refunded_matches_status',
      ],
      [{ ...base, status: 'pending', refunded_cents: 100 }, 'payments_refunded_matches_status'],
      [
        { ...base, status: 'approved', paid_at: null, raw_status: 'approved' },
        'payments_paid_at_matches_status',
      ],
      [
        { ...base, status: 'pending', paid_at: new Date().toISOString() },
        'payments_paid_at_matches_status',
      ],
      [{ ...base, provider: 'none' }, 'payments_provider_valid'],
      [{ ...base, raw_status: '   ' }, 'payments_raw_status_format'],
      [{ ...base, provider_payment_id: 'x'.repeat(256) }, 'payments_provider_payment_id_format'],
    ];
    for (const [fields, constraint] of invalid) {
      await rejects('payments', fields, constraint);
    }
    await insertPayment(order.id as string, {
      status: 'partially_refunded',
      refunded_cents: 400,
      paid_at: new Date().toISOString(),
      raw_status: 'partially_refunded',
    });
    await insertPayment(order.id as string, {
      status: 'refunded',
      refunded_cents: 9_000,
      paid_at: new Date().toISOString(),
      raw_status: 'refunded',
    });
    await insertPayment(order.id as string, {
      status: 'charged_back',
      paid_at: new Date().toISOString(),
      raw_status: 'charged_back',
    });

    assert.ok((await countRows('payments', 'order_id = $1', [order.id])) > 0);
    await query('DELETE FROM orders WHERE id = $1', [order.id]);
    assert.equal(await countRows('payments', 'order_id = $1', [order.id]), 0);
  });

  test('reembolsos: cobrança, estados, valores e retry', async () => {
    const user = await insertUser();
    const order = await insertOrder(user);
    const payment = await insertPayment(order.id as string, {
      status: 'approved',
      paid_at: new Date().toISOString(),
      raw_status: 'approved',
    });

    const refund = await insertRefund(payment.id as string, user, { order_id: order.id });
    assert.equal(refund.status, 'requested');
    assert.deepEqual(refund.items, []);
    assert.equal(refund.provider_refund_id, null);
    assert.equal(refund.error, null);
    assert.equal(refund.done_at, null);

    const subscriptionPayment = await insertPayment(null, { subscription_id: randomUUID() });
    const subscriptionRefund = await insertRefund(subscriptionPayment.id as string, user);
    assert.equal(subscriptionRefund.order_id, null);

    await insertRefund(payment.id as string, user, {
      status: 'done',
      done_at: new Date().toISOString(),
      provider_refund_id: `refund-${unique()}`,
      items: JSON.stringify([{ orderItemId: randomUUID(), amountCents: 1_000 }]),
    });
    await insertRefund(payment.id as string, user, {
      status: 'failed',
      error: 'O provedor recusou o estorno',
    });

    const invalid: [Row, string][] = [
      [{ status: 'done' }, 'refunds_done_at_matches_status'],
      [
        { status: 'requested', done_at: new Date().toISOString() },
        'refunds_done_at_matches_status',
      ],
      [{ status: 'failed' }, 'refunds_error_matches_status'],
      [{ status: 'requested', error: 'Falha antiga' }, 'refunds_error_matches_status'],
      [{ status: 'pending' }, 'refunds_status_valid'],
      [{ amount_cents: 0 }, 'refunds_amount_positive'],
      [{ reason: '   ' }, 'refunds_reason_length'],
      [{ reason: 'a'.repeat(501) }, 'refunds_reason_length'],
      [{ items: JSON.stringify({}) }, 'refunds_items_array'],
      [{ provider_refund_id: '   ' }, 'refunds_provider_refund_id_format'],
      [{ payment_id: randomUUID() }, 'refunds_payment_id_fkey'],
      [{ requested_by: randomUUID() }, 'refunds_requested_by_fkey'],
    ];
    for (const [fields, constraint] of invalid) {
      await rejects(
        'refunds',
        {
          payment_id: payment.id,
          order_id: order.id,
          amount_cents: 1_000,
          reason: 'Solicitação do aluno',
          requested_by: user,
          ...fields,
        },
        constraint,
      );
    }

    assert.ok((await countRows('refunds', 'payment_id = $1', [payment.id])) >= 3);
    await query('DELETE FROM payments WHERE id = $1', [payment.id]);
    assert.equal(await countRows('refunds', 'payment_id = $1', [payment.id]), 0);
  });

  test('webhook: chave idempotente parcial e trilha de rejeição', async () => {
    const eventId = `evt-${unique()}`;
    const received = await insertWebhook({ event_id: eventId });
    assert.equal(received.status, 'received');
    assert.equal(received.attempts, 0);
    assert.equal(received.processed_at, null);
    assert.equal(received.error, null);
    assert.ok(received.received_at instanceof Date);

    await rejects(
      'webhook_events',
      { provider: 'mercadopago', event_id: eventId },
      'webhook_events_event_unique',
    );
    await insertWebhook({ provider: 'fake', event_id: eventId });

    // A rejeição não ocupa a chave: várias guardam o mesmo identificador e o evento válido
    // posterior é gravado e processado normalmente.
    const rejectedEventId = `evt-${unique()}`;
    const rejected = await insertWebhook({
      event_id: rejectedEventId,
      status: 'rejected',
      error: 'invalid_signature',
    });
    assert.equal(rejected.status, 'rejected');
    await insertWebhook({
      event_id: rejectedEventId,
      status: 'rejected',
      error: 'invalid_signature',
    });
    await insertWebhook({
      event_id: rejectedEventId,
      status: 'processed',
      processed_at: new Date().toISOString(),
    });
    // Rejeitada não aceita reprocessamento; o expurgo (DELETE) continua permitido.
    await assert.rejects(
      query(`UPDATE webhook_events SET status = 'processed' WHERE id = $1`, [rejected.id]),
      /rejected não aceita reprocessamento/,
    );
    await query('DELETE FROM webhook_events WHERE id = $1', [rejected.id]);

    await insertWebhook({ event_id: null });
    await insertWebhook({ event_id: null });

    await rejects(
      'webhook_events',
      { provider: 'mercadopago', event_id: `evt-${unique()}`, status: 'rejected', error: 'other' },
      'webhook_events_rejected_reason',
    );
    await rejects(
      'webhook_events',
      { provider: 'mercadopago', event_id: `evt-${unique()}`, status: 'rejected' },
      'webhook_events_error_matches_status',
    );
    await rejects(
      'webhook_events',
      {
        provider: 'mercadopago',
        event_id: `evt-${unique()}`,
        status: 'rejected',
        error: 'invalid_signature',
        attempts: 1,
      },
      'webhook_events_rejection_without_processing',
    );
    await rejects(
      'webhook_events',
      { provider: 'mercadopago', event_id: `evt-${unique()}`, status: 'processed' },
      'webhook_events_processed_at_matches_status',
    );
    await insertWebhook({
      event_id: `evt-${unique()}`,
      status: 'ignored',
      processed_at: new Date().toISOString(),
    });
    await rejects(
      'webhook_events',
      { provider: 'mercadopago', event_id: `evt-${unique()}`, status: 'failed' },
      'webhook_events_error_matches_status',
    );
    await insertWebhook({
      event_id: `evt-${unique()}`,
      status: 'failed',
      error: 'amount_mismatch',
    });
    await rejects(
      'webhook_events',
      {
        provider: 'mercadopago',
        event_id: `evt-${unique()}`,
        status: 'received',
        processed_at: new Date().toISOString(),
      },
      'webhook_events_processed_at_matches_status',
    );
    await rejects(
      'webhook_events',
      { provider: 'mercadopago', event_id: `evt-${unique()}`, status: 'done' },
      'webhook_events_status_valid',
    );
    await rejects(
      'webhook_events',
      { provider: 'mercadopago', event_id: `evt-${unique()}`, resource_type: 'invoice' },
      'webhook_events_resource_type_valid',
    );
    await rejects(
      'webhook_events',
      { provider: 'pagseguro', event_id: `evt-${unique()}` },
      'webhook_events_provider_valid',
    );
    await rejects(
      'webhook_events',
      { provider: 'mercadopago', event_id: '   ' },
      'webhook_events_event_id_format',
    );
    await rejects(
      'webhook_events',
      { provider: 'mercadopago', event_id: 'x'.repeat(256) },
      'webhook_events_event_id_format',
    );
    await rejects(
      'webhook_events',
      { provider: 'mercadopago', resource_id: '   ' },
      'webhook_events_resource_id_format',
    );
    await rejects(
      'webhook_events',
      { provider: 'mercadopago', attempts: -1 },
      'webhook_events_attempts_range',
    );
  });

  test('índices de expurgo, reconciliação, CSV e chaves únicas parciais', async () => {
    const { rows } = await query(
      `SELECT tablename, indexname, indexdef FROM pg_indexes
        WHERE tablename IN (
          'coupons', 'coupon_products', 'carts', 'cart_items', 'orders', 'order_items',
          'payments', 'refunds', 'webhook_events'
        )`,
    );
    const defs = new Map<string, string>(
      rows.map((row) => [`${row.tablename}.${row.indexname}`, row.indexdef as string]),
    );
    const def = (name: string) => defs.get(name) ?? '';

    assert.match(def('coupons.coupons_code_unique'), /UNIQUE INDEX .*\(lower\(code\)\)/);
    assert.match(
      def('coupon_products.coupon_products_product_idx'),
      /\(product_type, product_id\)/,
    );
    assert.match(def('carts.carts_updated_idx'), /\(updated_at\)/);
    assert.match(def('orders.orders_user_created_idx'), /\(user_id, created_at DESC, id DESC\)/);
    assert.match(def('orders.orders_status_created_idx'), /\(status, created_at DESC, id DESC\)/);
    assert.match(def('orders.orders_created_idx'), /\(created_at DESC, id DESC\)/);
    assert.match(def('orders.orders_coupon_idx'), /WHERE \(coupon_id IS NOT NULL\)/);
    assert.match(def('orders.orders_expires_idx'), /WHERE \(status = 'pending'::text\)/);
    assert.match(
      def('orders.orders_user_pending_idx'),
      /\(user_id\).*WHERE \(status = 'pending'::text\)/,
    );
    assert.match(def('orders.orders_buyer_name_trgm_idx'), /USING gin \(buyer_name gin_trgm_ops\)/);
    assert.match(
      def('order_items.order_items_product_idx'),
      /\(product_type, product_id, order_id\)/,
    );
    assert.match(
      def('payments.payments_provider_payment_unique'),
      /UNIQUE INDEX .*\(provider, provider_payment_id\)/,
    );
    assert.match(
      def('payments.payments_order_idx'),
      /\(order_id, created_at DESC\).*WHERE \(order_id IS NOT NULL\)/,
    );
    assert.match(
      def('payments.payments_subscription_idx'),
      /\(subscription_id, created_at DESC\).*WHERE \(subscription_id IS NOT NULL\)/,
    );
    assert.match(def('refunds.refunds_payment_idx'), /\(payment_id\)/);
    assert.match(def('refunds.refunds_order_idx'), /WHERE \(order_id IS NOT NULL\)/);
    assert.match(
      def('refunds.refunds_requested_updated_idx'),
      /\(updated_at\).*WHERE \(status = 'requested'::text\)/,
    );
    assert.match(
      def('webhook_events.webhook_events_event_unique'),
      /UNIQUE INDEX .*\(provider, event_id\).*WHERE .*event_id IS NOT NULL.*status <> 'rejected'::text/,
    );
    assert.match(
      def('webhook_events.webhook_events_status_received_idx'),
      /\(status, received_at DESC, id DESC\)/,
    );
    assert.match(def('webhook_events.webhook_events_received_idx'), /\(received_at\)/);

    const { rows: types } = await query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE (table_name, column_name) IN (
          ('orders', 'subtotal_cents'), ('orders', 'discount_cents'), ('orders', 'total_cents'),
          ('order_items', 'unit_price_cents'), ('order_items', 'paid_cents'),
          ('order_items', 'refunded_cents'), ('payments', 'amount_cents'),
          ('payments', 'refunded_cents'), ('refunds', 'amount_cents'),
          ('coupons', 'amount_off_cents')
        )`,
    );
    assert.equal(types.length, 10);
    for (const column of types) {
      assert.equal(column.data_type, 'bigint', `${column.table_name}.${column.column_name}`);
    }

    // Sem campos de nota fiscal (fora de escopo da 011), sem dado de cartão (013) e sem corpo,
    // cabeçalho ou assinatura do webhook (013).
    const { rows: forbidden } = await query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('orders', 'order_items', 'payments', 'refunds', 'webhook_events')
          AND (
            column_name ~ '^(invoice|nfe|nfse|fiscal)'
            OR column_name ~ '^(card|cvv|pan|security_code)'
            OR column_name IN ('body', 'raw_body', 'headers', 'signature')
          )`,
    );
    assert.deepEqual(forbidden, []);
  });
});
