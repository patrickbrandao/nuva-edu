import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  AUDIT_DELETED_USER_NAME,
  AUDIT_DETAILS_MAX_BYTES,
  AUDIT_REDACTED,
  type AuditContext,
  closeDatabase,
  createDatabase,
  type Database,
  getAuditEntry,
  isAuditSensitiveKey,
  isDomainError,
  limitAuditDetails,
  purgeAudit,
  recordAudit,
  recordDenied,
  redactAuditDetails,
  searchAuditLog,
} from '../src/index.ts';
import {
  buildAuditListQuery,
  listAuditLog,
  resolveAuditQuery,
} from '../src/modules/audit/query.ts';

const PASSWORD = 'Senha-Muito-Secreta-42';
const TOKEN = 'tok_9f8e7d6c5b4a';

let db: Database;
let admin: string;
let student: string;
let removed: string;

class Rollback extends Error {}

async function rolledBack(work: (trx: Database) => Promise<void>): Promise<void> {
  await expect(
    db.transaction().execute(async (trx) => {
      await work(trx);
      throw new Rollback();
    }),
  ).rejects.toBeInstanceOf(Rollback);
}

async function createUser(name: string, role = 'student', password: string | null = null) {
  const row = await db
    .insertInto('users')
    .values({ email: `${randomUUID()}@exemplo.test`, name, role, password })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

function adminContext(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    origin: 'admin_panel',
    actorUserId: admin,
    actorRole: 'admin',
    requestId: 'req-143',
    ip: '203.0.113.7',
    userAgent: 'vitest',
    ...overrides,
  };
}

beforeAll(async () => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 3 });
  admin = await createUser('Ada Admin', 'admin');
  student = await createUser('Bia Aluna', 'student', PASSWORD);
  removed = await createUser('Caio Removido');
  await db.updateTable('users').set({ deletedAt: new Date() }).where('id', '=', removed).execute();
});

afterAll(async () => {
  await closeDatabase(db);
});

describe('redação de details', () => {
  it('troca senha, token e segredo por "[alterado]" em qualquer profundidade', () => {
    const details = redactAuditDetails({
      before: { name: 'A', password: PASSWORD },
      after: {
        name: 'B',
        nested: [{ deep: { newPassword: PASSWORD, csrfToken: TOKEN, clientSecret: 'x' } }],
      },
      adminPassword: PASSWORD,
      currentPassword: PASSWORD,
      resetToken: TOKEN,
      secret: 's',
      apiKey: 'k',
      cpf: '123',
      empty: null,
    });
    const text = JSON.stringify(details);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(TOKEN);
    expect(details).toMatchObject({
      before: { name: 'A', password: AUDIT_REDACTED },
      after: {
        name: 'B',
        nested: [
          {
            deep: {
              newPassword: AUDIT_REDACTED,
              csrfToken: AUDIT_REDACTED,
              clientSecret: AUDIT_REDACTED,
            },
          },
        ],
      },
      adminPassword: AUDIT_REDACTED,
      currentPassword: AUDIT_REDACTED,
      resetToken: AUDIT_REDACTED,
      secret: AUDIT_REDACTED,
      apiKey: AUDIT_REDACTED,
      cpf: AUDIT_REDACTED,
      empty: null,
    });
  });

  it('cobre a lista da spec e a máscara do logger', () => {
    for (const key of [
      'password',
      'adminPassword',
      'token',
      'csrfToken',
      'secret',
      'oldPassword',
      'accessToken',
      'webhookSecret',
      'authorization',
      'mcp_key',
    ]) {
      expect(isAuditSensitiveKey(key), key).toBe(true);
    }
    expect(isAuditSensitiveKey('name')).toBe(false);
    expect(isAuditSensitiveKey('role')).toBe(false);
  });

  it('mascara credencial dentro de texto e converte para JSON puro', () => {
    const cycle: Record<string, unknown> = { a: 1 };
    cycle.self = cycle;
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 20; i += 1) {
      deep = { deep };
    }
    const details = redactAuditDetails({
      header: `Bearer ${TOKEN}`,
      url: `postgres://u:${PASSWORD}@db/x`,
      at: new Date('2026-01-02T03:04:05.000Z'),
      invalidDate: new Date('x'),
      big: 10n,
      inf: Number.POSITIVE_INFINITY,
      fn: () => 1,
      undef: undefined,
      list: new Set([1, undefined]),
      map: new Map([['token', TOKEN]]),
      bytes: new Uint8Array(3),
      cycle,
      deep,
    });
    const text = JSON.stringify(details);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(PASSWORD);
    expect(details).toMatchObject({
      at: '2026-01-02T03:04:05.000Z',
      invalidDate: null,
      big: '10',
      inf: 'Infinity',
      list: [1, null],
      map: { token: AUDIT_REDACTED },
      bytes: '[3 bytes]',
      cycle: { a: 1, self: '[circular]' },
    });
    expect(details).not.toHaveProperty('fn');
    expect(details).not.toHaveProperty('undef');
    expect(text).toContain('[profundidade excedida]');
  });

  it('valor que não é objeto vira { value }', () => {
    expect(redactAuditDetails('x')).toEqual({ value: 'x' });
    expect(redactAuditDetails(null)).toEqual({});
    expect(redactAuditDetails([1])).toEqual({ value: [1] });
  });

  it('nas ações de senha guarda só números e booleanos, qualquer que seja o nome', () => {
    const details = redactAuditDetails(
      {
        shown: PASSWORD,
        value: PASSWORD,
        nested: { a: PASSWORD },
        revealed: true,
        count: 1,
        n: null,
      },
      'user.password_view',
    );
    expect(details).toEqual({ revealed: true, count: 1, n: null });
  });
});

