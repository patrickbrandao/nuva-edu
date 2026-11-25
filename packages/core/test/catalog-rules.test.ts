import { randomUUID } from 'node:crypto';
import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CATALOG_LIMITS,
  type CatalogRequest,
  catalogSlugFromTitle,
  closeDatabase,
  createBundle,
  createCourse,
  createDatabase,
  createEbook,
  createLesson,
  createModule,
  type Database,
  DomainError,
  getAdminModule,
  publishCourse,
  type Role,
  reorderLessons,
  updateBundle,
  updateCourse,
  updateEbook,
  updateLesson,
} from '../src/index.ts';

// Regras de criação e edição do catálogo decididas na tarefa 620 (spec 009, "Criação e
// edição"): mover aula entre módulos, slug gerado, modo inicial `private`, permissão antes da
// regra, duração nula e leitura de módulo. Banco próprio deste arquivo.

let testDb: TestDatabase;
let db: Database;
let admin: CatalogRequest;
let manager: CatalogRequest;
let instructor: CatalogRequest;
let otherInstructor: CatalogRequest;
let student: CatalogRequest;

async function createUser(role: Role): Promise<CatalogRequest> {
  const row = await sql<{ id: string }>`
    INSERT INTO users (email, name, role)
    VALUES (${`regra-${randomUUID()}@exemplo.test`}, 'Pessoa de teste', ${role})
    RETURNING id`.execute(db);
  const id = row.rows[0]?.id as string;
  return { actor: { id, role }, context: { ip: '127.0.0.1', requestId: 'req-regra' } };
}

beforeAll(async () => {
  loadEnvFiles();
  testDb = await createTestDatabase();
  db = createDatabase({ connectionString: testDb.url, maxConnections: 4 });
  admin = await createUser('admin');
  manager = await createUser('manager');
  instructor = await createUser('instructor');
  otherInstructor = await createUser('instructor');
  student = await createUser('student');
});

afterAll(async () => {
  await closeDatabase(db);
  await testDb.drop();
});

async function expectError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  const domain = error as DomainError;
  expect({ status: domain.status, code: domain.code }).toEqual({ status, code });
  return domain;
}

function slug(): string {
  return `regra-${randomUUID().slice(0, 8)}`;
}

async function auditOf(targetId: string) {
  const result = await sql<{ action: string; outcome: string; details: unknown }>`
    SELECT action, outcome, details FROM audit_log
    WHERE target_id = ${targetId} ORDER BY created_at, id`.execute(db);
  return result.rows;
}

async function deniedFor(actorId: string, action: string): Promise<number> {
  const result = await sql<{ n: number }>`
    SELECT count(*)::int AS n FROM audit_log
    WHERE actor_user_id = ${actorId} AND action = ${action} AND outcome = 'denied'`.execute(db);
  return result.rows[0]?.n ?? 0;
}

/** Aulas de um módulo, na ordem: título, posição e versão. */
async function lessonsOf(moduleId: string) {
  const rows = await db
    .selectFrom('lessons')
    .select(['title', 'position', 'version'])
    .where('moduleId', '=', moduleId)
    .orderBy('position')
    .execute();
  return rows.map((row) => [row.title, row.position, row.version]);
}

