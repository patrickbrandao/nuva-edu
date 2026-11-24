import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import {
  type Config,
  consumeEmailToken,
  type Database,
  type EmailDataInput,
  type EmailType,
  enqueue,
  enqueueEmail,
  setSetting,
} from '@nuva-edu/core';
import { type ParsedMail, simpleParser } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMailer, type Mailer } from '../src/email/smtp.ts';
import { createHandlers } from '../src/handlers.ts';
import { createWorker, type Worker } from '../src/worker.ts';
import {
  captureLogger,
  clearJobs,
  getJob,
  handlerDependencies,
  openDatabase,
  testDatabaseUrl,
  waitFor,
} from './helpers.ts';

// `email.send` de ponta a ponta contra um servidor SMTP em processo (smtp-server): STARTTLS
// com o certificado autoassinado dele e autenticação, como um SMTP real exige.

const SMTP_USER = 'nuva-worker';
const SMTP_PASSWORD = 'senha-do-smtp-de-teste';
const SCHOOL = 'Escola de Teste';
const CLASSROOM_URL = 'http://classroom.localhost:8080';
const ADMIN_URL = 'http://edu-admin.localhost:8080';
const TOKEN_IN_LINK = /\/(?:confirmar|redefinir)\?token=([A-Za-z0-9_-]{43})/;

interface SmtpBehavior {
  /** Responde 451 (temporário) ao DATA nas próximas N mensagens. */
  failData: number;
}

let db: Database;
let server: SMTPServer;
let port: number;
let mailer: Mailer;
const received: ParsedMail[] = [];
const behavior: SmtpBehavior = { failData: 0 };
const authAttempts: { user: string | undefined; ok: boolean }[] = [];
let worker: Worker | null = null;
let captured = captureLogger();

function smtpConfig(overrides: Partial<Config['smtp']> = {}): Config['smtp'] {
  return {
    host: '127.0.0.1',
    port,
    user: SMTP_USER,
    password: SMTP_PASSWORD,
    from: `${SCHOOL} <no-reply@escola.test>`,
    ...overrides,
  };
}

async function startWorker(): Promise<void> {
  captured = captureLogger();
  worker = createWorker({
    db,
    databaseUrl: testDatabaseUrl(),
    logger: captured.logger,
    handlers: createHandlers(
      handlerDependencies(db, captured.logger, {
        mailer,
        classroomUrl: CLASSROOM_URL,
        adminUrl: ADMIN_URL,
      }),
    ),
    concurrency: 2,
    sweepIntervalMs: 50,
  });
  await worker.start();
}

