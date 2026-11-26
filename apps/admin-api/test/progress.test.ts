import { generateCertificateCode } from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, type CallOptions, callAs, createActor, deniedBy } from './actors.ts';
import { createTestApp, type TestApp } from './helpers.ts';
import { completeLessons, grantCourse, makeCourse } from './learning-fixtures.ts';

// Progresso para a equipe (spec 014; tarefa 423): as rotas sobre as leituras do núcleo (413),
// com o alcance do instrutor e o certificado de cada curso.

const test: TestApp = createTestApp();
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

const call = (options: CallOptions) => callAs(test, options);
const get = (as: Actor, url: string) => call({ method: 'GET', url, as });

describe('GET /users/{id}/progress', () => {
  it('um item por curso, com o progresso, a última atividade e o certificado', async () => {
    const student = await createActor(test, 'student');
    const own = await makeCourse(test, { ownerId: instructor.id, mode: 'paid' });
    const other = await makeCourse(test, { ownerId: otherInstructor.id });
    await grantCourse(test, student.id, own.id, manager.id);
    await completeLessons(test, student.id, own, 2);
    await completeLessons(test, student.id, other);
    // O certificado do curso alheio, direto na tabela.
    const version = await test.db
      .insertInto('certificateTemplateVersions')
      .values({ courseId: other.id, html: '<p>x</p>', createdBy: admin.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    const certificate = await test.db
      .insertInto('certificates')
      .values({
        userId: student.id,
        courseId: other.id,
        code: generateCertificateCode(),
        studentName: 'Aluno',
        courseTitle: other.title,
        hours: 2,
        completedAt: new Date(),
        schoolName: 'Escola',
        templateVersionId: version.id,
      })
      .returning(['id', 'code'])
      .executeTakeFirstOrThrow();

    const response = await get(manager, `/api/v1/users/${student.id}/progress`);
    expect(response.statusCode).toBe(200);
    const items = response.json().items as {
      course: { id: string };
      progress: object;
      certificate: unknown;
      lastActivityAt: string | null;
    }[];
    const byCourse = new Map(items.map((item) => [item.course.id, item]));
    expect(byCourse.get(own.id)).toMatchObject({
      course: { type: 'course', id: own.id, title: own.title },
      progress: { completedLessons: 2, totalLessons: 4, percent: 50, state: 'in_progress' },
      certificate: null,
    });
    expect(byCourse.get(own.id)?.lastActivityAt).toEqual(expect.any(String));
    expect(byCourse.get(other.id)).toMatchObject({
      progress: { completedLessons: 4, percent: 100, state: 'completed' },
      certificate: {
        id: certificate.id,
        code: `${certificate.code.slice(0, 4)}-${certificate.code.slice(4, 8)}-${certificate.code.slice(8)}`,
        state: 'preparing',
      },
    });

    // O instrutor vê só os próprios cursos.
    const scoped = await get(instructor, `/api/v1/users/${student.id}/progress`);
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json().items.map((item: { course: { id: string } }) => item.course.id)).toEqual([
      own.id,
    ]);
  });

  it('instrutor sem nenhum curso do usuário: 404; aluno: 403', async () => {
    const student = await createActor(test, 'student');
    const course = await makeCourse(test, { ownerId: otherInstructor.id });
    await completeLessons(test, student.id, course, 1);
    expect((await get(instructor, `/api/v1/users/${student.id}/progress`)).statusCode).toBe(404);
    const denied = await get(student, `/api/v1/users/${student.id}/progress`);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('permission_denied');
  });
});

describe('GET /courses/{id}/progress-summary', () => {
  it('alunos por faixa e taxa de conclusão; instrutor só no próprio curso', async () => {
    const course = await makeCourse(test, { ownerId: instructor.id });
    const [a, b, c] = await Promise.all([
      createActor(test, 'student'),
      createActor(test, 'student'),
      createActor(test, 'student'),
    ]);
    await completeLessons(test, a.id, course);
    await completeLessons(test, b.id, course, 1);
    await completeLessons(test, c.id, course, 3);

    const response = await get(instructor, `/api/v1/courses/${course.id}/progress-summary`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      courseId: course.id,
      totalLessons: 4,
      studentCount: 3,
      buckets: { notStarted: 0, upTo25: 1, upTo50: 0, upTo75: 1, upTo99: 0, completed: 1 },
      completionRate: 0.3333,
    });

    expect(
      (await get(otherInstructor, `/api/v1/courses/${course.id}/progress-summary`)).statusCode,
    ).toBe(404);
    expect(
      (await get(admin, `/api/v1/courses/${crypto.randomUUID()}/progress-summary`)).statusCode,
    ).toBe(404);
  });
});

describe('GET /courses/{id}/students', () => {
  it('nome, avatar, progresso e acesso, sem e-mail; filtros, ordem e páginas', async () => {
    const course = await makeCourse(test, { ownerId: instructor.id, mode: 'paid' });
    const students = await Promise.all([1, 2, 3].map(() => createActor(test, 'student')));
    for (const student of students) await grantCourse(test, student.id, course.id, manager.id);
    await completeLessons(test, students[0]?.id as string, course);
    await completeLessons(test, students[1]?.id as string, course, 1);
    const emails = await test.db
      .selectFrom('users')
      .select('email')
      .where(
        'id',
        'in',
        students.map((student) => student.id),
      )
      .execute();

    const response = await get(instructor, `/api/v1/courses/${course.id}/students?sort=-percent`);
    expect(response.statusCode).toBe(200);
    const page = response.json();
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item: { user: { id: string } }) => item.user.id)).toEqual([
      students[0]?.id,
      students[1]?.id,
      students[2]?.id,
    ]);
    expect(page.items[0]).toEqual({
      user: { id: students[0]?.id, name: 'Pessoa de Teste', avatarUrl: null },
      progress: { completedLessons: 4, totalLessons: 4, percent: 100, state: 'completed' },
      lastActivityAt: expect.any(String),
      accessExpiresAt: null,
    });
    for (const { email } of emails) expect(response.body).not.toContain(email);

    const completed = await get(manager, `/api/v1/courses/${course.id}/students?state=completed`);
    expect(completed.json().items.map((item: { user: { id: string } }) => item.user.id)).toEqual([
      students[0]?.id,
    ]);

    const first = await get(manager, `/api/v1/courses/${course.id}/students?limit=2&sort=-percent`);
    expect(first.json().items).toHaveLength(2);
    const cursor = first.json().nextCursor as string;
    expect(cursor).toEqual(expect.any(String));
    const second = await get(
      manager,
      `/api/v1/courses/${course.id}/students?limit=2&sort=-percent&cursor=${cursor}`,
    );
    expect(second.json()).toMatchObject({ items: [{ user: { id: students[2]?.id } }] });
  });

  it('instrutor em curso alheio: 404, sem negação na auditoria; estado fora da lista: 400', async () => {
    const course = await makeCourse(test, { ownerId: otherInstructor.id });
    const before = (await deniedBy(test, instructor.id)).length;
    expect((await get(instructor, `/api/v1/courses/${course.id}/students`)).statusCode).toBe(404);
    expect(await deniedBy(test, instructor.id)).toHaveLength(before);
    expect(
      (await get(manager, `/api/v1/courses/${course.id}/students?state=finished`)).statusCode,
    ).toBe(400);
  });
});

describe('anotações', () => {
  it('nenhuma rota da admin-api lê anotações do aluno', () => {
    const routes = test.app.registeredRoutes().map((route) => route.path);
    expect(routes.filter((path) => /notes?\b|anotac/i.test(path))).toEqual([]);
  });
});
