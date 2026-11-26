import { createHash, randomUUID } from 'node:crypto';
import {
  CERTIFICATE_EMPTY_IMAGE,
  type CertificateRequest,
  createAccount,
  createCertificatePreview,
  type Database,
  enqueue,
  type Job,
  type JobContext,
  type JobOf,
  type JobType,
  type Role,
  saveCourseCertificateTemplate,
  saveSchoolCertificateTemplate,
  updateLesson,
  verifyCertificate,
} from '@nuva-edu/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildCertificateDocument } from '../src/certificates/handlers.ts';
import {
  CertificateRenderError,
  type CertificateRenderer,
  createCertificateRenderer,
} from '../src/certificates/renderer.ts';
import { createHandlers } from '../src/handlers.ts';
import { createWorker, type Worker } from '../src/worker.ts';
import {
  captureLogger,
  clearJobs,
  getJob,
  handlerDependencies,
  openDatabase,
  readPdf,
  testDatabaseUrl,
  waitFor,
} from './helpers.ts';

// Conclusão de curso e certificados pelo worker real (specs 014 e 015; tarefa 435): o catálogo e
// o progresso são gravados direto nas tabelas, os templates pelas funções do núcleo, e o PDF sai
// do Chromium headless shell (`pnpm browsers:worker`).

