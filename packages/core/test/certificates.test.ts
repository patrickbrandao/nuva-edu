import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { type KyselyPlugin, sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertCertificatePdfSize,
  CERTIFICATE_CODE_ALPHABET,
  CERTIFICATE_PDF_MAX_BYTES,
  CERTIFICATE_PREVIEW_HOURLY_LIMIT,
  type CertificateRequest,
  type CertificateViewer,
  certificateHours,
  certificatePdfFilename,
  certificateStateOf,
  certificateStudentName,
  closeDatabase,
  createAccount,
  createCertificatePreview,
  createDatabase,
  type Database,
  deleteCourseCertificateTemplate,
  deleteSchoolCertificateTemplate,
  failCertificatePreview,
  findEffectiveCertificateTemplate,
  generateCertificateCode,
  getCertificatePdf,
  getCertificatePreview,
  getCertificatePreviewJob,
  getCertificatePreviewPdf,
  getCertificateRefs,
  getCertificateRenderJob,
  getCertificateSettings,
  getCertificateTemplateReference,
  getCourseCertificateState,
  getCourseCertificateStates,
  getCourseCertificateTemplate,
  getMyCertificatePdf,
  getSchoolCertificateTemplate,
  grantManualEntitlement,
  isDomainError,
  issueCertificateManually,
  issueCertificateOnCompletion,
  listCertificateBackfillCandidates,
  listCertificates,
  listMyCertificates,
  normalizeCertificateCode,
  purgeCertificatePreviews,
  purgeCertificateTemplateVersions,
  type Role,
  reissueCertificate,
  requestCertificateBackfill,
  restoreCertificate,
  revokeCertificate,
  runCertificateBackfill,
  saveCertificatePdf,
  saveCertificatePreviewPdf,
  saveCourseCertificateTemplate,
  saveSchoolCertificateTemplate,
  setCertificateName,
  updateCertificateSettings,
  verifyCertificate,
} from '../src/index.ts';

// Certificados (tarefa 415; spec 015; ADR 0026). Banco próprio deste arquivo; o catálogo e o
// progresso são gravados direto nas tabelas. O padrão da escola é global: só o bloco dele o
// grava, e o apaga ao terminar.

let testDb: TestDatabase;
let db: Database;
let admin: CertificateViewer;
let manager: CertificateViewer;
let instructor: CertificateViewer;

const CLASSROOM = 'https://classroom.escola.test';
const HTML =
  '<p>{{aluno.nome}} {{curso.titulo}} {{certificado.codigo}} {{certificado.url_validacao}}</p>';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

async function makeUser(
  role: Role = 'student',
  name = `Pessoa ${role}`,
): Promise<CertificateViewer> {
  const id = await db.transaction().execute((trx) =>
    createAccount(trx, {
      email: `${role}-${crypto.randomUUID()}@example.com`,
      name,
      password: 'Senha-Certificados-Teste-7Qa',
      role,
      emailVerified: true,
    }),
  );
  return { id, role };
}

function requestOf(user: CertificateViewer): CertificateRequest {
  return { actor: { id: user.id, role: user.role }, context: { ip: '127.0.0.1', requestId: 'r' } };
}

interface CourseOptions {
  mode?: 'open' | 'paid' | 'private';
  ownerId?: string | null;
  enabled?: boolean;
  hours?: number | null;
  lessons?: number;
  duration?: number;
}

/** Curso publicado com um módulo e `lessons` aulas publicadas. */
async function makeCourse(options: CourseOptions = {}) {
  const mode = options.mode ?? 'open';
  const course = await db
    .insertInto('courses')
    .values({
      slug: `curso-${crypto.randomUUID().slice(0, 13)}`,
      title: `Curso ${crypto.randomUUID().slice(0, 6)}`,
      accessMode: mode,
      priceCents: mode === 'open' ? null : 9900,
      status: 'published',
      publishedAt: new Date(),
      ownerId: options.ownerId ?? null,
      certificateEnabled: options.enabled ?? true,
      certificateHours: options.hours ?? null,
    })
    .returning(['id', 'slug', 'title'])
    .executeTakeFirstOrThrow();
  const module = await db
    .insertInto('modules')
    .values({ courseId: course.id, title: 'Módulo', position: 0 })
    .returning('id')
    .executeTakeFirstOrThrow();
  const lessons: string[] = [];
  for (let position = 0; position < (options.lessons ?? 2); position += 1) {
    const lesson = await db
      .insertInto('lessons')
      .values({
        moduleId: module.id,
        title: `Aula ${position + 1}`,
        videoUrl: 'https://youtu.be/abc12345678',
        videoProvider: 'youtube',
        durationSeconds: options.duration ?? 1900,
        status: 'published',
        position,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    lessons.push(lesson.id);
  }
  return { ...course, lessons };
}

type Course = Awaited<ReturnType<typeof makeCourse>>;

/** Conclui todas as aulas do curso, direto na tabela (o caminho da 413 tem os próprios testes). */
async function completeAll(user: CertificateViewer, course: Course, at = new Date()) {
  for (const lessonId of course.lessons) {
    await db
      .insertInto('lessonProgress')
      .values({
        userId: user.id,
        lessonId,
        courseId: course.id,
        completedAt: at,
        completedVia: 'manual',
      })
      .onConflict((oc) => oc.columns(['userId', 'lessonId']).doNothing())
      .execute();
  }
}

/** Template próprio do curso, gravado pelo admin. */
async function withTemplate(course: Course, html = HTML) {
  const current = await getCourseCertificateTemplate(db, requestOf(admin), course.id);
  return saveCourseCertificateTemplate(db, requestOf(admin), course.id, {
    html,
    expectedVersionId: current.source === 'course' ? current.versionId : null,
  });
}

async function expectError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!isDomainError(error)) throw new Error(`esperava ${code}, veio ${String(error)}`);
  expect({ status: error.status, code: error.code }).toEqual({ status, code });
  return error;
}

function countingDb(): { db: Database; count: () => number } {
  let queries = 0;
  const plugin: KyselyPlugin = {
    transformQuery(args) {
      queries += 1;
      return args.node;
    },
    async transformResult(args) {
      return args.result;
    },
  };
  return { db: db.withPlugin(plugin), count: () => queries };
}

async function jobs(type: string, key: string): Promise<number> {
  const result = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM jobs
     WHERE type = ${type} AND payload::text LIKE ${`%${key}%`}`.execute(db);
  return result.rows[0]?.n ?? 0;
}

async function emails(userId: string, type: string): Promise<number> {
  const result = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM jobs
     WHERE type = 'notify'
       AND payload->>'userId' = ${userId}
       AND payload->>'type' = ${type}`.execute(db);
  return result.rows[0]?.n ?? 0;
}