describe('mover aula entre módulos (reorderLessons)', () => {
  it('move a aula de outro módulo do mesmo curso e fecha a numeração da origem', async () => {
    const course = await createCourse(db, instructor, { title: 'Mover aulas' });
    const from = await createModule(db, instructor, course.id, { title: 'Origem' });
    const to = await createModule(db, instructor, course.id, { title: 'Destino' });
    const a1 = await createLesson(db, instructor, from.id, { title: 'A1' });
    const a2 = await createLesson(db, instructor, from.id, { title: 'A2' });
    const a3 = await createLesson(db, instructor, from.id, { title: 'A3' });
    const b1 = await createLesson(db, instructor, to.id, { title: 'B1' });
    const b2 = await createLesson(db, instructor, to.id, { title: 'B2' });

    const result = await reorderLessons(db, instructor, to.id, {
      lessonIds: [b2.id, a2.id.toUpperCase(), b1.id],
    });
    expect(result.map((lesson) => [lesson.title, lesson.moduleId, lesson.position])).toEqual([
      ['B2', to.id, 0],
      ['A2', to.id, 1],
      ['B1', to.id, 2],
    ]);
    // Só a aula movida avança o `version`; a origem fica 0 e 1.
    expect(await lessonsOf(to.id)).toEqual([
      ['B2', 0, 1],
      ['A2', 1, 2],
      ['B1', 2, 1],
    ]);
    expect(await lessonsOf(from.id)).toEqual([
      ['A1', 0, 1],
      ['A3', 1, 1],
    ]);
    const reorder = (await auditOf(to.id)).filter((row) => row.action === 'lesson.reorder');
    expect(reorder).toEqual([
      {
        action: 'lesson.reorder',
        outcome: 'ok',
        details: {
          lessonIds: [b2.id, a2.id, b1.id],
          moved: [{ lessonId: a2.id, fromModuleId: from.id, toModuleId: to.id }],
        },
      },
    ]);
    // O `version` dos módulos (pais) não avança.
    const modules = await db
      .selectFrom('modules')
      .select('version')
      .where('courseId', '=', course.id)
      .execute();
    expect(modules.map((row) => row.version)).toEqual([1, 1]);

    // Esvaziar a origem, movendo duas de uma vez; a reordenação simples não leva `moved`.
    await reorderLessons(db, instructor, to.id, {
      lessonIds: [a1.id, a3.id, a2.id, b1.id, b2.id],
    });
    expect(await lessonsOf(from.id)).toEqual([]);
    expect((await lessonsOf(to.id)).map((row) => row[0])).toEqual(['A1', 'A3', 'A2', 'B1', 'B2']);
    await reorderLessons(db, instructor, to.id, {
      lessonIds: [b2.id, b1.id, a2.id, a3.id, a1.id],
    });
    const last = (await auditOf(to.id)).at(-1);
    expect(last?.details).toEqual({ lessonIds: [b2.id, b1.id, a2.id, a3.id, a1.id] });
    // E de volta para o módulo vazio.
    await reorderLessons(db, instructor, from.id, { lessonIds: [a1.id] });
    expect(await lessonsOf(from.id)).toEqual([['A1', 0, 3]]);
  });

  it('aula de outro curso, inexistente, repetida ou faltando é 422 order_mismatch, sem gravar', async () => {
    const course = await createCourse(db, instructor, { title: 'Ordem recusada' });
    const module = await createModule(db, instructor, course.id, { title: 'M1' });
    const sibling = await createModule(db, instructor, course.id, { title: 'M2' });
    const a = await createLesson(db, instructor, module.id, { title: 'A' });
    const b = await createLesson(db, instructor, module.id, { title: 'B' });
    const c = await createLesson(db, instructor, sibling.id, { title: 'C' });
    const other = await createCourse(db, instructor, { title: 'Outro curso' });
    const otherModule = await createModule(db, instructor, other.id, { title: 'M' });
    const foreign = await createLesson(db, instructor, otherModule.id, { title: 'Fora' });

    const attempts: unknown[] = [
      [a.id, b.id, foreign.id],
      [a.id, b.id, randomUUID()],
      [a.id, b.id, 'nao-e-uuid'],
      [a.id, b.id, 7],
      [a.id, c.id],
      [a.id, b.id, c.id, c.id],
      [a.id, a.id, b.id],
      // Aula válida junto de uma de outro curso: nada é movido.
      [a.id, c.id, b.id, foreign.id],
    ];
    for (const lessonIds of attempts) {
      await expectError(
        reorderLessons(db, instructor, module.id, { lessonIds }),
        422,
        'order_mismatch',
      );
    }
    await expectError(
      reorderLessons(db, instructor, module.id, { lessonIds: 'x' }),
      400,
      'validation_failed',
    );
    expect(await lessonsOf(module.id)).toEqual([
      ['A', 0, 1],
      ['B', 1, 1],
    ]);
    expect(await lessonsOf(sibling.id)).toEqual([['C', 0, 1]]);
    expect(await lessonsOf(otherModule.id)).toEqual([['Fora', 0, 1]]);
    expect((await auditOf(module.id)).map((row) => row.action)).toEqual(['module.create']);
    // Módulo de curso alheio ao instrutor: 404.
    await expectError(
      reorderLessons(db, otherInstructor, module.id, { lessonIds: [a.id, b.id] }),
      404,
      'not_found',
    );
  });
});

