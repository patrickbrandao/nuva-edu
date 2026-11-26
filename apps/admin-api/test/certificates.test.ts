import { createSettingsReader, type SettingsReader } from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, auditOf, type CallOptions, callAs, createActor, deniedBy } from './actors.ts';
import { createTestApp, type TestApp } from './helpers.ts';
import { makeCourse, type TestCourse } from './learning-fixtures.ts';

// Certificados pela equipe (spec 015; tarefa 423): as rotas sobre as regras do núcleo (415). O
// padrão da escola é global: só o bloco dele o grava, e o apaga ao terminar.

let invalidations = 0;
let reader: SettingsReader | undefined;
function current(): SettingsReader {
  if (reader === undefined) reader = createSettingsReader(test.db);
  return reader;
}
// O leitor do processo, contando os descartes; criado sobre o banco do app na primeira leitura.
const settings: SettingsReader = {
  all: () => current().all(),
  get: (key) => current().get(key),
  schoolName: () => current().schoolName(),
  schoolTimezone: () => current().schoolTimezone(),
  invalidate: () => {
    invalidations += 1;
    reader?.invalidate();
  },
};

const test: TestApp = createTestApp({}, { settings });
afterAll(() => test.close());

let admin: Actor;
let manager: Actor;
let instructor: Actor;
let otherInstructor: Actor;

beforeAll(async () => {
  [admin, manager, instructor, otherInstructor] = await Promise.all([
    createActor(test, 'admin'),
    createActor(test, 'manager'),
    createActor(test, 'instructor'),
    createActor(test, 'instructor'),
  ]);
});

const HTML =
  '<p>{{aluno.nome}} {{curso.titulo}} {{certificado.codigo}} {{certificado.url_validacao}}</p>';
const PDF = Buffer.from('%PDF-1.7 certificado de teste');

const call = (options: CallOptions) => callAs(test, options);
const get = (as: Actor, url: string) => call({ method: 'GET', url, as });
const post = (as: Actor, url: string, payload?: object) =>
  call({ method: 'POST', url, as, ...(payload === undefined ? {} : { payload }) });
const put = (as: Actor, url: string, payload: object) => call({ method: 'PUT', url, as, payload });

/** Template próprio do curso, gravado pelo admin. */
async function withTemplate(course: TestCourse, html = HTML) {
  const response = await put(admin, `/api/v1/courses/${course.id}/certificate-template`, {
    html,
    expectedVersionId: null,
  });
  expect(response.statusCode).toBe(200);
  return response.json();
}

/** Curso com template e um certificado emitido manualmente pelo gerente. */
async function issued(options: { ownerId?: string } = {}) {
  const course = await makeCourse(test, options);
  await withTemplate(course);
  const student = await createActor(test, 'student');
  const response = await post(manager, '/api/v1/certificates', {
    userId: student.id,
    courseId: course.id,
    reason: 'Turma migrada',
  });
  expect(response.statusCode).toBe(201);
  return { course, student, certificate: response.json() };
}

/** Grava o PDF como o worker faria. */
async function render(certificateId: string) {
  await test.db
    .updateTable('certificates')
    .set({ pdf: PDF, pdfRenderedAt: new Date() })
    .where('id', '=', certificateId)
    .execute();
}

/** Linhas da auditoria de quem age ou sobre o alvo (outros arquivos gravam ao mesmo tempo). */
const auditCount = async (actorId: string, targetId: string) =>
  Number(
    (
      await test.db
        .selectFrom('auditLog')
        .select((eb) => eb.fn.countAll().as('n'))
        .where((eb) => eb.or([eb('actorUserId', '=', actorId), eb('targetId', '=', targetId)]))
        .executeTakeFirstOrThrow()
    ).n,
  );