describe('limite de 8 KB', () => {
  it('mantém details pequeno como veio', () => {
    const details = { a: 1 };
    expect(limitAuditDetails(details)).toBe(details);
  });

  it('corta, marca truncated e nunca passa do limite', () => {
    const details = {
      small: 'ok',
      big: 'é'.repeat(10_000),
      nested: { more: 'x'.repeat(9_000) },
      after: 1,
    };
    const limited = limitAuditDetails(details);
    expect(Buffer.byteLength(JSON.stringify(limited))).toBeLessThanOrEqual(AUDIT_DETAILS_MAX_BYTES);
    expect(limited.truncated).toBe(true);
    expect(limited.originalBytes).toBe(Buffer.byteLength(JSON.stringify(details)));
    expect(limited.small).toBe('ok');
    expect(String(limited.big).endsWith('…')).toBe(true);
    expect(limited).not.toHaveProperty('nested');
  });

  it('para quando não cabe mais nada', () => {
    const details: Record<string, string> = { truncated: 'x' };
    for (let i = 0; i < 2_000; i += 1) {
      details[`campo_${i}`] = 'valor';
    }
    const limited = limitAuditDetails(details, 200);
    expect(Buffer.byteLength(JSON.stringify(limited))).toBeLessThanOrEqual(200);
    expect(limited.truncated).toBe(true);
    const tiny = limitAuditDetails({ text: 'x'.repeat(500) }, 40);
    expect(Buffer.byteLength(JSON.stringify(tiny))).toBeLessThanOrEqual(40);
  });
});

