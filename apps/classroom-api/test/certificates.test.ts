import { randomUUID } from 'node:crypto';
import {
  type CertificateRequest,
  getCertificateRenderJob,
  getCourseCertificateTemplate,
  issueCertificateOnCompletion,
  revokeCertificate,
  saveCertificatePdf,
  saveCourseCertificateTemplate,
} from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLASSROOM_RATE_LIMITS } from '../src/rate-limits.ts';
import {
  Browser,
  createUser,
  isolatedDatabase,
  type Reply,
  TEST_PASSWORD,
  type TestUser,
} from './accounts.ts';
import { createTestApp, type TestApp } from './helpers.ts';

// Certificados do aluno e validação pública (spec 015; tarefa 433). Banco só deste arquivo: o
// estado `awaiting_template` depende de não haver padrão da escola. Templates, emissão, PDF e
// revogação são gravados pelo núcleo (escrita do worker e da admin-api); a classroom-api só lê,
// grava o nome do certificado e serve o PDF.

const HTML =
  '<p>{{aluno.nome}} {{curso.titulo}} {{certificado.codigo}} {{certificado.url_validacao}}</p>';
const PDF = Buffer.from('%PDF-1.7 certificado de teste 433');
/** Nome completo gravado pelo aluno: não pode aparecer no log. */
const FULL_NAME = 'Maria Nome-Secreto-433 da Silva';
const CODE = /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let test: TestApp;
let limited: TestApp;

function scan(reply: Reply): void {
  expect(JSON.stringify(reply.headers) + reply.body).not.toContain(TEST_PASSWORD);
}

interface Course {
  id: string;
  slug: string;
  title: string;
  lessons: string[];
}

