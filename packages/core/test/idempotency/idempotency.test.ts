import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  canonicalJson,
  closeDatabase,
  createDatabase,
  type Database,
  IDEMPOTENCY_RETENTION_MS,
  IDEMPOTENCY_SCOPES,
  isProviderUnavailable,
  normalizeIdempotencyKey,
  requestFingerprint,
  runIdempotent,
  unavailable,
} from '../../src/index.ts';
import { expectError, makeUser, type TestUser } from '../sales/fixtures.ts';

// Chave, impressão digital e execução idempotente (spec 003, "Idempotência"; migration 0021).

const SCOPE = IDEMPOTENCY_SCOPES.orderCreate;
const KEY = 'chave-de-teste-0001';

let testDb: TestDatabase;
let db: Database;
let user: TestUser;

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
  user = await makeUser(db);
});

function syncError(run: () => unknown): Record<string, unknown> {
  try {
    run();
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error('Esperava um erro de domínio.');
}

async function keyRow(key = KEY) {
  return db
    .selectFrom('idempotencyKeys')
    .selectAll()
    .where('scope', '=', SCOPE)
    .where('userId', '=', user.id)
    .where('key', '=', key)
    .executeTakeFirst();
}

async function keyCount(): Promise<number> {
  const row = await db
    .selectFrom('idempotencyKeys')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('userId', '=', user.id)
    .executeTakeFirstOrThrow();
  return row.n;
}

describe('chave de idempotência', () => {
  it('aceita de 8 a 128 caracteres e trata ausência como sem idempotência', () => {
    expect(normalizeIdempotencyKey('12345678')).toBe('12345678');
    expect(normalizeIdempotencyKey('x'.repeat(128))).toBe('x'.repeat(128));
    expect(normalizeIdempotencyKey('order-123e4567-e89b-12d3-a456-426614174000')).toBe(
      'order-123e4567-e89b-12d3-a456-426614174000',
    );
    expect(normalizeIdempotencyKey(null)).toBeNull();
    expect(normalizeIdempotencyKey(undefined)).toBeNull();
  });

  it('recusa comprimento fora do contrato, espaço e controle com 400', () => {
    for (const invalid of ['1234567', 'x'.repeat(129), 'chave com espaço', 'chave\nquebrada']) {
      const error = syncError(() => normalizeIdempotencyKey(invalid));
      expect(error).toMatchObject({
        status: 400,
        code: 'validation_failed',
        errors: [{ path: 'header.idempotency-key' }],
      });
    }
  });
});

describe('impressão digital da requisição', () => {
  it('não depende da ordem das propriedades do corpo', () => {
    const first = requestFingerprint(SCOPE, 'alvo', { amountCents: 100, reason: 'motivo' });
    const second = requestFingerprint(SCOPE, 'alvo', { reason: 'motivo', amountCents: 100 });
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('muda com escopo, alvo ou corpo', () => {
    const base = requestFingerprint(SCOPE, 'alvo', { reason: 'a' });
    expect(requestFingerprint('refund.order', 'alvo', { reason: 'a' })).not.toBe(base);
    expect(requestFingerprint(SCOPE, 'outro', { reason: 'a' })).not.toBe(base);
    expect(requestFingerprint(SCOPE, 'alvo', { reason: 'b' })).not.toBe(base);
    expect(canonicalJson({ b: 1, a: [true, null] })).toBe('{"a":[true,null],"b":1}');
  });
});

describe('execução idempotente', () => {
  it('sem chave executa sempre e não grava nada', async () => {
    let calls = 0;
    const execute = async () => ({ execution: ++calls });
    const request = { scope: SCOPE, userId: user.id, key: null, requestHash: 'hash', status: 201 };

    const first = await runIdempotent(db, { ...request, execute });
    const second = await runIdempotent(db, { ...request, execute });
    expect(first).toMatchObject({ body: { execution: 1 }, status: 201, replayed: false });
    expect(second).toMatchObject({ body: { execution: 2 }, status: 201, replayed: false });
    expect(await keyCount()).toBe(0);
  });

  it('chave nova executa uma vez e grava status, corpo e conclusão', async () => {
    const now = new Date('2026-03-01T10:00:00.000Z');
    const createdAt = new Date('2026-03-01T09:00:00.000Z');
    let calls = 0;
    const execute = async () => ({ createdAt, execution: ++calls });
    const request = {
      scope: SCOPE,
      userId: user.id,
      key: KEY,
      requestHash: 'hash',
      status: 201,
      now,
    };

    const first = await runIdempotent(db, { ...request, execute });
    expect(first.replayed).toBe(false);
    const stored = await keyRow();
    expect(stored).toMatchObject({ responseStatus: 201, requestHash: 'hash' });
    expect(stored?.completedAt).toEqual(now);
    expect(stored?.responseBody).toEqual({
      createdAt: createdAt.toISOString(),
      execution: 1,
    });

    const replay = await runIdempotent(db, { ...request, execute });
    expect(replay).toMatchObject({ status: 201, replayed: true });
    expect(replay.body.createdAt).toBeInstanceOf(Date);
    expect(replay.body).toEqual(first.body);
    expect(calls).toBe(1);
  });

  it('mesma chave com hash diferente responde 422 idempotency_key_reuse', async () => {
    const request = {
      scope: SCOPE,
      userId: user.id,
      key: KEY,
      requestHash: 'hash-a',
      status: 201,
      execute: async () => ({ ok: true }),
    };
    await runIdempotent(db, request);
    await expectError(
      runIdempotent(db, { ...request, requestHash: 'hash-b' }),
      422,
      'idempotency_key_reuse',
    );
    expect((await keyRow())?.requestHash).toBe('hash-a');
  });

  it('chave com mais de 24 h pode ser usada de novo', async () => {
    let calls = 0;
    const request = {
      scope: SCOPE,
      userId: user.id,
      key: KEY,
      requestHash: 'hash-a',
      status: 201,
      execute: async () => ({ execution: ++calls }),
    };
    await runIdempotent(db, request);
    const before = await keyRow();
    expect(before).toBeDefined();

    // A retenção apaga a linha depois de 24 h; enquanto ela existir, a leitura a trata como
    // expirada e a chave vale de novo — mesmo com outra requisição.
    await db
      .updateTable('idempotencyKeys')
      .set({ createdAt: new Date(Date.now() - IDEMPOTENCY_RETENTION_MS - 60_000) })
      .where('key', '=', KEY)
      .where('userId', '=', user.id)
      .execute();

    const reused = await runIdempotent(db, { ...request, requestHash: 'hash-b' });
    expect(reused).toMatchObject({ body: { execution: 2 }, replayed: false });
    const after = await keyRow();
    expect(after?.requestHash).toBe('hash-b');
    expect(after?.createdAt.getTime()).toBeGreaterThan(before?.createdAt.getTime() ?? 0);
  });

  it('reserva sem resposta é tratada como expirada e executada de novo', async () => {
    // Linha commitada sem resposta: o efeito de uma versão anterior não chegou a terminar.
    await db
      .insertInto('idempotencyKeys')
      .values({
        key: KEY,
        scope: SCOPE,
        userId: user.id,
        requestHash: 'hash-a',
        createdAt: new Date(),
      })
      .execute();
    let calls = 0;
    const outcome = await runIdempotent(db, {
      scope: SCOPE,
      userId: user.id,
      key: KEY,
      requestHash: 'hash-b',
      status: 202,
      execute: async () => ({ execution: ++calls }),
    });
    expect(outcome).toMatchObject({ body: { execution: 1 }, status: 202, replayed: false });
    const stored = await keyRow();
    expect(stored).toMatchObject({ responseStatus: 202, requestHash: 'hash-b' });
  });

  it('duas execuções concorrentes com a mesma chave executam uma vez', async () => {
    let calls = 0;
    const request = {
      scope: SCOPE,
      userId: user.id,
      key: KEY,
      requestHash: 'hash',
      status: 201,
      execute: async () => {
        const execution = ++calls;
        // Segura a transação para a segunda requisição encontrar a reserva em andamento.
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { execution };
      },
    };
    const results = await Promise.all([runIdempotent(db, request), runIdempotent(db, request)]);
    expect(calls).toBe(1);
    expect(results.map((result) => result.body)).toEqual([{ execution: 1 }, { execution: 1 }]);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(await keyCount()).toBe(1);
  });

  it('erro liberado preserva o efeito e apaga a reserva', async () => {
    const failure = unavailable('payment_provider_unavailable', 'Provedor fora.');
    const error = await expectError(
      runIdempotent(db, {
        scope: SCOPE,
        userId: user.id,
        key: KEY,
        requestHash: 'hash',
        status: 201,
        releaseOn: isProviderUnavailable,
        execute: async (trx) => {
          await trx
            .updateTable('users')
            .set({ name: 'Efeito preservado' })
            .where('id', '=', user.id)
            .execute();
          throw failure;
        },
      }),
      503,
      'payment_provider_unavailable',
    );
    expect(error).toBe(failure);
    const stored = await db
      .selectFrom('users')
      .select('name')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(stored.name).toBe('Efeito preservado');
    expect(await keyCount()).toBe(0);
  });

  it('erro não liberado desfaz o efeito e a reserva', async () => {
    const error = await runIdempotent(db, {
      scope: SCOPE,
      userId: user.id,
      key: KEY,
      requestHash: 'hash',
      status: 201,
      releaseOn: isProviderUnavailable,
      execute: async (trx) => {
        await trx
          .updateTable('users')
          .set({ name: 'Efeito desfeito' })
          .where('id', '=', user.id)
          .execute();
        throw new Error('falha inesperada');
      },
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    const stored = await db
      .selectFrom('users')
      .select('name')
      .where('id', '=', user.id)
      .executeTakeFirstOrThrow();
    expect(stored.name).not.toBe('Efeito desfeito');
    expect(await keyCount()).toBe(0);
  });
});
