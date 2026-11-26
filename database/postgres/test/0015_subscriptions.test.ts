import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { defaultMigrationsDir } from '../src/config.ts';
import { migrateDown, migrateUp } from '../src/migrator.ts';
import { createScratchDatabase, type Scratch, tableExists, unique } from './helpers.ts';

const dir = defaultMigrationsDir;

type Row = Record<string, unknown>;

describe('0015: assinaturas', () => {
  let db: Scratch;

  before(async () => {
    db = await createScratchDatabase();
    await migrateUp(db.client, { dir, to: 15 });
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

  async function insertUser(): Promise<string> {
    const user = await insertRow('users', {
      email: `assinatura-${unique()}@example.com`,
      name: 'Pessoa',
    });
    return user.id as string;
  }

  async function insertPlan(overrides: Row = {}): Promise<Row> {
    const suffix = unique();
    return insertRow('plans', {
      slug: `plano-${suffix}`,
      group_key: `grupo-${suffix}`,
      title: 'Plano mensal',
      interval: 'month',
      price_cents: 4_900,
      ...overrides,
    });
  }

  async function insertSubscription(
    userId: string,
    planId: string,
    overrides: Row = {},
  ): Promise<Row> {
    return insertRow('subscriptions', {
      user_id: userId,
      plan_id: planId,
      price_cents: 4_900,
      currency: 'BRL',
      provider: 'fake',
      ...overrides,
    });
  }

  /** Assinatura com usuário e plano novos, para os casos de estado. */
  async function insertFreshSubscription(overrides: Row = {}): Promise<Row> {
    return insertSubscription(await insertUser(), (await insertPlan()).id as string, overrides);
  }

  async function insertOrder(userId: string): Promise<Row> {
    return insertRow('orders', {
      user_id: userId,
      status: 'paid',
      subtotal_cents: 10_000,
      discount_cents: 0,
      total_cents: 10_000,
      currency: 'BRL',
      buyer_name: 'Ana Souza',
      buyer_tax_id_type: 'cpf',
      buyer_tax_id: '12345678901',
      provider: 'fake',
      paid_at: new Date().toISOString(),
    });
  }

  async function insertPayment(owner: Row, overrides: Row = {}): Promise<Row> {
    return insertRow('payments', {
      ...owner,
      provider: 'fake',
      provider_payment_id: `pay-${unique()}`,
      status: 'pending',
      method: 'card',
      amount_cents: 4_900,
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

  async function countRows(table: string, where = 'true', values: unknown[] = []): Promise<number> {
    const { rows } = await query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, values);
    return rows[0].n as number;
  }

  async function foreignKeyDeleteAction(table: string, constraint: string): Promise<string> {
    const { rows } = await query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conname = $1 AND conrelid = $2::regclass`,
      [constraint, table],
    );
    return rows[0]?.confdeltype as string;
  }

  test('down e up da 0015 removem e recriam tabelas, chave e gatilho', async () => {
    const tables = ['plans', 'plan_items', 'subscriptions'];
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), true, table);
    }
    assert.equal(await foreignKeyDeleteAction('payments', 'payments_subscription_id_fkey'), 'c');
    assert.equal(await foreignKeyDeleteAction('subscriptions', 'subscriptions_plan_id_fkey'), 'a');
    assert.equal(await foreignKeyDeleteAction('subscriptions', 'subscriptions_user_id_fkey'), 'a');

    await migrateDown(db.client, { dir });
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), false, table);
    }
    assert.equal(await tableExists(db.client, 'payments'), true);
    assert.equal(await tableExists(db.client, 'refunds'), true);
    const { rows: fk } = await query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'payments_subscription_id_fkey'`,
    );
    assert.deepEqual(fk, []);
    const { rows: fn } = await query(
      `SELECT 1 FROM pg_proc WHERE proname = 'refunds_payment_owner'`,
    );
    assert.deepEqual(fn, []);

    await migrateUp(db.client, { dir, to: 15 });
    for (const table of tables) {
      assert.equal(await tableExists(db.client, table), true, table);
    }
    assert.equal(await foreignKeyDeleteAction('payments', 'payments_subscription_id_fkey'), 'c');
  });

  test('planos: padrões, UUID v7, slug, grupo, periodicidade e vitrine', async () => {
    const plan = await insertPlan();
    assert.equal(plan.interval, 'month');
    assert.equal(Number(plan.price_cents), 4_900);
    assert.equal(plan.includes_all, false);
    assert.equal(plan.includes_private, false);
    assert.equal(plan.active, true);
    assert.equal(plan.position, 0);
    assert.equal(plan.provider_plan_id, null);
    assert.equal(plan.description, null);
    assert.ok(plan.created_at instanceof Date);
    const { rows: version } = await query('SELECT uuid_extract_version($1::uuid) AS v', [plan.id]);
    assert.equal(version[0].v, 7);

    const group = `grupo-${unique()}`;
    await insertPlan({ group_key: group, interval: 'month' });
    await insertPlan({ group_key: group, interval: 'year' });
    await rejects(
      'plans',
      {
        slug: `plano-${unique()}`,
        group_key: group,
        title: 'Outro mensal do mesmo grupo',
        interval: 'month',
        price_cents: 1_000,
      },
      'plans_group_interval_unique',
    );

    /** Linha válida com slug e grupo novos, para isolar a restrição testada. */
    const freshPlan = (overrides: Row = {}): Row => ({
      slug: `plano-${unique()}`,
      group_key: `grupo-${unique()}`,
      title: 'Plano',
      interval: 'month',
      price_cents: 4_900,
      ...overrides,
    });

    await rejects('plans', freshPlan({ slug: plan.slug }), 'plans_slug_unique');
    for (const slug of ['Plano', 'plano_com_underscore', 'a--b', 'x'.repeat(161)]) {
      await rejects('plans', freshPlan({ slug }), 'plans_slug_format');
    }
    for (const groupKey of ['Grupo', 'grupo_com_underscore', '', 'x'.repeat(161)]) {
      await rejects('plans', freshPlan({ group_key: groupKey }), 'plans_group_key_format');
    }
    await rejects('plans', freshPlan({ title: '   ' }), 'plans_title_length');
    await rejects('plans', freshPlan({ title: 'a'.repeat(161) }), 'plans_title_length');
    await rejects(
      'plans',
      freshPlan({ description: 'a'.repeat(20_001) }),
      'plans_description_length',
    );
    await rejects('plans', freshPlan({ interval: 'week' }), 'plans_interval_valid');
    await rejects('plans', freshPlan({ price_cents: 0 }), 'plans_price_positive');
    await rejects('plans', freshPlan({ price_cents: -1 }), 'plans_price_positive');
    await rejects(
      'plans',
      freshPlan({ includes_private: true }),
      'plans_includes_private_requires_all',
    );
    await insertPlan({ includes_all: true, includes_private: true });
    await rejects('plans', freshPlan({ position: -1 }), 'plans_position_range');

    const providerPlanId = `fake_plan_${unique()}`;
    await insertPlan({ provider_plan_id: providerPlanId });
    await rejects(
      'plans',
      freshPlan({ provider_plan_id: providerPlanId }),
      'plans_provider_plan_unique',
    );
    await rejects('plans', freshPlan({ provider_plan_id: '   ' }), 'plans_provider_plan_id_format');

    await query(`UPDATE plans SET updated_at = now() - interval '1 day' WHERE id = $1`, [plan.id]);
    const { rows: fresh } = await query(
      "SELECT updated_at > now() - interval '1 minute' AS fresh FROM plans WHERE id = $1",
      [plan.id],
    );
    assert.equal(fresh[0].fresh, true);
  });

  test('itens do plano: chave, tipo, produto sem chave e cascata', async () => {
    const plan = await insertPlan();
    const item = {
      plan_id: plan.id,
      product_type: 'course',
      product_id: randomUUID(),
    };
    await insertRow('plan_items', item);
    await insertRow('plan_items', {
      plan_id: plan.id,
      product_type: 'ebook',
      product_id: randomUUID(),
    });
    await insertRow('plan_items', {
      plan_id: plan.id,
      product_type: 'bundle',
      product_id: randomUUID(),
    });
    await rejects('plan_items', item, 'plan_items_pkey');
    await rejects(
      'plan_items',
      { plan_id: plan.id, product_type: 'lesson', product_id: randomUUID() },
      'plan_items_product_type_valid',
    );
    // product_id é polimórfico: sem chave estrangeira, como em coupon_products e entitlements.
    await insertRow('plan_items', {
      plan_id: plan.id,
      product_type: 'course',
      product_id: randomUUID(),
    });
    await rejects(
      'plan_items',
      { plan_id: randomUUID(), product_type: 'course', product_id: randomUUID() },
      'plan_items_plan_id_fkey',
    );

    assert.equal(await countRows('plan_items', 'plan_id = $1', [plan.id]), 4);
    await query('DELETE FROM plans WHERE id = $1', [plan.id]);
    assert.equal(await countRows('plan_items', 'plan_id = $1', [plan.id]), 0);
  });

  test('assinatura: preço congelado, padrões, moeda, provedor e vínculos', async () => {
    const user = await insertUser();
    const plan = await insertPlan();
    const subscription = await insertSubscription(user, plan.id as string);
    assert.equal(subscription.status, 'pending');
    assert.equal(Number(subscription.price_cents), 4_900);
    assert.equal(subscription.currency, 'BRL');
    assert.equal(subscription.coupon_id, null);
    assert.equal(subscription.provider, 'fake');
    assert.equal(subscription.provider_subscription_id, null);
    assert.equal(subscription.current_period_start, null);
    assert.equal(subscription.current_period_end, null);
    assert.equal(subscription.grace_until, null);
    assert.equal(subscription.canceled_at, null);
    assert.equal(subscription.cancel_reason, null);
    assert.equal(subscription.ended_at, null);
    assert.ok(subscription.created_at instanceof Date);
    const { rows: version } = await query('SELECT uuid_extract_version($1::uuid) AS v', [
      subscription.id,
    ]);
    assert.equal(version[0].v, 7);

    // Mudar o preço do plano não muda o que a assinatura contratou.
    await query('UPDATE plans SET price_cents = 9_900 WHERE id = $1', [plan.id]);
    const { rows: frozen } = await query('SELECT price_cents FROM subscriptions WHERE id = $1', [
      subscription.id,
    ]);
    assert.equal(Number(frozen[0].price_cents), 4_900);

    const base = {
      user_id: await insertUser(),
      plan_id: (await insertPlan()).id,
      price_cents: 4_900,
      currency: 'BRL',
      provider: 'fake',
    };
    await rejects('subscriptions', { ...base, price_cents: 0 }, 'subscriptions_price_positive');
    await rejects('subscriptions', { ...base, price_cents: -1 }, 'subscriptions_price_positive');
    await rejects('subscriptions', { ...base, currency: 'brl' }, 'subscriptions_currency_format');
    await rejects(
      'subscriptions',
      { ...base, provider: 'pagseguro' },
      'subscriptions_provider_valid',
    );
    await rejects(
      'subscriptions',
      { ...base, provider_subscription_id: '   ' },
      'subscriptions_provider_subscription_id_format',
    );
    await rejects(
      'subscriptions',
      { ...base, provider_subscription_id: 'x'.repeat(256) },
      'subscriptions_provider_subscription_id_format',
    );
    await rejects(
      'subscriptions',
      { ...base, plan_id: randomUUID() },
      'subscriptions_plan_id_fkey',
    );
    await rejects(
      'subscriptions',
      { ...base, user_id: randomUUID() },
      'subscriptions_user_id_fkey',
    );

    // Plano com assinaturas não é excluído, só desativado (chave sem cascata).
    await assert.rejects(query('DELETE FROM plans WHERE id = $1', [plan.id]), /foreign key/);

    // coupon_id vira nulo se o cupom for apagado, como em orders.
    const coupon = await insertRow('coupons', {
      code: `CUPOM-${unique().toUpperCase()}`,
      kind: 'percent',
      percent_off: 100,
      applies_to: 'subscriptions',
      created_by: await insertUser(),
    });
    const withCoupon = await insertSubscription(
      await insertUser(),
      (await insertPlan()).id as string,
      { coupon_id: coupon.id },
    );
    await query('DELETE FROM coupons WHERE id = $1', [coupon.id]);
    const { rows: kept } = await query('SELECT coupon_id FROM subscriptions WHERE id = $1', [
      withCoupon.id,
    ]);
    assert.equal(kept[0].coupon_id, null);
  });

  test('assinatura: estados, períodos, carência e cancelamento', async () => {
    const period = {
      current_period_start: new Date(Date.now() - 86_400_000).toISOString(),
      current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    };

    const active = await insertFreshSubscription({ status: 'active', ...period });
    assert.equal(active.status, 'active');
    const pastDue = await insertFreshSubscription({
      status: 'past_due',
      ...period,
      grace_until: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    });
    assert.equal(pastDue.status, 'past_due');
    await insertFreshSubscription({
      status: 'suspended',
      ...period,
      grace_until: new Date(Date.now() - 86_400_000).toISOString(),
    });
    await insertFreshSubscription({
      status: 'canceling',
      ...period,
      canceled_at: new Date().toISOString(),
      cancel_reason: 'Solicitado pelo aluno',
    });
    const ended = await insertFreshSubscription({
      status: 'ended',
      ...period,
      ended_at: new Date().toISOString(),
    });
    assert.equal(ended.status, 'ended');
    await insertFreshSubscription({ status: 'expired' });

    await rejects(
      'subscriptions',
      {
        user_id: await insertUser(),
        plan_id: (await insertPlan()).id,
        status: 'active',
        price_cents: 4_900,
        currency: 'BRL',
        provider: 'fake',
      },
      'subscriptions_period_required',
    );
    await rejects(
      'subscriptions',
      {
        user_id: await insertUser(),
        plan_id: (await insertPlan()).id,
        status: 'paid',
        price_cents: 4_900,
        currency: 'BRL',
        provider: 'fake',
      },
      'subscriptions_status_valid',
    );

    const fresh = async (overrides: Row) => ({
      user_id: await insertUser(),
      plan_id: (await insertPlan()).id,
      price_cents: 4_900,
      currency: 'BRL',
      provider: 'fake',
      ...overrides,
    });

    await rejects(
      'subscriptions',
      await fresh({ current_period_start: period.current_period_start }),
      'subscriptions_period_pair',
    );
    await rejects(
      'subscriptions',
      await fresh({
        current_period_start: period.current_period_end,
        current_period_end: period.current_period_start,
      }),
      'subscriptions_period_order',
    );
    await rejects(
      'subscriptions',
      await fresh({
        current_period_start: period.current_period_start,
        current_period_end: period.current_period_start,
      }),
      'subscriptions_period_order',
    );
    await rejects(
      'subscriptions',
      {
        user_id: await insertUser(),
        plan_id: (await insertPlan()).id,
        status: 'past_due',
        price_cents: 4_900,
        currency: 'BRL',
        provider: 'fake',
        ...period,
      },
      'subscriptions_grace_required',
    );
    await rejects(
      'subscriptions',
      {
        user_id: await insertUser(),
        plan_id: (await insertPlan()).id,
        status: 'suspended',
        price_cents: 4_900,
        currency: 'BRL',
        provider: 'fake',
        ...period,
      },
      'subscriptions_grace_required',
    );
    await rejects(
      'subscriptions',
      await fresh({ status: 'canceling', ...period }),
      'subscriptions_canceling_requires_cancel',
    );
    await rejects(
      'subscriptions',
      await fresh({ ...period, canceled_at: new Date().toISOString() }),
      'subscriptions_canceled_together',
    );
    await rejects(
      'subscriptions',
      await fresh({ ...period, cancel_reason: 'Motivo sem data' }),
      'subscriptions_canceled_together',
    );
    await rejects(
      'subscriptions',
      await fresh({
        ...period,
        canceled_at: new Date().toISOString(),
        cancel_reason: '   ',
      }),
      'subscriptions_cancel_reason_length',
    );
    await rejects(
      'subscriptions',
      await fresh({
        ...period,
        canceled_at: new Date().toISOString(),
        cancel_reason: 'a'.repeat(201),
      }),
      'subscriptions_cancel_reason_length',
    );
    await rejects(
      'subscriptions',
      await fresh({ status: 'ended', ...period }),
      'subscriptions_ended_at_matches_status',
    );
    await rejects(
      'subscriptions',
      await fresh({ status: 'expired', ended_at: new Date().toISOString() }),
      'subscriptions_ended_at_matches_status',
    );
    await rejects(
      'subscriptions',
      await fresh({ ...period, ended_at: new Date().toISOString() }),
      'subscriptions_ended_at_matches_status',
    );

    await query(`UPDATE subscriptions SET updated_at = now() - interval '1 day' WHERE id = $1`, [
      active.id,
    ]);
    const { rows: freshRow } = await query(
      "SELECT updated_at > now() - interval '1 minute' AS fresh FROM subscriptions WHERE id = $1",
      [active.id],
    );
    assert.equal(freshRow[0].fresh, true);
  });

  test('assinar duas vezes o mesmo plano: recusa, canceling e encerrada liberam', async () => {
    const user = await insertUser();
    const plan = await insertPlan();
    const first = await insertSubscription(user, plan.id as string);
    await rejects(
      'subscriptions',
      {
        user_id: user,
        plan_id: plan.id,
        price_cents: 4_900,
        currency: 'BRL',
        provider: 'fake',
      },
      'subscriptions_user_plan_open_unique',
    );

    // Mesmo aluno, outro plano: pode.
    await insertSubscription(user, (await insertPlan()).id as string);

    // Cancelada com o período em curso: o aluno assina o mesmo plano de novo (spec 012).
    await query(
      `UPDATE subscriptions
          SET status = 'canceling',
              current_period_start = now() - interval '1 day',
              current_period_end = now() + interval '29 days',
              canceled_at = now(),
              cancel_reason = 'Pedido do aluno'
        WHERE id = $1`,
      [first.id],
    );
    const second = await insertSubscription(user, plan.id as string);
    assert.equal(second.status, 'pending');

    // Ativa ou em carência ocupa a vaga; encerrada libera.
    await query(
      `UPDATE subscriptions SET status = 'active',
      current_period_start = now(), current_period_end = now() + interval '30 days'
      WHERE id = $1`,
      [second.id],
    );
    await rejects(
      'subscriptions',
      {
        user_id: user,
        plan_id: plan.id,
        price_cents: 4_900,
        currency: 'BRL',
        provider: 'fake',
      },
      'subscriptions_user_plan_open_unique',
    );
    await query(
      `UPDATE subscriptions
          SET status = 'ended', ended_at = now(),
              current_period_start = now() - interval '30 days',
              current_period_end = now()
        WHERE id = $1`,
      [second.id],
    );
    await insertSubscription(user, plan.id as string);

    // O identificador da adesão é único por provedor, como o pagamento.
    const providerSubscriptionId = `preapproval-${unique()}`;
    await insertSubscription(await insertUser(), (await insertPlan()).id as string, {
      provider_subscription_id: providerSubscriptionId,
    });
    await rejects(
      'subscriptions',
      {
        user_id: await insertUser(),
        plan_id: (await insertPlan()).id,
        price_cents: 4_900,
        currency: 'BRL',
        provider: 'fake',
        provider_subscription_id: providerSubscriptionId,
      },
      'subscriptions_provider_subscription_unique',
    );
    await insertSubscription(await insertUser(), (await insertPlan()).id as string, {
      provider: 'mercadopago',
      provider_subscription_id: providerSubscriptionId,
    });
  });

  test('cobrança recorrente em payments e reembolsos sem pedido', async () => {
    const user = await insertUser();
    const plan = await insertPlan();
    const subscription = await insertSubscription(user, plan.id as string);

    const payment = await insertPayment({ subscription_id: subscription.id });
    assert.equal(payment.order_id, null);
    assert.equal(payment.subscription_id, subscription.id);
    await rejects(
      'payments',
      {
        subscription_id: randomUUID(),
        provider: 'fake',
        provider_payment_id: `pay-${unique()}`,
        status: 'pending',
        method: 'card',
        amount_cents: 4_900,
        currency: 'BRL',
        raw_status: 'pending',
      },
      'payments_subscription_id_fkey',
    );

    // Reembolso da cobrança recorrente: order_id nulo.
    const refund = await insertRefund(payment.id as string, user);
    assert.equal(refund.order_id, null);
    await assert.rejects(
      insertRefund(payment.id as string, user, { order_id: (await insertOrder(user)).id }),
      /reembolso de cobrança recorrente não tem pedido/,
    );

    // Reembolso de pedido: order_id precisa ser o do pagamento.
    const order = await insertOrder(user);
    const orderPayment = await insertPayment({ order_id: order.id });
    const orderRefund = await insertRefund(orderPayment.id as string, user, {
      order_id: order.id,
    });
    assert.equal(orderRefund.order_id, order.id);
    await assert.rejects(
      insertRefund(orderPayment.id as string, user),
      /reembolso de pedido precisa apontar para o pedido do pagamento/,
    );
    await assert.rejects(
      insertRefund(orderPayment.id as string, user, {
        order_id: (await insertOrder(user)).id,
      }),
      /reembolso de pedido precisa apontar para o pedido do pagamento/,
    );
    await assert.rejects(
      query('UPDATE refunds SET order_id = $1 WHERE id = $2', [order.id, refund.id]),
      /reembolso de cobrança recorrente não tem pedido/,
    );

    // Apagar a assinatura leva as cobranças (cascata), como em pedidos.
    assert.ok((await countRows('payments', 'subscription_id = $1', [subscription.id])) > 0);
    await query('DELETE FROM subscriptions WHERE id = $1', [subscription.id]);
    assert.equal(await countRows('payments', 'subscription_id = $1', [subscription.id]), 0);
  });

  test('índices, tipos e ausência de dados sensíveis', async () => {
    const { rows } = await query(
      `SELECT tablename, indexname, indexdef FROM pg_indexes
        WHERE tablename IN ('plans', 'plan_items', 'subscriptions')`,
    );
    const defs = new Map<string, string>(
      rows.map((row) => [`${row.tablename}.${row.indexname}`, row.indexdef as string]),
    );
    const def = (name: string) => defs.get(name) ?? '';

    assert.match(def('plans.plans_provider_plan_unique'), /UNIQUE INDEX .*\(provider_plan_id\)/);
    assert.match(def('plans.plans_provider_plan_unique'), /WHERE \(provider_plan_id IS NOT NULL\)/);
    assert.match(def('plans.plans_active_position_idx'), /\("position", id\).*WHERE active/);
    assert.match(def('plan_items.plan_items_product_idx'), /\(product_type, product_id\)/);
    assert.match(
      def('subscriptions.subscriptions_provider_subscription_unique'),
      /UNIQUE INDEX .*\(provider, provider_subscription_id\).*WHERE \(provider_subscription_id IS NOT NULL\)/,
    );
    assert.match(
      def('subscriptions.subscriptions_user_created_idx'),
      /\(user_id, created_at DESC, id DESC\)/,
    );
    assert.match(
      def('subscriptions.subscriptions_status_created_idx'),
      /\(status, created_at DESC, id DESC\)/,
    );
    assert.match(def('subscriptions.subscriptions_created_idx'), /\(created_at DESC, id DESC\)/);
    assert.match(def('subscriptions.subscriptions_plan_idx'), /\(plan_id\)/);
    assert.match(
      def('subscriptions.subscriptions_pending_created_idx'),
      /\(created_at\).*WHERE \(status = 'pending'::text\)/,
    );
    assert.match(
      def('subscriptions.subscriptions_grace_due_idx'),
      /\(grace_until\).*WHERE \(status = 'past_due'::text\)/,
    );
    assert.match(
      def('subscriptions.subscriptions_suspended_grace_idx'),
      /\(grace_until\).*WHERE \(status = 'suspended'::text\)/,
    );
    assert.match(
      def('subscriptions.subscriptions_user_plan_open_unique'),
      /UNIQUE INDEX .*\(user_id, plan_id\).*status = ANY/,
    );

    const { rows: types } = await query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE (table_name, column_name) IN (
          ('plans', 'price_cents'), ('subscriptions', 'price_cents')
        )`,
    );
    assert.equal(types.length, 2);
    for (const column of types) {
      assert.equal(column.data_type, 'bigint', `${column.table_name}.${column.column_name}`);
    }
    const { rows: timestamps } = await query(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name = 'subscriptions'
          AND column_name IN (
            'current_period_start', 'current_period_end', 'grace_until',
            'canceled_at', 'ended_at', 'created_at', 'updated_at'
          )`,
    );
    assert.equal(timestamps.length, 7);
    for (const column of timestamps) {
      assert.equal(
        column.data_type,
        'timestamp with time zone',
        `subscriptions.${column.column_name}`,
      );
    }

    // Sem dado de cartão, de nota fiscal ou segredo do provedor nas tabelas da assinatura.
    const { rows: forbidden } = await query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('plans', 'plan_items', 'subscriptions')
          AND (
            column_name ~ '^(invoice|nfe|nfse|fiscal)'
            OR column_name ~ '^(card|cvv|pan|security_code)'
            OR column_name IN ('access_token', 'webhook_secret')
          )`,
    );
    assert.deepEqual(forbidden, []);
  });
});
