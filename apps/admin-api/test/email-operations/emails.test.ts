import type { TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { maskEmail } from '../../src/routes/email-operations.ts';
import { callAs, createActor, deniedBy } from '../actors.ts';
import { createIsolatedDatabase, createTestApp, type TestApp } from '../helpers.ts';

// Banco próprio: a fila de e-mails é lida inteira pela tela e o `email.send` enfileirado não
// pode aparecer nos outros arquivos.
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

interface EmailSeed {
  type?: string;
  to?: string;
  subject?: string | null;
  status?: 'queued' | 'failed' | 'sent';
  attempts?: number;
  lastError?: string | null;
  createdAt?: Date;
}

/** Linha de `email_outbox` como o `enqueueEmail` a grava; o destinatário é o e-mail do usuário. */
async function seedEmail(userId: string, seed: EmailSeed = {}): Promise<string> {
  const status = seed.status ?? 'queued';
  const row = await test.db
    .insertInto('emailOutbox')
    .values({
      userId,
      to: seed.to ?? 'ana@exemplo.com',
      type: seed.type ?? 'ticket.reply',
      data: JSON.stringify({ protocol: 'SUP-1' }),
      status,
      attempts: seed.attempts ?? 0,
      lastError: seed.lastError ?? null,
      subject: seed.subject ?? null,
      ...(status === 'sent' ? { sentAt: new Date() } : {}),
      ...(seed.createdAt === undefined ? {} : { createdAt: seed.createdAt }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function emailRow(id: string) {
  return test.db.selectFrom('emailOutbox').selectAll().where('id', '=', id).executeTakeFirst();
}

describe('mascaramento do destinatário', () => {
  it('mostra a primeira letra e o domínio, e esconde o resto', () => {
    expect(maskEmail('ana@exemplo.com')).toBe('a***@exemplo.com');
    expect(maskEmail('a@exemplo.com')).toBe('a***@exemplo.com');
    expect(maskEmail('sem-arroba')).toBe('s***');
  });
});

describe('GET /api/v1/ops/emails', () => {
  it('lista pendentes e com falha do mais antigo para o mais novo, com o destinatário mascarado', async () => {
    const admin = await createActor(test, 'admin');
    const older = await seedEmail(admin.id, {
      type: 'ticket.reply',
      to: 'ana@exemplo.com',
      createdAt: new Date('2026-04-01T00:00:00Z'),
    });
    const failed = await seedEmail(admin.id, {
      type: 'ticket.reply',
      to: 'bruno@exemplo.com',
      status: 'failed',
      attempts: 5,
      lastError: 'smtp: caixa cheia',
      subject: 'Resposta do chamado',
      createdAt: new Date('2026-04-02T00:00:00Z'),
    });
    await seedEmail(admin.id, {
      type: 'ticket.reply',
      status: 'sent',
      createdAt: new Date('2026-04-03T00:00:00Z'),
    });

    const response = await callAs(test, {
      method: 'GET',
      url: '/api/v1/ops/emails?type=ticket.reply',
      as: admin,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([older, failed]);
    expect(response.json().items[0]).toEqual({
      id: older,
      type: 'ticket.reply',
      to: 'a***@exemplo.com',
      subject: null,
      status: 'queued',
      attempts: 0,
      lastError: null,
      createdAt: '2026-04-01T00:00:00.000Z',
    });
    expect(response.json().items[1]).toMatchObject({
      to: 'b***@exemplo.com',
      status: 'failed',
      attempts: 5,
      lastError: 'smtp: caixa cheia',
      subject: 'Resposta do chamado',
    });
    // O corpo renderizado não é guardado nem devolvido.
    expect(response.json().items[1]).not.toHaveProperty('data');
    expect(test.logText()).not.toContain('ana@exemplo.com');
  });

  it('filtra por estado e pagina por cursor', async () => {
    const admin = await createActor(test, 'admin');
    const first = await seedEmail(admin.id, {
      type: 'forum.reply',
      status: 'failed',
      lastError: 'smtp: recusado',
      createdAt: new Date('2026-05-01T00:00:00Z'),
    });
    const second = await seedEmail(admin.id, {
      type: 'forum.reply',
      status: 'failed',
      lastError: 'smtp: recusado',
      createdAt: new Date('2026-05-02T00:00:00Z'),
    });
    const third = await seedEmail(admin.id, {
      type: 'forum.reply',
      status: 'failed',
      lastError: 'smtp: recusado',
      createdAt: new Date('2026-05-03T00:00:00Z'),
    });
    await seedEmail(admin.id, { type: 'forum.reply' });

    const failed = await callAs(test, {
      method: 'GET',
      url: '/api/v1/ops/emails?type=forum.reply&status=failed',
      as: admin,
    });
    expect(failed.json().items.map((item: { id: string }) => item.id)).toEqual([
      first,
      second,
      third,
    ]);

    const page = await callAs(test, {
      method: 'GET',
      url: '/api/v1/ops/emails?type=forum.reply&status=failed&limit=2',
      as: admin,
    });
    expect(page.json().items.map((item: { id: string }) => item.id)).toEqual([first, second]);
    const cursor = page.json().nextCursor as string;
    const next = await callAs(test, {
      method: 'GET',
      url: `/api/v1/ops/emails?type=forum.reply&status=failed&limit=2&cursor=${encodeURIComponent(cursor)}`,
      as: admin,
    });
    expect(next.json().items.map((item: { id: string }) => item.id)).toEqual([third]);
    expect(next.json().nextCursor).toBeNull();
  });

  it('recusa cursor inválido e o gerente recebe 403 auditado', async () => {
    const admin = await createActor(test, 'admin');
    const invalid = await callAs(test, {
      method: 'GET',
      url: '/api/v1/ops/emails?cursor=xyz',
      as: admin,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({ code: 'validation_failed' });
    expect(invalid.json().errors).toContainEqual(expect.objectContaining({ path: 'query.cursor' }));

    const manager = await createActor(test, 'manager');
    const forbidden = await callAs(test, {
      method: 'GET',
      url: '/api/v1/ops/emails',
      as: manager,
    });
    expect(forbidden.statusCode).toBe(403);
    const denied = await deniedBy(test, manager.id);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ action: 'ops.manage', outcome: 'denied' });
  });
});

describe('POST /api/v1/ops/emails/{id}/retry', () => {
  it('devolve o e-mail a queued, zera as tentativas, enfileira email.send e audita', async () => {
    const admin = await createActor(test, 'admin');
    const id = await seedEmail(admin.id, {
      status: 'failed',
      attempts: 5,
      lastError: 'smtp: caixa cheia',
      to: 'ana@exemplo.com',
    });
    const response = await callAs(test, {
      method: 'POST',
      url: `/api/v1/ops/emails/${id}/retry`,
      as: admin,
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      id,
      type: 'ticket.reply',
      to: 'a***@exemplo.com',
      subject: null,
      status: 'queued',
      attempts: 0,
      lastError: 'smtp: caixa cheia',
      createdAt: expect.any(String),
    });

    const row = await emailRow(id);
    expect(row).toMatchObject({ status: 'queued', attempts: 0 });
    expect(row?.sentAt).toBeNull();

    const jobs = await test.db
      .selectFrom('jobs')
      .select(['id', 'type', 'payload', 'status'])
      .where('type', '=', 'email.send')
      .execute();
    expect(
      jobs.filter((job) => (job.payload as { outboxId?: string }).outboxId === id),
    ).toHaveLength(1);

    const audit = await test.db
      .selectFrom('auditLog')
      .selectAll()
      .where('action', '=', 'email.retry')
      .where('targetId', '=', id)
      .execute();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: admin.id, targetType: 'email', outcome: 'ok' });
  });

  it('404 para e-mail inexistente e 409 para o que não está com falha', async () => {
    const admin = await createActor(test, 'admin');
    const missing = await callAs(test, {
      method: 'POST',
      url: `/api/v1/ops/emails/${crypto.randomUUID()}/retry`,
      as: admin,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'not_found' });

    const queued = await seedEmail(admin.id);
    const notFailed = await callAs(test, {
      method: 'POST',
      url: `/api/v1/ops/emails/${queued}/retry`,
      as: admin,
    });
    expect(notFailed.statusCode).toBe(409);
    expect(notFailed.json()).toMatchObject({ code: 'email_not_failed' });
    expect(await emailRow(queued)).toMatchObject({ status: 'queued' });
  });

  it('exige CSRF e recusa o gerente com 403 auditado', async () => {
    const admin = await createActor(test, 'admin');
    const id = await seedEmail(admin.id, { status: 'failed', attempts: 1 });

    const noCsrf = await callAs(test, {
      method: 'POST',
      url: `/api/v1/ops/emails/${id}/retry`,
      as: admin,
      csrf: null,
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toMatchObject({ code: 'csrf_token_invalid' });
    expect(await emailRow(id)).toMatchObject({ status: 'failed' });

    const manager = await createActor(test, 'manager');
    const forbidden = await callAs(test, {
      method: 'POST',
      url: `/api/v1/ops/emails/${id}/retry`,
      as: manager,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json()).toMatchObject({ code: 'permission_denied' });
    expect(await emailRow(id)).toMatchObject({ status: 'failed' });
    const denied = await deniedBy(test, manager.id);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ action: 'ops.manage', outcome: 'denied' });
  });
});