async function audits(action: string, targetId?: string) {
  const result = await sql<{ outcome: string; data: Record<string, unknown> }>`
    SELECT outcome, details AS data FROM audit_log
     WHERE action = ${action} AND (${targetId ?? null}::text IS NULL OR target_id = ${targetId ?? null})
     ORDER BY created_at`.execute(db);
  return result.rows;
}

async function auditCount(): Promise<number> {
  const result = await sql<{ n: number }>`SELECT count(*)::int AS n FROM audit_log`.execute(db);
  return result.rows[0]?.n ?? 0;
}

/** Certificado emitido pelo caminho automático. */
async function issued(user: CertificateViewer, course: Course): Promise<string> {
  await completeAll(user, course);
  const result = await issueCertificateOnCompletion(db, { userId: user.id, courseId: course.id });
  expect(result.outcome).toBe('issued');
  return result.certificateId as string;
}

async function renderPdf(certificateId: string) {
  const job = await getCertificateRenderJob(db, certificateId);
  if (!job) throw new Error('sem render job');
  expect(await saveCertificatePdf(db, job, PDF)).toBe('saved');
}

async function codeOf(certificateId: string): Promise<string> {
  const row = await db
    .selectFrom('certificates')
    .select('code')
    .where('id', '=', certificateId)
    .executeTakeFirstOrThrow();
  return row.code;
}

beforeAll(async () => {
  loadEnvFiles();
  testDb = await createTestDatabase();
  db = createDatabase({ connectionString: testDb.url, maxConnections: 6 });
  admin = await makeUser('admin', 'Admin');
  manager = await makeUser('manager', 'Gerente');
  instructor = await makeUser('instructor', 'Instrutora Ana');
});

afterAll(async () => {
  await closeDatabase(db);
  await testDb.drop();
});

describe('regras puras', () => {
  it('código: alfabeto sem ambiguidade, 12 caracteres, normalização da entrada', () => {
    for (let index = 0; index < 50; index += 1) {
      const code = generateCertificateCode();
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{12}$/);
    }
    expect(CERTIFICATE_CODE_ALPHABET).not.toMatch(/[01ILO]/);
    expect(normalizeCertificateCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN');
    expect(normalizeCertificateCode(' ABCDEFGHJKMN ')).toBe('ABCDEFGHJKMN');
    expect(normalizeCertificateCode('ABCD-EFGH-JKM0')).toBeNull();
    expect(normalizeCertificateCode('ABCD-EFGH')).toBeNull();
    expect(normalizeCertificateCode(42)).toBeNull();
    expect(normalizeCertificateCode('A'.repeat(65))).toBeNull();
  });

  it('carga horária, nome, estado e tamanho do PDF', () => {
    expect(certificateHours(null, 0)).toBe(0);
    expect(certificateHours(null, 3601)).toBe(2);
    expect(certificateHours(null, 3600)).toBe(1);
    expect(certificateHours(40, 3601)).toBe(40);
    expect(certificateStudentName({ fullName: '  Maria Souza ', name: 'Mari' })).toBe(
      'Maria Souza',
    );
    expect(certificateStudentName({ fullName: '  ', name: 'Mari' })).toBe('Mari');
    expect(certificateStudentName({ fullName: null, name: 'Mari' })).toBe('Mari');
    const at = new Date();
    expect(certificateStateOf({ revokedAt: at, pdfRenderedAt: at, studentName: 'x' })).toBe(
      'revoked',
    );
    expect(certificateStateOf({ revokedAt: null, pdfRenderedAt: at, studentName: 'x' })).toBe(
      'issued',
    );
    expect(certificateStateOf({ revokedAt: null, pdfRenderedAt: null, studentName: null })).toBe(
      'issued',
    );
    expect(certificateStateOf({ revokedAt: null, pdfRenderedAt: null, studentName: 'x' })).toBe(
      'preparing',
    );
    expect(certificatePdfFilename('abcdefghjkmn')).toBe('certificado-ABCD-EFGH-JKMN.pdf');
    expect(() => assertCertificatePdfSize(new Uint8Array())).toThrow(RangeError);
    expect(() => assertCertificatePdfSize(new Uint8Array(CERTIFICATE_PDF_MAX_BYTES + 1))).toThrow(
      RangeError,
    );
    expect(() => assertCertificatePdfSize(PDF)).not.toThrow();
  });
});

