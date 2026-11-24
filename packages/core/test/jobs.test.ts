import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  claimJobs,
  closeDatabase,
  completeJob,
  createDatabase,
  createLogger,
  type Database,
  EMAIL_SEND_RETRY_DELAYS_SECONDS,
  enqueue,
  enqueueRecurring,
  failJob,
  formatJobError,
  getJobCounts,
  getJobCountsByType,
  getOldestPendingJobAgeSeconds,
  heartbeatJobs,
  isDomainError,
  isJobType,
  isKnownJob,
  isPermanentJobError,
  JOB_DEFINITIONS,
  type Job,
  type JobListener,
  listenForJobs,
  PermanentJobError,
  recurringKey,
  releaseJob,
  requeueStaleJobs,
  retryJob,
} from '../src/index.ts';

let db: Database;
/** Segunda conexão, com pool próprio: outro "processo" disputando a fila. */
let other: Database;

beforeAll(() => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 6 });
  other = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 6 });
});

afterAll(async () => {
  await closeDatabase(db);
  await closeDatabase(other);
});

beforeEach(async () => {
  await sql`DELETE FROM jobs`.execute(db);
});

async function getJob(id: string): Promise<Job> {
  const result = await sql<Job>`SELECT * FROM jobs WHERE id = ${id}`.execute(db);
  const job = result.rows[0];
  if (!job) {
    throw new Error(`tarefa ${id} não existe`);
  }
  return job;
}

async function waitFor(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condição não atendida a tempo');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('registro de tipos', () => {
  it('reconhece os tipos do registro e recusa os demais', () => {
    expect(Object.keys(JOB_DEFINITIONS).sort()).toEqual([
      'email.send',
      'example.echo',
      'retention.purge',
    ]);
    expect(isJobType('retention.purge')).toBe(true);
    expect(isJobType('email.send')).toBe(true);
    expect(isJobType('notify')).toBe(false);
    expect(isJobType('toString')).toBe(false);
  });
});

describe('enqueue', () => {
  it('grava a tarefa imediata com os padrões do tipo e o payload intacto', async () => {
    const job = await enqueue(db, 'example.echo', { message: 'olá' });
    expect(job).toMatchObject({
      type: 'example.echo',
      payload: { message: 'olá' },
      status: 'queued',
      priority: 0,
      attempts: 0,
      maxAttempts: 3,
      uniqueKey: null,
      lockedBy: null,
      finishedAt: null,
    });
    expect(job?.id).toMatch(/^[0-9a-f-]{36}$/);
    // Imediata: run_at é o padrão do banco, igual ao created_at da mesma instrução.
    expect(job?.runAt).toEqual(job?.createdAt);
    expect(job && isKnownJob(job)).toBe(true);
  });

  it('aceita prioridade, máximo de tentativas e data próprios', async () => {
    const runAt = new Date(Date.now() + 60_000);
    const job = await enqueue(
      db,
      'example.echo',
      { message: 'depois' },
      { runAt, priority: 10, maxAttempts: 8 },
    );
    expect(job).toMatchObject({ priority: 10, maxAttempts: 8, runAt });
  });

  it('enfileira junto com a transação: desfeita, a tarefa não existe', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await enqueue(trx, 'example.echo', { message: 'some' });
        throw new Error('desiste');
      }),
    ).rejects.toThrow('desiste');
    expect(await getJobCounts(db)).toMatchObject({ queued: 0 });

    await db.transaction().execute(async (trx) => {
      await enqueue(trx, 'example.echo', { message: 'fica' });
    });
    expect(await getJobCounts(db)).toMatchObject({ queued: 1 });
  });

  it('com uniqueKey não cria segunda tarefa ativa, e volta a aceitar depois de concluída', async () => {
    const first = await enqueue(db, 'example.echo', { message: 'a' }, { uniqueKey: 'eco:1' });
    expect(first?.uniqueKey).toBe('eco:1');
    expect(await enqueue(db, 'example.echo', { message: 'b' }, { uniqueKey: 'eco:1' })).toBeNull();

    // Em execução ainda conta como ativa.
    const [running] = await claimJobs(db, { workerId: 'w1', limit: 1 });
    expect(running?.id).toBe(first?.id);
    expect(await enqueue(db, 'example.echo', { message: 'c' }, { uniqueKey: 'eco:1' })).toBeNull();

    // Outra chave não é barrada.
    expect(
      await enqueue(db, 'example.echo', { message: 'd' }, { uniqueKey: 'eco:2' }),
    ).not.toBeNull();

    await completeJob(db, { jobId: running?.id ?? '', workerId: 'w1' });
    const again = await enqueue(db, 'example.echo', { message: 'e' }, { uniqueKey: 'eco:1' });
    expect(again).not.toBeNull();
    expect(again?.id).not.toBe(first?.id);
  });

  it('dois chamadores simultâneos com a mesma uniqueKey criam uma só', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        enqueue(
          index % 2 ? db : other,
          'example.echo',
          { message: 'x' },
          { uniqueKey: 'eco:junto' },
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await getJobCounts(db)).toMatchObject({ queued: 1 });
  });
});