/** Curso aberto e publicado, com um módulo e duas aulas publicadas. */
async function makeCourse(title: string, certificateEnabled = true): Promise<Course> {
  const course = await test.db
    .insertInto('courses')
    .values({
      slug: `curso-${randomUUID().slice(0, 13)}`,
      title,
      summary: `Resumo de ${title}`,
      accessMode: 'open',
      priceCents: null,
      status: 'published',
      publishedAt: new Date(),
      level: 'beginner',
      certificateEnabled,
    })
    .returning(['id', 'slug', 'title'])
    .executeTakeFirstOrThrow();
  const module = await test.db
    .insertInto('modules')
    .values({ courseId: course.id, title: 'Módulo', position: 0 })
    .returning('id')
    .executeTakeFirstOrThrow();
  const lessons: string[] = [];
  for (let position = 0; position < 2; position += 1) {
    const lesson = await test.db
      .insertInto('lessons')
      .values({
        moduleId: module.id,
        title: `Aula ${position + 1}`,
        videoUrl: 'https://youtu.be/abc12345678',
        videoProvider: 'youtube',
        durationSeconds: 1800,
        isSample: false,
        status: 'published',
        position,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    lessons.push(lesson.id);
  }
  return { ...course, lessons };
}

/** Conclui as aulas do curso direto na tabela (o caminho da 413 tem os próprios testes). */
async function completeAll(user: TestUser, course: Course): Promise<void> {
  for (const lessonId of course.lessons) {
    await test.db
      .insertInto('lessonProgress')
      .values({
        userId: user.id,
        lessonId,
        courseId: course.id,
        completedAt: new Date(),
        completedVia: 'manual',
      })
      .execute();
  }
}

let admin: TestUser;
function asAdmin(): CertificateRequest {
  return {
    actor: { id: admin.id, role: 'admin' },
    context: { ip: '127.0.0.1', requestId: 'teste-433' },
  };
}

async function withTemplate(course: Course): Promise<void> {
  const current = await getCourseCertificateTemplate(test.db, asAdmin(), course.id);
  await saveCourseCertificateTemplate(test.db, asAdmin(), course.id, {
    html: HTML,
    expectedVersionId: current.source === 'course' ? current.versionId : null,
  });
}

/** Emite o certificado como o worker faria ao receber `course.completed`. */
async function issue(user: TestUser, course: Course): Promise<string> {
  const result = await issueCertificateOnCompletion(test.db, {
    userId: user.id,
    courseId: course.id,
  });
  expect(result.outcome).toBe('issued');
  return result.certificateId as string;
}

async function render(certificateId: string): Promise<void> {
  const job = await getCertificateRenderJob(test.db, certificateId);
  if (!job) throw new Error('sem a tarefa de renderização');
  expect(await saveCertificatePdf(test.db, job, PDF)).toBe('saved');
}

async function loggedIn(user: TestUser, app: TestApp = test): Promise<Browser> {
  const session = new Browser(app.app, scan);
  expect((await session.login(user.email)).statusCode).toBe(200);
  return session;
}

const pdfUrl = (id: string) => `/api/v1/me/certificates/${id}/pdf`;
const verifyUrl = (code: string) => `/api/v1/certificates/verify/${code}`;

let withCertificate: Course;
let awaiting: Course;
let disabled: Course;
let revokedCourse: Course;
let student: TestUser;
let other: TestUser;
let certificateId: string;
let revokedId: string;

beforeAll(async () => {
  database = await isolatedDatabase();
  test = createTestApp({ DATABASE_URL: database.url });
  limited = createTestApp({ DATABASE_URL: database.url }, { rateLimits: CLASSROOM_RATE_LIMITS });

  admin = await createUser(test.db, { role: 'admin' });
  student = await createUser(test.db, { name: 'Maria Exibição' });
  other = await createUser(test.db);

  withCertificate = await makeCourse('Curso com certificado');
  awaiting = await makeCourse('Curso sem template');
  disabled = await makeCourse('Curso sem certificado', false);
  revokedCourse = await makeCourse('Curso revogado');

  await withTemplate(withCertificate);
  await withTemplate(revokedCourse);
  for (const course of [withCertificate, awaiting, disabled, revokedCourse]) {
    await completeAll(student, course);
  }
  certificateId = await issue(student, withCertificate);
  revokedId = await issue(student, revokedCourse);
  await render(revokedId);
  await revokeCertificate(test.db, asAdmin(), revokedId, { reason: 'Teste da revogação' });
}, 120_000);

afterAll(async () => {
  for (const app of [test, limited]) {
    expect(app.logText()).not.toContain(TEST_PASSWORD);
    expect(app.logText()).not.toContain('Nome-Secreto-433');
    expect(app.logText()).not.toContain('%PDF');
  }
  await limited.close();
  await test.close();
  await database.drop();
});

describe('sem sessão', () => {
  it('as rotas do aluno respondem 401', async () => {
    const visitor = new Browser(test.app, scan);
    expect((await visitor.request('GET', '/api/v1/me/certificates')).statusCode).toBe(401);
    expect((await visitor.request('GET', pdfUrl(certificateId))).statusCode).toBe(401);
    const put = await visitor.request('PUT', '/api/v1/me/certificate-name', {
      payload: { fullName: FULL_NAME },
    });
    expect(put.statusCode).toBe(401);
  });
});

describe('estado do certificado por curso (spec 015, "Estado do certificado para o aluno")', () => {
  it('GET /courses/{slug}: preparing, awaiting_template, revoked e nulo com certificado desabilitado', async () => {
    const session = await loggedIn(student);
    const state = async (course: Course) => {
      const reply = await session.request('GET', `/api/v1/courses/${course.slug}`);
      expect(reply.statusCode).toBe(200);
      return reply.json().certificate;
    };
    expect(await state(withCertificate)).toEqual({
      state: 'preparing',
      certificateId,
      code: null,
      studentName: 'Maria Exibição',
    });
    expect(await state(awaiting)).toEqual({
      state: 'awaiting_template',
      certificateId: null,
      code: null,
      studentName: 'Maria Exibição',
    });
    expect(await state(disabled)).toBeNull();
    const revoked = await state(revokedCourse);
    expect(revoked).toMatchObject({ state: 'revoked', certificateId: revokedId });
    expect(revoked.code).toMatch(CODE);

    // Quem não concluiu vê "ao concluir".
    const outsider = await loggedIn(other);
    const reply = await outsider.request('GET', `/api/v1/courses/${withCertificate.slug}`);
    expect(reply.json().certificate).toMatchObject({ state: 'in_progress', certificateId: null });
  });

  it('GET /me/courses: o estado de cada curso da estante, em lote', async () => {
    const session = await loggedIn(student);
    const reply = await session.request('GET', '/api/v1/me/courses?filter=completed');
    expect(reply.statusCode).toBe(200);
    const byId = new Map(
      reply
        .json()
        .items.map((item: { id: string; certificate: unknown }) => [item.id, item.certificate]),
    );
    expect(byId.get(withCertificate.id)).toMatchObject({ state: 'preparing', certificateId });
    expect(byId.get(awaiting.id)).toMatchObject({ state: 'awaiting_template' });
    expect(byId.get(disabled.id)).toBeNull();
    expect(byId.get(revokedCourse.id)).toMatchObject({ state: 'revoked' });
  });
});

describe('meus certificados (GET /me/certificates)', () => {
  it('lista os certificados e, à parte, os cursos que aguardam template', async () => {
    const session = await loggedIn(student);
    const reply = await session.request('GET', '/api/v1/me/certificates');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    const body = reply.json();
    expect(body.studentName).toBe('Maria Exibição');
    expect(body.items).toHaveLength(2);
    const item = body.items.find((entry: { id: string }) => entry.id === certificateId);
    expect(item).toMatchObject({
      state: 'preparing',
      course: { id: withCertificate.id, slug: withCertificate.slug, title: withCertificate.title },
      courseTitle: withCertificate.title,
      studentName: 'Maria Exibição',
      hours: 1,
      revokedAt: null,
    });
    expect(item.code).toMatch(CODE);
    expect(item.validationUrl).toBe(`${test.config.classroomUrl}/certificados/${item.code}`);
    expect(body.items.find((entry: { id: string }) => entry.id === revokedId)).toMatchObject({
      state: 'revoked',
    });
    // Só o curso concluído sem template; o desabilitado não aparece.
    expect(body.awaitingTemplate).toMatchObject([
      { course: { id: awaiting.id, slug: awaiting.slug, title: awaiting.title } },
    ]);
  });

  it('outro aluno não vê os certificados alheios', async () => {
    const session = await loggedIn(other);
    const body = (await session.request('GET', '/api/v1/me/certificates')).json();
    expect(body).toMatchObject({ items: [], awaitingTemplate: [] });
  });
});

describe('PDF do certificado (GET /me/certificates/{id}/pdf)', () => {
  it('sem PDF ainda: 409 certificate_preparing; depois de gerado, o arquivo com no-store', async () => {
    const session = await loggedIn(student);
    const preparing = await session.request('GET', pdfUrl(certificateId));
    expect(preparing.statusCode).toBe(409);
    expect(preparing.json()).toMatchObject({ code: 'certificate_preparing' });
    expect(preparing.headers['cache-control']).toBe('no-store');

    await render(certificateId);
    const reply = await session.request('GET', pdfUrl(certificateId));
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toBe('application/pdf');
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    expect(reply.headers['content-disposition']).toMatch(
      /^attachment; filename="certificado-[2-9A-HJKMNP-Z-]{14}\.pdf"$/,
    );
    expect(reply.body).toBe(PDF.toString());

    const course = (await session.request('GET', `/api/v1/courses/${withCertificate.slug}`)).json();
    expect(course.certificate).toMatchObject({ state: 'issued', certificateId });
    expect(course.certificate.code).toMatch(CODE);
  });

  it('PDF de outro aluno, revogado ou inexistente: 404; identificador fora do formato: 400', async () => {
    const outsider = await loggedIn(other);
    expect((await outsider.request('GET', pdfUrl(certificateId))).statusCode).toBe(404);
    const session = await loggedIn(student);
    expect((await session.request('GET', pdfUrl(revokedId))).statusCode).toBe(404);
    expect((await session.request('GET', pdfUrl(randomUUID()))).statusCode).toBe(404);
    expect((await session.request('GET', pdfUrl('nao-e-uuid'))).statusCode).toBe(400);
  });
});

describe('nome no certificado (PUT /me/certificate-name)', () => {
  it('sem o X-CSRF-Token: 403; fora do contrato: 400', async () => {
    const session = await loggedIn(other);
    const noCsrf = await session.request('PUT', '/api/v1/me/certificate-name', {
      payload: { fullName: FULL_NAME },
      csrf: false,
    });
    expect(noCsrf.statusCode).toBe(403);
    for (const payload of [{ fullName: '' }, {}, { fullName: 'x'.repeat(161) }]) {
      const reply = await session.request('PUT', '/api/v1/me/certificate-name', { payload });
      expect(reply.statusCode).toBe(400);
    }
    const blank = await session.request('PUT', '/api/v1/me/certificate-name', {
      payload: { fullName: '   ' },
    });
    expect(blank.statusCode).toBe(400);
  });

  it('grava o nome dos próximos certificados, sem mudar o emitido; null volta ao de exibição', async () => {
    const session = await loggedIn(student);
    const saved = await session.request('PUT', '/api/v1/me/certificate-name', {
      payload: { fullName: `  ${FULL_NAME}  ` },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ fullName: FULL_NAME, studentName: FULL_NAME });

    const list = (await session.request('GET', '/api/v1/me/certificates')).json();
    expect(list.studentName).toBe(FULL_NAME);
    // O emitido mantém o nome congelado; o curso que aguarda mostra o novo.
    const item = list.items.find((entry: { id: string }) => entry.id === certificateId);
    expect(item.studentName).toBe('Maria Exibição');
    const course = (await session.request('GET', `/api/v1/courses/${awaiting.slug}`)).json();
    expect(course.certificate.studentName).toBe(FULL_NAME);

    const cleared = await session.request('PUT', '/api/v1/me/certificate-name', {
      payload: { fullName: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual({ fullName: null, studentName: 'Maria Exibição' });
  });
});

describe('validação pública (GET /certificates/verify/{code})', () => {
  async function codeOf(id: string): Promise<string> {
    const session = await loggedIn(student);
    const list = (await session.request('GET', '/api/v1/me/certificates')).json();
    return list.items.find((entry: { id: string }) => entry.id === id).code;
  }

  it('sem login, com e sem hífens e em minúsculas: os dados previstos, nada além', async () => {
    const code = await codeOf(certificateId);
    const visitor = new Browser(test.app, scan);
    for (const variant of [code, code.replaceAll('-', ''), code.toLowerCase()]) {
      const reply = await visitor.request('GET', verifyUrl(variant));
      expect(reply.statusCode, variant).toBe(200);
      expect(reply.json()).toEqual({
        status: 'valid',
        code,
        studentName: 'Maria Exibição',
        courseTitle: withCertificate.title,
        hours: 1,
        completedAt: expect.any(String),
        issuedAt: expect.any(String),
        schoolName: expect.any(String),
        revokedAt: null,
      });
    }
    const body = (await visitor.request('GET', verifyUrl(code))).body;
    expect(body).not.toContain(student.email);
    expect(body).not.toContain('%PDF');
  });

  it('revogado: só o estado, o código e a data da revogação, sem o motivo', async () => {
    const code = await codeOf(revokedId);
    const reply = await new Browser(test.app, scan).request('GET', verifyUrl(code));
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({
      status: 'revoked',
      code,
      studentName: null,
      courseTitle: null,
      hours: null,
      completedAt: null,
      issuedAt: null,
      schoolName: null,
      revokedAt: expect.any(String),
    });
    expect(reply.body).not.toContain('Teste da revogação');
  });

  it('inexistente e fora do formato: o mesmo 404 certificate_not_found', async () => {
    const visitor = new Browser(test.app, scan);
    const bodies = [];
    for (const code of [
      'ABCD-EFGH-JKMN',
      'abcdefghjkmn',
      '0000-0000-0000',
      'curto',
      'X'.repeat(32),
    ]) {
      const reply = await visitor.request('GET', verifyUrl(code));
      expect(reply.statusCode, code).toBe(404);
      const { code: errorCode, status, title, detail } = reply.json();
      bodies.push({ errorCode, status, title, detail });
    }
    expect(bodies[0]).toMatchObject({ errorCode: 'certificate_not_found', status: 404 });
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it('a 31ª validação no minuto do mesmo IP responde 429, com ou sem sessão', async () => {
    const code = await codeOf(certificateId);
    const visitor = new Browser(limited.app, scan);
    for (let call = 0; call < 30; call += 1) {
      // Encontrado e não encontrado contam igual.
      const reply = await visitor.request(
        'GET',
        verifyUrl(call % 2 === 0 ? code : 'ABCD-EFGH-JKMN'),
      );
      expect(reply.statusCode).toBe(call % 2 === 0 ? 200 : 404);
    }
    const refused = await visitor.request('GET', verifyUrl(code));
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: 'rate_limited' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    // O limite é só da validação.
    expect((await visitor.request('GET', '/api/v1/meta')).statusCode).toBe(200);

    // A sessão não abre conta nova: o IP é o mesmo.
    const member = new Browser(limited.app, scan);
    Object.assign(member, { ip: visitor.ip });
    expect((await member.login(other.email)).statusCode).toBe(200);
    expect((await member.request('GET', verifyUrl(code))).statusCode).toBe(429);

    // Outro IP tem a própria conta.
    expect((await new Browser(limited.app, scan).request('GET', verifyUrl(code))).statusCode).toBe(
      200,
    );
  });
});