describe('slug gerado do título', () => {
  it('catalogSlugFromTitle: sem acentos, minúsculas, hífens, até 160 e o padrão por tipo', () => {
    expect(catalogSlugFromTitle('  Introdução à Física — Módulo 2!  ', 'course')).toBe(
      'introducao-a-fisica-modulo-2',
    );
    expect(catalogSlugFromTitle('Ça & là: ÀÉÎÕÜ ñ', 'ebook')).toBe('ca-la-aeiou-n');
    expect(catalogSlugFromTitle('---', 'course')).toBe('curso');
    expect(catalogSlugFromTitle('日本語', 'ebook')).toBe('ebook');
    expect(catalogSlugFromTitle('¿?', 'bundle')).toBe('pacote');
    const long = catalogSlugFromTitle(`${'a'.repeat(159)} b`, 'course');
    expect(long).toBe('a'.repeat(159));
    expect(catalogSlugFromTitle('x'.repeat(300), 'course')).toHaveLength(160);
  });

  it('criar sem slug gera do título; o segundo do mesmo tipo recebe -2, o terceiro -3', async () => {
    const title = `Álgebra Linear ${randomUUID().slice(0, 8)}`;
    const base = catalogSlugFromTitle(title, 'course');
    const first = await createCourse(db, manager, { title });
    const second = await createCourse(db, manager, { title, slug: null });
    const third = await createCourse(db, instructor, { title });
    expect([first.slug, second.slug, third.slug]).toEqual([base, `${base}-2`, `${base}-3`]);
    expect((await auditOf(second.id))[0]?.details).toMatchObject({ slug: `${base}-2` });
    // A unicidade é por tipo: ebook e pacote com o mesmo título ficam com a base.
    const ebook = await createEbook(db, manager, { title });
    const ebook2 = await createEbook(db, manager, { title });
    const bundle = await createBundle(db, manager, { title });
    const bundle2 = await createBundle(db, manager, { title });
    expect([ebook.slug, ebook2.slug, bundle.slug, bundle2.slug]).toEqual([
      base,
      `${base}-2`,
      base,
      `${base}-2`,
    ]);
    // Slug informado repetido não ganha sufixo: 409.
    await expectError(createCourse(db, manager, { title, slug: base }), 409, 'slug_taken');
    await expectError(createEbook(db, manager, { title, slug: `${base}-2` }), 409, 'slug_taken');
    await expectError(createBundle(db, manager, { title, slug: base }), 409, 'slug_taken');
    // Slug informado fora do formato continua 400.
    await expectError(createCourse(db, manager, { title, slug: '' }), 400, 'validation_failed');
    // O slug não é regerado quando o título muda.
    const renamed = await updateCourse(db, manager, first.id, { title: 'Outro nome', version: 1 });
    expect(renamed.slug).toBe(base);
  });

  it('título sem caractere aproveitável gera curso, ebook e pacote', async () => {
    // Banco próprio do arquivo: os três padrões estão livres.
    expect((await createCourse(db, manager, { title: '!!!' })).slug).toBe('curso');
    expect((await createCourse(db, manager, { title: '???' })).slug).toBe('curso-2');
    expect((await createEbook(db, manager, { title: '…' })).slug).toBe('ebook');
    expect((await createBundle(db, manager, { title: '★' })).slug).toBe('pacote');
  });

  it('a base é cortada para o sufixo caber em 160; sem sufixo livre é 409 slug_taken', async () => {
    const title = 'z'.repeat(CATALOG_LIMITS.titleMaxLength);
    const first = await createEbook(db, manager, { title });
    const second = await createEbook(db, manager, { title });
    expect(first.slug).toBe('z'.repeat(160));
    expect(second.slug).toBe(`${'z'.repeat(158)}-2`);

    const base = `cheio-${randomUUID().slice(0, 8)}`;
    const taken = [base, ...Array.from({ length: 97 }, (_, index) => `${base}-${index + 2}`)];
    await db
      .insertInto('bundles')
      .values(taken.map((value) => ({ slug: value, title: 'Ocupado' })))
      .execute();
    // Resta só o -99.
    expect((await createBundle(db, manager, { title: base })).slug).toBe(`${base}-99`);
    await expectError(createBundle(db, manager, { title: base }), 409, 'slug_taken');
  });
});