describe('claim', () => {
  it('marca running com a trava do worker e conta a tentativa', async () => {
    const job = await enqueue(db, 'example.echo', { message: 'a' });
    const [claimed] = await claimJobs(db, { workerId: 'w1', limit: 5 });
    expect(claimed).toMatchObject({
      id: job?.id,
      status: 'running',
      lockedBy: 'w1',
      attempts: 1,
    });
    expect(claimed?.lockedAt).toBeInstanceOf(Date);
    expect(claimed?.heartbeatAt).toEqual(claimed?.lockedAt);
    expect(await claimJobs(db, { workerId: 'w2', limit: 5 })).toEqual([]);
    expect(await claimJobs(db, { workerId: 'w2', limit: 0 })).toEqual([]);
  });

  it('entrega por prioridade e depois por run_at, respeitando o limite', async () => {
    const now = Date.now();
    const old = await enqueue(
      db,
      'example.echo',
      { message: 'antiga' },
      { runAt: new Date(now - 60_000) },
    );
    const recent = await enqueue(
      db,
      'example.echo',
      { message: 'recente' },
      { runAt: new Date(now - 1_000) },
    );
    const urgent = await enqueue(
      db,
      'example.echo',
      { message: 'urgente' },
      { runAt: new Date(now - 500), priority: 10 },
    );
    const firstTwo = await claimJobs(db, { workerId: 'w1', limit: 2 });
    expect(firstTwo.map((job) => job.id)).toEqual([urgent?.id, old?.id]);
    const rest = await claimJobs(db, { workerId: 'w1', limit: 2 });
    expect(rest.map((job) => job.id)).toEqual([recent?.id]);
  });

  it('agendada só é entregue quando run_at chega', async () => {
    const job = await enqueue(
      db,
      'example.echo',
      { message: 'amanhã' },
      { runAt: new Date(Date.now() + 3_600_000) },
    );
    expect(await claimJobs(db, { workerId: 'w1', limit: 5 })).toEqual([]);
    expect(await getJobCounts(db)).toMatchObject({ queued: 1, ready: 0 });

    await sql`UPDATE jobs SET run_at = now() - interval '1 second' WHERE id = ${job?.id}`.execute(
      db,
    );
    expect(await getJobCounts(db)).toMatchObject({ queued: 1, ready: 1 });
    const claimed = await claimJobs(db, { workerId: 'w1', limit: 5 });
    expect(claimed.map((item) => item.id)).toEqual([job?.id]);
  });

  it('1.000 tarefas e quatro consumidores concorrentes: cada uma é executada uma única vez', async () => {
    await sql`
      INSERT INTO jobs (type, payload)
      SELECT 'example.echo', jsonb_build_object('message', n::text) FROM generate_series(1, 1000) AS n
    `.execute(db);

    const seen = new Map<string, number>();
    const consume = async (connection: Database, workerId: string): Promise<number> => {
      let executed = 0;
      for (;;) {
        const jobs = await claimJobs(connection, { workerId, limit: 7 });
        if (jobs.length === 0) {
          return executed;
        }
        for (const job of jobs) {
          seen.set(job.id, (seen.get(job.id) ?? 0) + 1);
          expect(await completeJob(connection, { jobId: job.id, workerId })).toBe(true);
          executed += 1;
        }
      }
    };
    const executed = await Promise.all([
      consume(db, 'w1'),
      consume(other, 'w2'),
      consume(db, 'w3'),
      consume(other, 'w4'),
    ]);

    expect(executed.reduce((total, count) => total + count, 0)).toBe(1000);
    expect(seen.size).toBe(1000);
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
    // A carga se dividiu: nenhum consumidor ficou esperando a trava do outro.
    expect(executed.filter((count) => count > 0).length).toBeGreaterThan(1);
    expect(await getJobCounts(db)).toEqual({
      queued: 0,
      ready: 0,
      running: 0,
      done: 1000,
      failed: 0,
    });
    const attempts = await sql<{ max: number }>`SELECT max(attempts)::int AS max FROM jobs`.execute(
      db,
    );
    expect(attempts.rows[0]?.max).toBe(1);
  }, 60_000);
});