describe('emissão manual, revogação, restauração e reemissão', () => {
  it('gerente emite: 201 em preparação, com auditoria; de novo: 409 certificate_exists', async () => {
    const { course, student, certificate } = await issued();
    expect(certificate).toMatchObject({
      state: 'preparing',
      user: { id: student.id },
      course: { type: 'course', id: course.id, title: course.title },
      studentName: 'Pessoa de Teste',
      issuedManually: true,
      issuedBy: { id: manager.id },
      issueReason: 'Turma migrada',
      revokedAt: null,
      pdfRenderedAt: null,
    });
    expect(certificate.code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(await auditOf(test, certificate.id, 'certificate.issue')).toHaveLength(1);

    const again = await post(manager, '/api/v1/certificates', {
      userId: student.id,
      courseId: course.id,
      reason: 'De novo',
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('certificate_exists');
  });

  it('emissão sem template: 422 certificate_template_missing; instrutor: 403', async () => {
    const course = await makeCourse(test, { ownerId: instructor.id });
    const student = await createActor(test, 'student');
    const payload = { userId: student.id, courseId: course.id, reason: 'Motivo' };
    const missing = await post(admin, '/api/v1/certificates', payload);
    expect(missing.statusCode).toBe(422);
    expect(missing.json().code).toBe('certificate_template_missing');
    const denied = await post(instructor, '/api/v1/certificates', payload);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('permission_denied');
  });

  it('só o admin revoga e restaura; o gerente recebe 403, com a negação na auditoria', async () => {
    const { certificate } = await issued();
    const url = `/api/v1/certificates/${certificate.id}`;

    const before = (await deniedBy(test, manager.id)).length;
    const denied = await post(manager, `${url}/revoke`, { reason: 'Fraude' });
    expect(denied.statusCode).toBe(403);
    expect(await deniedBy(test, manager.id)).toHaveLength(before + 1);

    const revoked = await post(admin, `${url}/revoke`, { reason: 'Fraude' });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      state: 'revoked',
      revokedBy: { id: admin.id },
      revokeReason: 'Fraude',
      revokedAt: expect.any(String),
    });
    expect(await auditOf(test, certificate.id, 'certificate.revoke')).toHaveLength(1);
    const twice = await post(admin, `${url}/revoke`, { reason: 'Fraude' });
    expect(twice.statusCode).toBe(409);
    expect(twice.json().code).toBe('certificate_already_revoked');

    // Revogado não é reemitido.
    const reissue = await post(manager, `${url}/reissue`);
    expect(reissue.statusCode).toBe(409);
    expect(reissue.json().code).toBe('certificate_already_revoked');

    expect((await post(manager, `${url}/restore`)).statusCode).toBe(403);
    const restored = await post(admin, `${url}/restore`);
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ state: 'preparing', revokedAt: null });
    const notRevoked = await post(admin, `${url}/restore`);
    expect(notRevoked.statusCode).toBe(409);
    expect(notRevoked.json().code).toBe('certificate_not_revoked');
  });

  it('gerente reemite: mantém o código, congela o nome atual e volta a preparing', async () => {
    const { student, certificate } = await issued();
    await render(certificate.id);
    await test.db
      .updateTable('users')
      .set({ fullName: 'Nome Completo Corrigido' })
      .where('id', '=', student.id)
      .execute();
    const response = await post(manager, `/api/v1/certificates/${certificate.id}/reissue`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: certificate.id,
      code: certificate.code,
      state: 'preparing',
      studentName: 'Nome Completo Corrigido',
      pdfRenderedAt: null,
    });
    expect(await auditOf(test, certificate.id, 'certificate.reissue')).toHaveLength(1);
    expect(
      (await post(instructor, `/api/v1/certificates/${certificate.id}/reissue`)).statusCode,
    ).toBe(403);
  });
});

