import type { TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callAs, createActor, deniedBy } from '../actors.ts';
import { createIsolatedDatabase, createTestApp, type TestApp } from '../helpers.ts';

// Banco próprio: o resumo da operação conta a fila inteira (tarefas e e-mails dos outros
// arquivos não podem entrar na conta).
let isolated: TestDatabase;
let test: TestApp;

beforeAll(async () => {
  isolated = await createIsolatedDatabase();
  test = createTestApp({ DATABASE_URL: isolated.url });
});

afterAll(async () => {
  await test.close();
  await isolated.drop();
});

interface JobSeed {
  type?: string;
  status?: 'queued' | 'running' | 'done' | 'failed';
  runAt?: Date;
  createdAt?: Date;
  uniqueKey?: string | null;
  lastError?: string | null;
  attempts?: number;
}

async function seedJob(seed: JobSeed = {}): Promise<string> {
  const status = seed.status ?? 'queued';
  const createdAt = seed.createdAt ?? new Date();
  const finished = status === 'done' || status === 'failed' ? createdAt : null;
  const locked =
    status === 'queued' ? {} : { lockedBy: 'teste', lockedAt: createdAt, heartbeatAt: new Date() };
  const row = await test.db
    .insertInto('jobs')
    .values({
      type: seed.type ?? 'test.ops_jobs',
      payload: JSON.stringify({ message: 'fila' }),
      status,
      runAt: seed.runAt ?? createdAt,
      createdAt,
      attempts: seed.attempts ?? (status === 'queued' ? 0 : 1),
      finishedAt: finished,
      lastError: seed.lastError ?? null,
      ...(seed.uniqueKey === undefined ? {} : { uniqueKey: seed.uniqueKey }),
      ...locked,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function jobRow(id: string) {
  return test.db.selectFrom('jobs').selectAll().where('id', '=', id).executeTakeFirst();
}

describe('GET /api/v1/ops/summary', () => {
  it('traz a fila por tipo, e-mails, webhooks, sistema e o total de falhas do selo', async () => {
    const admin = await createActor(test, 'admin');
    const user = await createActor(test, 'manager');
    await seedJob({
      type: 'test.ops_summary',
      status: 'queued',
      runAt: new Date(Date.now() - 90_000),
    });
    await seedJob({
      type: 'test.ops_summary',
      status: 'queued',
      runAt: new Date(Date.now() - 30_000),
    });
    await seedJob({ type: 'test.ops_summary', status: 'running' });
    await seedJob({ type: 'test.ops_summary', status: 'failed', lastError: 'falhou' });
    const email = await test.db
      .insertInto('emailOutbox')
      .values({ userId: user.id, to: `${user.id}@example.com`, type: 'ticket.reply' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await test.db
      .insertInto('emailOutbox')
      .values({
        userId: user.id,
        to: `${user.id}@example.com`,
        type: 'ticket.reply',
        status: 'failed',
        attempts: 5,
        lastError: 'smtp: recusado',
      })
      .execute();
    await test.db
      .insertInto('webhookEvents')
      .values({ provider: 'fake', status: 'failed', error: 'sem processar' })
      .execute();

    const response = await callAs(test, {
      method: 'GET',
      url: '/api/v1/ops/summary',
      as: admin,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.jobs).toContainEqual({
      type: 'test.ops_summary',
      queued: 2,
      running: 1,
      failed: 1,
      oldestPendingSeconds: expect.any(Number),
    });
    const summary = body.jobs.find((row: { type: string }) => row.type === 'test.ops_summary');
    expect(summary.oldestPendingSeconds).toBeGreaterThanOrEqual(90);
    expect(body.emails).toEqual({ queued: 1, failed: 1 });
    expect(body.webhooks).toEqual({ failed: 1 });
    expect(body.system).toMatchObject({
      version: expect.any(String),
      migrationVersion: expect.stringMatching(/^\d{4}$/),
      databaseBytes: expect.any(Number),
      lastBackup: null,
      lastPurgeAt: null,
    });
    expect(body.system.migrationVersion).not.toBe('0000');
    expect(body.system.databaseBytes).toBeGreaterThan(0);
    expect(body.failures).toBeGreaterThanOrEqual(2);
    // O e-mail criado não fica pendente em outro teste.
    await test.db.deleteFrom('emailOutbox').where('id', '=', email.id).execute();
  });
});

describe('GET /api/v1/ops/jobs', () => {
  it('lista queued/running/failed da mais antiga para a mais nova, com filtros e cursor', async () => {
    const admin = await createActor(test, 'admin');
    const first = await seedJob({
      type: 'test.ops_list',
      status: 'queued',
      createdAt: new Date('2026-03-01T00:00:00Z'),
    });
    const second = await seedJob({
      type: 'test.ops_list',
      status: 'running',
      createdAt: new Date('2026-03-02T00:00:00Z'),
    });
    const third = await seedJob({
      type: 'test.ops_list',
      status: 'failed',
      createdAt: new Date('2026-03-03T00:00:00Z'),
      lastError: 'falhou',
    });
    await seedJob({
      type: 'test.ops_list',
      status: 'done',
      createdAt: new Date('2026-03-04T00:00:00Z'),
    });

    const list = await callAs(test, {
      method: 'GET',
      url: '/api/v1/ops/jobs?type=test.ops_list',
      as: admin,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((item: { id: string }) => item.id)).toEqual([
      first,
      second,
      third,
    ]);
    expect(list.json().items[0]).toMatchObject({
      type: 'test.ops_list',
      status: 'queued',
      attempts: 0,
      maxAttempts: 5,
      lastError: null,
    });
    expect(list.json().items[0]).not.toHaveProperty('payload');
    expect(list.json().items[0]).not.toHaveProperty('lockedBy');

    const onlyFailed = await callAs(test, {
      method: 'GET',
      url: '/api/v1/ops/jobs?type=test.ops_list&status=failed',
      as: admin,
    });
    expect(onlyFailed.json().items.map((item: { id: string }) => item.id)).toEqual([third]);

    const page = await callAs(test, {
      method: 'GET',
      url: '/api/v1/ops/jobs?type=test.ops_list&limit=2',
      as: admin,
    });
    expect(page.json().items).toHaveLength(2);
    const cursor = page.json().nextCursor as string;
    const next = await callAs(test, {
      method: 'GET',
      url: `/api/v1/ops/jobs?type=test.ops_list&limit=2&cursor=${encodeURIComponent(cursor)}`,
      as: admin,
    });
    expect(next.json().items.map((item: { id: string }) => item.id)).toEqual([third]);
    expect(next.json().nextCursor).toBeNull();
  });

  it('recusa cursor inválido com 400 validation_failed', async () => {
    const admin = await createActor(test, 'admin');
    const response = await callAs(test, {
      method: 'GET',
      url: '/api/v1/ops/jobs?cursor=xyz',
      as: admin,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_failed' });
  });

  it('o gerente recebe 403 auditado em toda rota de operação', async () => {
    const manager = await createActor(test, 'manager');
    for (const url of ['/api/v1/ops/summary', '/api/v1/ops/jobs', '/api/v1/ops/emails']) {
      const response = await callAs(test, { method: 'GET', url, as: manager });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'permission_denied' });
    }
    const denied = await deniedBy(test, manager.id);
    expect(denied).toHaveLength(3);
    expect(denied[0]).toMatchObject({ action: 'ops.manage', outcome: 'denied' });
  });
});

describe('ações de /ops/jobs', () => {
  it('reenfileira uma tarefa com falha com as tentativas zeradas e grava auditoria', async () => {
    const admin = await createActor(test, 'admin');
    const id = await seedJob({
      type: 'test.ops_retry',
      status: 'failed',
      attempts: 5,
      lastError: 'erro antigo',
    });
    const response = await callAs(test, {
      method: 'POST',
      url: `/api/v1/ops/jobs/${id}/retry`,
      as: admin,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      id,
      status: 'queued',
      attempts: 0,
      lastError: 'erro antigo',
    });
    const row = await jobRow(id);
    expect(row).toMatchObject({ status: 'queued', attempts: 0 });
    const audit = await test.db
      .selectFrom('auditLog')
      .selectAll()
      .where('action', '=', 'job.retry')
      .where('targetId', '=', id)
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: admin.id, outcome: 'ok' });
  });

  it('404 para tarefa inexistente e 409 para tarefa que não está com falha', async () => {
    const admin = await createActor(test, 'admin');
    const missing = await callAs(test, {
      method: 'POST',
      url: `/api/v1/ops/jobs/${crypto.randomUUID()}/retry`,
      as: admin,
    });
    expect(missing.statusCode).toBe(404);

    const queued = await seedJob({ type: 'test.ops_retry_queued', status: 'queued' });
    const notFailed = await callAs(test, {
      method: 'POST',
      url: `/api/v1/ops/jobs/${queued}/retry`,
      as: admin,
    });
    expect(notFailed.statusCode).toBe(409);
    expect(notFailed.json()).toMatchObject({ code: 'job_not_failed' });
  });

  it('409 job_already_active quando a mesma unique_key tem tarefa ativa', async () => {
    const admin = await createActor(test, 'admin');
    const key = `test.ops_active:${crypto.randomUUID()}`;
    const failed = await seedJob({ type: 'test.ops_active', status: 'failed', uniqueKey: key });
    await seedJob({ type: 'test.ops_active', status: 'queued', uniqueKey: key });
    const response = await callAs(test, {
      method: 'POST',
      url: `/api/v1/ops/jobs/${failed}/retry`,
      as: admin,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: 'job_already_active' });
  });

  it('descarta uma tarefa com falha e grava auditoria; recusa as demais', async () => {
    const admin = await createActor(test, 'admin');
    const id = await seedJob({ type: 'test.ops_discard', status: 'failed', lastError: 'erro' });
    const response = await callAs(test, {
      method: 'DELETE',
      url: `/api/v1/ops/jobs/${id}`,
      as: admin,
    });
    expect(response.statusCode).toBe(204);
    expect(await jobRow(id)).toBeUndefined();
    const audit = await test.db
      .selectFrom('auditLog')
      .selectAll()
      .where('action', '=', 'job.discard')
      .where('targetId', '=', id)
      .execute();
    expect(audit).toHaveLength(1);

    const queued = await seedJob({ type: 'test.ops_discard_queued', status: 'queued' });
    const refused = await callAs(test, {
      method: 'DELETE',
      url: `/api/v1/ops/jobs/${queued}`,
      as: admin,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: 'job_not_failed' });

    const missing = await callAs(test, {
      method: 'DELETE',
      url: `/api/v1/ops/jobs/${crypto.randomUUID()}`,
      as: admin,
    });
    expect(missing.statusCode).toBe(404);
  });
});