describe('modo de acesso inicial', () => {
  it('curso, ebook e pacote criados sem accessMode nascem private, sem preço, gravado na linha', async () => {
    const course = await createCourse(db, instructor, { slug: slug(), title: 'Curso' });
    const ebook = await createEbook(db, manager, { slug: slug(), title: 'Ebook' });
    const bundle = await createBundle(db, admin, { slug: slug(), title: 'Pacote' });
    for (const product of [course, ebook, bundle]) {
      expect(product).toMatchObject({ accessMode: 'private', priceCents: null, accessDays: null });
    }
    const rows = await sql<{ accessMode: string }>`
      SELECT access_mode FROM courses WHERE id = ${course.id}
      UNION ALL SELECT access_mode FROM ebooks WHERE id = ${ebook.id}
      UNION ALL SELECT access_mode FROM bundles WHERE id = ${bundle.id}`.execute(db);
    expect(rows.rows.map((row) => row.accessMode)).toEqual(['private', 'private', 'private']);
    // O modo inicial não é uma mudança de acesso: só a criação é auditada.
    expect((await auditOf(course.id)).map((row) => row.action)).toEqual(['course.create']);
    expect((await auditOf(ebook.id)).map((row) => row.action)).toEqual(['ebook.create']);
    // O instrutor não publica o curso private dele: envia para publicação.
    const module = await createModule(db, instructor, course.id, { title: 'M' });
    await createLesson(db, admin, module.id, { title: 'A', status: 'published' });
    await expectError(publishCourse(db, instructor, course.id), 403, 'permission_denied');
  });

  it('quem tem product.set_access escolhe outro modo na criação, com auditoria', async () => {
    const open = await createCourse(db, manager, {
      slug: slug(),
      title: 'Aberto',
      accessMode: 'open',
    });
    expect(open.accessMode).toBe('open');
    expect((await auditOf(open.id)).map((row) => row.action)).toEqual([
      'course.create',
      'product.set_access',
    ]);
    const paid = await createEbook(db, admin, {
      slug: slug(),
      title: 'Pago',
      accessMode: 'paid',
      priceCents: 1990,
      accessDays: 30,
    });
    expect(paid).toMatchObject({ accessMode: 'paid', priceCents: 1990, accessDays: 30 });
    // Preço em produto private é aceito de quem define preço (compõe pacote e plano).
    const priced = await createBundle(db, admin, { slug: slug(), title: 'P', priceCents: 500 });
    expect(priced).toMatchObject({ accessMode: 'private', priceCents: 500 });
  });
});