describe('gravação', () => {
  it('grava o contexto da requisição e o details redigido', async () => {
    const recorded = await recordAudit(db, {
      context: adminContext(),
      action: 'user.update',
      targetType: 'user',
      targetId: student,
      details: { before: { name: 'A' }, after: { name: 'B', password: PASSWORD } },
    });
    const row = await sql<{
      details: string;
      ip: string;
      outcome: string;
      requestId: string;
      userAgent: string;
      actorRole: string;
    }>`SELECT details::text AS details, host(ip) AS ip, outcome, request_id, user_agent, actor_role
       FROM audit_log WHERE id = ${recorded.id}`.execute(db);
    expect(row.rows[0]).toMatchObject({
      ip: '203.0.113.7',
      outcome: 'ok',
      // O CamelCasePlugin também converte o resultado do SQL cru.
      requestId: 'req-143',
      userAgent: 'vitest',
      actorRole: 'admin',
    });
    expect(row.rows[0]?.details).not.toContain(PASSWORD);
    expect(recorded.createdAt).toBeInstanceOf(Date);
  });

  it('ver a senha registra que viu, não o que viu', async () => {
    const shown = await db
      .selectFrom('users')
      .select('password')
      .where('id', '=', student)
      .executeTakeFirstOrThrow();
    const recorded = await recordAudit(db, {
      context: adminContext(),
      action: 'user.password_view',
      targetType: 'user',
      targetId: student,
      details: { password: shown.password, shown: shown.password, revealed: true },
    });
    const entry = await getAuditEntry(db, recorded.id);
    expect(entry).toMatchObject({
      action: 'user.password_view',
      actor: { id: admin, name: 'Ada Admin' },
      targetName: 'Bia Aluna',
      ip: '203.0.113.7',
      details: { revealed: true },
    });
    const leaks = await sql<{
      n: number;
    }>`SELECT count(*)::int AS n FROM audit_log
       WHERE position(${PASSWORD} IN details::text) > 0
          OR position(${PASSWORD} IN coalesce(user_agent, '')) > 0`.execute(db);
    expect(leaks.rows[0]?.n).toBe(0);
  });

  it('IP inválido vira nulo; textos longos são cortados', async () => {
    const recorded = await recordAudit(db, {
      context: { origin: 'worker', ip: 'não é ip', userAgent: 'u'.repeat(2_000), requestId: '' },
      action: 'auth.lockout',
    });
    const entry = await getAuditEntry(db, recorded.id);
    expect(entry.ip).toBeNull();
    expect(entry.userAgent).toHaveLength(1024);
    expect(entry.requestId).toBeNull();
    expect(entry.actor).toBeNull();
    expect(entry.details).toEqual({});
  });

  it('recusa entrada malformada antes de ir ao banco', async () => {
    const context = adminContext();
    await expect(recordAudit(db, { context, action: 'semponto' })).rejects.toThrow(TypeError);
    await expect(
      recordAudit(db, { context: { ...context, mcpKeyId: randomUUID() }, action: 'user.update' }),
    ).rejects.toThrow(TypeError);
    await expect(
      recordAudit(db, { context, action: 'user.update', targetId: 'x' }),
    ).rejects.toThrow(TypeError);
    await expect(
      recordAudit(db, { context: { origin: 'web' as never }, action: 'user.update' }),
    ).rejects.toThrow(TypeError);
    await expect(
      recordAudit(db, { context, action: 'user.update', outcome: 'talvez' as never }),
    ).rejects.toThrow(TypeError);
  });

  it('falha na gravação desfaz a ação (mesma transação)', async () => {
    const email = `${randomUUID()}@exemplo.test`;
    await expect(
      db.transaction().execute(async (trx) => {
        await trx.insertInto('users').values({ email, name: 'Desfeito' }).execute();
        // Ator inexistente: a chave estrangeira recusa o registro.
        await recordAudit(trx, {
          context: { origin: 'admin_panel', actorUserId: randomUUID() },
          action: 'user.create',
        });
      }),
    ).rejects.toThrow();
    const user = await db.selectFrom('users').select('id').where('email', '=', email).execute();
    expect(user).toEqual([]);
  });

  it('a recusa por permissão grava denied com a permissão em details', async () => {
    const manager = await createUser('Gil Gerente', 'manager');
    const recorded = await recordDenied(db, {
      context: { origin: 'admin_panel', actorUserId: manager, actorRole: 'manager' },
      permission: 'audit.view',
      details: { token: TOKEN },
    });
    const entry = await getAuditEntry(db, recorded.id);
    expect(entry).toMatchObject({
      action: 'audit.view',
      outcome: 'denied',
      details: { permission: 'audit.view', token: AUDIT_REDACTED },
    });
    const other = await recordDenied(db, {
      context: { origin: 'mcp', actorUserId: manager, mcpKeyId: randomUUID() },
      permission: 'users.password_view',
      action: 'user.password_view',
      targetType: 'user',
      targetId: student,
    });
    expect((await getAuditEntry(db, other.id)).action).toBe('user.password_view');
  });
});