async function createUser(email = `aluno-${randomUUID()}@escola.test`): Promise<string> {
  const row = await db
    .insertInto('users')
    .values({ email, name: 'Ana Teste' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function send<T extends EmailType>(
  userId: string,
  type: T,
  data: EmailDataInput<T>,
): Promise<{ outboxId: string; jobId: string }> {
  const queued = await db.transaction().execute((trx) => enqueueEmail(trx, { userId, type, data }));
  if (!queued) {
    throw new Error('e-mail não enfileirado');
  }
  return queued;
}

async function outbox(id: string) {
  return db.selectFrom('emailOutbox').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}

async function jobDone(jobId: string, status: 'done' | 'failed' = 'done'): Promise<void> {
  await waitFor(async () => (await getJob(db, jobId)).status === status);
}

beforeAll(async () => {
  db = openDatabase(8);
  server = new SMTPServer({
    logger: false,
    // STARTTLS anunciado, com o certificado autoassinado que acompanha o smtp-server.
    authMethods: ['PLAIN', 'LOGIN'],
    onAuth(auth, _session, callback) {
      const ok = auth.username === SMTP_USER && auth.password === SMTP_PASSWORD;
      authAttempts.push({ user: auth.username, ok });
      callback(
        ok ? null : new Error('credenciais inválidas'),
        ok ? { user: SMTP_USER } : undefined,
      );
    },
    onRcptTo(address, _session, callback) {
      if (address.address.startsWith('recusado')) {
        const error = Object.assign(new Error(`<${address.address}>: mailbox unavailable`), {
          responseCode: 550,
        });
        callback(error);
        return;
      }
      callback();
    },
    onData(stream, _session, callback) {
      simpleParser(stream).then(
        (mail) => {
          if (behavior.failData > 0) {
            behavior.failData -= 1;
            callback(Object.assign(new Error('try again later'), { responseCode: 451 }));
            return;
          }
          received.push(mail);
          callback();
        },
        (error: Error) => callback(error),
      );
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.server.address() as AddressInfo).port;
  mailer = createMailer(smtpConfig(), { tls: { rejectUnauthorized: false } });
  await setSetting(db, 'school.name', SCHOOL);
});

afterAll(async () => {
  mailer.close();
  await new Promise<void>((resolve) => server.close(resolve));
  await db.deleteFrom('settings').where('key', '=', 'school.name').execute();
  await db.destroy();
});

beforeEach(async () => {
  await clearJobs(db);
  received.length = 0;
  behavior.failData = 0;
  authAttempts.length = 0;
  await startWorker();
});

afterEach(async () => {
  await worker?.stop({ timeoutMs: 1_000 });
  worker = null;
});

describe('email.send', () => {
  it('envia a confirmação com STARTTLS, autenticação e link com token válido', async () => {
    const email = `confirma-${randomUUID()}@escola.test`;
    const userId = await createUser(email);
    const { outboxId, jobId } = await send(userId, 'account.verify_email', {});
    await jobDone(jobId);

    expect(received).toHaveLength(1);
    const mail = received[0] as ParsedMail;
    expect(mail.subject).toBe(`Confirme seu e-mail em ${SCHOOL}`);
    const to = Array.isArray(mail.to) ? mail.to[0] : mail.to;
    expect(to?.value[0]?.address).toBe(email);
    expect(mail.text).toContain('Olá, Ana Teste.');
    expect(mail.html).toContain(SCHOOL);
    expect(authAttempts).toEqual([{ user: SMTP_USER, ok: true }]);

    const token = TOKEN_IN_LINK.exec(mail.text ?? '')?.[1];
    expect(token).toBeDefined();
    expect(mail.text).toContain(`${CLASSROOM_URL}/confirmar?token=${token}`);
    expect(mail.html).toContain(`${CLASSROOM_URL}/confirmar?token=${token}`);

    const row = await outbox(outboxId);
    expect(row).toMatchObject({
      status: 'sent',
      subject: `Confirme seu e-mail em ${SCHOOL}`,
      attempts: 1,
      lastError: null,
    });
    expect(row.sentAt).not.toBeNull();

    // O token em claro não está em log, em `jobs`, em `email_outbox` nem em `email_tokens`.
    const secret = token as string;
    const logs = JSON.stringify(captured.lines);
    expect(logs).not.toContain(secret);
    expect(logs).not.toContain(SMTP_PASSWORD);
    expect(logs).not.toContain(email);
    const jobs = await db.selectFrom('jobs').selectAll().execute();
    expect(JSON.stringify(jobs)).not.toContain(secret);
    expect(JSON.stringify(row)).not.toContain(secret);
    const tokens = await db
      .selectFrom('emailTokens')
      .selectAll()
      .where('userId', '=', userId)
      .execute();
    expect(tokens).toHaveLength(1);
    expect(JSON.stringify(tokens)).not.toContain(secret);

    // O link funciona: o token confere com o propósito `verify`, uma vez só.
    const owner = await db.transaction().execute((trx) => consumeEmailToken(trx, secret, 'verify'));
    expect(owner.userId).toBe(userId);
  });

  it('não envia de novo uma linha já enviada', async () => {
    const userId = await createUser();
    const { outboxId, jobId } = await send(userId, 'account.password_changed', { by: 'self' });
    await jobDone(jobId);
    expect(received).toHaveLength(1);
    const first = await outbox(outboxId);

    const again = await enqueue(db, 'email.send', { outboxId });
    await jobDone(again?.id ?? '');
    expect(received).toHaveLength(1);
    expect(await outbox(outboxId)).toEqual(first);
  });

  it('marca failed sem nova tentativa quando o servidor recusa o destinatário (5xx)', async () => {
    const email = `recusado-${randomUUID()}@escola.test`;
    const userId = await createUser(email);
    const { outboxId, jobId } = await send(userId, 'account.password_reset', {});
    await jobDone(jobId, 'failed');

    const job = await getJob(db, jobId);
    expect(job.attempts).toBe(1);
    expect(job.lastError).toContain('smtp: EENVELOPE 550');
    expect(job.lastError).not.toContain(email);
    const row = await outbox(outboxId);
    expect(row).toMatchObject({ status: 'failed', attempts: 1, sentAt: null, subject: null });
    expect(row.lastError).toBe('smtp: EENVELOPE 550 (recusa permanente)');
    expect(JSON.stringify(captured.lines)).not.toContain(email);
    // A transação desfez o token: nenhum link válido ficou sem e-mail.
    const tokens = await db
      .selectFrom('emailTokens')
      .select('id')
      .where('userId', '=', userId)
      .execute();
    expect(tokens).toHaveLength(0);
    expect(received).toHaveLength(0);
  });

  it('erro temporário volta à fila com a espera própria e envia na tentativa seguinte', async () => {
    behavior.failData = 1;
    const userId = await createUser();
    const { outboxId, jobId } = await send(userId, 'account.password_reset', {});
    await waitFor(
      async () =>
        (await getJob(db, jobId)).attempts === 1 && (await getJob(db, jobId)).status === 'queued',
    );

    const waiting = await getJob(db, jobId);
    const waitSeconds = (waiting.runAt.getTime() - Date.now()) / 1000;
    expect(waitSeconds).toBeGreaterThan(50);
    expect(waitSeconds).toBeLessThanOrEqual(60);
    expect(await outbox(outboxId)).toMatchObject({
      status: 'queued',
      attempts: 1,
      lastError: 'smtp: EMESSAGE 451',
    });

    await db
      .updateTable('jobs')
      .set({ runAt: new Date(Date.now() - 1_000) })
      .where('id', '=', jobId)
      .execute();
    await jobDone(jobId);
    expect(received).toHaveLength(1);
    const token = TOKEN_IN_LINK.exec(received[0]?.text ?? '')?.[1] as string;
    expect(received[0]?.text).toContain(`${CLASSROOM_URL}/redefinir?token=${token}`);
    expect(await outbox(outboxId)).toMatchObject({ status: 'sent', attempts: 2, lastError: null });
    const owner = await db.transaction().execute((trx) => consumeEmailToken(trx, token, 'reset'));
    expect(owner.userId).toBe(userId);
  });

  it('novo envio do mesmo propósito invalida o link anterior', async () => {
    const userId = await createUser();
    const first = await send(userId, 'account.password_reset', {});
    await jobDone(first.jobId);
    const second = await send(userId, 'account.password_reset', {});
    await jobDone(second.jobId);
    const [old, current] = received.map((mail) => TOKEN_IN_LINK.exec(mail.text ?? '')?.[1] ?? '');
    await expect(
      db.transaction().execute((trx) => consumeEmailToken(trx, old as string, 'reset')),
    ).rejects.toMatchObject({ code: 'token_expired' });
    const owner = await db
      .transaction()
      .execute((trx) => consumeEmailToken(trx, current as string, 'reset'));
    expect(owner.userId).toBe(userId);
  });

  it('dispensa a confirmação de quem já confirmou o e-mail', async () => {
    const userId = await createUser();
    const { outboxId, jobId } = await send(userId, 'account.verify_email', {});
    await worker?.stop({ timeoutMs: 1_000 });
    await db
      .updateTable('users')
      .set({ emailVerifiedAt: new Date() })
      .where('id', '=', userId)
      .execute();
    await startWorker();
    await jobDone(jobId);
    expect(received).toHaveLength(0);
    expect(await outbox(outboxId)).toMatchObject({
      status: 'sent',
      subject: null,
      lastError: 'skipped: already_verified',
    });
  });

  it('linha inexistente conclui sem enviar', async () => {
    const job = await enqueue(db, 'email.send', { outboxId: randomUUID() });
    await jobDone(job?.id ?? '');
    expect(received).toHaveLength(0);
  });

  it('servidor sem STARTTLS: o cliente recusa enviar sem TLS', async () => {
    const plain = new SMTPServer({
      logger: false,
      hideSTARTTLS: true,
      authOptional: true,
      onData(stream, _session, callback) {
        stream.resume();
        stream.on('end', () => callback());
      },
    });
    await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
    const plainPort = (plain.server.address() as AddressInfo).port;
    const insecure = createMailer(smtpConfig({ port: plainPort, user: null, password: null }));
    try {
      await expect(
        insecure.send({ to: 'a@escola.test', subject: 'x', text: 'x', html: '<p>x</p>' }),
      ).rejects.toMatchObject({ code: expect.any(String) });
    } finally {
      insecure.close();
      await new Promise<void>((resolve) => plain.close(resolve));
    }
  });
});
