import { randomUUID } from 'node:crypto';
import {
  type Database,
  type JobOf,
  type JobType,
  notify,
  unsubscribeByToken,
} from '@nuva-edu/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHandlers } from '../../src/handlers.ts';
import { captureLogger, handlerDependencies, memoryMailer, openDatabase } from '../helpers.ts';

let db: Database;
const signal = new AbortController().signal;

beforeAll(() => {
  db = openDatabase();
});
afterAll(() => db.destroy());

async function user() {
  return db
    .insertInto('users')
    .values({
      email: `${randomUUID()}@escola.test`,
      name: 'Aluna de teste',
      emailVerifiedAt: new Date(),
    })
    .returning(['id', 'email'])
    .executeTakeFirstOrThrow();
}

async function readNotifications(userId: string) {
  return db
    .selectFrom('notifications')
    .select(['id', 'type', 'count'])
    .where('userId', '=', userId)
    .execute();
}

async function readOutbox(userId: string) {
  return db
    .selectFrom('emailOutbox')
    .select(['id', 'type', 'status', 'lastError'])
    .where('userId', '=', userId)
    .orderBy('id')
    .execute();
}

async function notifyJob(
  userId: string,
  type: 'forum.reply' | 'lesson.published' | 'order.approved',
  targetType: string,
  targetId: string,
) {
  const input = {
    type,
    userId,
    actorId: null,
    targetType,
    targetId,
    data: { title: 'Aviso <teste>' },
  };
  const result = await db.transaction().execute((trx) => notify(trx, type, userId, input));
  const id = result.queued[0]?.jobId;
  if (!id) throw new Error('Notificação não foi enfileirada.');
  return { ...job('notify', input), id };
}

function job<T extends JobType>(type: T, payload: JobOf<T>['payload']): JobOf<T> {
  return { id: randomUUID(), type, payload, attempts: 1, maxAttempts: 5 } as JobOf<T>;
}

it('agrupa cinco avisos, deduplica uma repetição do job e fornece descadastro de um clique', async () => {
  const recipient = await user();
  const { logger, lines } = captureLogger();
  const mailer = memoryMailer();
  const handlers = createHandlers(handlerDependencies(db, logger, { mailer }));
  const topic = randomUUID();
  const jobs = await Promise.all(
    Array.from({ length: 5 }, () => notifyJob(recipient.id, 'forum.reply', 'topic', topic)),
  );
  await Promise.all(jobs.map((queued) => handlers.notify?.(queued, { signal })));
  const original = jobs[0];
  if (!original) throw new Error('Tarefa não foi criada.');
  await handlers.notify?.(original, { signal });

  expect(await readNotifications(recipient.id)).toEqual([
    expect.objectContaining({ type: 'forum.reply', count: 5 }),
  ]);
  const [email, ...others] = await readOutbox(recipient.id);
  expect(others).toEqual([]);
  if (!email) throw new Error('E-mail não foi enfileirado.');
  await handlers['email.send'](job('email.send', { outboxId: email.id }), { signal });
  expect(mailer.sent).toHaveLength(1);
  const message = mailer.sent[0];
  expect(message?.html).toContain('Aviso &lt;teste&gt;');
  expect(message?.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  const token = /([a-f0-9]{64})>$/.exec(message?.headers?.['List-Unsubscribe'] ?? '')?.[1];
  expect(token).toBeDefined();
  if (!token) throw new Error('Link de descadastro ausente.');
  expect(message?.text).toContain(`/descadastro/${token}`);
  expect(JSON.stringify(lines)).not.toContain(token);
  await unsubscribeByToken(db, token);

  const next = await notifyJob(recipient.id, 'forum.reply', 'topic', randomUUID());
  await handlers.notify?.(next, { signal });
  expect(await readNotifications(recipient.id)).toHaveLength(2);
  expect(await readOutbox(recipient.id)).toHaveLength(1);
});

it('não dispara aviso de aula para quem perdeu o acesso ao curso pago', async () => {
  const recipient = await user();
  const course = await db
    .insertInto('courses')
    .values({
      slug: `curso-${randomUUID()}`,
      title: 'Curso pago',
      accessMode: 'paid',
      status: 'published',
      publishedAt: new Date(),
      priceCents: 500,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const handlers = createHandlers(handlerDependencies(db, captureLogger().logger));
  const queued = await notifyJob(recipient.id, 'lesson.published', 'course', course.id);
  await handlers.notify?.(queued, { signal });
  expect(await readNotifications(recipient.id)).toEqual([]);
  expect(await readOutbox(recipient.id)).toEqual([]);
});

it('após três recusas permanentes avisa só na central e preserva novas notificações', async () => {
  const recipient = await user();
  const mailer = {
    async send() {
      throw Object.assign(new Error('Recusado'), { code: 'EENVELOPE', responseCode: 550 });
    },
    close() {},
  };
  const handlers = createHandlers(handlerDependencies(db, captureLogger().logger, { mailer }));
  for (let count = 1; count <= 3; count += 1) {
    const queued = await notifyJob(recipient.id, 'order.approved', 'order', randomUUID());
    await handlers.notify?.(queued, { signal });
    const latest = (await readOutbox(recipient.id)).at(-1);
    if (!latest) throw new Error('E-mail não foi enfileirado.');
    await expect(
      handlers['email.send'](job('email.send', { outboxId: latest.id }), { signal }),
    ).rejects.toMatchObject({ name: 'PermanentJobError' });
  }
  const warnings = (await readNotifications(recipient.id)).filter(
    (entry) => entry.type === 'account.email_undeliverable',
  );
  expect(warnings).toHaveLength(1);
  const next = await notifyJob(recipient.id, 'order.approved', 'order', randomUUID());
  await handlers.notify?.(next, { signal });
  expect(
    (await readNotifications(recipient.id)).filter((entry) => entry.type === 'order.approved'),
  ).toHaveLength(4);
  expect(await readOutbox(recipient.id)).toEqual(
    Array.from({ length: 3 }, () =>
      expect.objectContaining({
        status: 'failed',
        type: 'order.approved',
        lastError: expect.stringContaining('recusa permanente'),
      }),
    ),
  );
});