describe('template do curso', () => {
  it('lê, grava com versão, recusa conflito e inválido, e enfileira o lote só na transição', async () => {
    const course = await makeCourse({ ownerId: instructor.id });
    const request = requestOf(instructor);
    expect(await getCourseCertificateTemplate(db, request, course.id)).toEqual({
      source: 'none',
      html: null,
      versionId: null,
      updatedAt: null,
      updatedBy: null,
    });
    const first = await saveCourseCertificateTemplate(db, request, course.id, {
      html: HTML,
      expectedVersionId: null,
    });
    expect(first).toMatchObject({
      source: 'course',
      html: HTML,
      backfillQueued: true,
      updatedBy: { id: instructor.id, name: 'Instrutora Ana' },
    });
    expect(await jobs('certificate.backfill', course.id)).toBe(1);
    // Editar o existente não enfileira; versão antiga: `version_conflict`.
    const second = await saveCourseCertificateTemplate(db, request, course.id, {
      html: `${HTML}<p>v2</p>`,
      expectedVersionId: first.versionId,
    });
    expect(second.backfillQueued).toBe(false);
    expect(second.versionId).not.toBe(first.versionId);
    await expectError(
      saveCourseCertificateTemplate(db, request, course.id, {
        html: HTML,
        expectedVersionId: first.versionId,
      }),
      409,
      'version_conflict',
    );
    await expectError(
      saveCourseCertificateTemplate(db, request, course.id, { html: HTML, expectedVersionId: 'x' }),
      400,
      'validation_failed',
    );
    await expectError(
      saveCourseCertificateTemplate(db, request, course.id, {
        html: '',
        expectedVersionId: second.versionId,
      }),
      400,
      'validation_failed',
    );
    const invalid = await expectError(
      saveCourseCertificateTemplate(db, request, course.id, {
        html: '<p>{{aluno.nome}}</p><script>x</script>',
        expectedVersionId: second.versionId,
      }),
      422,
      'certificate_template_invalid',
    );
    const problems = (invalid.extras as { details: { problems: { rule: string }[] } }).details
      .problems;
    expect(problems.map((problem) => problem.rule)).toContain('element_not_allowed');
    expect(problems.map((problem) => problem.rule)).toContain('missing_required_key');
    // Imagem da instalação que não existe.
    const imageId = crypto.randomUUID();
    const withImage = await expectError(
      saveCourseCertificateTemplate(db, request, course.id, {
        html: `${HTML}\n<img src="/api/v1/images/${imageId}/480.webp">`,
        expectedVersionId: second.versionId,
      }),
      422,
      'certificate_template_invalid',
    );
    expect(
      (withImage.extras as { details: { problems: { rule: string; line: number }[] } }).details
        .problems,
    ).toEqual([expect.objectContaining({ rule: 'image_not_found', line: 2 })]);
    // A auditoria tem a versão e o tamanho, nunca o HTML.
    const rows = await audits('certificate_template.update', course.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.data).toMatchObject({ versionId: first.versionId, previousVersionId: null });
    expect(JSON.stringify(rows)).not.toContain('aluno.nome');
  });

  it('imagem da instalação existente é aceita; oculta, não', async () => {
    const course = await makeCourse();
    const image = await sql<{ id: string }>`
      INSERT INTO images (owner_user_id, purpose, original_width, original_height)
      VALUES (${admin.id}::uuid, 'product_cover', 800, 450) RETURNING id`.execute(db);
    const imageId = image.rows[0]?.id as string;
    await sql`INSERT INTO image_variants (image_id, width, height, bytes, sha256, data)
              VALUES (${imageId}::uuid, 480, 270, 3, ${'a'.repeat(64)}, '\\x000102'::bytea)`.execute(
      db,
    );
    const html = `${HTML}<img src="/api/v1/images/${imageId}/480.webp">`;
    const saved = await withTemplate(course, html);
    expect(saved.html).toBe(html);
    await sql`UPDATE images SET hidden_at = now() WHERE id = ${imageId}::uuid`.execute(db);
    await expectError(withTemplate(course, html), 422, 'certificate_template_invalid');
  });

  it('instrutor recebe 404 no curso alheio; aluno, 403 com a negação auditada', async () => {
    const other = await makeCourse();
    const request = requestOf(instructor);
    await expectError(getCourseCertificateTemplate(db, request, other.id), 404, 'not_found');
    await expectError(
      saveCourseCertificateTemplate(db, request, other.id, { html: HTML, expectedVersionId: null }),
      404,
      'not_found',
    );
    await expectError(deleteCourseCertificateTemplate(db, request, other.id), 404, 'not_found');
    await expectError(getCourseCertificateTemplate(db, request, 'x'), 404, 'not_found');
    const student = await makeUser();
    await expectError(
      saveCourseCertificateTemplate(db, requestOf(student), other.id, {
        html: HTML,
        expectedVersionId: null,
      }),
      403,
      'permission_denied',
    );
    const denied = await audits('certificate_template.update', other.id);
    expect(denied.at(-1)?.outcome).toBe('denied');
  });

  it('excluir volta a nenhum; curso com certificado desabilitado não enfileira', async () => {
    const course = await makeCourse({ enabled: false });
    const saved = await withTemplate(course);
    expect(saved.backfillQueued).toBe(false);
    expect(await jobs('certificate.backfill', course.id)).toBe(0);
    const removed = await deleteCourseCertificateTemplate(db, requestOf(admin), course.id);
    expect(removed.source).toBe('none');
    expect(await audits('certificate_template.delete', course.id)).toHaveLength(1);
    // Sem template, excluir não muda nada nem audita.
    await deleteCourseCertificateTemplate(db, requestOf(admin), course.id);
    expect(await audits('certificate_template.delete', course.id)).toHaveLength(1);
    expect(await findEffectiveCertificateTemplate(db, course.id)).toBeNull();
  });
});

