import { createHash, randomUUID } from 'node:crypto';
import type { Database, JobContext, JobOf, JobType } from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandlers } from '../src/handlers.ts';
import {
  DEVICE_RETENTION_DAYS,
  purgeRetention,
  RETENTION_BATCH_SIZE,
  type RetentionSettings,
} from '../src/retention.ts';
import { captureLogger, handlerDependencies, openDatabase } from './helpers.ts';

let db: Database;

beforeAll(() => {
  db = openDatabase();
});

afterAll(async () => {
  await db.destroy();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number): Date => new Date(Date.now() - ms);
const ahead = (ms: number): Date => new Date(Date.now() + ms);

const SETTINGS: RetentionSettings = {
  sessionDays: 30,
  emailTokenHours: 24,
  loginAttemptDays: 30,
  emailSentDays: 30,
  emailFailedDays: 90,
  auditDays: 730,
};

const hex64 = (): string => createHash('sha256').update(randomUUID()).digest('hex');

async function createUser(): Promise<string> {
  const row = await db
    .insertInto('users')
    .values({ email: `aluno-${randomUUID()}@escola.test`, name: 'Ana Teste' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function exists(
  table: 'sessions' | 'emailTokens' | 'loginAttempts' | 'userDevices' | 'emailOutbox' | 'auditLog',
  id: string,
): Promise<boolean> {
  const row = await db.selectFrom(table).select('id').where('id', '=', id).executeTakeFirst();
  return row !== undefined;
}

async function insertSession(
  userId: string,
  times: { createdAt: Date; lastUsedAt: Date; expiresAt: Date },
): Promise<string> {
  const row = await db
    .insertInto('sessions')
    .values({
      userId,
      idHash: hex64(),
      site: 'classroom',
      ip: '127.0.0.1',
      csrfToken: randomUUID(),
      ...times,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function insertToken(
  userId: string,
  times: { createdAt: Date; expiresAt: Date; usedAt?: Date },
): Promise<string> {
  const row = await db
    .insertInto('emailTokens')
    .values({ userId, purpose: 'verify', tokenHash: hex64(), ...times })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function insertAttempt(createdAt: Date): Promise<string> {
  const row = await db
    .insertInto('loginAttempts')
    .values({
      email: 'ana@escola.test',
      ip: '127.0.0.1',
      site: 'classroom',
      success: false,
      createdAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function insertDevice(userId: string, lastSeenAt: Date): Promise<string> {
  const row = await db
    .insertInto('userDevices')
    .values({ userId, deviceKey: `Chrome|${randomUUID()}`, firstSeenAt: lastSeenAt, lastSeenAt })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function insertOutbox(
  userId: string,
  status: 'queued' | 'sent' | 'failed',
  createdAt: Date,
  sentAt: Date | null = null,
): Promise<string> {
  const row = await db
    .insertInto('emailOutbox')
    .values({
      userId,
      to: 'ana@escola.test',
      type: 'account.verify',
      status,
      createdAt,
      sentAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function insertAudit(createdAt: Date): Promise<string> {
  const row = await db
    .insertInto('auditLog')
    .values({ origin: 'worker', action: 'test.retention', outcome: 'ok', createdAt })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

function fakeJob<T extends JobType>(type: T): JobOf<T> {
  return {
    id: randomUUID(),
    type,
    payload: {},
    status: 'running',
    priority: 0,
    runAt: new Date(),
    attempts: 1,
    maxAttempts: 3,
    uniqueKey: null,
    lockedBy: 'teste',
    lockedAt: new Date(),
    heartbeatAt: new Date(),
    lastError: null,
    createdAt: new Date(),
    finishedAt: null,
  } as unknown as JobOf<T>;
}

const context = (): JobContext => ({ signal: new AbortController().signal });

describe('retention.purge', () => {
  it('sessões: apaga a vencida e a sem uso há mais do prazo, mantém a ativa', async () => {
    const userId = await createUser();
    const expired = await insertSession(userId, {
      createdAt: ago(40 * DAY),
      lastUsedAt: ago(40 * DAY),
      expiresAt: ago(10 * DAY),
    });
    // Prazo encurtado depois da emissão: ainda não venceu, mas está sem uso há mais de 7 dias.
    const idle = await insertSession(userId, {
      createdAt: ago(10 * DAY),
      lastUsedAt: ago(10 * DAY),
      expiresAt: ahead(20 * DAY),
    });
    const active = await insertSession(userId, {
      createdAt: ago(2 * DAY),
      lastUsedAt: ago(HOUR),
      expiresAt: ahead(29 * DAY),
    });

    await purgeRetention(db, { ...SETTINGS, sessionDays: 7 });

    expect(await exists('sessions', expired)).toBe(false);
    expect(await exists('sessions', idle)).toBe(false);
    expect(await exists('sessions', active)).toBe(true);
  });

  it('links de e-mail: apaga o vencido (usado ou não) e mantém o válido', async () => {
    const userId = await createUser();
    const expired = await insertToken(userId, {
      createdAt: ago(30 * HOUR),
      expiresAt: ago(6 * HOUR),
    });
    const used = await insertToken(userId, {
      createdAt: ago(30 * HOUR),
      expiresAt: ago(6 * HOUR),
      usedAt: ago(29 * HOUR),
    });
    const valid = await insertToken(userId, { createdAt: ago(HOUR), expiresAt: ahead(23 * HOUR) });

    await purgeRetention(db, SETTINGS);

    expect(await exists('emailTokens', expired)).toBe(false);
    expect(await exists('emailTokens', used)).toBe(false);
    expect(await exists('emailTokens', valid)).toBe(true);
  });

  it('tentativas de login: apaga as de mais de 30 dias e mantém as recentes', async () => {
    const old = await insertAttempt(ago(31 * DAY));
    const recent = await insertAttempt(ago(29 * DAY));

    await purgeRetention(db, SETTINGS);

    expect(await exists('loginAttempts', old)).toBe(false);
    expect(await exists('loginAttempts', recent)).toBe(true);
  });

  it('dispositivos conhecidos: apaga os sem uso há mais de 1 ano e mantém os demais', async () => {
    const userId = await createUser();
    const old = await insertDevice(userId, ago((DEVICE_RETENTION_DAYS + 1) * DAY));
    const recent = await insertDevice(userId, ago((DEVICE_RETENTION_DAYS - 1) * DAY));

    await purgeRetention(db, SETTINGS);

    expect(await exists('userDevices', old)).toBe(false);
    expect(await exists('userDevices', recent)).toBe(true);
  });

  it('fila de e-mail: apaga enviados de 30 dias e falhas de 90; a fila pendente fica', async () => {
    const userId = await createUser();
    const sentOld = await insertOutbox(userId, 'sent', ago(40 * DAY), ago(31 * DAY));
    const sentRecent = await insertOutbox(userId, 'sent', ago(40 * DAY), ago(29 * DAY));
    const failedOld = await insertOutbox(userId, 'failed', ago(91 * DAY));
    const failedRecent = await insertOutbox(userId, 'failed', ago(89 * DAY));
    const queuedOld = await insertOutbox(userId, 'queued', ago(400 * DAY));

    await purgeRetention(db, SETTINGS);

    expect(await exists('emailOutbox', sentOld)).toBe(false);
    expect(await exists('emailOutbox', sentRecent)).toBe(true);
    expect(await exists('emailOutbox', failedOld)).toBe(false);
    expect(await exists('emailOutbox', failedRecent)).toBe(true);
    expect(await exists('emailOutbox', queuedOld)).toBe(true);
  });

  it('auditoria: segue NUVA_RETENTION_AUDIT_DAYS e mantém o que está no prazo', async () => {
    const veryOld = await insertAudit(ago(731 * DAY));
    const middle = await insertAudit(ago(500 * DAY));
    const recent = await insertAudit(ago(10 * DAY));

    await purgeRetention(db, SETTINGS);
    expect(await exists('auditLog', veryOld)).toBe(false);
    expect(await exists('auditLog', middle)).toBe(true);

    await purgeRetention(db, { ...SETTINGS, auditDays: 400 });
    expect(await exists('auditLog', middle)).toBe(false);
    expect(await exists('auditLog', recent)).toBe(true);
  });

  it('apaga em lotes até não sobrar nada vencido e repetir não apaga mais nada', async () => {
    expect(RETENTION_BATCH_SIZE).toBe(5_000);
    const ids = await Promise.all(Array.from({ length: 5 }, () => insertAttempt(ago(60 * DAY))));
    const kept = await insertAttempt(ago(DAY));

    const report = await purgeRetention(db, SETTINGS, { batchSize: 2 });
    expect(report.loginAttempts).toBeGreaterThanOrEqual(5);
    for (const id of ids) {
      expect(await exists('loginAttempts', id)).toBe(false);
    }
    expect(await exists('loginAttempts', kept)).toBe(true);

    const again = await purgeRetention(db, SETTINGS);
    expect(again).toMatchObject({ loginAttempts: 0, sessions: 0, emailTokens: 0, auditLog: 0 });
  });

  it('para antes do lote seguinte quando o worker encerra', async () => {
    const old = await insertAttempt(ago(60 * DAY));
    const controller = new AbortController();
    const reason = new DOMException('encerrando', 'AbortError');
    controller.abort(reason);
    await expect(purgeRetention(db, SETTINGS, { signal: controller.signal })).rejects.toBe(reason);
    expect(await exists('loginAttempts', old)).toBe(true);
    await purgeRetention(db, SETTINGS);
  });

  it('o manipulador usa os prazos recebidos e registra só as contagens', async () => {
    const old = await insertAttempt(ago(10 * DAY));
    const { logger, lines } = captureLogger();
    const handlers = createHandlers(
      handlerDependencies(db, logger, { retention: { ...SETTINGS, loginAttemptDays: 5 } }),
    );
    await handlers['retention.purge'](fakeJob('retention.purge'), context());
    expect(await exists('loginAttempts', old)).toBe(false);
    const line = lines.find((entry) => entry.msg === 'Expurgo diário executado');
    expect(line?.deleted).toMatchObject({ loginAttempts: expect.any(Number) });
    expect(JSON.stringify(lines)).not.toContain('ana@escola.test');
  });
});

describe('suspension.expire', () => {
  async function suspend(userId: string, endsAt: Date | null, startsAt = ago(2 * DAY)) {
    const adminId = await createUser();
    await db
      .updateTable('users')
      .set({
        suspendedAt: startsAt,
        suspendedKind: 'full',
        suspendedReason: 'Teste',
        suspendedBy: adminId,
      })
      .where('id', '=', userId)
      .execute();
    const row = await db
      .insertInto('userSuspensions')
      .values({ userId, kind: 'full', reason: 'Teste', startsAt, endsAt, createdBy: adminId })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function unsuspendAudits(userId: string) {
    return db
      .selectFrom('auditLog')
      .select(['origin', 'actorUserId'])
      .where('action', '=', 'user.unsuspend')
      .where('targetId', '=', userId)
      .execute();
  }

  it('encerra a suspensão vencida, grava user.unsuspend do worker e não repete', async () => {
    const due = await createUser();
    const future = await createUser();
    const open = await createUser();
    const dueSuspension = await suspend(due, ago(HOUR));
    await suspend(future, ahead(DAY));
    await suspend(open, null);

    const { logger, lines } = captureLogger();
    const handler = createHandlers(handlerDependencies(db, logger))['suspension.expire'];
    expect(handler).toBeDefined();
    await handler?.(fakeJob('suspension.expire'), context());

    const lifted = await db
      .selectFrom('userSuspensions')
      .select('liftedAt')
      .where('id', '=', dueSuspension)
      .executeTakeFirstOrThrow();
    expect(lifted.liftedAt).not.toBeNull();
    const users = await db
      .selectFrom('users')
      .select(['id', 'suspendedAt'])
      .where('id', 'in', [due, future, open])
      .execute();
    const suspendedAt = Object.fromEntries(users.map((user) => [user.id, user.suspendedAt]));
    expect(suspendedAt[due]).toBeNull();
    expect(suspendedAt[future]).not.toBeNull();
    expect(suspendedAt[open]).not.toBeNull();
    expect(await unsuspendAudits(due)).toEqual([{ origin: 'worker', actorUserId: null }]);
    expect(
      lines.find((line) => line.msg === 'Suspensões vencidas encerradas')?.expired,
    ).toBeGreaterThanOrEqual(1);

    // Repetir (nova tentativa) não encerra de novo nem duplica a auditoria.
    await handler?.(fakeJob('suspension.expire'), context());
    expect(await unsuspendAudits(due)).toHaveLength(1);
    expect(await unsuspendAudits(future)).toHaveLength(0);
  });
});

describe('image.cleanup', () => {
  async function insertImage(ownerUserId: string, createdAt: Date): Promise<string> {
    const row = await db
      .insertInto('images')
      .values({
        ownerUserId,
        purpose: 'avatar',
        originalWidth: 100,
        originalHeight: 100,
        createdAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async function imageExists(id: string): Promise<boolean> {
    return (
      (await db.selectFrom('images').select('id').where('id', '=', id).executeTakeFirst()) !==
      undefined
    );
  }

  it('apaga a órfã de mais de 24 h e mantém a recente e a referenciada', async () => {
    const userId = await createUser();
    const orphanOld = await insertImage(userId, ago(25 * HOUR));
    const orphanRecent = await insertImage(userId, ago(HOUR));
    const avatar = await insertImage(userId, ago(48 * HOUR));
    await db.insertInto('profiles').values({ userId, avatarImageId: avatar }).execute();

    const { logger } = captureLogger();
    const handler = createHandlers(handlerDependencies(db, logger))['image.cleanup'];
    expect(handler).toBeDefined();
    await handler?.(fakeJob('image.cleanup'), context());

    expect(await imageExists(orphanOld)).toBe(false);
    expect(await imageExists(orphanRecent)).toBe(true);
    expect(await imageExists(avatar)).toBe(true);

    // Repetir não apaga mais nada.
    await handler?.(fakeJob('image.cleanup'), context());
    expect(await imageExists(orphanRecent)).toBe(true);
    expect(await imageExists(avatar)).toBe(true);
  });
});