const CLASSROOM = 'http://classroom.localhost:8080';
const TEMPLATE = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body { font-family: sans-serif; margin: 20mm; }
.qr svg { width: 30mm; height: 30mm; }
</style></head><body>
<h1>Certificado de conclusão</h1>
<p>Aluno: {{aluno.nome}}</p>
<p>Curso: {{ curso.titulo }}</p>
<p>Carga horária: {{curso.carga_horaria}} horas</p>
<p>Código: {{certificado.codigo}}</p>
<div class="qr">{{certificado.qrcode}}</div>
</body></html>`;

let db: Database;
let worker: Worker | null = null;
let renderer: CertificateRenderer;
const intercepted: string[] = [];
let admin: { id: string; role: Role };

function requestOf(user: { id: string; role: Role }): CertificateRequest {
  return { actor: user, context: { ip: '127.0.0.1', requestId: 'teste' } };
}

async function makeUser(role: Role = 'student', fullName: string | null = null) {
  const id = await db.transaction().execute((trx) =>
    createAccount(trx, {
      email: `${role}-${randomUUID()}@escola.test`,
      name: 'Ana Teste',
      password: 'Senha-Certificados-Worker-7Qa',
      role,
      emailVerified: true,
    }),
  );
  if (fullName !== null) {
    await db.updateTable('users').set({ fullName }).where('id', '=', id).execute();
  }
  return { id, role };
}

/** Curso `open` publicado com `lessons` aulas publicadas de 30 min. */
async function makeCourse(lessons = 2) {
  const course = await db
    .insertInto('courses')
    .values({
      slug: `curso-${randomUUID().slice(0, 13)}`,
      title: `Violão <básico> ${randomUUID().slice(0, 6)}`,
      accessMode: 'open',
      status: 'published',
      publishedAt: new Date(),
      certificateEnabled: true,
    })
    .returning(['id', 'title'])
    .executeTakeFirstOrThrow();
  const module = await db
    .insertInto('modules')
    .values({ courseId: course.id, title: 'Módulo', position: 0 })
    .returning('id')
    .executeTakeFirstOrThrow();
  const ids: string[] = [];
  for (let position = 0; position < lessons; position += 1) {
    const lesson = await db
      .insertInto('lessons')
      .values({
        moduleId: module.id,
        title: `Aula ${position + 1}`,
        videoUrl: 'https://youtu.be/abc12345678',
        videoProvider: 'youtube',
        durationSeconds: 1800,
        status: 'published',
        position,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    ids.push(lesson.id);
  }
  return { ...course, lessons: ids };
}

type Course = Awaited<ReturnType<typeof makeCourse>>;

async function complete(userId: string, course: Course, lessonIds = course.lessons) {
  for (const lessonId of lessonIds) {
    await db
      .insertInto('lessonProgress')
      .values({
        userId,
        lessonId,
        courseId: course.id,
        completedAt: new Date(),
        completedVia: 'manual',
      })
      .execute();
  }
}

async function withTemplate(course: Course, html = TEMPLATE) {
  return saveCourseCertificateTemplate(db, requestOf(admin), course.id, {
    html,
    expectedVersionId: null,
  });
}

/** O que a `classroom-api` enfileira ao levar o curso a 100% (spec 014). */
function enqueueCompleted(userId: string, courseId: string) {
  return enqueue(
    db,
    'course.completed',
    { userId, courseId },
    { uniqueKey: `course.completed:${userId}:${courseId}` },
  );
}

async function certificatesOf(userId: string, courseId: string) {
  return db
    .selectFrom('certificates')
    .selectAll()
    .where('userId', '=', userId)
    .where('courseId', '=', courseId)
    .execute();
}

async function waitForPdf(userId: string, courseId: string, timeoutMs = 60_000) {
  let pdf: Buffer | null = null;
  await waitFor(async () => {
    const [row] = await certificatesOf(userId, courseId);
    pdf = row?.pdf ?? null;
    return pdf !== null;
  }, timeoutMs);
  return pdf as unknown as Buffer;
}

async function startWorker(withRenderer: CertificateRenderer = renderer): Promise<Worker> {
  const { logger } = captureLogger();
  const started = createWorker({
    db,
    databaseUrl: testDatabaseUrl(),
    logger,
    handlers: createHandlers(handlerDependencies(db, logger, { renderer: withRenderer })),
    concurrency: 2,
    sweepIntervalMs: 50,
  });
  await started.start();
  return started;
}

function fakeJob<T extends JobType>(type: T, payload: JobOf<T>['payload']): JobOf<T> {
  return {
    id: randomUUID(),
    type,
    payload,
    status: 'running',
    priority: 0,
    runAt: new Date(),
    attempts: 1,
    maxAttempts: 5,
    uniqueKey: null,
    lockedBy: 'teste',
    lockedAt: new Date(),
    heartbeatAt: new Date(),
    lastError: null,
    createdAt: new Date(),
    finishedAt: null,
  } as JobOf<T>;
}

const context = (): JobContext => ({ signal: new AbortController().signal });

beforeAll(async () => {
  db = openDatabase(12);
  renderer = createCertificateRenderer({
    logger: captureLogger().logger,
    onRequest: (url) => intercepted.push(url),
  });
  admin = await makeUser('admin');
  // Sem padrão da escola: cada curso tem o template que o teste der.
  await db.deleteFrom('certificateTemplates').where('courseId', 'is', null).execute();
});

beforeEach(async () => {
  await clearJobs(db);
  worker = await startWorker();
});

afterEach(async () => {
  await worker?.stop({ timeoutMs: 5_000 });
  worker = null;
});

afterAll(async () => {
  await renderer.close();
  await db.destroy();
  // Nenhum template válido pede algo à rede.
  expect(intercepted).toEqual([]);
});

describe('course.completed', () => {
  it('emite o PDF em até 60 s e enfileira a notificação do certificado', {
    timeout: 90_000,
  }, async () => {
    const student = await makeUser('student', 'Ana <script>alert(1)</script> Souza');
    const course = await makeCourse();
    await withTemplate(course);
    await complete(student.id, course);
    const started = Date.now();
    await enqueueCompleted(student.id, course.id);

    const pdf = await waitForPdf(student.id, course.id);
    expect(Date.now() - started).toBeLessThan(60_000);
    const [certificate] = await certificatesOf(student.id, course.id);
    const code = certificate?.code ?? '';
    const formatted = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
    const read = await readPdf(pdf);
    expect(read.pages).toBe(1);
    expect(Math.round(read.width)).toBeGreaterThan(Math.round(read.height));
    expect(pdf.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(read.text).toContain('Certificado de conclusão');
    // O valor sai escapado: o texto aparece como foi escrito, sem virar marcação.
    expect(read.text).toContain('Aluno: Ana <script>alert(1)</script> Souza');
    expect(read.text).toContain(`Curso: ${course.title}`);
    expect(read.text).toContain('Carga horária: 1 horas');
    expect(read.text).toContain(`Código: ${formatted}`);
    expect(read.text).not.toContain('{{');

    const notifications = await db
      .selectFrom('jobs')
      .select('payload')
      .where('type', '=', 'notify')
      .where('payload', '@>', JSON.stringify({ userId: student.id, type: 'certificate.issued' }))
      .execute();
    expect(notifications).toMatchObject([
      {
        payload: {
          type: 'certificate.issued',
          userId: student.id,
          targetType: 'course',
          targetId: course.id,
          data: { courseTitle: course.title, code: formatted },
        },
      },
    ]);
  });

  it('sem template não cria certificado; o backfill do template emite', {
    timeout: 90_000,
  }, async () => {
    const student = await makeUser();
    const course = await makeCourse();
    await complete(student.id, course);
    const job = await enqueueCompleted(student.id, course.id);
    await waitFor(async () => (await getJob(db, job?.id ?? '')).status === 'done');
    expect(await certificatesOf(student.id, course.id)).toEqual([]);

    // Gravar o template enfileira `certificate.backfill` (núcleo), que emite para quem concluiu.
    const saved = await withTemplate(course);
    expect(saved.backfillQueued).toBe(true);
    const pdf = await waitForPdf(student.id, course.id);
    expect((await readPdf(pdf)).text).toContain('Aluno: Ana Teste');
  });

  it('o padrão da escola novo emite nos cursos sem template próprio', {
    timeout: 90_000,
  }, async () => {
    const student = await makeUser();
    const course = await makeCourse(1);
    await complete(student.id, course);
    try {
      await saveSchoolCertificateTemplate(db, requestOf(admin), {
        html: TEMPLATE.replace('Certificado de conclusão', 'Padrão da escola'),
        expectedVersionId: null,
      });
      const pdf = await waitForPdf(student.id, course.id);
      expect((await readPdf(pdf)).text).toContain('Padrão da escola');
    } finally {
      await db.deleteFrom('certificateTemplates').where('courseId', 'is', null).execute();
    }
  });

  it('duas tarefas simultâneas geram um certificado', { timeout: 30_000 }, async () => {
    await worker?.stop({ timeoutMs: 5_000 });
    worker = null;
    const student = await makeUser();
    const course = await makeCourse();
    await withTemplate(course);
    await clearJobs(db);
    await complete(student.id, course);
    const { logger } = captureLogger();
    const handlers = createHandlers(handlerDependencies(db, logger, { renderer }));
    const run = () =>
      handlers['course.completed']?.(
        fakeJob('course.completed', { userId: student.id, courseId: course.id }),
        context(),
      );
    await Promise.all([run(), run(), run()]);

    const certificates = await certificatesOf(student.id, course.id);
    expect(certificates).toHaveLength(1);
    const renders = await db
      .selectFrom('jobs')
      .select('id')
      .where('type', '=', 'certificate.render')
      .execute();
    expect(renders).toHaveLength(1);
    const notifications = await db
      .selectFrom('jobs')
      .select('id')
      .where('type', '=', 'notify')
      .where('payload', '@>', JSON.stringify({ userId: student.id, type: 'certificate.issued' }))
      .execute();
    expect(notifications).toHaveLength(1);
  });

  it('despublicar a aula que faltava emite os certificados de quem chegou a 100%', {
    timeout: 90_000,
  }, async () => {
    const student = await makeUser();
    const course = await makeCourse(3);
    await withTemplate(course);
    await complete(student.id, course, course.lessons.slice(0, 2));
    const missing = course.lessons[2] as string;
    const lesson = await db
      .selectFrom('lessons')
      .select('version')
      .where('id', '=', missing)
      .executeTakeFirstOrThrow();
    // A `admin-api` despublica e enfileira `course.completion_check` (núcleo).
    await updateLesson(db, requestOf(admin), missing, { status: 'draft', version: lesson.version });

    const pdf = await waitForPdf(student.id, course.id);
    expect((await readPdf(pdf)).text).toContain('Carga horária: 1 horas');
  });
});

describe('certificate.render', () => {
  it('falha do PDF repete, e o registro já valida', { timeout: 90_000 }, async () => {
    await worker?.stop({ timeoutMs: 5_000 });
    let failures = 0;
    const broken: CertificateRenderer = {
      render: async () => {
        failures += 1;
        throw new CertificateRenderError('browser', 'O navegador falhou ao gerar o PDF.');
      },
      isBrowserOpen: () => false,
      close: async () => {},
    };
    worker = await startWorker(broken);
    const student = await makeUser();
    const course = await makeCourse();
    await withTemplate(course);
    await complete(student.id, course);
    await enqueueCompleted(student.id, course.id);

    let renderJob: Job | undefined;
    await waitFor(async () => {
      renderJob = (await db
        .selectFrom('jobs')
        .selectAll()
        .where('type', '=', 'certificate.render')
        .where('attempts', '=', 1)
        .where('status', '=', 'queued')
        .executeTakeFirst()) as Job | undefined;
      return renderJob !== undefined;
    });
    expect(failures).toBe(1);
    expect(renderJob?.lastError).toContain('navegador');
    const [certificate] = await certificatesOf(student.id, course.id);
    expect(certificate?.pdf).toBeNull();
    const verification = await verifyCertificate(db, certificate?.code);
    expect(verification).toMatchObject({ status: 'valid' });

    // Nova tentativa com o navegador de volta: o PDF sai e o código continua o mesmo.
    await worker.stop({ timeoutMs: 5_000 });
    await db
      .updateTable('jobs')
      .set({ runAt: new Date() })
      .where('id', '=', renderJob?.id ?? '')
      .execute();
    worker = await startWorker();
    await waitForPdf(student.id, course.id);
    expect((await certificatesOf(student.id, course.id))[0]?.code).toBe(certificate?.code);
  });

  it('template que deixou de passar na validação falha sem nova tentativa', {
    timeout: 30_000,
  }, async () => {
    const student = await makeUser();
    const course = await makeCourse();
    await withTemplate(course);
    await complete(student.id, course);
    await worker?.stop({ timeoutMs: 5_000 });
    worker = null;
    const { logger } = captureLogger();
    const handlers = createHandlers(handlerDependencies(db, logger, { renderer }));
    await handlers['course.completed']?.(
      fakeJob('course.completed', { userId: student.id, courseId: course.id }),
      context(),
    );
    const [certificate] = await certificatesOf(student.id, course.id);
    // Versão gravada antes de uma regra nova (simulada direto nas tabelas).
    const version = await db
      .insertInto('certificateTemplateVersions')
      .values({ html: `${TEMPLATE}<script>alert(1)</script>`, createdBy: admin.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .updateTable('certificates')
      .set({ templateVersionId: version.id })
      .where('id', '=', certificate?.id ?? '')
      .execute();
    await expect(
      handlers['certificate.render']?.(
        fakeJob('certificate.render', { certificateId: certificate?.id ?? '' }),
        context(),
      ),
    ).rejects.toMatchObject({ name: 'PermanentJobError' });
  });
});

describe('certificate.preview', () => {
  it('grava o PDF de exemplo com os dados fictícios', { timeout: 60_000 }, async () => {
    const preview = await createCertificatePreview(db, requestOf(admin), { html: TEMPLATE });
    let row: { status: string; pdf: Buffer | null; error: string | null } | undefined;
    await waitFor(async () => {
      row = await db
        .selectFrom('certificatePreviews')
        .select(['status', 'pdf', 'error'])
        .where('id', '=', preview.id)
        .executeTakeFirst();
      return row?.status !== 'pending';
    }, 30_000);
    expect(row).toMatchObject({ status: 'ready', error: null });
    const read = await readPdf(row?.pdf as Buffer);
    expect(read.pages).toBe(1);
    expect(read.text).toContain('Aluno: Maria Exemplo da Silva');
    expect(read.text).toContain('Curso: Curso de exemplo');
    expect(read.text).toContain('Carga horária: 12 horas');
    expect(read.text).toContain('Código: ABCD-EFGH-JKMN');
  });

  it('template fora das regras grava failed com o motivo, sem requisição', {
    timeout: 30_000,
  }, async () => {
    const before = intercepted.length;
    const row = await db
      .insertInto('certificatePreviews')
      .values({
        requestedBy: admin.id,
        // Gravado direto: a `admin-api` o teria recusado.
        html: `${TEMPLATE.replace('</body>', '<img src="https://rastreio.example.com/x.gif"></body>')}`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const job = await enqueue(db, 'certificate.preview', { previewId: row.id });
    await waitFor(async () => (await getJob(db, job?.id ?? '')).status === 'done');
    const preview = await db
      .selectFrom('certificatePreviews')
      .select(['status', 'error', 'pdf'])
      .where('id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(preview).toMatchObject({ status: 'failed', pdf: null });
    expect(preview.error).toContain('url_not_allowed');
    expect(intercepted.length).toBe(before);
  });

  it('tempo esgotado grava failed com o motivo', { timeout: 30_000 }, async () => {
    await worker?.stop({ timeoutMs: 5_000 });
    const slow = createCertificateRenderer({ logger: captureLogger().logger, timeoutMs: 1 });
    worker = await startWorker(slow);
    try {
      const preview = await createCertificatePreview(db, requestOf(admin), { html: TEMPLATE });
      let row: { status: string; error: string | null } | undefined;
      await waitFor(async () => {
        row = await db
          .selectFrom('certificatePreviews')
          .select(['status', 'error'])
          .where('id', '=', preview.id)
          .executeTakeFirst();
        return row?.status !== 'pending';
      });
      expect(row?.status).toBe('failed');
      expect(row?.error).toContain('não ficou pronto');
    } finally {
      await worker.stop({ timeoutMs: 5_000 });
      worker = null;
      await slow.close();
    }
  });
});

describe('montagem do documento', () => {
  it('embute a imagem da instalação em data:, gera o QR e escapa os valores', async () => {
    const owner = await makeUser('admin');
    const image = await db
      .insertInto('images')
      .values({
        ownerUserId: owner.id,
        purpose: 'product_cover',
        originalWidth: 1600,
        originalHeight: 900,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const bytes = Buffer.from('conteudo-webp-de-teste');
    await db
      .insertInto('imageVariants')
      .values({
        imageId: image.id,
        width: 480,
        height: 270,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        data: bytes,
      })
      .execute();
    const gone = randomUUID();
    const html = `${TEMPLATE.replace(
      '</body>',
      `<img src="/api/v1/images/${image.id}/480.webp"><img src="/api/v1/images/${gone}/480.webp"></body>`,
    )}`;
    const document = await buildCertificateDocument(
      { db, classroomUrl: CLASSROOM, locale: 'pt-BR' },
      html,
      {
        studentName: 'Zé <b>&</b>',
        courseTitle: 'Curso',
        hours: 3,
        instructorName: null,
        completedAt: new Date('2026-11-25T15:00:00Z'),
        issuedAt: new Date('2026-11-25T15:00:00Z'),
        code: 'ABCDEFGHJKMN',
        schoolName: 'Escola',
        signerName: null,
        signerRole: null,
      },
    );
    expect(document.html).toContain(`data:image/webp;base64,${bytes.toString('base64')}`);
    expect(document.html).not.toContain('/api/v1/images/');
    expect(document.missingImages).toEqual([`/api/v1/images/${gone}/480.webp`]);
    expect(document.html).toContain(CERTIFICATE_EMPTY_IMAGE);
    expect(document.html).toMatch(/<div class="qr"><svg [^>]*><path /);
    expect(document.html).toContain('Zé &lt;b&gt;&amp;&lt;/b&gt;');
  });
});