describe('emissão automática', () => {
  it('sem template não emite e o estado é awaiting_template; o template emite pelo lote', async () => {
    const student = await makeUser('student', 'Aluno Lote');
    const course = await makeCourse();
    await completeAll(student, course);
    expect(
      await issueCertificateOnCompletion(db, { userId: student.id, courseId: course.id }),
    ).toEqual({ outcome: 'awaiting_template', certificateId: null });
    expect(
      await getCourseCertificateState(db, student, {
        id: course.id,
        certificateEnabled: true,
        completed: true,
      }),
    ).toEqual({
      state: 'awaiting_template',
      certificateId: null,
      code: null,
      studentName: 'Aluno Lote',
    });
    const mine = await listMyCertificates(db, student, { classroomUrl: CLASSROOM });
    expect(mine.awaitingTemplate).toEqual([
      {
        course: { id: course.id, slug: course.slug, title: course.title },
        completedAt: expect.any(Date),
      },
    ]);
    expect(await listCertificateBackfillCandidates(db, course.id)).toEqual([student.id]);
    // Salvar o template enfileira um lote, uma vez.
    const saved = await withTemplate(course);
    expect(saved.backfillQueued).toBe(true);
    expect(await jobs('certificate.backfill', course.id)).toBe(1);
    expect(await runCertificateBackfill(db, course.id, { batchSize: 1 })).toEqual({
      candidates: 1,
      issued: 1,
    });
    expect(await runCertificateBackfill(db, course.id)).toEqual({ candidates: 0, issued: 0 });
    const after = await listMyCertificates(db, student, { classroomUrl: CLASSROOM });
    expect(after.awaitingTemplate).toEqual([]);
    expect(after.items).toHaveLength(1);
    expect(after.items[0]).toMatchObject({ state: 'preparing', studentName: 'Aluno Lote' });
    expect(after.items[0]?.validationUrl).toBe(`${CLASSROOM}/certificados/${after.items[0]?.code}`);
  });

  it('cria com os dados congelados, o PDF e o e-mail; renomear o curso não altera', async () => {
    const student = await makeUser('student', 'Exibição');
    await setCertificateName(db, student, { fullName: 'Maria Completa' });
    const course = await makeCourse({ ownerId: instructor.id, lessons: 2, duration: 1900 });
    const template = await withTemplate(course);
    const completedAt = new Date('2026-11-20T15:00:00Z');
    await completeAll(student, course, completedAt);
    const result = await issueCertificateOnCompletion(db, {
      userId: student.id.toUpperCase(),
      courseId: course.id,
    });
    expect(result.outcome).toBe('issued');
    const id = result.certificateId as string;
    const row = await db
      .selectFrom('certificates')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      studentName: 'Maria Completa',
      courseTitle: course.title,
      instructorName: 'Instrutora Ana',
      hours: 2,
      completedAt,
      templateVersionId: template.versionId,
      issuedManually: false,
    });
    expect(row.code).toMatch(/^[2-9A-HJKMNP-Z]{12}$/);
    expect(await jobs('certificate.render', id)).toBe(1);
    expect(await emails(student.id, 'certificate.issued')).toBe(1);
    // Repetir devolve o existente.
    expect(
      await issueCertificateOnCompletion(db, { userId: student.id, courseId: course.id }),
    ).toEqual({ outcome: 'already_issued', certificateId: id });
    await db
      .updateTable('courses')
      .set({ title: 'Título novo' })
      .where('id', '=', course.id)
      .execute();
    await withTemplate(course, `${HTML}<p>editado</p>`);
    const job = await getCertificateRenderJob(db, id);
    expect(job).toMatchObject({
      templateVersionId: template.versionId,
      html: HTML,
      data: { courseTitle: course.title, studentName: 'Maria Completa', hours: 2 },
    });
    const views = await listCertificates(db, requestOf(admin), { courseId: course.id });
    expect(views.items[0]).toMatchObject({
      courseTitle: course.title,
      course: { type: 'course', id: course.id, title: 'Título novo' },
    });
  });

  it('duas emissões simultâneas geram um certificado', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    await withTemplate(course);
    await completeAll(student, course);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        issueCertificateOnCompletion(db, { userId: student.id, courseId: course.id }),
      ),
    );
    expect(results.filter((result) => result.outcome === 'issued')).toHaveLength(1);
    expect(new Set(results.map((result) => result.certificateId)).size).toBe(1);
    const count = await db
      .selectFrom('certificates')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('courseId', '=', course.id)
      .executeTakeFirstOrThrow();
    expect(count.n).toBe(1);
    expect(await emails(student.id, 'certificate.issued')).toBe(1);
  });

  it('curso desabilitado, incompleto, sem acesso, carga fixada e entradas inválidas', async () => {
    const student = await makeUser();
    const disabled = await makeCourse({ enabled: false });
    await withTemplate(disabled);
    await completeAll(student, disabled);
    expect(
      (await issueCertificateOnCompletion(db, { userId: student.id, courseId: disabled.id }))
        .outcome,
    ).toBe('certificate_disabled');
    expect(
      await getCourseCertificateState(db, student, {
        id: disabled.id,
        certificateEnabled: false,
        completed: true,
      }),
    ).toBeNull();
    expect(await runCertificateBackfill(db, disabled.id)).toEqual({ candidates: 0, issued: 0 });

    const partial = await makeCourse();
    await withTemplate(partial);
    await completeAll(student, { ...partial, lessons: partial.lessons.slice(0, 1) });
    expect(
      (await issueCertificateOnCompletion(db, { userId: student.id, courseId: partial.id }))
        .outcome,
    ).toBe('not_completed');

    // Concluiu as aulas (por exemplo, como amostras) sem ter o curso pago.
    const paid = await makeCourse({ mode: 'paid' });
    await withTemplate(paid);
    await completeAll(student, paid);
    expect(
      (await issueCertificateOnCompletion(db, { userId: student.id, courseId: paid.id })).outcome,
    ).toBe('no_access');
    expect(
      (await listMyCertificates(db, student, { classroomUrl: CLASSROOM })).awaitingTemplate,
    ).toEqual([]);
    await grantManualEntitlement(db, requestOf(admin), student.id, {
      productType: 'course',
      productId: paid.id,
      reason: 'Teste',
    });
    expect(
      (await issueCertificateOnCompletion(db, { userId: student.id, courseId: paid.id })).outcome,
    ).toBe('issued');

    const fixed = await makeCourse({ hours: 40 });
    await withTemplate(fixed);
    const id = await issued(student, fixed);
    const row = await db
      .selectFrom('certificates')
      .select('hours')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.hours).toBe(40);

    expect(
      (await issueCertificateOnCompletion(db, { userId: student.id, courseId: 'x' })).outcome,
    ).toBe('course_not_found');
    expect(
      (await issueCertificateOnCompletion(db, { userId: 'x', courseId: fixed.id })).outcome,
    ).toBe('user_not_found');
    expect(
      (
        await issueCertificateOnCompletion(db, {
          userId: student.id,
          courseId: crypto.randomUUID(),
        })
      ).outcome,
    ).toBe('course_not_found');
    const ghost = await makeCourse();
    await withTemplate(ghost);
    expect(
      (await issueCertificateOnCompletion(db, { userId: crypto.randomUUID(), courseId: ghost.id }))
        .outcome,
    ).toBe('user_not_found');
    expect(await runCertificateBackfill(db, 'x')).toEqual({ candidates: 0, issued: 0 });
    expect(await listCertificateBackfillCandidates(db, 'x')).toEqual([]);
  });

  it('PDF: grava, recusa reemitido no meio e some com o titular removido', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    await withTemplate(course);
    const id = await issued(student, course);
    const job = await getCertificateRenderJob(db, id);
    if (!job) throw new Error('sem job');
    expect(
      await saveCertificatePdf(db, { ...job, data: { ...job.data, studentName: 'Outro' } }, PDF),
    ).toBe('stale');
    expect(await saveCertificatePdf(db, job, PDF)).toBe('saved');
    expect(await getCertificateRenderJob(db, 'x')).toBeNull();
    expect(await getCertificateRenderJob(db, crypto.randomUUID())).toBeNull();
    await db
      .updateTable('certificates')
      .set({ studentName: null, pdf: null, pdfRenderedAt: null })
      .where('id', '=', id)
      .execute();
    expect(await getCertificateRenderJob(db, id)).toBeNull();
    expect(await saveCertificatePdf(db, job, PDF)).toBe('gone');
  });
});