describe('lista e PDF', () => {
  it('lista com filtros; o instrutor vê só os dos próprios cursos', async () => {
    const own = await issued({ ownerId: instructor.id });
    const other = await issued({ ownerId: otherInstructor.id });

    const byCourse = await get(manager, `/api/v1/certificates?courseId=${own.course.id}`);
    expect(byCourse.statusCode).toBe(200);
    expect(byCourse.json()).toMatchObject({
      items: [{ id: own.certificate.id }],
      nextCursor: null,
    });

    const code = (own.certificate.code as string).replaceAll('-', '').toLowerCase();
    const byCode = await get(manager, `/api/v1/certificates?code=${code}`);
    expect(byCode.json().items.map((item: { id: string }) => item.id)).toEqual([
      own.certificate.id,
    ]);

    const scoped = await get(instructor, '/api/v1/certificates?limit=100');
    const ids = scoped.json().items.map((item: { id: string }) => item.id);
    expect(ids).toContain(own.certificate.id);
    expect(ids).not.toContain(other.certificate.id);
    const foreign = await get(instructor, `/api/v1/certificates?userId=${other.student.id}`);
    expect(foreign.json().items).toEqual([]);

    expect((await get(manager, '/api/v1/certificates?state=lost')).statusCode).toBe(400);
  });

  it('gerente baixa o PDF, também revogado, sem gravar auditoria; em preparação: 409', async () => {
    const { certificate } = await issued();
    const url = `/api/v1/certificates/${certificate.id}/pdf`;

    const preparing = await get(manager, url);
    expect(preparing.statusCode).toBe(409);
    expect(preparing.json().code).toBe('certificate_preparing');

    await render(certificate.id);
    const audits = await auditCount(manager.id, certificate.id);
    const response = await get(manager, url);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="certificado-${certificate.code}.pdf"`,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.rawPayload.equals(PDF)).toBe(true);
    expect(await auditCount(manager.id, certificate.id)).toBe(audits);

    expect(
      (await post(admin, `/api/v1/certificates/${certificate.id}/revoke`, { reason: 'Erro' }))
        .statusCode,
    ).toBe(200);
    expect((await get(admin, url)).statusCode).toBe(200);
  });

  it('instrutor: 200 no próprio curso, 404 no alheio; titular removido ou inexistente: 404', async () => {
    const own = await issued({ ownerId: instructor.id });
    const other = await issued({ ownerId: otherInstructor.id });
    await render(own.certificate.id);
    await render(other.certificate.id);
    expect(
      (await get(instructor, `/api/v1/certificates/${own.certificate.id}/pdf`)).statusCode,
    ).toBe(200);
    expect(
      (await get(instructor, `/api/v1/certificates/${other.certificate.id}/pdf`)).statusCode,
    ).toBe(404);

    // Exclusão da conta do titular (spec 030): nome e PDF apagados.
    await test.db
      .updateTable('certificates')
      .set({ studentName: null, pdf: null, pdfRenderedAt: null })
      .where('id', '=', other.certificate.id)
      .execute();
    expect((await get(admin, `/api/v1/certificates/${other.certificate.id}/pdf`)).statusCode).toBe(
      404,
    );
    expect((await get(admin, `/api/v1/certificates/${crypto.randomUUID()}/pdf`)).statusCode).toBe(
      404,
    );
  });
});

describe('emissão retroativa', () => {
  it('202 com o lote; desabilitado e sem template: 422; instrutor alheio: 404', async () => {
    const course = await makeCourse(test, { ownerId: instructor.id });
    const missing = await post(instructor, `/api/v1/courses/${course.id}/certificates/backfill`);
    expect(missing.statusCode).toBe(422);
    expect(missing.json().code).toBe('certificate_template_missing');

    await withTemplate(course);
    const queued = await post(instructor, `/api/v1/courses/${course.id}/certificates/backfill`);
    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toEqual({ courseId: course.id, queued: true });
    expect(await auditOf(test, course.id, 'certificate.backfill')).toHaveLength(1);

    expect(
      (await post(otherInstructor, `/api/v1/courses/${course.id}/certificates/backfill`))
        .statusCode,
    ).toBe(404);

    const disabled = await makeCourse(test, { enabled: false });
    const response = await post(admin, `/api/v1/courses/${disabled.id}/certificates/backfill`);
    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe('certificate_disabled');
  });
});

describe('template do curso', () => {
  it('grava, edita com a versão aberta e exclui; a primeira gravação enfileira o lote', async () => {
    const course = await makeCourse(test, { ownerId: instructor.id });
    const url = `/api/v1/courses/${course.id}/certificate-template`;

    const empty = await get(instructor, url);
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({
      source: 'none',
      html: null,
      versionId: null,
      updatedAt: null,
      updatedBy: null,
    });

    const saved = await put(instructor, url, { html: HTML, expectedVersionId: null });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      source: 'course',
      html: HTML,
      versionId: expect.any(String),
      updatedAt: expect.any(String),
      updatedBy: { id: instructor.id },
      backfillQueued: true,
    });
    expect(await auditOf(test, course.id, 'certificate_template.update')).toHaveLength(1);

    const stale = await put(instructor, url, { html: HTML, expectedVersionId: null });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('version_conflict');

    const edited = await put(manager, url, {
      html: `<div>${HTML}</div>`,
      expectedVersionId: saved.json().versionId,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().backfillQueued).toBe(false);

    const removed = await call({ method: 'DELETE', url, as: instructor });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ source: 'none', html: null });
    expect(await auditOf(test, course.id, 'certificate_template.delete')).toHaveLength(1);
  });

  it('template inválido: 422 com details.problems, nada gravado; acima de 768 KiB: too_large', async () => {
    const course = await makeCourse(test);
    const url = `/api/v1/courses/${course.id}/certificate-template`;
    const invalid = await put(admin, url, {
      html: '<p>{{aluno.nome}}</p><script>alert(1)</script>',
      expectedVersionId: null,
    });
    expect(invalid.statusCode).toBe(422);
    const problem = invalid.json();
    expect(problem.code).toBe('certificate_template_invalid');
    const rules = problem.details.problems.map((item: { rule: string }) => item.rule);
    expect(rules).toContain('element_not_allowed');
    expect(rules).toContain('missing_required_key');
    for (const item of problem.details.problems) {
      expect(item).toEqual({
        rule: expect.any(String),
        message: expect.any(String),
        line: expect.any(Number),
        column: expect.any(Number),
      });
    }

    // Dentro do limite de 1 MB do corpo, acima dos 768 KiB do template.
    const large = await put(admin, url, {
      html: `${HTML}<p>${'a'.repeat(800 * 1024)}</p>`,
      expectedVersionId: null,
    });
    expect(large.statusCode).toBe(422);
    expect(large.json().details.problems[0]).toMatchObject({
      rule: 'too_large',
      line: 1,
      column: 1,
    });

    // Perto do limite do template: o corpo passa.
    const near = await put(admin, url, {
      html: `${HTML}<p>${'a'.repeat(760 * 1024)}</p>`,
      expectedVersionId: null,
    });
    expect(near.statusCode).toBe(200);
  });

  it('instrutor em curso alheio: 404 em ler, gravar e excluir', async () => {
    const course = await makeCourse(test, { ownerId: otherInstructor.id });
    const url = `/api/v1/courses/${course.id}/certificate-template`;
    expect((await get(instructor, url)).statusCode).toBe(404);
    expect((await put(instructor, url, { html: HTML, expectedVersionId: null })).statusCode).toBe(
      404,
    );
    expect((await call({ method: 'DELETE', url, as: instructor })).statusCode).toBe(404);
  });
});

describe('referência e PDFs de exemplo', () => {
  it('as 13 palavras-chave e o modelo inicial', async () => {
    const response = await get(instructor, '/api/v1/certificate-templates/reference');
    expect(response.statusCode).toBe(200);
    const reference = response.json();
    expect(reference.keys).toHaveLength(13);
    expect(reference.keys[0]).toMatchObject({
      key: 'aluno.nome',
      placeholder: '{{aluno.nome}}',
      required: true,
      requiredOneOf: false,
    });
    const url = reference.keys.find(
      (key: { key: string }) => key.key === 'certificado.url_validacao',
    );
    expect(url.example.startsWith(`${test.config.classroomUrl}/certificados/`)).toBe(true);
    expect(reference.modelHtml).toContain('{{aluno.nome}}');
  });

  it('pede o exemplo, consulta e baixa; de outro usuário: 404; antes de pronto: 409', async () => {
    const requester = await createActor(test, 'instructor');
    const course = await makeCourse(test, { ownerId: requester.id });
    const created = await post(requester, '/api/v1/certificate-templates/previews', {
      html: HTML,
      courseId: course.id,
    });
    expect(created.statusCode).toBe(202);
    const preview = created.json();
    expect(preview).toMatchObject({
      courseId: course.id,
      status: 'pending',
      error: null,
      renderedAt: null,
    });
    const url = `/api/v1/certificate-templates/previews/${preview.id}`;
    expect((await get(requester, url)).json().status).toBe('pending');
    expect((await get(admin, url)).statusCode).toBe(404);

    const notReady = await get(requester, `${url}/pdf`);
    expect(notReady.statusCode).toBe(409);
    expect(notReady.json().code).toBe('certificate_preview_not_ready');

    await test.db
      .updateTable('certificatePreviews')
      .set({ status: 'ready', pdf: PDF, renderedAt: new Date() })
      .where('id', '=', preview.id)
      .execute();
    expect((await get(requester, url)).json()).toMatchObject({
      status: 'ready',
      renderedAt: expect.any(String),
    });
    const pdf = await get(requester, `${url}/pdf`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['cache-control']).toBe('no-store');
    expect(pdf.rawPayload.equals(PDF)).toBe(true);
    expect((await get(admin, `${url}/pdf`)).statusCode).toBe(404);
  });

  it('exemplo inválido: 422; curso alheio ao instrutor: 404; o 21º na hora: 429', async () => {
    const requester = await createActor(test, 'instructor');
    const previews = '/api/v1/certificate-templates/previews';
    const invalid = await post(requester, previews, { html: '<p>sem chaves</p>' });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().code).toBe('certificate_template_invalid');

    const foreign = await makeCourse(test, { ownerId: otherInstructor.id });
    expect((await post(requester, previews, { html: HTML, courseId: foreign.id })).statusCode).toBe(
      404,
    );

    // Vinte pedidos na última hora, direto na tabela.
    await test.db
      .insertInto('certificatePreviews')
      .values(Array.from({ length: 20 }, () => ({ requestedBy: requester.id, html: HTML })))
      .execute();
    const limited = await post(requester, previews, { html: HTML, courseId: null });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().code).toBe('rate_limited');
    expect(limited.headers['retry-after']).toEqual(expect.any(String));
  });
});

describe('signatário', () => {
  it('admin lê e grava; descarta o cache do processo; gerente: 403', async () => {
    const url = '/api/v1/settings/certificates';
    const current = await get(admin, url);
    expect(current.statusCode).toBe(200);
    expect(current.json()).toEqual({
      signerName: expect.toBeOneOf([expect.any(String), null]),
      signerRole: expect.toBeOneOf([expect.any(String), null]),
      schoolName: expect.any(String),
    });

    const before = invalidations;
    const saved = await put(admin, url, { signerName: 'Ana Diretora', signerRole: 'Diretora' });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ signerName: 'Ana Diretora', signerRole: 'Diretora' });
    expect(invalidations).toBe(before + 1);
    expect((await get(admin, url)).json()).toMatchObject({ signerName: 'Ana Diretora' });

    const cleared = await put(admin, url, { signerName: null, signerRole: null });
    expect(cleared.json()).toMatchObject({ signerName: null, signerRole: null });

    expect((await get(manager, url)).statusCode).toBe(403);
    expect((await put(manager, url, { signerName: 'X', signerRole: null })).statusCode).toBe(403);
  });
});

describe('template padrão da escola', () => {
  it('só o admin; gravar enfileira o lote dos cursos sem template; excluir volta a none', async () => {
    const url = '/api/v1/settings/certificate-template';
    expect((await get(manager, url)).statusCode).toBe(403);
    expect((await put(manager, url, { html: HTML, expectedVersionId: null })).statusCode).toBe(403);

    const initial = await get(admin, url);
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({ source: 'none', html: null });

    const course = await makeCourse(test, { ownerId: instructor.id });
    const saved = await put(admin, url, { html: HTML, expectedVersionId: null });
    try {
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({
        source: 'school',
        html: HTML,
        updatedBy: { id: admin.id },
        backfillQueued: true,
      });
      // O curso sem template próprio passa a usar o padrão.
      const courseTemplate = await get(
        instructor,
        `/api/v1/courses/${course.id}/certificate-template`,
      );
      expect(courseTemplate.json()).toMatchObject({ source: 'school', html: null });

      const invalid = await put(admin, url, {
        html: '<iframe src="https://x.test"></iframe>',
        expectedVersionId: saved.json().versionId,
      });
      expect(invalid.statusCode).toBe(422);
      expect(invalid.json().code).toBe('certificate_template_invalid');
    } finally {
      const removed = await call({ method: 'DELETE', url, as: admin });
      expect(removed.statusCode).toBe(200);
      expect(removed.json()).toMatchObject({ source: 'none', html: null });
    }
  });
});