describe('heartbeat, complete e release', () => {
  it('renova o batimento só das tarefas travadas pelo worker', async () => {
    await enqueue(db, 'example.echo', { message: 'a' });
    await enqueue(db, 'example.echo', { message: 'b' });
    const [mine] = await claimJobs(db, { workerId: 'w1', limit: 1 });
    const [theirs] = await claimJobs(db, { workerId: 'w2', limit: 1 });
    await sql`UPDATE jobs SET heartbeat_at = now() - interval '2 minutes'`.execute(db);

    const alive = await heartbeatJobs(db, {
      workerId: 'w1',
      jobIds: [mine?.id ?? '', theirs?.id ?? ''],
    });
    expect(alive).toEqual([mine?.id]);
    const refreshed = await getJob(mine?.id ?? '');
    expect(Date.now() - (refreshed.heartbeatAt?.getTime() ?? 0)).toBeLessThan(30_000);
    const untouched = await getJob(theirs?.id ?? '');
    expect(Date.now() - (untouched.heartbeatAt?.getTime() ?? 0)).toBeGreaterThan(90_000);
    expect(await heartbeatJobs(db, { workerId: 'w1', jobIds: [] })).toEqual([]);
  });

  it('conclui guardando quem executou, e recusa quem não tem a trava', async () => {
    await enqueue(db, 'example.echo', { message: 'a' });
    const [job] = await claimJobs(db, { workerId: 'w1', limit: 1 });
    const lock = { jobId: job?.id ?? '', workerId: 'w1' };
    expect(await completeJob(db, { ...lock, workerId: 'intruso' })).toBe(false);
    expect(await completeJob(db, lock)).toBe(true);
    expect(await completeJob(db, lock)).toBe(false);
    const done = await getJob(lock.jobId);
    expect(done).toMatchObject({ status: 'done', lockedBy: 'w1', attempts: 1 });
    expect(done.finishedAt).toBeInstanceOf(Date);
  });

  it('release devolve à fila sem contar a tentativa interrompida', async () => {
    await enqueue(db, 'example.echo', { message: 'a' });
    const [job] = await claimJobs(db, { workerId: 'w1', limit: 1 });
    const lock = { jobId: job?.id ?? '', workerId: 'w1' };
    expect(await releaseJob(db, { ...lock, workerId: 'intruso' })).toBe(false);
    expect(await releaseJob(db, lock)).toBe(true);
    expect(await getJob(lock.jobId)).toMatchObject({
      status: 'queued',
      attempts: 0,
      lockedBy: null,
      lockedAt: null,
      heartbeatAt: null,
    });
    const [again] = await claimJobs(db, { workerId: 'w2', limit: 1 });
    expect(again).toMatchObject({ id: lock.jobId, attempts: 1, lockedBy: 'w2' });
  });
});

