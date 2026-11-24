import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  closeDatabase,
  consumeEmailToken,
  createDatabase,
  createLogger,
  type Database,
  EMAIL_TOKEN_TTL_MS,
  EMAIL_TYPES,
  EmailDataError,
  type EmailType,
  enqueueEmail,
  hashEmailToken,
  isDomainError,
  isEmailType,
  issueEmailToken,
  normalizeEmailData,
  parseEmailData,
  tokenExpired,
} from '../src/index.ts';

// Os outros arquivos de teste dividem o banco e mexem em `jobs`: tudo o que grava fila roda numa
// transação desfeita no fim, invisível a eles.

let db: Database;
const logLines: string[] = [];

beforeAll(() => {
  const logger = createLogger({
    service: 'worker',
    level: 'debug',
    write: (line) => logLines.push(line),
  });
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 4, logger });
});

afterAll(async () => {
  await closeDatabase(db);
});

class Rollback extends Error {}

/** Roda `fn` numa transação e a desfaz, devolvendo o que `fn` devolveu. */
async function inRollback<T>(fn: (trx: Database) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await db.transaction().execute(async (trx) => {
      result = await fn(trx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) {
      throw error;
    }
  }
  return result as T;
}

async function createUser(trx: Database, overrides: { deletedAt?: Date } = {}): Promise<string> {
  const row = await trx
    .insertInto('users')
    .values({
      email: `aluno-${crypto.randomUUID()}@example.com`,
      name: 'Aluno',
      ...overrides,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function rowsAsText(trx: Database, table: 'jobs' | 'email_outbox'): Promise<string> {
  const result = await sql<{ t: string }>`SELECT t::text AS t FROM ${sql.table(table)} t`.execute(
    trx,
  );
  return result.rows.map((row) => row.t).join('\n');
}

describe('tipos de e-mail', () => {
  it('cataloga os oito tipos da Fase 1 com o propósito do token', () => {
    expect(Object.keys(EMAIL_TYPES).sort()).toEqual([
      'account.exists',
      'account.locked',
      'account.new_login',
      'account.password_changed',
      'account.password_reset',
      'account.role_changed',
      'account.verify_email',
      'moderation.suspended',
    ]);
    expect(EMAIL_TYPES['account.verify_email'].tokenPurpose).toBe('verify');
    expect(EMAIL_TYPES['account.password_reset'].tokenPurpose).toBe('reset');
    expect(EMAIL_TYPES['moderation.suspended']).toEqual({
      group: 'moderation',
      tokenPurpose: null,
    });
    expect(isEmailType('account.exists')).toBe(true);
    expect(isEmailType('forum.reply')).toBe(false);
    expect(isEmailType('toString')).toBe(false);
  });

  it('converte datas para ISO e aceita os formatos de cada tipo', () => {
    const at = new Date('2026-11-24T12:00:00.000Z');
    expect(
      normalizeEmailData('account.new_login', {
        at,
        ip: '203.0.113.7',
        browser: null,
        os: 'Linux',
        site: 'admin',
      }),
    ).toEqual({
      at: '2026-11-24T12:00:00.000Z',
      ip: '203.0.113.7',
      browser: null,
      os: 'Linux',
      site: 'admin',
    });
    expect(normalizeEmailData('account.locked', { until: '2026-11-24T12:15:00Z' })).toEqual({
      until: '2026-11-24T12:15:00Z',
    });
    expect(normalizeEmailData('moderation.suspended', { kind: 'full', endsAt: null })).toEqual({
      kind: 'full',
      endsAt: null,
    });
    expect(normalizeEmailData('account.password_changed', { by: 'admin' })).toEqual({
      by: 'admin',
    });
    expect(normalizeEmailData('account.role_changed', { role: 'manager' })).toEqual({
      role: 'manager',
    });
    expect(normalizeEmailData('account.verify_email', {})).toEqual({});
  });

  it('recusa campo a mais (senha, token), ausente, fora do formato e tipo desconhecido', () => {
    const cases: [string, unknown][] = [
      ['account.verify_email', { token: 'abc' }],
      ['account.password_changed', { by: 'self', password: 'segredo' }],
      ['moderation.suspended', { kind: 'full', endsAt: null, reason: 'interno' }],
      ['account.locked', {}],
      ['account.locked', { until: 'amanhã' }],
      ['account.locked', { until: '2026-13-45T99:99:99Z' }],
      ['account.role_changed', { role: 'root' }],
      [
        'account.new_login',
        { at: '2026-11-24T12:00:00Z', ip: ' ', browser: null, os: null, site: 'classroom' },
      ],
      ['account.exists', null],
      ['account.exists', []],
      ['forum.reply', {}],
    ];
    for (const [type, data] of cases) {
      expect(
        () => parseEmailData(type as EmailType, data),
        `${type} ${JSON.stringify(data)}`,
      ).toThrow(EmailDataError);
    }
    expect(() => normalizeEmailData('account.locked', { until: new Date('x') })).toThrow(
      /data inválida/,
    );
    expect(() =>
      normalizeEmailData('account.exists', null as unknown as Record<string, never>),
    ).toThrow(EmailDataError);
  });
});

describe('enqueueEmail', () => {
  it('grava email_outbox e a tarefa email.send na mesma transação', async () => {
    const { result, outbox, job } = await inRollback(async (trx) => {
      const userId = await createUser(trx);
      const result = await enqueueEmail(trx, {
        userId,
        type: 'account.locked',
        data: { until: new Date('2026-11-24T12:15:00.000Z') },
      });
      const outbox = await trx
        .selectFrom('emailOutbox')
        .selectAll()
        .where('id', '=', result?.outboxId ?? '')
        .executeTakeFirstOrThrow();
      const user = await trx
        .selectFrom('users')
        .select('email')
        .where('id', '=', userId)
        .executeTakeFirstOrThrow();
      const job = await trx
        .selectFrom('jobs')
        .selectAll()
        .where('id', '=', result?.jobId ?? '')
        .executeTakeFirstOrThrow();
      return { result, outbox: { ...outbox, expectedTo: user.email, userId }, job };
    });
    expect(result).not.toBeNull();
    expect(outbox).toMatchObject({
      type: 'account.locked',
      to: outbox.expectedTo,
      userId: outbox.userId,
      status: 'queued',
      attempts: 0,
      subject: null,
      sentAt: null,
      data: { until: '2026-11-24T12:15:00.000Z' },
    });
    expect(job).toMatchObject({
      type: 'email.send',
      status: 'queued',
      maxAttempts: 5,
      payload: { outboxId: result?.outboxId },
    });
  });

  it('a ação desfeita desfaz o e-mail e a tarefa', async () => {
    const ids = await inRollback(async (trx) => {
      const userId = await createUser(trx);
      return enqueueEmail(trx, { userId, type: 'account.verify_email', data: {} });
    });
    const outbox = await db
      .selectFrom('emailOutbox')
      .select('id')
      .where('id', '=', ids?.outboxId ?? '')
      .execute();
    const jobs = await db
      .selectFrom('jobs')
      .select('id')
      .where('id', '=', ids?.jobId ?? '')
      .execute();
    expect(outbox).toEqual([]);
    expect(jobs).toEqual([]);
  });

  it('exige transação, usuário existente e não grava para conta excluída', async () => {
    await expect(
      enqueueEmail(db, { userId: crypto.randomUUID(), type: 'account.exists', data: {} }),
    ).rejects.toThrow(/transação/);
    await inRollback(async (trx) => {
      await expect(
        enqueueEmail(trx, { userId: crypto.randomUUID(), type: 'account.exists', data: {} }),
      ).rejects.toThrow(/não existe/);
      const deleted = await createUser(trx, { deletedAt: new Date() });
      expect(
        await enqueueEmail(trx, { userId: deleted, type: 'account.exists', data: {} }),
      ).toBeNull();
      // Dado inválido não chega ao banco.
      const userId = await createUser(trx);
      await expect(
        enqueueEmail(trx, {
          userId,
          type: 'account.verify_email',
          data: { token: 'x' } as unknown as Record<string, never>,
        }),
      ).rejects.toThrow(EmailDataError);
    });
  });
});

describe('tokens de e-mail', () => {
  it('emite, guarda só o hash e consome uma vez só', async () => {
    await inRollback(async (trx) => {
      const userId = await createUser(trx);
      const before = Date.now();
      const { token, expiresAt } = await issueEmailToken(trx, userId, 'verify');
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(expiresAt.getTime() - before).toBeGreaterThanOrEqual(EMAIL_TOKEN_TTL_MS - 1_000);
      expect(expiresAt.getTime() - before).toBeLessThanOrEqual(EMAIL_TOKEN_TTL_MS + 1_000);
      const stored = await trx
        .selectFrom('emailTokens')
        .selectAll()
        .where('userId', '=', userId)
        .executeTakeFirstOrThrow();
      expect(stored.tokenHash).toBe(hashEmailToken(token));
      expect(stored.tokenHash).not.toContain(token);

      // Propósito errado não consome nem gasta o token.
      await expect(consumeEmailToken(trx, token, 'reset')).rejects.toMatchObject({
        code: 'token_expired',
        status: 410,
      });
      expect(await consumeEmailToken(trx, token, 'verify')).toEqual({ userId });
      await expect(consumeEmailToken(trx, token, 'verify')).rejects.toMatchObject({
        code: 'token_expired',
      });
    });
  });

  it('token novo invalida os anteriores do mesmo propósito, não os do outro', async () => {
    await inRollback(async (trx) => {
      const userId = await createUser(trx);
      const first = await issueEmailToken(trx, userId, 'reset');
      const verify = await issueEmailToken(trx, userId, 'verify');
      const second = await issueEmailToken(trx, userId, 'reset');
      await expect(consumeEmailToken(trx, first.token, 'reset')).rejects.toMatchObject({
        code: 'token_expired',
      });
      expect(await consumeEmailToken(trx, second.token, 'reset')).toEqual({ userId });
      expect(await consumeEmailToken(trx, verify.token, 'verify')).toEqual({ userId });
    });
  });

  it('recusa vencido, desconhecido e malformado com 410 token_expired', async () => {
    await inRollback(async (trx) => {
      const userId = await createUser(trx);
      const { token } = await issueEmailToken(trx, userId, 'verify');
      await sql`UPDATE email_tokens SET created_at = now() - interval '2 days', expires_at = now() - interval '1 second' WHERE user_id = ${userId}`.execute(
        trx,
      );
      for (const candidate of [token, 'A'.repeat(43), 'curto', '']) {
        const error = await consumeEmailToken(trx, candidate, 'verify').catch((e: unknown) => e);
        expect(isDomainError(error)).toBe(true);
        expect(error).toMatchObject({ code: 'token_expired', status: 410 });
      }
    });
    expect(tokenExpired().title).toBe('Link expirado');
  });

  it('exige transação para emitir', async () => {
    await expect(issueEmailToken(db, crypto.randomUUID(), 'verify')).rejects.toThrow(/transação/);
  });

  it('nunca grava o token em claro em jobs, email_outbox ou no log', async () => {
    logLines.length = 0;
    const leaked = await inRollback(async (trx) => {
      const userId = await createUser(trx);
      await enqueueEmail(trx, { userId, type: 'account.password_reset', data: {} });
      // O que o worker faz ao montar o e-mail: cria o token e o põe só no corpo.
      const { token } = await issueEmailToken(trx, userId, 'reset');
      await consumeEmailToken(trx, token, 'reset');
      const text = `${await rowsAsText(trx, 'jobs')}\n${await rowsAsText(trx, 'email_outbox')}`;
      return { token, text };
    });
    expect(logLines.length).toBeGreaterThan(0);
    expect(leaked.text).not.toContain(leaked.token);
    expect(logLines.join('\n')).not.toContain(leaked.token);
    expect(logLines.join('\n')).not.toContain(hashEmailToken(leaked.token));
  });
});
