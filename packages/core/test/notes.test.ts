import { createTestDatabase, loadEnvFiles, type TestDatabase } from '@nuva-edu/database';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  createAccount,
  createDatabase,
  createNote,
  type Database,
  type DomainError,
  deleteNote,
  getNote,
  grantEntitlement,
  isDomainError,
  listLessonNotes,
  listNotes,
  NOTE_BODY_MAX_LENGTH,
  NOTE_MAX_PER_USER,
  type Note,
  noteExcerpt,
  type Role,
  revokeEntitlementTree,
  updateNote,
} from '../src/index.ts';

// Anotações (tarefa 414; spec 016). Banco próprio deste arquivo; catálogo gravado direto nas
// tabelas da 0009.

let testDb: TestDatabase;
let db: Database;

beforeAll(async () => {
  loadEnvFiles();
  testDb = await createTestDatabase();
  db = createDatabase({ connectionString: testDb.url, maxConnections: 6 });
});

afterAll(async () => {
  await closeDatabase(db);
  await testDb.drop();
});

async function makeUser(role: Role = 'student'): Promise<{ id: string }> {
  const id = await db.transaction().execute((trx) =>
    createAccount(trx, {
      email: `${role}-${crypto.randomUUID()}@example.com`,
      name: `Pessoa ${role}`,
      password: 'Senha-Notas-Teste-7Qa',
      role,
      emailVerified: true,
    }),
  );
  return { id };
}