describe('fail', () => {
  it('volta à fila com espera crescente e termina failed ao esgotar', async () => {
    const created = await enqueue(db, 'example.echo', { message: 'a' });
    const jobId = created?.id ?? '';
    const makeReady = () =>
      sql`UPDATE jobs SET run_at = now() - interval '1 second' WHERE id = ${jobId}`.execute(db);
    const delaySeconds = (job: Job | null) => ((job?.runAt.getTime() ?? 0) - Date.now()) / 1000;

    // 1ª falha: 2^1 × 30 s = 60 s; sem variação quando random() = 0,5.
    await claimJobs(db, { workerId: 'w1', limit: 1 });
    const first = await failJob(db, {
      jobId,
      workerId: 'w1',
      error: new Error('SMTP fora do ar'),
      random: () => 0.5,
    });
    expect(first).toMatchObject({
      status: 'queued',
      attempts: 1,
      lockedBy: null,
      lockedAt: null,
      heartbeatAt: null,
      finishedAt: null,
    });
    expect(first?.lastError).toContain('SMTP fora do ar');
    expect(delaySeconds(first)).toBeGreaterThan(55);
    expect(delaySeconds(first)).toBeLessThan(61);
    // Adiada: ninguém pega antes da hora.
    expect(await claimJobs(db, { workerId: 'w1', limit: 1 })).toEqual([]);

    // 2ª falha: 2^2 × 30 s = 120 s, no piso da variação (−20%) = 96 s.
    await makeReady();
    await claimJobs(db, { workerId: 'w2', limit: 1 });
    const second = await failJob(db, {
      jobId,
      workerId: 'w2',
      error: 'texto solto',
      random: () => 0,
    });
    expect(second).toMatchObject({ status: 'queued', attempts: 2, lastError: 'texto solto' });
    expect(delaySeconds(second)).toBeGreaterThan(91);
    expect(delaySeconds(second)).toBeLessThan(97);

    // 3ª falha, com max_attempts = 3: estado final, com a trava como registro.
    await makeReady();
    await claimJobs(db, { workerId: 'w3', limit: 1 });
    const third = await failJob(db, { jobId, workerId: 'w3', error: new Error('de novo') });
    expect(third).toMatchObject({ status: 'failed', attempts: 3, lockedBy: 'w3' });
    expect(third?.finishedAt).toBeInstanceOf(Date);
    expect(third?.lastError).toContain('de novo');

    // failed não é reprocessada sozinha.
    await makeReady();
    expect(await claimJobs(db, { workerId: 'w1', limit: 1 })).toEqual([]);
    expect(await getJobCounts(db)).toMatchObject({ failed: 1, queued: 0 });
  });

  it('limita a espera a 6 horas (mais a variação)', async () => {
    const created = await enqueue(db, 'example.echo', { message: 'a' }, { maxAttempts: 30 });
    const jobId = created?.id ?? '';
    await sql`UPDATE jobs SET attempts = 20 WHERE id = ${jobId}`.execute(db);
    await claimJobs(db, { workerId: 'w1', limit: 1 });
    const failed = await failJob(db, {
      jobId,
      workerId: 'w1',
      error: new Error('x'),
      random: () => 0.999999,
    });
    const hours = ((failed?.runAt.getTime() ?? 0) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(7.1);
    expect(hours).toBeLessThan(7.21);
  });

  it('email.send segue a espera própria da spec 024, sem variação, e termina failed', async () => {
    expect(JOB_DEFINITIONS['email.send']).toMatchObject({ maxAttempts: 5 });
    expect(EMAIL_SEND_RETRY_DELAYS_SECONDS).toEqual([60, 300, 1_800, 7_200, 43_200]);
    const created = await enqueue(db, 'email.send', { outboxId: 'linha-1' });
    const jobId = created?.id ?? '';
    expect(created).toMatchObject({ maxAttempts: 5, payload: { outboxId: 'linha-1' } });
    const makeReady = () =>
      sql`UPDATE jobs SET run_at = now() - interval '1 second' WHERE id = ${jobId}`.execute(db);
    const delaySeconds = (job: Job | null) => ((job?.runAt.getTime() ?? 0) - Date.now()) / 1000;

    // Depois de cada tentativa: 1 min, 5 min, 30 min, 2 h; random() no extremo não muda nada.
    for (const expected of [60, 300, 1_800, 7_200]) {
      await claimJobs(db, { workerId: 'w1', limit: 1 });
      const failed = await failJob(db, {
        jobId,
        workerId: 'w1',
        error: new Error('SMTP fora do ar'),
        random: () => 0.999999,
      });
      expect(failed?.status).toBe('queued');
      expect(delaySeconds(failed)).toBeGreaterThan(expected - 5);
      expect(delaySeconds(failed)).toBeLessThanOrEqual(expected);
      await makeReady();
    }
    await claimJobs(db, { workerId: 'w1', limit: 1 });
    const last = await failJob(db, { jobId, workerId: 'w1', error: new Error('SMTP fora do ar') });
    expect(last).toMatchObject({ status: 'failed', attempts: 5 });
  });

  it('email.send com mais tentativas usa 12 h e repete o último item', async () => {
    const created = await enqueue(db, 'email.send', { outboxId: 'linha-2' }, { maxAttempts: 9 });
    const jobId = created?.id ?? '';
    for (const attempts of [4, 6]) {
      await sql`UPDATE jobs SET attempts = ${attempts}, status = 'queued', run_at = now() WHERE id = ${jobId}`.execute(
        db,
      );
      await claimJobs(db, { workerId: 'w1', limit: 1 });
      const failed = await failJob(db, { jobId, workerId: 'w1', error: new Error('x') });
      const hours = ((failed?.runAt.getTime() ?? 0) - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(11.99);
      expect(hours).toBeLessThanOrEqual(12);
    }
  });

  it('erro permanente marca failed sem nova tentativa, em qualquer tipo', async () => {
    for (const type of ['email.send', 'example.echo'] as const) {
      const created =
        type === 'email.send'
          ? await enqueue(db, type, { outboxId: 'linha-3' })
          : await enqueue(db, type, { message: 'a' });
      await claimJobs(db, { workerId: 'w1', limit: 5 });
      const error = new PermanentJobError('550 destinatário recusado');
      expect(isPermanentJobError(error)).toBe(true);
      expect(isPermanentJobError(new Error('x'))).toBe(false);
      const failed = await failJob(db, { jobId: created?.id ?? '', workerId: 'w1', error });
      expect(failed).toMatchObject({ status: 'failed', attempts: 1, lockedBy: 'w1' });
      expect(failed?.finishedAt).toBeInstanceOf(Date);
      expect(failed?.lastError).toContain('PermanentJobError: 550 destinatário recusado');
    }
  });

  it('ignora quem não tem mais a trava', async () => {
    await enqueue(db, 'example.echo', { message: 'a' });
    const [job] = await claimJobs(db, { workerId: 'w1', limit: 1 });
    expect(
      await failJob(db, { jobId: job?.id ?? '', workerId: 'intruso', error: new Error('x') }),
    ).toBeNull();
    expect(await getJob(job?.id ?? '')).toMatchObject({ status: 'running', lastError: null });
  });

  it('grava last_error já mascarado e com tamanho limitado', async () => {
    await enqueue(db, 'example.echo', { message: 'a' });
    const [job] = await claimJobs(db, { workerId: 'w1', limit: 1 });
    const error = new Error(
      'falha em postgres://nuva:segredo-do-banco@db:5432/nuva com senha=abc123 do CPF 529.982.247-25',
    );
    const failed = await failJob(db, { jobId: job?.id ?? '', workerId: 'w1', error });
    expect(failed?.lastError).toContain('[REDACTED]');
    expect(failed?.lastError).not.toContain('segredo-do-banco');
    expect(failed?.lastError).not.toContain('abc123');
    expect(failed?.lastError).not.toContain('529.982.247-25');
    // A pilha vai junto, para achar o erro de programação.
    expect(failed?.lastError).toContain('jobs.test.ts');

    expect(formatJobError('x'.repeat(20_000)).length).toBe(8_001);
    const stackless = new Error('sem pilha');
    delete stackless.stack;
    expect(formatJobError(stackless)).toBe('Error: sem pilha');
    expect(formatJobError(42)).toBe('42');
  });
});

describe('requeueStale', () => {
  it('devolve à fila a tarefa sem batimento e deixa as vivas', async () => {
    const stuck = await enqueue(db, 'example.echo', { message: 'presa' });
    const alive = await enqueue(db, 'example.echo', { message: 'viva' });
    await claimJobs(db, { workerId: 'morto', limit: 1 });
    await claimJobs(db, { workerId: 'vivo', limit: 1 });
    await sql`UPDATE jobs SET heartbeat_at = now() - interval '6 minutes' WHERE id = ${stuck?.id}`.execute(
      db,
    );
    await sql`UPDATE jobs SET heartbeat_at = now() - interval '4 minutes' WHERE id = ${alive?.id}`.execute(
      db,
    );

    const requeued = await requeueStaleJobs(db);
    expect(requeued.map((job) => job.id)).toEqual([stuck?.id]);
    expect(requeued[0]).toMatchObject({
      status: 'queued',
      attempts: 1,
      lockedBy: null,
      lockedAt: null,
      heartbeatAt: null,
      finishedAt: null,
    });
    expect(requeued[0]?.lastError).toContain('Tarefa presa');
    expect(await getJob(alive?.id ?? '')).toMatchObject({ status: 'running', lockedBy: 'vivo' });

    // Pronta na hora para outro worker; o que morreu não conclui mais.
    const [again] = await claimJobs(db, { workerId: 'w2', limit: 5 });
    expect(again).toMatchObject({ id: stuck?.id, attempts: 2, lockedBy: 'w2' });
    expect(await completeJob(db, { jobId: stuck?.id ?? '', workerId: 'morto' })).toBe(false);
    expect(await heartbeatJobs(db, { workerId: 'morto', jobIds: [stuck?.id ?? ''] })).toEqual([]);
  });

  it('presa na última tentativa fica failed; o prazo é ajustável', async () => {
    const job = await enqueue(db, 'example.echo', { message: 'a' }, { maxAttempts: 1 });
    await claimJobs(db, { workerId: 'morto', limit: 1 });
    await sql`UPDATE jobs SET heartbeat_at = now() - interval '10 seconds'`.execute(db);
    expect(await requeueStaleJobs(db)).toEqual([]);

    const [failed] = await requeueStaleJobs(db, { staleAfterMs: 5_000 });
    expect(failed).toMatchObject({ id: job?.id, status: 'failed', attempts: 1, lockedBy: 'morto' });
    expect(failed?.finishedAt).toBeInstanceOf(Date);
    expect(await requeueStaleJobs(db, { staleAfterMs: 5_000 })).toEqual([]);
  });
});

describe('retry', () => {
  async function failedJob(uniqueKey?: string): Promise<string> {
    const job = await enqueue(
      db,
      'example.echo',
      { message: 'a' },
      { maxAttempts: 1, ...(uniqueKey ? { uniqueKey } : {}) },
    );
    await claimJobs(db, { workerId: 'w1', limit: 1 });
    await failJob(db, { jobId: job?.id ?? '', workerId: 'w1', error: new Error('quebrou') });
    return job?.id ?? '';
  }

  it('reenfileira a failed para agora, com as tentativas zeradas', async () => {
    const jobId = await failedJob();
    const retried = await retryJob(db, jobId);
    expect(retried).toMatchObject({
      id: jobId,
      status: 'queued',
      attempts: 0,
      finishedAt: null,
      lockedBy: null,
      lockedAt: null,
      heartbeatAt: null,
    });
    expect(retried?.lastError).toContain('quebrou');
    const [claimed] = await claimJobs(db, { workerId: 'w2', limit: 1 });
    expect(claimed).toMatchObject({ id: jobId, attempts: 1 });
  });

  it('devolve null para tarefa que não está failed ou não existe', async () => {
    const queued = await enqueue(db, 'example.echo', { message: 'a' });
    expect(await retryJob(db, queued?.id ?? '')).toBeNull();
    expect(await retryJob(db, '00000000-0000-7000-8000-000000000000')).toBeNull();
  });

  it('recusa quando já há tarefa ativa com a mesma chave', async () => {
    const jobId = await failedJob('eco:unica');
    await enqueue(db, 'example.echo', { message: 'nova' }, { uniqueKey: 'eco:unica' });
    const error = await retryJob(db, jobId).catch((reason: unknown) => reason);
    expect(isDomainError(error)).toBe(true);
    expect(error).toMatchObject({ code: 'job_already_active' });
    expect(await getJob(jobId)).toMatchObject({ status: 'failed' });
    // Qualquer outro erro do banco sobe como veio.
    await expect(retryJob(db, 'não-é-uuid')).rejects.toThrow(/uuid/);
  });
});

describe('enqueueRecurring', () => {
  it('usa a chave tipo + janela', async () => {
    expect(recurringKey('retention.purge', '2026-11-24')).toBe('retention.purge:2026-11-24');
    const job = await enqueueRecurring(db, 'retention.purge', {}, { window: '2026-11-24' });
    expect(job).toMatchObject({
      type: 'retention.purge',
      payload: {},
      uniqueKey: 'retention.purge:2026-11-24',
      status: 'queued',
      maxAttempts: 5,
    });
    expect(job?.runAt).toEqual(job?.createdAt);
    const scheduled = await enqueueRecurring(
      db,
      'retention.purge',
      {},
      {
        window: '2026-11-25',
        runAt: new Date('2026-11-25T06:30:00Z'),
        priority: 2,
        maxAttempts: 2,
      },
    );
    expect(scheduled).toMatchObject({
      runAt: new Date('2026-11-25T06:30:00Z'),
      priority: 2,
      maxAttempts: 2,
    });
  });

  it('dois chamadores simultâneos enfileiram a janela uma única vez', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        enqueueRecurring(index % 2 ? db : other, 'retention.purge', {}, { window: '2026-11-24' }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await getJobCounts(db)).toMatchObject({ queued: 1 });
  });

  it('não reenfileira a janela já concluída nem a que falhou, mesmo com chamadores simultâneos', async () => {
    await enqueueRecurring(db, 'retention.purge', {}, { window: '2026-11-24' });
    const [job] = await claimJobs(db, { workerId: 'w1', limit: 1 });
    await completeJob(db, { jobId: job?.id ?? '', workerId: 'w1' });

    const afterDone = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        enqueueRecurring(index % 2 ? db : other, 'retention.purge', {}, { window: '2026-11-24' }),
      ),
    );
    expect(afterDone.every((result) => result === null)).toBe(true);

    await enqueueRecurring(db, 'retention.purge', {}, { window: '2026-11-25', maxAttempts: 1 });
    const [next] = await claimJobs(db, { workerId: 'w1', limit: 1 });
    await failJob(db, { jobId: next?.id ?? '', workerId: 'w1', error: new Error('x') });
    expect(await enqueueRecurring(db, 'retention.purge', {}, { window: '2026-11-25' })).toBeNull();

    // A janela seguinte entra normalmente.
    expect(
      await enqueueRecurring(db, 'retention.purge', {}, { window: '2026-11-26' }),
    ).not.toBeNull();
    expect(await getJobCounts(db)).toEqual({ queued: 1, ready: 1, running: 0, done: 1, failed: 1 });
  });
});