describe('ações da equipe', () => {
  it('emissão manual: motivo, 409 se já existe, 422 sem template, auditoria e e-mail', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    const input = { userId: student.id, courseId: course.id, reason: 'Turma migrada' };
    await expectError(
      issueCertificateManually(db, requestOf(manager), input),
      422,
      'certificate_template_missing',
    );
    await expectError(
      issueCertificateManually(db, requestOf(manager), { ...input, reason: ' ' }),
      400,
      'validation_failed',
    );
    await expectError(
      issueCertificateManually(db, requestOf(manager), { ...input, userId: 'x', courseId: 'y' }),
      400,
      'validation_failed',
    );
    await expectError(
      issueCertificateManually(db, requestOf(instructor), input),
      403,
      'permission_denied',
    );
    await expectError(
      issueCertificateManually(db, requestOf(manager), { ...input, courseId: crypto.randomUUID() }),
      404,
      'not_found',
    );
    await withTemplate(course);
    const view = await issueCertificateManually(db, requestOf(manager), input);
    expect(view).toMatchObject({
      state: 'preparing',
      issuedManually: true,
      issueReason: 'Turma migrada',
      issuedBy: { id: manager.id, name: 'Gerente' },
      user: { id: student.id },
    });
    expect(view.code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
    expect(await emails(student.id, 'certificate.issued')).toBe(1);
    expect(await audits('certificate.issue', view.id)).toHaveLength(1);
    await expectError(
      issueCertificateManually(db, requestOf(manager), input),
      409,
      'certificate_exists',
    );
    const disabled = await makeCourse({ enabled: false });
    await expectError(
      issueCertificateManually(db, requestOf(manager), { ...input, courseId: disabled.id }),
      422,
      'certificate_disabled',
    );
  });

  it('reemitir mantém o código, congela o nome e a versão atuais e não envia e-mail', async () => {
    const student = await makeUser('student', 'Nome Antigo');
    const course = await makeCourse();
    const first = await withTemplate(course);
    const id = await issued(student, course);
    await renderPdf(id);
    const code = await codeOf(id);
    await setCertificateName(db, student, { fullName: 'Nome Corrigido' });
    const second = await withTemplate(course, `${HTML}<p>v2</p>`);
    await expectError(reissueCertificate(db, requestOf(instructor), id), 403, 'permission_denied');
    const view = await reissueCertificate(db, requestOf(manager), id);
    expect(view).toMatchObject({
      state: 'preparing',
      studentName: 'Nome Corrigido',
      templateVersionId: second.versionId,
      pdfRenderedAt: null,
    });
    expect(second.versionId).not.toBe(first.versionId);
    expect(await codeOf(id)).toBe(code);
    expect(await emails(student.id, 'certificate.issued')).toBe(1);
    expect(await jobs('certificate.render', id)).toBe(2);
    const audit = (await audits('certificate.reissue', id)).at(-1);
    expect(audit?.data).toMatchObject({
      before: { studentName: 'Nome Antigo', templateVersionId: first.versionId },
      after: { studentName: 'Nome Corrigido', templateVersionId: second.versionId },
    });
    // Sem template efetivo: 422.
    await deleteCourseCertificateTemplate(db, requestOf(admin), course.id);
    await expectError(
      reissueCertificate(db, requestOf(manager), id),
      422,
      'certificate_template_missing',
    );
    await expectError(reissueCertificate(db, requestOf(manager), 'x'), 404, 'not_found');
  });

  it('revogar e restaurar: só o admin, com motivo; reemitir revogado é 409', async () => {
    const student = await makeUser();
    const course = await makeCourse();
    await withTemplate(course);
    const id = await issued(student, course);
    await expectError(
      revokeCertificate(db, requestOf(manager), id, { reason: 'Fraude' }),
      403,
      'permission_denied',
    );
    await expectError(
      revokeCertificate(db, requestOf(admin), id, { reason: '' }),
      400,
      'validation_failed',
    );
    await expectError(restoreCertificate(db, requestOf(admin), id), 409, 'certificate_not_revoked');
    const revoked = await revokeCertificate(db, requestOf(admin), id, { reason: 'Fraude' });
    expect(revoked).toMatchObject({
      state: 'revoked',
      revokeReason: 'Fraude',
      revokedBy: { id: admin.id },
    });
    await expectError(
      revokeCertificate(db, requestOf(admin), id, { reason: 'De novo' }),
      409,
      'certificate_already_revoked',
    );
    await expectError(
      reissueCertificate(db, requestOf(admin), id),
      409,
      'certificate_already_revoked',
    );
    const restored = await restoreCertificate(db, requestOf(admin), id);
    expect(restored).toMatchObject({ state: 'preparing', revokedAt: null, revokeReason: null });
    expect(await audits('certificate.revoke', id)).toHaveLength(2); // a negação do gerente e a revogação
    expect(await audits('certificate.restore', id)).toHaveLength(1);
    await expectError(restoreCertificate(db, requestOf(manager), id), 403, 'permission_denied');
    // Titular removido não é reemitido.
    await db.updateTable('certificates').set({ studentName: null }).where('id', '=', id).execute();
    await expectError(
      reissueCertificate(db, requestOf(admin), id),
      409,
      'certificate_holder_removed',
    );
  });

  it('pedido de lote: alcance, desabilitado, sem template, auditoria e um lote ativo', async () => {
    const own = await makeCourse({ ownerId: instructor.id });
    const other = await makeCourse();
    await expectError(
      requestCertificateBackfill(db, requestOf(instructor), other.id),
      404,
      'not_found',
    );
    await expectError(
      requestCertificateBackfill(db, requestOf(instructor), own.id),
      422,
      'certificate_template_missing',
    );
    await withTemplate(own);
    expect(await requestCertificateBackfill(db, requestOf(instructor), own.id)).toEqual({
      courseId: own.id,
      queued: true,
    });
    expect(await jobs('certificate.backfill', own.id)).toBe(1);
    expect(await audits('certificate.backfill', own.id)).toHaveLength(1);
    const disabled = await makeCourse({ enabled: false });
    await expectError(
      requestCertificateBackfill(db, requestOf(admin), disabled.id),
      422,
      'certificate_disabled',
    );
    const student = await makeUser();
    await expectError(
      requestCertificateBackfill(db, requestOf(student), own.id),
      403,
      'permission_denied',
    );
  });

  it('lista com filtros, alcance do instrutor e cursor', async () => {
    const own = await makeCourse({ ownerId: instructor.id });
    const other = await makeCourse();
    await withTemplate(own);
    await withTemplate(other);
    const students = [await makeUser(), await makeUser(), await makeUser()];
    const ids: string[] = [];
    for (const student of students) ids.push(await issued(student, own));
    const alien = await issued(students[0] as CertificateViewer, other);
    await renderPdf(ids[0] as string);

    const mine = await listCertificates(db, requestOf(instructor), { limit: 100 });
    expect(mine.items.map((item) => item.id)).not.toContain(alien);
    expect(mine.items.map((item) => item.id)).toEqual(expect.arrayContaining(ids));

    const page1 = await listCertificates(db, requestOf(admin), { courseId: own.id, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listCertificates(db, requestOf(admin), {
      courseId: own.id,
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect([...page1.items, ...page2.items].map((item) => item.id)).toEqual([...ids].reverse());

    const byUser = await listCertificates(db, requestOf(admin), {
      userId: (students[0] as CertificateViewer).id,
    });
    expect(byUser.items.map((item) => item.id).sort()).toEqual([ids[0], alien].sort());
    const issuedOnly = await listCertificates(db, requestOf(admin), {
      courseId: own.id,
      state: 'issued',
    });
    expect(issuedOnly.items.map((item) => item.id)).toEqual([ids[0]]);
    const preparing = await listCertificates(db, requestOf(admin), {
      courseId: own.id,
      state: 'preparing',
    });
    expect(preparing.items).toHaveLength(2);
    const code = await codeOf(ids[1] as string);
    const byCode = await listCertificates(db, requestOf(admin), {
      code: `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`.toLowerCase(),
    });
    expect(byCode.items.map((item) => item.id)).toEqual([ids[1]]);
    expect((await listCertificates(db, requestOf(admin), { code: 'nada' })).items).toEqual([]);
    expect(
      (await listCertificates(db, requestOf(admin), { courseId: own.id, state: 'revoked' })).items,
    ).toEqual([]);
    const invalid = await expectError(
      listCertificates(db, requestOf(admin), {
        courseId: 'x',
        userId: 'y',
        state: 'z',
        code: '',
        limit: 0,
        cursor: 'bad',
      }),
      400,
      'validation_failed',
    );
    expect(invalid.errors).toHaveLength(6);
    await expectError(listCertificates(db, requestOf(await makeUser())), 403, 'permission_denied');

    // Referências do progresso do aluno.
    const refs = await getCertificateRefs(db, (students[0] as CertificateViewer).id, [
      own.id,
      other.id,
      'x',
    ]);
    expect(refs.get(own.id)).toEqual({ id: ids[0], code: expect.any(String), state: 'issued' });
    expect(refs.get(other.id)?.state).toBe('preparing');
    expect((await getCertificateRefs(db, 'x', [own.id])).size).toBe(0);
  });

  it('PDF para a equipe: gerente baixa sem auditoria; instrutor 404 em curso alheio; 409 em preparação', async () => {
    const student = await makeUser();
    const own = await makeCourse({ ownerId: instructor.id });
    const other = await makeCourse();
    await withTemplate(own);
    await withTemplate(other);
    const mineId = await issued(student, own);
    const alienId = await issued(student, other);
    await expectError(
      getCertificatePdf(db, requestOf(manager), alienId),
      409,
      'certificate_preparing',
    );
    await renderPdf(alienId);
    await renderPdf(mineId);
    const before = await auditCount();
    const file = await getCertificatePdf(db, requestOf(manager), alienId);
    expect(Buffer.from(file.pdf)).toEqual(Buffer.from(PDF));
    expect(file.filename).toBe(certificatePdfFilename(await codeOf(alienId)));
    expect(await auditCount()).toBe(before);
    expect((await getCertificatePdf(db, requestOf(instructor), mineId)).filename).toMatch(
      /^certificado-/,
    );
    await expectError(getCertificatePdf(db, requestOf(instructor), alienId), 404, 'not_found');
    await expectError(getCertificatePdf(db, requestOf(manager), 'x'), 404, 'not_found');
    // Revogado continua disponível à equipe; titular removido não.
    await revokeCertificate(db, requestOf(admin), alienId, { reason: 'Teste' });
    expect((await getCertificatePdf(db, requestOf(manager), alienId)).pdf).toBeDefined();
    await db
      .updateTable('certificates')
      .set({ studentName: null, pdf: null, pdfRenderedAt: null })
      .where('id', '=', mineId)
      .execute();
    await expectError(getCertificatePdf(db, requestOf(manager), mineId), 404, 'not_found');
  });
});

describe('aluno e validação pública', () => {
  it('estado em lote sem consulta por curso, nos cinco estados e desabilitado', async () => {
    const student = await makeUser('student', 'Aluna Estado');
    const preparing = await makeCourse();
    const issuedCourse = await makeCourse();
    const revoked = await makeCourse();
    const awaiting = await makeCourse();
    const progress = await makeCourse();
    const disabled = await makeCourse({ enabled: false });
    for (const course of [preparing, issuedCourse, revoked]) await withTemplate(course);
    await issued(student, preparing);
    const issuedId = await issued(student, issuedCourse);
    await renderPdf(issuedId);
    const revokedId = await issued(student, revoked);
    await revokeCertificate(db, requestOf(admin), revokedId, { reason: 'Teste' });
    const counting = countingDb();
    const states = await getCourseCertificateStates(counting.db, student, [
      { id: preparing.id, certificateEnabled: true, completed: false },
      { id: issuedCourse.id, certificateEnabled: true, completed: true },
      { id: revoked.id, certificateEnabled: true, completed: true },
      { id: awaiting.id, certificateEnabled: true, completed: true },
      { id: progress.id, certificateEnabled: true, completed: false },
      { id: disabled.id, certificateEnabled: false, completed: true },
      { id: 'x', certificateEnabled: true, completed: true },
    ]);
    expect(counting.count()).toBe(2);
    expect(states.get(preparing.id)).toMatchObject({ state: 'preparing', code: null });
    expect(states.get(issuedCourse.id)).toEqual({
      state: 'issued',
      certificateId: issuedId,
      code: expect.stringMatching(/^.{4}-.{4}-.{4}$/),
      studentName: 'Aluna Estado',
    });
    expect(states.get(revoked.id)?.state).toBe('revoked');
    expect(states.get(awaiting.id)?.state).toBe('awaiting_template');
    expect(states.get(progress.id)).toMatchObject({ state: 'in_progress', certificateId: null });
    expect(states.get(disabled.id)).toBeNull();
    expect(states.get('x')).toBeNull();
    const none = countingDb();
    const empty = await getCourseCertificateStates(none.db, student, [
      { id: disabled.id, certificateEnabled: false, completed: true },
    ]);
    expect(empty.get(disabled.id)).toBeNull();
    expect(none.count()).toBe(0);
  });

  it('PDF do aluno: só o dono, 409 em preparação, 404 revogado', async () => {
    const student = await makeUser();
    const intruder = await makeUser();
    const course = await makeCourse();
    await withTemplate(course);
    const id = await issued(student, course);
    await expectError(getMyCertificatePdf(db, student, id), 409, 'certificate_preparing');
    await renderPdf(id);
    expect((await getMyCertificatePdf(db, student, id)).filename).toBe(
      certificatePdfFilename(await codeOf(id)),
    );
    await expectError(getMyCertificatePdf(db, intruder, id), 404, 'not_found');
    await expectError(getMyCertificatePdf(db, student, 'x'), 404, 'not_found');
    await revokeCertificate(db, requestOf(admin), id, { reason: 'Teste' });
    await expectError(getMyCertificatePdf(db, student, id), 404, 'not_found');
  });

  it('nome no certificado: grava, apaga e valida', async () => {
    const student = await makeUser('student', 'Apelido');
    expect(await setCertificateName(db, student, { fullName: '  Ana Maria Lima  ' })).toEqual({
      fullName: 'Ana Maria Lima',
      studentName: 'Ana Maria Lima',
    });
    expect(await setCertificateName(db, student, { fullName: null })).toEqual({
      fullName: null,
      studentName: 'Apelido',
    });
    await expectError(setCertificateName(db, student, { fullName: '' }), 400, 'validation_failed');
    await expectError(
      setCertificateName(db, student, { fullName: 'a'.repeat(161) }),
      400,
      'validation_failed',
    );
    await expectError(
      setCertificateName(db, { id: crypto.randomUUID(), role: 'student' }, { fullName: 'X' }),
      404,
      'not_found',
    );
    const mine = await listMyCertificates(db, student, { classroomUrl: CLASSROOM });
    expect(mine).toEqual({ studentName: 'Apelido', items: [], awaitingTemplate: [] });
    expect(
      await listMyCertificates(db, { id: 'x', role: 'student' }, { classroomUrl: CLASSROOM }),
    ).toEqual({ studentName: '', items: [], awaitingTemplate: [] });
  });

  it('validação pública: com e sem hífen, minúsculas, revogado, titular removido e inexistente', async () => {
    const student = await makeUser('student', 'Titular');
    const course = await makeCourse();
    await withTemplate(course);
    const id = await issued(student, course);
    const code = await codeOf(id);
    const dashed = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
    const valid = await verifyCertificate(db, code);
    expect(valid).toEqual({
      status: 'valid',
      code: dashed,
      studentName: 'Titular',
      courseTitle: course.title,
      hours: expect.any(Number),
      completedAt: expect.any(Date),
      issuedAt: expect.any(Date),
      schoolName: expect.any(String),
      revokedAt: null,
    });
    expect(await verifyCertificate(db, dashed.toLowerCase())).toEqual(valid);
    expect(await verifyCertificate(db, code.toLowerCase())).toEqual(valid);
    // Inexistente e fora do formato: a mesma resposta.
    const missing = await expectError(
      verifyCertificate(db, generateCertificateCode()),
      404,
      'certificate_not_found',
    );
    const malformed = await expectError(verifyCertificate(db, 'zz'), 404, 'certificate_not_found');
    expect({ ...malformed }).toEqual({ ...missing });
    expect(malformed.message).toBe(missing.message);

    await revokeCertificate(db, requestOf(admin), id, { reason: 'Motivo interno' });
    const revoked = await verifyCertificate(db, code);
    expect(revoked).toMatchObject({
      status: 'revoked',
      code: dashed,
      studentName: null,
      courseTitle: null,
      revokedAt: expect.any(Date),
    });
    expect(JSON.stringify(revoked)).not.toContain('Motivo interno');
    await restoreCertificate(db, requestOf(admin), id);
    await db.updateTable('certificates').set({ studentName: null }).where('id', '=', id).execute();
    expect(await verifyCertificate(db, code)).toMatchObject({
      status: 'holder_removed',
      studentName: null,
      courseTitle: course.title,
      hours: null,
      schoolName: null,
      completedAt: expect.any(Date),
    });
  });
});

describe('pedidos de exemplo e expurgo', () => {
  it('cria, limita a 20 por hora, só o dono lê, e o worker grava ou falha', async () => {
    const editor = await makeUser('instructor', 'Editora');
    const request = requestOf(editor);
    const own = await makeCourse({ ownerId: editor.id });
    const other = await makeCourse();
    await expectError(
      createCertificatePreview(db, request, { html: HTML, courseId: other.id }),
      404,
      'not_found',
    );
    await expectError(
      createCertificatePreview(db, request, { html: HTML, courseId: 'x' }),
      400,
      'validation_failed',
    );
    await expectError(
      createCertificatePreview(db, request, { html: '<p>sem chaves</p>' }),
      422,
      'certificate_template_invalid',
    );
    const preview = await createCertificatePreview(db, request, { html: HTML, courseId: own.id });
    expect(preview).toMatchObject({ courseId: own.id, status: 'pending', error: null });
    expect(preview.expiresAt.getTime() - preview.createdAt.getTime()).toBe(24 * 3600 * 1000);
    expect(await jobs('certificate.preview', preview.id)).toBe(1);
    expect(await getCertificatePreview(db, request, preview.id)).toEqual(preview);
    await expectError(getCertificatePreview(db, requestOf(admin), preview.id), 404, 'not_found');
    await expectError(
      getCertificatePreviewPdf(db, request, preview.id),
      409,
      'certificate_preview_not_ready',
    );
    const job = await getCertificatePreviewJob(db, preview.id, {
      now: new Date('2026-11-25T12:00:00Z'),
    });
    expect(job).toMatchObject({
      previewId: preview.id,
      html: HTML,
      data: {
        studentName: 'Maria Exemplo da Silva',
        courseTitle: own.title,
        instructorName: 'Editora',
        code: 'ABCD-EFGH-JKMN',
        hours: 12,
      },
    });
    expect(await saveCertificatePreviewPdf(db, preview.id, PDF)).toBe(true);
    expect(await saveCertificatePreviewPdf(db, preview.id, PDF)).toBe(false);
    expect(await getCertificatePreviewJob(db, preview.id)).toBeNull();
    expect(await getCertificatePreviewJob(db, 'x')).toBeNull();
    const file = await getCertificatePreviewPdf(db, request, preview.id);
    expect(file.filename).toBe('certificado-exemplo.pdf');
    await expectError(getCertificatePreviewPdf(db, requestOf(admin), preview.id), 404, 'not_found');

    const failed = await createCertificatePreview(db, request, { html: HTML });
    const sampleJob = await getCertificatePreviewJob(db, failed.id);
    expect(sampleJob?.data.courseTitle).toBe('Curso de exemplo');
    expect(await failCertificatePreview(db, failed.id, '  ')).toBe(true);
    expect(await failCertificatePreview(db, failed.id, 'de novo')).toBe(false);
    expect(await getCertificatePreview(db, request, failed.id)).toMatchObject({
      status: 'failed',
      error: 'Falha ao gerar o PDF de exemplo.',
    });

    // 2 já criados; até 20 na hora, o 21º é 429.
    for (let index = 2; index < CERTIFICATE_PREVIEW_HOURLY_LIMIT; index += 1) {
      await createCertificatePreview(db, request, { html: HTML });
    }
    const limited = await expectError(
      createCertificatePreview(db, request, { html: HTML }),
      429,
      'rate_limited',
    );
    expect(limited.extras?.retryAfterSeconds).toBeGreaterThan(0);
    await expectError(
      createCertificatePreview(db, requestOf(await makeUser()), { html: HTML }),
      403,
      'permission_denied',
    );
  });

  it('expurga exemplos com mais de 24 horas e versões sem uso com mais de 30 dias', async () => {
    const course = await makeCourse();
    const student = await makeUser();
    const first = await withTemplate(course);
    const id = await issued(student, course); // usa a primeira versão
    const second = await withTemplate(course, `${HTML}<p>2</p>`);
    const third = await withTemplate(course, `${HTML}<p>3</p>`); // a atual
    // Recente: o padrão de 30 dias não apaga; com idade mínima zero, só a sem uso some.
    await purgeCertificateTemplateVersions(db);
    expect(
      await db
        .selectFrom('certificateTemplateVersions')
        .select('id')
        .where('id', '=', second.versionId)
        .executeTakeFirst(),
    ).toBeDefined();
    expect(
      await purgeCertificateTemplateVersions(db, { batchSize: 1, olderThanDays: 0 }),
    ).toBeGreaterThanOrEqual(1);
    const left = await db
      .selectFrom('certificateTemplateVersions')
      .select('id')
      .where('courseId', '=', course.id)
      .execute();
    const leftIds = left.map((row) => row.id);
    expect(leftIds).toContain(first.versionId);
    expect(leftIds).toContain(third.versionId);
    expect(leftIds).not.toContain(second.versionId);
    expect(await getCertificateRenderJob(db, id)).not.toBeNull();

    const editor = await makeUser('manager');
    const old = await createCertificatePreview(db, requestOf(editor), { html: HTML });
    const fresh = await createCertificatePreview(db, requestOf(editor), { html: HTML });
    await sql`UPDATE certificate_previews SET created_at = now() - interval '25 hours'
               WHERE id = ${old.id}::uuid`.execute(db);
    await expectError(getCertificatePreview(db, requestOf(editor), old.id), 404, 'not_found');
    const controller = new AbortController();
    controller.abort();
    expect(await purgeCertificatePreviews(db, { signal: controller.signal })).toBe(0);
    expect(await purgeCertificatePreviews(db)).toBeGreaterThanOrEqual(1);
    expect((await getCertificatePreview(db, requestOf(editor), fresh.id)).id).toBe(fresh.id);
  });
});

describe('configurações, referência e padrão da escola', () => {
  it('signatário: lê, grava com auditoria por chave e recusa fora do formato', async () => {
    await expectError(getCertificateSettings(db, requestOf(manager)), 403, 'permission_denied');
    const before = await getCertificateSettings(db, requestOf(admin));
    expect(before).toEqual({ signerName: null, signerRole: null, schoolName: expect.any(String) });
    const saved = await updateCertificateSettings(db, requestOf(admin), {
      signerName: '  Dra. Joana  ',
      signerRole: null,
    });
    expect(saved).toMatchObject({ signerName: 'Dra. Joana', signerRole: null });
    const rows = await audits('settings.update', 'certificate.signer_name');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toMatchObject({ before: null, after: 'Dra. Joana' });
    expect(await audits('settings.update', 'certificate.signer_role')).toHaveLength(0);
    const invalid = await expectError(
      updateCertificateSettings(db, requestOf(admin), { signerName: '', signerRole: 7 }),
      400,
      'validation_failed',
    );
    expect(invalid.errors).toHaveLength(2);
    // O signatário entra nos certificados emitidos depois.
    const student = await makeUser();
    const course = await makeCourse();
    await withTemplate(course);
    const id = await issued(student, course);
    expect((await getCertificateRenderJob(db, id))?.data.signerName).toBe('Dra. Joana');
    await updateCertificateSettings(db, requestOf(admin), { signerName: null, signerRole: null });
  });

  it('referência do editor com os exemplos', async () => {
    const reference = await getCertificateTemplateReference(db, requestOf(instructor), {
      locale: 'pt-BR',
      classroomUrl: CLASSROOM,
      now: new Date('2026-11-25T15:00:00Z'),
    });
    expect(reference.keys).toHaveLength(13);
    expect(reference.keys.find((key) => key.key === 'certificado.url_validacao')?.example).toBe(
      `${CLASSROOM}/certificados/ABCD-EFGH-JKMN`,
    );
    expect(reference.modelHtml).toContain('{{aluno.nome}}');
    await expectError(
      getCertificateTemplateReference(db, requestOf(await makeUser()), {
        locale: 'pt-BR',
        classroomUrl: CLASSROOM,
      }),
      403,
      'permission_denied',
    );
  });

  it('padrão da escola: efetivo dos cursos sem template, lote para cada um e exclusão', async () => {
    await expectError(
      saveSchoolCertificateTemplate(db, requestOf(manager), {
        html: HTML,
        expectedVersionId: null,
      }),
      403,
      'permission_denied',
    );
    const plain = await makeCourse();
    const own = await makeCourse();
    await withTemplate(own);
    const ownJobs = await jobs('certificate.backfill', own.id);
    const disabled = await makeCourse({ enabled: false });
    const student = await makeUser();
    await completeAll(student, plain);
    expect(await getSchoolCertificateTemplate(db, requestOf(admin))).toMatchObject({
      source: 'none',
      html: null,
    });
    const saved = await saveSchoolCertificateTemplate(db, requestOf(admin), {
      html: HTML,
      expectedVersionId: null,
    });
    expect(saved).toMatchObject({ source: 'school', backfillQueued: true, html: HTML });
    expect(await jobs('certificate.backfill', plain.id)).toBe(1);
    expect(await jobs('certificate.backfill', own.id)).toBe(ownJobs);
    expect(await jobs('certificate.backfill', disabled.id)).toBe(0);
    expect(await getCourseCertificateTemplate(db, requestOf(admin), plain.id)).toMatchObject({
      source: 'school',
      html: null,
      versionId: null,
    });
    expect(await findEffectiveCertificateTemplate(db, plain.id)).toEqual({
      source: 'school',
      versionId: saved.versionId,
    });
    expect(await findEffectiveCertificateTemplate(db, own.id)).toMatchObject({ source: 'course' });
    // O curso sem template passa a emitir com o padrão.
    expect(await runCertificateBackfill(db, plain.id)).toEqual({ candidates: 1, issued: 1 });
    // Editar o padrão não enfileira; com padrão, o template do curso também não.
    const edited = await saveSchoolCertificateTemplate(db, requestOf(admin), {
      html: `${HTML}<p>2</p>`,
      expectedVersionId: saved.versionId,
    });
    expect(edited.backfillQueued).toBe(false);
    const another = await makeCourse();
    expect((await withTemplate(another)).backfillQueued).toBe(false);
    await expectError(
      saveSchoolCertificateTemplate(db, requestOf(admin), {
        html: HTML,
        expectedVersionId: saved.versionId,
      }),
      409,
      'version_conflict',
    );
    const audit = await audits('certificate_template.update');
    expect(audit.filter((row) => 'backfillCourses' in row.data).at(-1)?.data).toMatchObject({
      backfillCourses: 0,
    });
    const removed = await deleteSchoolCertificateTemplate(db, requestOf(admin));
    expect(removed).toMatchObject({ source: 'none', html: null });
    expect(await deleteSchoolCertificateTemplate(db, requestOf(admin))).toMatchObject({
      source: 'none',
    });
    expect(await findEffectiveCertificateTemplate(db, plain.id)).toBeNull();
    await expectError(
      getSchoolCertificateTemplate(db, requestOf(manager)),
      403,
      'permission_denied',
    );
  });
});