describe('permissão antes da regra do valor', () => {
  it('instrutor: priceCents em curso open e em curso paid é 403, não 422', async () => {
    const open = await createCourse(db, manager, {
      slug: slug(),
      title: 'Aberto do instrutor',
      accessMode: 'open',
      ownerId: instructor.actor.id,
    });
    const paid = await createCourse(db, admin, {
      slug: slug(),
      title: 'Pago do instrutor',
      accessMode: 'paid',
      priceCents: 5000,
      ownerId: instructor.actor.id,
    });
    const before = await deniedFor(instructor.actor.id, 'product.set_price');
    // `open`: a regra do valor seria `price_not_allowed`.
    await expectError(
      updateCourse(db, instructor, open.id, { priceCents: 100, version: open.version }),
      403,
      'permission_denied',
    );
    await expectError(
      updateCourse(db, instructor, paid.id, { priceCents: 100, version: paid.version }),
      403,
      'permission_denied',
    );
    // Valor fora do formato e versão antiga também não passam à frente da permissão.
    await expectError(
      updateCourse(db, instructor, paid.id, { priceCents: -1, version: 99 }),
      403,
      'permission_denied',
    );
    expect(await deniedFor(instructor.actor.id, 'product.set_price')).toBe(before + 3);
    // Publicado e pago: tirar o preço seria `price_required`.
    const module = await createModule(db, instructor, paid.id, { title: 'M' });
    await createLesson(db, admin, module.id, { title: 'A', status: 'published' });
    const published = await publishCourse(db, manager, paid.id);
    await expectError(
      updateCourse(db, instructor, paid.id, { priceCents: null, version: published.version }),
      403,
      'permission_denied',
    );
    await expectError(
      updateCourse(db, instructor, paid.id, { accessMode: 'open', version: published.version }),
      403,
      'permission_denied',
    );
    await expectError(
      updateCourse(db, instructor, paid.id, { accessDays: 0, version: published.version }),
      403,
      'permission_denied',
    );
    // Na criação: preço e modo, qualquer que seja o valor.
    await expectError(
      createCourse(db, instructor, { title: 'X', priceCents: 100 }),
      403,
      'permission_denied',
    );
    await expectError(
      createCourse(db, instructor, { title: 'X', accessMode: 'open' }),
      403,
      'permission_denied',
    );
    // Campo reenviado com o valor atual não é alteração e não exige a permissão.
    const same = await updateCourse(db, instructor, paid.id, {
      title: 'Pago, renomeado',
      accessMode: 'paid',
      priceCents: 5000,
      accessDays: null,
      version: published.version,
    });
    expect(same).toMatchObject({ title: 'Pago, renomeado', priceCents: 5000, accessMode: 'paid' });
    const created = await createCourse(db, instructor, {
      title: 'Com os padrões',
      accessMode: 'private',
      priceCents: null,
      accessDays: null,
    });
    expect(created.accessMode).toBe('private');
  });

  it('gerente: preço é 403 em ebook e pacote, na criação e na edição; as regras são de quem tem a permissão', async () => {
    await expectError(
      createEbook(db, manager, { title: 'E', accessMode: 'open', priceCents: 100 }),
      403,
      'permission_denied',
    );
    await expectError(
      createBundle(db, manager, { title: 'P', priceCents: 100 }),
      403,
      'permission_denied',
    );
    const ebook = await createEbook(db, manager, {
      slug: slug(),
      title: 'Aberto',
      accessMode: 'open',
    });
    await expectError(
      updateEbook(db, manager, ebook.id, { priceCents: 100, version: 1 }),
      403,
      'permission_denied',
    );
    const bundle = await createBundle(db, admin, {
      slug: slug(),
      title: 'Pago',
      accessMode: 'paid',
      priceCents: 9000,
    });
    await expectError(
      updateBundle(db, manager, bundle.id, { priceCents: null, version: 1 }),
      403,
      'permission_denied',
    );
    expect(await deniedFor(manager.actor.id, 'product.set_price')).toBe(4);
    // Quem tem `product.set_price` recebe a regra do valor.
    await expectError(
      updateEbook(db, admin, ebook.id, { priceCents: 100, version: 1 }),
      422,
      'price_not_allowed',
    );
    await expectError(
      createEbook(db, admin, { title: 'E', accessMode: 'open', priceCents: 100 }),
      422,
      'price_not_allowed',
    );
    // O gerente passa o pacote a `open` reenviando o preço atual: o preço sai com o modo.
    const opened = await updateBundle(db, manager, bundle.id, {
      accessMode: 'open',
      priceCents: 9000,
      version: 1,
    });
    expect(opened).toMatchObject({ accessMode: 'open', priceCents: null });
    // O aluno não chega às regras: 403 pela ação do produto.
    await expectError(createEbook(db, student, { title: 'E' }), 403, 'permission_denied');
  });
});