describe('contagens', () => {
  it('conta por estado e por tipo', async () => {
    expect(await getJobCounts(db)).toEqual({ queued: 0, ready: 0, running: 0, done: 0, failed: 0 });
    expect(await getJobCountsByType(db)).toEqual([]);

    await enqueue(db, 'example.echo', { message: 'a' });
    await enqueue(db, 'example.echo', { message: 'b' }, { priority: 5 });
    await enqueue(
      db,
      'example.echo',
      { message: 'c' },
      { runAt: new Date(Date.now() + 3_600_000) },
    );
    await enqueueRecurring(db, 'retention.purge', {}, { window: '2026-11-24', priority: 9 });
    const [purge, echo] = await claimJobs(db, { workerId: 'w1', limit: 2 });
    await completeJob(db, { jobId: purge?.id ?? '', workerId: 'w1' });
    expect(echo?.type).toBe('example.echo');

    expect(await getJobCounts(db)).toEqual({ queued: 2, ready: 1, running: 1, done: 1, failed: 0 });
    expect(await getJobCountsByType(db)).toEqual([
      { type: 'example.echo', queued: 2, running: 1, done: 0, failed: 0 },
      { type: 'retention.purge', queued: 0, running: 0, done: 1, failed: 0 },
    ]);
  });
});