describe('consulta', () => {
  it('filtra, traz nomes e "usuário removido", e pagina por cursor', async () => {
    const actor = await createUser('Duda Ator', 'admin');
    // Mesma transação: o mesmo created_at para todos, o desempate é o id.
    await db.transaction().execute(async (trx) => {
      for (let i = 0; i < 5; i += 1) {
        await recordAudit(trx, {
          context: adminContext({ actorUserId: actor }),
          action: i % 2 === 0 ? 'user.suspend' : 'course.update',
          targetType: i === 0 ? 'user' : 'course',
          targetId: i === 0 ? removed : randomUUID(),
        });
      }
    });
    const context = adminContext();
    const first = await searchAuditLog(db, context, { actorId: actor, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = await searchAuditLog(db, context, {
      actorId: actor,
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    const third = await searchAuditLog(db, context, {
      actorId: actor,
      limit: 2,
      cursor: second.nextCursor ?? undefined,
    });
    expect(third.items).toHaveLength(1);
    expect(third.nextCursor).toBeNull();
    const all = [...first.items, ...second.items, ...third.items];
    expect(new Set(all.map((item) => item.id)).size).toBe(5);
    expect(all.every((item) => item.actor?.name === 'Duda Ator')).toBe(true);
    expect(all.every((item) => !('details' in item))).toBe(true);

    const users = await searchAuditLog(db, context, { actorId: actor, action: 'user.*' });
    expect(users.items).toHaveLength(3);
    const removedTarget = users.items.find((item) => item.targetId === removed);
    expect(removedTarget?.targetName).toBe(AUDIT_DELETED_USER_NAME);
    const exact = await searchAuditLog(db, context, {
      actorId: actor,
      action: 'course.update',
      origin: 'admin_panel',
      outcome: 'ok',
    });
    expect(exact.items).toHaveLength(2);
    expect(exact.items[0]?.targetName).toBeNull();
    const byTarget = await searchAuditLog(db, context, { targetType: 'user', targetId: removed });
    expect(byTarget.items.map((item) => item.actor?.id)).toContain(actor);
    const none = await searchAuditLog(db, context, { actorId: actor, mcpKeyId: randomUUID() });
    expect(none.items).toEqual([]);
  });

  it('cada lista grava audit.search com os filtros', async () => {
    const searcher = await createUser('Eva Busca', 'admin');
    const context = adminContext({ actorUserId: searcher });
    const page = await searchAuditLog(db, context, { action: 'user.*', limit: 1 });
    await searchAuditLog(db, context, {
      action: 'user.*',
      limit: 1,
      cursor: page.nextCursor ?? undefined,
    });
    const searches = await db
      .selectFrom('auditLog')
      .select(['details', 'action'])
      .where('actorUserId', '=', searcher)
      .orderBy('id')
      .execute();
    expect(searches).toHaveLength(2);
    expect(searches[0]).toMatchObject({
      action: 'audit.search',
      details: { filters: { action: 'user.*', limit: 1 }, continued: false },
    });
    expect(searches[1]?.details).toMatchObject({ continued: true });

    // Dentro de uma transação aberta, usa a mesma.
    await db.transaction().execute(async (trx) => {
      await searchAuditLog(trx, context, {});
    });
    const count = await db
      .selectFrom('auditLog')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('actorUserId', '=', searcher)
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(3);
  });

  it('filtro inválido é 400 e não grava audit.search', async () => {
    const searcher = await createUser('Fábio Inválido', 'admin');
    const context = adminContext({ actorUserId: searcher });
    const now = new Date('2026-06-01T00:00:00Z');
    const cases = [
      { from: new Date('2025-01-01T00:00:00Z'), to: now },
      { from: now, to: now },
      { from: new Date('x') },
      { to: new Date('x') },
      { actorId: 'nao-uuid' },
      { mcpKeyId: 'x' },
      { action: 'User.*' },
      { targetType: '' },
      { targetId: 'x' },
      { targetType: 't'.repeat(65) },
      { origin: 'web' as never },
      { outcome: 'x' as never },
      { limit: 0 },
      { limit: 101 },
      { cursor: 'lixo' },
      { cursor: Buffer.from('a1:nao-uuid').toString('base64url') },
    ];
    for (const options of cases) {
      const error = await searchAuditLog(db, context, { now, ...options }).catch((e) => e);
      expect(isDomainError(error), JSON.stringify(options)).toBe(true);
      expect(error.code).toBe('validation_failed');
    }
    const rows = await db
      .selectFrom('auditLog')
      .select('id')
      .where('actorUserId', '=', searcher)
      .execute();
    expect(rows).toEqual([]);
  });

  it('o período padrão são os últimos 30 dias', () => {
    const now = new Date('2026-06-01T00:00:00Z');
    const query = resolveAuditQuery({ now });
    expect(query.to).toEqual(now);
    expect(query.from).toEqual(new Date('2026-05-02T00:00:00Z'));
    expect(query.limit).toBe(25);
  });

  it('prefixo escapa os curingas do LIKE', async () => {
    const query = resolveAuditQuery({ action: 'forum.category.*' });
    const compiled = buildAuditListQuery(db, query).compile();
    expect(compiled.sql).toContain('like');
    expect(compiled.parameters).toContain('forum.category.%');
    const underscore = buildAuditListQuery(
      db,
      resolveAuditQuery({ action: 'mcp_key.*' }),
    ).compile();
    expect(underscore.parameters).toContain('mcp\\_key.%');
  });

  it('registro inexistente ou id malformado é 404', async () => {
    for (const id of [randomUUID(), 'nao-uuid']) {
      const error = await getAuditEntry(db, id).catch((e) => e);
      expect(isDomainError(error) && error.code).toBe('not_found');
    }
  });
});

describe('índices', () => {
  it('a consulta de 30 dias não faz varredura sequencial', async () => {
    await rolledBack(async (trx) => {
      // Dois anos de registros, um a cada 17 minutos (~60 mil).
      await sql`
        INSERT INTO audit_log (created_at, origin, action, outcome, actor_user_id, target_type, target_id)
        SELECT now() - (i * interval '17 minutes'), 'admin_panel',
               (ARRAY['user.update','course.update','auth.login','order.refund'])[1 + i % 4],
               'ok', CASE WHEN i % 10 = 0 THEN ${admin}::uuid END,
               'course', (i % 500)::text
          FROM generate_series(1, 60000) AS i`.execute(trx);
      await sql`ANALYZE audit_log`.execute(trx);
      const variants = [
        {},
        { action: 'user.*' },
        { action: 'auth.login' },
        { actorId: admin },
        { targetType: 'course', targetId: '42' },
        { mcpKeyId: randomUUID() },
      ];
      for (const filters of variants) {
        const query = resolveAuditQuery(filters);
        const compiled = buildAuditListQuery(trx, query).compile();
        const plan = await trx.executeQuery({
          ...compiled,
          sql: `EXPLAIN (FORMAT JSON) ${compiled.sql}`,
        });
        const text = JSON.stringify(plan.rows);
        expect(text, JSON.stringify(filters)).not.toContain('Seq Scan');
        expect(text).toContain('Index');
      }
      // Paginação também usa índice.
      const page = await listAuditLog(trx, resolveAuditQuery({ limit: 5 }));
      expect(page.items).toHaveLength(5);
      const next = resolveAuditQuery({ cursor: page.nextCursor ?? undefined });
      const compiled = buildAuditListQuery(trx, next).compile();
      const plan = await trx.executeQuery({
        ...compiled,
        sql: `EXPLAIN (FORMAT JSON) ${compiled.sql}`,
      });
      expect(JSON.stringify(plan.rows)).not.toContain('Seq Scan');
    });
  });
});

describe('expurgo', () => {
  it('apaga o que passou do prazo e nada mais novo', async () => {
    await rolledBack(async (trx) => {
      const rows = await sql<{ id: string }>`
        INSERT INTO audit_log (created_at, origin, action, outcome)
        VALUES (now() - interval '800 days', 'worker', 'auth.login', 'ok'),
               (now() - interval '729 days', 'worker', 'auth.login', 'ok')
        RETURNING id`.execute(trx);
      const [old, recent] = rows.rows.map((row) => row.id);
      expect(await purgeAudit(trx)).toBeGreaterThanOrEqual(1);
      const left = await trx
        .selectFrom('auditLog')
        .select('id')
        .where('id', 'in', [old ?? '', recent ?? ''])
        .execute();
      expect(left.map((row) => row.id)).toEqual([recent]);
    });
  });

  it('recusa prazo abaixo de 365 dias', async () => {
    await expect(purgeAudit(db, 30)).rejects.toThrow(RangeError);
    await expect(purgeAudit(db, 400.5)).rejects.toThrow(RangeError);
    await expect(sql`SELECT audit_log_purge(30)`.execute(db)).rejects.toMatchObject({
      code: '22023',
    });
  });

  it('o banco recusa UPDATE e DELETE diretos', async () => {
    const recorded = await recordAudit(db, { context: adminContext(), action: 'user.update' });
    await expect(
      db
        .updateTable('auditLog')
        .set({ action: 'user.delete' })
        .where('id', '=', recorded.id)
        .execute(),
    ).rejects.toMatchObject({ code: 'P0001' });
    await expect(
      db.deleteFrom('auditLog').where('id', '=', recorded.id).execute(),
    ).rejects.toMatchObject({ code: 'P0001' });
  });
});