async function makeCourse(
  options: { mode?: 'open' | 'paid'; title?: string } = {},
): Promise<{ id: string; slug: string; title: string }> {
  const mode = options.mode ?? 'paid';
  const title = options.title ?? `Curso ${crypto.randomUUID().slice(0, 6)}`;
  const slug = `curso-${crypto.randomUUID().slice(0, 13)}`;
  const row = await db
    .insertInto('courses')
    .values({
      slug,
      title,
      accessMode: mode,
      priceCents: mode === 'open' ? null : 9900,
      status: 'published',
      publishedAt: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id, slug, title };
}

async function makeLesson(
  courseId: string,
  options: { title?: string; published?: boolean } = {},
): Promise<string> {
  let module = await db
    .selectFrom('modules')
    .select('id')
    .where('courseId', '=', courseId)
    .executeTakeFirst();
  if (!module) {
    module = await db
      .insertInto('modules')
      .values({ courseId, title: 'Módulo 1', position: 0 })
      .returning('id')
      .executeTakeFirstOrThrow();
  }
  const count = await db
    .selectFrom('lessons')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('moduleId', '=', module.id)
    .executeTakeFirstOrThrow();
  const row = await db
    .insertInto('lessons')
    .values({
      moduleId: module.id,
      title: options.title ?? `Aula ${count.n + 1}`,
      status: (options.published ?? true) ? 'published' : 'draft',
      position: count.n,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function grantCourse(userId: string, courseId: string): Promise<void> {
  await db.transaction().execute((trx) =>
    grantEntitlement(trx, {
      userId,
      productType: 'course',
      productId: courseId,
      source: 'order',
      sourceId: crypto.randomUUID(),
      notify: false,
    }),
  );
}

async function revokeCourse(userId: string, courseId: string): Promise<void> {
  const rows = await db
    .selectFrom('entitlements')
    .select('id')
    .where('userId', '=', userId)
    .where('productId', '=', courseId)
    .execute();
  await db.transaction().execute((trx) =>
    revokeEntitlementTree(
      trx,
      rows.map((row) => row.id),
      'refund',
    ),
  );
}

async function failure(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    if (isDomainError(error)) return error;
    throw error;
  }
  throw new Error('Era esperado um DomainError.');
}

describe('criação', () => {
  it('nota avulsa: sem aula, título opcional aparado', async () => {
    const user = await makeUser();
    const note = await createNote(db, user, { title: '  Ideia  ', body: 'Resumo da semana' });
    expect(note).toMatchObject({
      lesson: null,
      videoSeconds: null,
      title: 'Ideia',
      body: 'Resumo da semana',
    });
    expect(note.updatedAt.getTime()).toBe(note.createdAt.getTime());
    const blank = await createNote(db, user, { title: '   ', body: 'Sem título' });
    expect(blank.title).toBeNull();
    expect(await getNote(db, user, note.id)).toEqual(note);
  });

  it('nota de aula: exige acesso, congela os títulos e guarda o instante inteiro', async () => {
    const user = await makeUser();
    const course = await makeCourse({ title: 'Curso de Notas' });
    const lessonId = await makeLesson(course.id, { title: 'Primeira aula' });

    const denied = await failure(createNote(db, user, { lessonId, body: 'texto' }));
    expect(denied).toMatchObject({ code: 'access_denied', status: 403 });
    expect(denied.extras).toEqual({ reason: 'no_entitlement' });

    await grantCourse(user.id, course.id);
    const note = await createNote(db, user, { lessonId, body: 'texto', videoSeconds: 83.9 });
    expect(note.videoSeconds).toBe(83);
    expect(note.lesson).toEqual({
      id: lessonId,
      title: 'Primeira aula',
      courseId: course.id,
      courseSlug: course.slug,
      courseTitle: 'Curso de Notas',
      available: true,
    });
    const stored = await db
      .selectFrom('notes')
      .select(['lessonTitleSnapshot', 'courseTitleSnapshot', 'courseId'])
      .where('id', '=', note.id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({
      lessonTitleSnapshot: 'Primeira aula',
      courseTitleSnapshot: 'Curso de Notas',
      courseId: course.id,
    });
  });

  it('aula inexistente, despublicada ou com id inválido: not_found', async () => {
    const user = await makeUser();
    const course = await makeCourse({ mode: 'open' });
    const draft = await makeLesson(course.id, { published: false });
    for (const lessonId of [crypto.randomUUID(), draft, 'abc']) {
      const error = await failure(createNote(db, user, { lessonId, body: 'texto' }));
      expect(error.code).toBe('not_found');
    }
  });

  it('limites de tamanho, nota vazia e instante do vídeo', async () => {
    const user = await makeUser();
    const course = await makeCourse({ mode: 'open' });
    const lessonId = await makeLesson(course.id);

    for (const body of ['', '  \n\t ', '\u0085']) {
      expect(await failure(createNote(db, user, { body }))).toMatchObject({
        code: 'note_empty',
        status: 422,
      });
    }
    const max = await createNote(db, user, { body: 'ã'.repeat(NOTE_BODY_MAX_LENGTH) });
    expect([...max.body]).toHaveLength(NOTE_BODY_MAX_LENGTH);
    // Pontos de código, como o banco conta: 20.000 emojis são 40.000 unidades UTF-16.
    await createNote(db, user, { body: '😀'.repeat(NOTE_BODY_MAX_LENGTH) });
    const tooLong = await failure(
      createNote(db, user, { body: 'a'.repeat(NOTE_BODY_MAX_LENGTH + 1) }),
    );
    expect(tooLong).toMatchObject({ code: 'note_too_long', status: 422 });
    expect(tooLong.detail).not.toContain('aaaa');

    await createNote(db, user, { title: 't'.repeat(160), body: 'ok' });
    expect(
      await failure(createNote(db, user, { title: 't'.repeat(161), body: 'ok' })),
    ).toMatchObject({ code: 'validation_failed', errors: [{ path: 'body.title' }] });
    expect(await failure(createNote(db, user, { body: 42 as unknown as string }))).toMatchObject({
      code: 'validation_failed',
    });

    for (const videoSeconds of [-1, Number.NaN, 3e9]) {
      expect(
        await failure(createNote(db, user, { lessonId, body: 'ok', videoSeconds })),
      ).toMatchObject({ code: 'note_video_seconds_invalid', status: 422 });
    }
    expect(await failure(createNote(db, user, { body: 'ok', videoSeconds: 10 }))).toMatchObject({
      code: 'note_video_seconds_invalid',
    });
  });

  it('5.000 notas por usuário: a seguinte é recusada, a de outro usuário não', async () => {
    const user = await makeUser();
    const other = await makeUser();
    await sql`
      INSERT INTO notes (user_id, body)
      SELECT ${user.id}::uuid, 'nota ' || n FROM generate_series(1, ${NOTE_MAX_PER_USER - 1}) n
    `.execute(db);
    // Duas ao mesmo tempo na última vaga: só uma entra.
    const results = await Promise.allSettled([
      createNote(db, user, { body: 'última' }),
      createNote(db, user, { body: 'excedente' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'note_limit_reached', status: 422 });
    expect(await failure(createNote(db, user, { body: 'mais uma' }))).toMatchObject({
      code: 'note_limit_reached',
    });
    await createNote(db, other, { body: 'livre' });
    // Dentro de uma transação aberta por quem chama também funciona.
    const inTrx = await db
      .transaction()
      .execute((trx) => createNote(trx, other, { body: 'em transação' }));
    expect(inTrx.body).toBe('em transação');
  });
});

describe('privacidade', () => {
  it('usuário B recebe not_found na nota de A, e a equipe também', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const admin = await makeUser('admin');
    const note = await createNote(db, a, { body: 'segredo de A' });
    for (const intruder of [b, admin]) {
      for (const attempt of [
        () => getNote(db, intruder, note.id),
        () => updateNote(db, intruder, note.id, { updatedAt: note.updatedAt, body: 'invadida' }),
        () => deleteNote(db, intruder, note.id),
      ]) {
        const error = await failure(attempt());
        expect(error).toMatchObject({ code: 'not_found', status: 404 });
        expect(JSON.stringify(error)).not.toContain('segredo');
      }
      expect((await listNotes(db, intruder)).items).toEqual([]);
    }
    expect((await getNote(db, a, note.id)).body).toBe('segredo de A');
    for (const id of ['abc', crypto.randomUUID()]) {
      expect((await failure(getNote(db, a, id))).code).toBe('not_found');
      expect((await failure(deleteNote(db, a, id))).code).toBe('not_found');
    }
    expect((await failure(getNote(db, { id: 'x' }, note.id))).code).toBe('not_found');
  });
});

describe('edição', () => {
  it('grava com o updatedAt conhecido e avança a versão', async () => {
    const user = await makeUser();
    const note = await createNote(db, user, { title: 'Título', body: 'v1' });
    // Logo após criar: a gravação no mesmo milissegundo espera, e a versão sempre avança.
    const second = await updateNote(db, user, note.id, {
      updatedAt: note.updatedAt.toISOString(),
      body: 'v2',
    });
    expect(second).toMatchObject({ title: 'Título', body: 'v2' });
    expect(second.updatedAt.getTime()).toBeGreaterThan(note.updatedAt.getTime());
    expect(await getNote(db, user, note.id)).toEqual(second);

    const third = await updateNote(db, user, note.id, { updatedAt: second.updatedAt, title: null });
    expect(third.title).toBeNull();
    expect(third.updatedAt.getTime()).toBeGreaterThan(second.updatedAt.getTime());
    // Nada a alterar: devolve a nota como está, sem nova versão.
    const same = await updateNote(db, user, note.id, { updatedAt: third.updatedAt, body: 'v2' });
    expect(same).toEqual(third);
  });

  it('updatedAt antigo devolve conflito com a versão atual', async () => {
    const user = await makeUser();
    const note = await createNote(db, user, { body: 'original' });
    const current = await updateNote(db, user, note.id, {
      updatedAt: note.updatedAt,
      body: 'do celular',
    });
    const error = await failure(
      updateNote(db, user, note.id, { updatedAt: note.updatedAt, body: 'do computador' }),
    );
    expect(error).toMatchObject({ code: 'version_conflict', status: 409 });
    expect((error.extras as { current: Note }).current).toEqual(current);
    expect((await getNote(db, user, note.id)).body).toBe('do celular');

    // Duas gravações simultâneas a partir da mesma versão: só uma entra.
    const results = await Promise.allSettled([
      updateNote(db, user, note.id, { updatedAt: current.updatedAt, body: 'A' }),
      updateNote(db, user, note.id, { updatedAt: current.updatedAt, body: 'B' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((result) => result.status === 'rejected');
    expect(lost?.reason).toMatchObject({ code: 'version_conflict' });
  });

  it('valida os campos como na criação', async () => {
    const user = await makeUser();
    const note = await createNote(db, user, { body: 'texto' });
    const updatedAt = note.updatedAt;
    const cases: [Parameters<typeof updateNote>[3], string][] = [
      [{ updatedAt, body: '   ' }, 'note_empty'],
      [{ updatedAt, body: '\u0085' }, 'note_empty'],
      [{ updatedAt, body: 'a'.repeat(NOTE_BODY_MAX_LENGTH + 1) }, 'note_too_long'],
      [{ updatedAt, title: 't'.repeat(161) }, 'validation_failed'],
      [{ updatedAt, videoSeconds: 5 }, 'note_video_seconds_invalid'],
      [{ updatedAt: 'ontem', body: 'x' }, 'validation_failed'],
    ];
    for (const [input, code] of cases) {
      expect((await failure(updateNote(db, user, note.id, input))).code).toBe(code);
    }
    expect(await getNote(db, user, note.id)).toEqual(note);
  });

  it('nota segue legível e editável após perder o acesso ao curso', async () => {
    const user = await makeUser();
    const course = await makeCourse();
    const lessonId = await makeLesson(course.id);
    await grantCourse(user.id, course.id);
    const note = await createNote(db, user, { lessonId, body: 'com acesso', videoSeconds: 12 });
    await revokeCourse(user.id, course.id);

    expect((await failure(createNote(db, user, { lessonId, body: 'nova' }))).code).toBe(
      'access_denied',
    );
    expect((await getNote(db, user, note.id)).lesson?.available).toBe(true);
    expect(await listLessonNotes(db, user, lessonId)).toHaveLength(1);
    expect((await listNotes(db, user)).items).toHaveLength(1);
    const edited = await updateNote(db, user, note.id, {
      updatedAt: note.updatedAt,
      body: 'sem acesso',
      videoSeconds: null,
    });
    expect(edited).toMatchObject({ body: 'sem acesso', videoSeconds: null });
    await deleteNote(db, user, note.id);
    expect((await failure(getNote(db, user, note.id))).code).toBe('not_found');
  });
});

describe('aula despublicada ou excluída', () => {
  it('mostra os títulos guardados, sem link, e continua nota de aula', async () => {
    const user = await makeUser();
    const course = await makeCourse({ mode: 'open', title: 'Curso original' });
    const lessonId = await makeLesson(course.id, { title: 'Aula original' });
    const note = await createNote(db, user, { lessonId, body: 'da aula', videoSeconds: 7 });

    await db
      .updateTable('lessons')
      .set({ title: 'Aula renomeada' })
      .where('id', '=', lessonId)
      .execute();
    expect((await getNote(db, user, note.id)).lesson?.title).toBe('Aula renomeada');

    await db.updateTable('lessons').set({ status: 'draft' }).where('id', '=', lessonId).execute();
    expect((await getNote(db, user, note.id)).lesson).toEqual({
      id: lessonId,
      title: 'Aula original',
      courseId: course.id,
      courseSlug: course.slug,
      courseTitle: 'Curso original',
      available: false,
    });
    // Com notas, a aba da aula despublicada ainda as devolve; sem notas, 404.
    expect(await listLessonNotes(db, user, lessonId)).toHaveLength(1);
    const other = await makeUser();
    expect((await failure(listLessonNotes(db, other, lessonId))).code).toBe('not_found');

    await db.deleteFrom('lessons').where('id', '=', lessonId).execute();
    const orphan = await getNote(db, user, note.id);
    expect(orphan.lesson).toEqual({
      id: null,
      title: 'Aula original',
      courseId: course.id,
      courseSlug: course.slug,
      courseTitle: 'Curso original',
      available: false,
    });
    expect(orphan.videoSeconds).toBe(7);
    expect((await listNotes(db, user, { kind: 'lesson' })).items).toHaveLength(1);
    expect((await listNotes(db, user, { kind: 'standalone' })).items).toHaveLength(0);
    // Segue editável, inclusive o instante.
    const edited = await updateNote(db, user, note.id, {
      updatedAt: orphan.updatedAt,
      videoSeconds: 9,
    });
    expect(edited.videoSeconds).toBe(9);
  });
});

describe('listas', () => {
  it('aba da aula: só as do usuário naquela aula, da mais antiga à mais recente', async () => {
    const user = await makeUser();
    const other = await makeUser();
    const course = await makeCourse({ mode: 'open' });
    const lessonId = await makeLesson(course.id);
    const otherLesson = await makeLesson(course.id);
    const first = await createNote(db, user, { lessonId, body: 'primeira' });
    const second = await createNote(db, user, { lessonId, body: 'segunda' });
    await createNote(db, user, { lessonId: otherLesson, body: 'de outra aula' });
    await createNote(db, other, { lessonId, body: 'de outra pessoa' });
    await createNote(db, user, { body: 'avulsa' });
    // Editar a primeira não muda a ordem (é por criação).
    await updateNote(db, user, first.id, { updatedAt: first.updatedAt, body: 'primeira, editada' });

    const notes = await listLessonNotes(db, user, lessonId);
    expect(notes.map((note) => note.id)).toEqual([first.id, second.id]);
    expect(notes[0]?.body).toBe('primeira, editada');

    const empty = await makeLesson(course.id);
    expect(await listLessonNotes(db, user, empty)).toEqual([]);
    for (const id of ['abc', crypto.randomUUID()]) {
      expect((await failure(listLessonNotes(db, user, id))).code).toBe('not_found');
    }
  });

  it('página "Anotações": ordem, cursor, filtros e busca', async () => {
    const user = await makeUser();
    const courseA = await makeCourse({ mode: 'open' });
    const courseB = await makeCourse({ mode: 'open' });
    const lessonA = await makeLesson(courseA.id);
    const lessonB = await makeLesson(courseB.id);

    const ids: string[] = [];
    for (let n = 0; n < 7; n += 1) {
      ids.push((await createNote(db, user, { body: `avulsa número ${n}` })).id);
    }
    const ofA = await createNote(db, user, {
      lessonId: lessonA,
      title: 'Fotossíntese',
      body: 'As **plantas** convertem luz em [energia](https://example.com).',
    });
    const ofB = await createNote(db, user, { lessonId: lessonB, body: 'Sobre montanhas e rios' });
    // Datas distintas e conhecidas: a mais antiga primeiro em `ids`.
    const all = [...ids, ofA.id, ofB.id];
    for (const [index, id] of all.entries()) {
      await sql`ALTER TABLE notes DISABLE TRIGGER notes_set_updated_at`.execute(db);
      await sql`UPDATE notes SET updated_at = ${new Date(Date.UTC(2026, 0, 1, 0, 0, index % 2 === 0 ? index : index - 1))}
                 WHERE id = ${id}::uuid`.execute(db);
      await sql`ALTER TABLE notes ENABLE TRIGGER notes_set_updated_at`.execute(db);
    }
    const expected = (
      await db
        .selectFrom('notes')
        .select('id')
        .where('userId', '=', user.id)
        .orderBy('updatedAt', 'desc')
        .orderBy('id', 'desc')
        .execute()
    ).map((row) => row.id);

    // Pares com a mesma data: o desempate por id mantém a paginação sem repetir nem pular.
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listNotes(db, user, { limit: 4, cursor });
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor !== undefined);
    expect(seen).toEqual(expected);
    expect(pages).toBe(3);
    const whole = await listNotes(db, user);
    expect(whole.items).toHaveLength(9);
    expect(whole.nextCursor).toBeNull();

    const summary = whole.items.find((item) => item.id === ofA.id);
    expect(summary).toMatchObject({
      title: 'Fotossíntese',
      excerpt: 'As plantas convertem luz em energia.',
      lesson: { id: lessonA, courseId: courseA.id, available: true },
    });
    expect(summary).not.toHaveProperty('body');

    const kinds = async (query: Parameters<typeof listNotes>[2]) =>
      (await listNotes(db, user, query)).items.map((item) => item.id).sort();
    expect(await kinds({ kind: 'lesson' })).toEqual([ofA.id, ofB.id].sort());
    expect(await kinds({ kind: 'standalone' })).toEqual([...ids].sort());
    expect(await kinds({ courseId: courseB.id })).toEqual([ofB.id]);
    expect(await kinds({ courseId: crypto.randomUUID() })).toEqual([]);
    // Busca no corpo e no título, com a raiz da palavra em português.
    expect(await kinds({ q: 'planta' })).toEqual([ofA.id]);
    expect(await kinds({ q: 'fotossíntese' })).toEqual([ofA.id]);
    expect(await kinds({ q: 'rios montanha' })).toEqual([ofB.id]);
    expect(await kinds({ q: 'montanha', kind: 'standalone' })).toEqual([]);
    expect(await kinds({ q: "inexistente ' OR 1=1 --" })).toEqual([]);
    expect(await kinds({ q: '   ' })).toHaveLength(9);

    const invalid: Parameters<typeof listNotes>[2][] = [
      { limit: 0 },
      { limit: 101 },
      { cursor: 'lixo' },
      { cursor: Buffer.from('notes:1:abc').toString('base64url') },
      { courseId: 'abc' },
      { kind: 'outra' as 'lesson' },
      { q: 'a'.repeat(201) },
      { q: 1 as unknown as string },
    ];
    for (const query of invalid) {
      expect((await failure(listNotes(db, user, query))).code).toBe('validation_failed');
    }
  });
});

describe('noteExcerpt', () => {
  it('tira a marcação e corta com reticências', () => {
    expect(
      noteExcerpt(
        '# Título\n\n> citação\n- item **forte**\n1. _um_\n\n---\n```js\ncódigo()\n```\n![foto](a.png) <b>html</b> ~~fim~~',
      ),
    ).toBe('Título citação item forte um código() foto html fim');
    const long = noteExcerpt('palavra '.repeat(100));
    expect([...long]).toHaveLength(300);
    expect(long.endsWith('…')).toBe(true);
    expect(noteExcerpt('😀'.repeat(10), 4)).toBe('😀😀😀…');
    expect(noteExcerpt('curta')).toBe('curta');
  });
});