describe('duração da aula', () => {
  it('durationSeconds ausente ou null grava 0, na criação e na edição', async () => {
    const course = await createCourse(db, manager, { slug: slug(), title: 'Duração' });
    const module = await createModule(db, manager, course.id, { title: 'M' });
    const absent = await createLesson(db, manager, module.id, { title: 'Sem duração' });
    const nulled = await createLesson(db, manager, module.id, {
      title: 'Nula',
      durationSeconds: null,
    });
    const timed = await createLesson(db, manager, module.id, {
      title: 'Com duração',
      durationSeconds: 90,
    });
    expect([absent.durationSeconds, nulled.durationSeconds, timed.durationSeconds]).toEqual([
      0, 0, 90,
    ]);
    const cleared = await updateLesson(db, manager, timed.id, {
      durationSeconds: null,
      version: 1,
    });
    expect(cleared).toMatchObject({ durationSeconds: 0, version: 2 });
    // Já é 0: `null` não é mudança.
    const again = await updateLesson(db, manager, timed.id, { durationSeconds: null, version: 2 });
    expect(again.version).toBe(2);
    await expectError(
      updateLesson(db, manager, timed.id, { durationSeconds: '90', version: 2 }),
      400,
      'validation_failed',
    );
    await expectError(
      createLesson(db, manager, module.id, {
        title: 'Longa',
        durationSeconds: CATALOG_LIMITS.lessonDurationMaxSeconds + 1,
      }),
      400,
      'validation_failed',
    );
  });
});

describe('getAdminModule', () => {
  it('devolve o módulo com as aulas, o version e o courseId, com o alcance do curso', async () => {
    const course = await createCourse(db, instructor, { slug: slug(), title: 'Leitura' });
    const first = await createModule(db, instructor, course.id, { title: 'Primeiro' });
    const second = await createModule(db, instructor, course.id, { title: 'Segundo' });
    const a = await createLesson(db, instructor, second.id, {
      title: 'A',
      durationSeconds: 60,
      videoUrl: 'https://youtu.be/abc',
    });
    const b = await createLesson(db, instructor, second.id, { title: 'B', isSample: true });
    await createLesson(db, instructor, first.id, { title: 'De outro módulo' });
    await reorderLessons(db, instructor, second.id, { lessonIds: [b.id, a.id] });

    const module = await getAdminModule(db, instructor, second.id.toUpperCase());
    expect(module).toEqual({
      id: second.id,
      courseId: course.id,
      title: 'Segundo',
      position: 1,
      version: 1,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
      lessons: [
        {
          id: b.id,
          moduleId: second.id,
          title: 'B',
          status: 'draft',
          isSample: true,
          durationSeconds: 0,
          videoProvider: null,
          position: 0,
        },
        {
          id: a.id,
          moduleId: second.id,
          title: 'A',
          status: 'draft',
          isSample: false,
          durationSeconds: 60,
          videoProvider: 'youtube',
          position: 1,
        },
      ],
    });
    expect((await getAdminModule(db, manager, first.id)).lessons).toHaveLength(1);
    // Módulo vazio.
    const empty = await createModule(db, instructor, course.id, { title: 'Vazio' });
    expect(await getAdminModule(db, admin, empty.id)).toMatchObject({ position: 2, lessons: [] });
    // Curso alheio ao instrutor, inexistente e fora do formato: 404; aluno: 403.
    await expectError(getAdminModule(db, otherInstructor, second.id), 404, 'not_found');
    await expectError(getAdminModule(db, admin, randomUUID()), 404, 'not_found');
    await expectError(getAdminModule(db, admin, 'x'), 404, 'not_found');
    await expectError(getAdminModule(db, student, second.id), 403, 'permission_denied');
  });
});