describe('getOldestPendingJobAgeSeconds', () => {
  it('devolve 0 com a fila vazia ou só com tarefas que ainda não podem executar', async () => {
    expect(await getOldestPendingJobAgeSeconds(db)).toBe(0);
    await enqueue(
      db,
      'example.echo',
      { message: 'depois' },
      { runAt: new Date(Date.now() + 3_600_000) },
    );
    const running = await enqueue(
      db,
      'example.echo',
      { message: 'em execução' },
      { runAt: new Date(Date.now() - 600_000) },
    );
    await claimJobs(db, { workerId: 'w1', limit: 1 });
    expect((await getJob(running?.id ?? '')).status).toBe('running');
    expect(await getOldestPendingJobAgeSeconds(db)).toBe(0);
  });

  it('mede a espera da pendente mais antiga, a partir de run_at', async () => {
    await enqueue(db, 'example.echo', { message: 'nova' });
    await enqueue(
      db,
      'example.echo',
      { message: 'velha' },
      { runAt: new Date(Date.now() - 90_000) },
    );
    await enqueue(
      db,
      'example.echo',
      { message: 'meio' },
      { runAt: new Date(Date.now() - 30_000) },
    );
    const age = await getOldestPendingJobAgeSeconds(db);
    expect(age).toBeGreaterThanOrEqual(89);
    expect(age).toBeLessThan(120);
    // Aceita transação, como as demais funções da fila.
    const inTransaction = await db
      .transaction()
      .execute((trx) => getOldestPendingJobAgeSeconds(trx));
    expect(inTransaction).toBeGreaterThanOrEqual(89);
  });
});

describe('listenForJobs', () => {
  const lines: string[] = [];
  const logger = createLogger({ service: 'core-test', write: (line) => lines.push(line) });
  let listener: JobListener | undefined;
  let wakes = 0;

  const start = (applicationName: string): JobListener => {
    wakes = 0;
    lines.length = 0;
    listener = listenForJobs({
      connectionString: inject('databaseUrl'),
      applicationName,
      logger,
      reconnectMinDelayMs: 20,
      reconnectMaxDelayMs: 100,
      onNotify: () => {
        wakes += 1;
      },
    });
    return listener;
  };

  afterAll(async () => {
    await listener?.close();
  });

  it('acorda com tarefa pronta, e só depois do COMMIT; agendada não acorda', async () => {
    const current = start('core-test-listen');
    expect(current.isConnected()).toBe(false);
    await current.whenConnected();
    expect(current.isConnected()).toBe(true);

    await enqueue(db, 'example.echo', { message: 'agora' });
    await waitFor(() => wakes === 1);

    await enqueue(
      db,
      'example.echo',
      { message: 'depois' },
      { runAt: new Date(Date.now() + 3_600_000) },
    );
    await expect(
      db.transaction().execute(async (trx) => {
        await enqueue(trx, 'example.echo', { message: 'desfeita' });
        throw new Error('desiste');
      }),
    ).rejects.toThrow('desiste');
    // Um aviso de outro canal não acorda.
    await sql`SELECT pg_notify('nuva_outro', '')`.execute(db);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(wakes).toBe(1);

    // Reenfileirar uma failed também acorda (gatilho de UPDATE).
    await sql`DELETE FROM jobs`.execute(db);
    const job = await enqueue(db, 'example.echo', { message: 'x' }, { maxAttempts: 1 });
    await waitFor(() => wakes === 2);
    await claimJobs(db, { workerId: 'w1', limit: 1 });
    await failJob(db, { jobId: job?.id ?? '', workerId: 'w1', error: new Error('x') });
    await retryJob(db, job?.id ?? '');
    await waitFor(() => wakes === 3);

    await current.close();
    expect(current.isConnected()).toBe(false);
    await enqueue(db, 'example.echo', { message: 'ninguém ouve' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(wakes).toBe(3);
  });

  it('reconecta quando a conexão cai, acorda o consumo e volta a ouvir', async () => {
    const current = start('core-test-listen-drop');
    await current.whenConnected();
    const killed = await sql<{ killed: boolean }>`
      SELECT pg_terminate_backend(pid) AS killed FROM pg_stat_activity
      WHERE application_name = 'core-test-listen-drop' AND datname = current_database()
    `.execute(db);
    expect(killed.rows).toEqual([{ killed: true }]);

    // Ao reconectar acorda uma vez, pelo que pode ter perdido.
    await waitFor(() => wakes === 1);
    expect(current.isConnected()).toBe(true);
    const messages = lines.map((line) => JSON.parse(line).msg);
    expect(messages).toContain('Escuta da fila caiu; reconectando');
    expect(messages).toContain('Escuta da fila reconectada');

    await enqueue(db, 'example.echo', { message: 'depois da queda' });
    await waitFor(() => wakes === 2);
    await current.close();
  });

  it('com o banco fora, segue tentando sem lançar, e encerra limpo', async () => {
    const warnings: string[] = [];
    const offline = listenForJobs({
      connectionString: 'postgres://nuva:senha-que-nao-pode-sair@127.0.0.1:1/nuva_edu',
      logger: createLogger({ service: 'core-test', write: (line) => warnings.push(line) }),
      reconnectMinDelayMs: 10,
      reconnectMaxDelayMs: 20,
      onNotify: () => {
        throw new Error('não deveria acordar');
      },
    });
    await waitFor(() => warnings.length >= 3);
    expect(offline.isConnected()).toBe(false);
    await offline.close();
    const count = warnings.length;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(warnings.length).toBe(count);
    expect(JSON.parse(warnings[0] ?? '{}')).toMatchObject({ level: 'warn', retry_in_ms: 10 });
    expect(JSON.parse(warnings[2] ?? '{}')).toMatchObject({ retry_in_ms: 20 });
    expect(warnings.join('')).not.toContain('senha-que-nao-pode-sair');
  });

  it('erro de quem é acordado não derruba a escuta', async () => {
    const errors: string[] = [];
    let calls = 0;
    const fragile = listenForJobs({
      connectionString: inject('databaseUrl'),
      logger: createLogger({ service: 'core-test', write: (line) => errors.push(line) }),
      onNotify: () => {
        calls += 1;
        throw new Error('laço quebrado');
      },
    });
    await fragile.whenConnected();
    await enqueue(db, 'example.echo', { message: 'a' });
    await waitFor(() => calls === 1);
    await enqueue(db, 'example.echo', { message: 'b' });
    await waitFor(() => calls === 2);
    expect(fragile.isConnected()).toBe(true);
    expect(JSON.parse(errors[0] ?? '{}')).toMatchObject({
      level: 'error',
      msg: 'Falha ao acordar o consumo da fila',
    });
    await fragile.close();
  });
});
