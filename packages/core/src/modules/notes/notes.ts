import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  businessRule,
  DomainError,
  type FieldError,
  notFound,
  validationFailed,
} from '../../errors/domain-error.ts';
import { type AccessDenialReason, canAccess } from '../entitlements/access.ts';
import { isUuid } from '../entitlements/types.ts';
import {
  type CreateNoteInput,
  type ListNotesQuery,
  NOTE_BODY_MAX_LENGTH,
  NOTE_KINDS,
  NOTE_MAX_PER_USER,
  NOTE_PAGE_DEFAULT_LIMIT,
  NOTE_PAGE_MAX_LIMIT,
  NOTE_SEARCH_MAX_LENGTH,
  NOTE_TITLE_MAX_LENGTH,
  NOTE_VIDEO_SECONDS_MAX,
  type Note,
  type NoteOwner,
  type NoteSummaryPage,
  type UpdateNoteInput,
} from './types.ts';
import { selectNotes, toNote, toNoteSummary } from './view.ts';

// Anotações (spec 016). Escrita do `classroom-api`, dono da tabela `notes`. Toda função recebe o
// usuário da sessão e filtra por ele: nota alheia é `not_found`, também para a equipe (RF-06).
// Nada aqui escreve em log, e nenhum erro leva o texto da nota no `detail`.

const NOT_BLANK = /\S/;
/** Espera entre tentativas quando a gravação cai no mesmo milissegundo da anterior. */
const SAME_MILLISECOND_WAIT_MS = 2;
const UPDATE_ATTEMPTS = 5;

function codePoints(text: string): number {
  // `length` conta unidades UTF-16 e nunca é menor que o número de pontos de código.
  return text.length <= NOTE_BODY_MAX_LENGTH ? 0 : [...text].length;
}

function checkBody(body: unknown): asserts body is string {
  if (typeof body !== 'string') {
    throw validationFailed([{ path: 'body.body', message: 'Informe o texto da nota.' }]);
  }
  if (!NOT_BLANK.test(body)) throw noteEmpty();
  if (codePoints(body) > NOTE_BODY_MAX_LENGTH) {
    throw businessRule(
      'note_too_long',
      `A nota tem mais de ${NOTE_BODY_MAX_LENGTH.toLocaleString('pt-BR')} caracteres.`,
    );
  }
}

function noteEmpty(): DomainError {
  return businessRule('note_empty', 'Nota vazia não é salva.');
}

/** Título sem espaços nas pontas; vazio vira `null`. Acima de 160: `400`. */
function normalizeTitle(title: string | null): string | null {
  if (title === null) return null;
  if (typeof title !== 'string') {
    throw validationFailed([{ path: 'body.title', message: 'Título inválido.' }]);
  }
  const trimmed = title.trim();
  if (trimmed === '') return null;
  if ([...trimmed].length > NOTE_TITLE_MAX_LENGTH) {
    throw validationFailed([
      { path: 'body.title', message: `Use até ${NOTE_TITLE_MAX_LENGTH} caracteres.` },
    ]);
  }
  return trimmed;
}

function videoSecondsInvalid(detail: string): DomainError {
  return businessRule('note_video_seconds_invalid', detail);
}

/** Instante do vídeo em segundos inteiros (a coluna é `integer`); negativo: `422`. */
function normalizeVideoSeconds(value: number | null, isLessonNote: boolean): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw videoSecondsInvalid('O instante do vídeo não pode ser negativo.');
  }
  if (!isLessonNote) throw videoSecondsInvalid('Só nota de aula guarda o instante do vídeo.');
  const seconds = Math.floor(value);
  if (seconds > NOTE_VIDEO_SECONDS_MAX) throw videoSecondsInvalid('Instante do vídeo inválido.');
  return seconds;
}

function accessDenied(reason: AccessDenialReason): DomainError {
  return new DomainError({
    code: 'access_denied',
    status: 403,
    title: 'Sem acesso ao conteúdo',
    detail: 'Só cria nota de aula quem tem acesso à aula.',
    extras: { reason },
  });
}

/** O banco considera branco algum caractere que o `\S` do JavaScript não considera. */
function isBlankBodyViolation(error: unknown): boolean {
  const pg = error as { code?: unknown; constraint?: unknown } | null;
  return pg?.code === '23514' && pg.constraint === 'notes_body_length';
}

function ownerId(user: NoteOwner): string {
  // Sem usuário válido não há nota a mostrar: o mesmo `not_found` da nota alheia.
  if (!user || !isUuid(user.id)) throw notFound();
  return user.id.toLowerCase();
}

async function findNote(db: Database, userId: string, noteId: string): Promise<Note | undefined> {
  if (!isUuid(noteId)) return undefined;
  const row = await selectNotes(db)
    .where('notes.id', '=', noteId.toLowerCase())
    .where('notes.userId', '=', userId)
    .executeTakeFirst();
  return row ? toNote(row) : undefined;
}

/** `GET /notes/{id}`. Inexistente, de outro usuário ou id fora do formato: `404`. */
export async function getNote(db: Database, user: NoteOwner, noteId: string): Promise<Note> {
  const note = await findNote(db, ownerId(user), noteId);
  if (!note) throw notFound('Anotação não encontrada.');
  return note;
}

/**
 * `POST /notes`. Com `lessonId`, nota de aula: exige acesso à aula agora (`canAccess`; negado:
 * `403 access_denied` com `reason`; aula inexistente ou despublicada: `404`) e congela os títulos
 * da aula e do curso. Sem `lessonId`, avulsa. Corpo só com espaços: `422 note_empty`; acima de
 * 20.000 caracteres: `422 note_too_long`; `videoSeconds` negativo ou em nota avulsa: `422
 * note_video_seconds_invalid`; usuário com 5.000 notas: `422 note_limit_reached`.
 */
export async function createNote(
  db: Database,
  user: NoteOwner,
  input: CreateNoteInput,
): Promise<Note> {
  const userId = ownerId(user);
  checkBody(input.body);
  const title = normalizeTitle(input.title ?? null);
  const lessonId = input.lessonId ?? null;
  const videoSeconds = normalizeVideoSeconds(input.videoSeconds ?? null, lessonId !== null);

  let lesson: { id: string; title: string; courseId: string; courseTitle: string } | null = null;
  if (lessonId !== null) {
    const decision = await canAccess(db, { id: userId }, { type: 'lesson', id: lessonId });
    if (!decision.allowed) {
      // Aula despublicada não é revelada ao aluno: a mesma resposta da inexistente.
      if (decision.reason === 'unpublished') throw notFound('Aula não encontrada.');
      throw accessDenied(decision.reason);
    }
    const found = await db
      .selectFrom('lessons as l')
      .innerJoin('modules as m', 'm.id', 'l.moduleId')
      .innerJoin('courses as c', 'c.id', 'm.courseId')
      .select(['l.id', 'l.title', 'c.id as courseId', 'c.title as courseTitle'])
      .where('l.id', '=', lessonId.toLowerCase())
      .executeTakeFirst();
    if (!found) throw notFound('Aula não encontrada.');
    lesson = found;
  }

  const insert = async (trx: Database): Promise<string> => {
    // Serializa as criações do mesmo usuário: sem a trava, duas ao mesmo tempo passam do limite.
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`notes:${userId}`}, 0))`.execute(trx);
    const count = await trx
      .selectFrom('notes')
      .select(sql<number>`count(*)::int`.as('total'))
      .where('userId', '=', userId)
      .executeTakeFirstOrThrow();
    if (count.total >= NOTE_MAX_PER_USER) {
      throw businessRule(
        'note_limit_reached',
        `Limite de ${NOTE_MAX_PER_USER.toLocaleString('pt-BR')} anotações atingido.`,
      );
    }
    const row = await trx
      .insertInto('notes')
      .values({
        userId,
        lessonId: lesson?.id ?? null,
        courseId: lesson?.courseId ?? null,
        lessonTitleSnapshot: lesson?.title ?? null,
        courseTitleSnapshot: lesson?.courseTitle ?? null,
        videoSeconds,
        title,
        body: input.body,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  };

  let id: string;
  try {
    id = db.isTransaction ? await insert(db) : await db.transaction().execute(insert);
  } catch (error) {
    if (isBlankBodyViolation(error)) throw noteEmpty();
    throw error;
  }
  const note = await findNote(db, userId, id);
  if (!note) throw notFound('Anotação não encontrada.');
  return note;
}

function parseKnownUpdatedAt(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(typeof value === 'string' ? value : NaN);
  if (Number.isNaN(date.getTime())) {
    throw validationFailed([{ path: 'body.updatedAt', message: 'Data inválida.' }]);
  }
  return date;
}

function versionConflict(current: Note): DomainError {
  return new DomainError({
    code: 'version_conflict',
    status: 409,
    title: 'Conflito de estado',
    detail: 'A anotação foi alterada em outro dispositivo.',
    extras: { current },
  });
}

/**
 * `PATCH /notes/{id}` (salvamento automático). `updatedAt` é o da versão que o cliente leu: se a
 * nota mudou, `409 version_conflict` com a versão gravada em `extras.current` (campo `current` do
 * problem+json). Não confere acesso ao curso: a nota segue editável depois de perdê-lo. Sem campo
 * a alterar, devolve a nota como está. Mesmos `422` da criação; nota alheia: `404`.
 *
 * Toda gravação avança `updated_at` em ao menos 1 ms (a coluna tem precisão de milissegundos e
 * o gatilho grava `now()`): a que cairia no mesmo milissegundo da anterior espera e tenta de
 * novo, para que duas versões nunca tenham o mesmo `updatedAt`.
 */
export async function updateNote(
  db: Database,
  user: NoteOwner,
  noteId: string,
  input: UpdateNoteInput,
): Promise<Note> {
  const userId = ownerId(user);
  const known = parseKnownUpdatedAt(input.updatedAt);
  if (input.body !== undefined) checkBody(input.body);
  const title = input.title === undefined ? undefined : normalizeTitle(input.title);

  let current: Note | undefined;
  for (let attempt = 0; attempt < UPDATE_ATTEMPTS; attempt += 1) {
    current = await findNote(db, userId, noteId);
    if (!current) throw notFound('Anotação não encontrada.');
    if (current.updatedAt.getTime() !== known.getTime()) throw versionConflict(current);
    const videoSeconds =
      input.videoSeconds === undefined
        ? undefined
        : normalizeVideoSeconds(input.videoSeconds, current.lesson !== null);

    const changes = {
      ...(title !== undefined && title !== current.title ? { title } : {}),
      ...(input.body !== undefined && input.body !== current.body ? { body: input.body } : {}),
      ...(videoSeconds !== undefined && videoSeconds !== current.videoSeconds
        ? { videoSeconds }
        : {}),
    };
    if (Object.keys(changes).length === 0) return current;

    let updated: { updatedAt: Date } | undefined;
    try {
      updated = await db
        .updateTable('notes')
        .set(changes)
        .where('id', '=', current.id)
        .where('userId', '=', userId)
        .where('updatedAt', '=', known)
        .where(sql<boolean>`now()::timestamptz(3) > updated_at`)
        .returning('updatedAt')
        .executeTakeFirst();
    } catch (error) {
      if (isBlankBodyViolation(error)) throw noteEmpty();
      throw error;
    }
    if (updated) return { ...current, ...changes, updatedAt: updated.updatedAt };
    await new Promise((resolve) => setTimeout(resolve, SAME_MILLISECOND_WAIT_MS));
  }
  // Só chega aqui com o relógio do banco parado ou atrás do `updated_at` gravado.
  throw versionConflict(current as Note);
}

/** `DELETE /notes/{id}`: definitivo, sem lixeira. Nota alheia ou inexistente: `404`. */
export async function deleteNote(db: Database, user: NoteOwner, noteId: string): Promise<void> {
  const userId = ownerId(user);
  if (!isUuid(noteId)) throw notFound('Anotação não encontrada.');
  const result = await db
    .deleteFrom('notes')
    .where('id', '=', noteId.toLowerCase())
    .where('userId', '=', userId)
    .executeTakeFirst();
  if (result.numDeletedRows === 0n) throw notFound('Anotação não encontrada.');
}

/**
 * `GET /lessons/{id}/notes`: as notas do usuário naquela aula, da mais antiga à mais recente.
 * Não exige acesso à aula (as notas seguem legíveis depois de perdê-lo). Sem nenhuma nota, a
 * aula inexistente ou despublicada responde `404`, como nas demais rotas do aluno.
 */
export async function listLessonNotes(
  db: Database,
  user: NoteOwner,
  lessonId: string,
): Promise<Note[]> {
  const userId = ownerId(user);
  if (!isUuid(lessonId)) throw notFound('Aula não encontrada.');
  const rows = await selectNotes(db)
    .where('notes.userId', '=', userId)
    .where('notes.lessonId', '=', lessonId.toLowerCase())
    .orderBy('notes.createdAt', 'asc')
    .orderBy('notes.id', 'asc')
    .execute();
  if (rows.length === 0) {
    const decision = await canAccess(db, { id: userId }, { type: 'lesson', id: lessonId });
    if (!decision.allowed && decision.reason === 'unpublished') {
      throw notFound('Aula não encontrada.');
    }
  }
  return rows.map(toNote);
}

const CURSOR_PREFIX = 'notes:';

function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(`${CURSOR_PREFIX}${updatedAt.getTime()}:${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: unknown): { updatedAt: Date; id: string } | undefined {
  if (typeof cursor !== 'string') return undefined;
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const match = /^notes:(\d{1,15}):(.+)$/.exec(text);
  if (!match || !isUuid(match[2])) return undefined;
  return { updatedAt: new Date(Number(match[1])), id: match[2].toLowerCase() };
}

/**
 * `GET /notes` (página "Anotações"): as notas do usuário, da alteração mais recente à mais
 * antiga, paginadas por cursor opaco (30 por página; até 100). `kind` separa as de aula das
 * avulsas pelos títulos guardados (a nota de aula excluída continua "de aula"); `courseId`
 * filtra pelo curso; `q` usa a busca textual do Postgres em `portuguese`, no título e no corpo
 * (todas as palavras). Parâmetro fora do formato: `400`.
 */
export async function listNotes(
  db: Database,
  user: NoteOwner,
  query: ListNotesQuery = {},
): Promise<NoteSummaryPage> {
  const userId = ownerId(user);
  const errors: FieldError[] = [];
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  if (query.q !== undefined && typeof query.q !== 'string') {
    errors.push({ path: 'query.q', message: 'Busca inválida.' });
  } else if ([...q].length > NOTE_SEARCH_MAX_LENGTH) {
    errors.push({ path: 'query.q', message: `Use até ${NOTE_SEARCH_MAX_LENGTH} caracteres.` });
  }
  if (query.kind !== undefined && !(NOTE_KINDS as readonly unknown[]).includes(query.kind)) {
    errors.push({ path: 'query.kind', message: 'Use lesson ou standalone.' });
  }
  if (query.courseId !== undefined && !isUuid(query.courseId)) {
    errors.push({ path: 'query.courseId', message: 'Identificador inválido.' });
  }
  const limit = query.limit ?? NOTE_PAGE_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > NOTE_PAGE_MAX_LIMIT) {
    errors.push({ path: 'query.limit', message: `Use de 1 a ${NOTE_PAGE_MAX_LIMIT}.` });
  }
  const after = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
  if (query.cursor !== undefined && after === undefined) {
    errors.push({ path: 'query.cursor', message: 'Cursor inválido.' });
  }
  if (errors.length > 0) throw validationFailed(errors);

  let rows = selectNotes(db, { excerptOnly: true }).where('notes.userId', '=', userId);
  if (query.kind === 'lesson') rows = rows.where('notes.lessonTitleSnapshot', 'is not', null);
  if (query.kind === 'standalone') rows = rows.where('notes.lessonTitleSnapshot', 'is', null);
  if (query.courseId !== undefined) {
    rows = rows.where('notes.courseId', '=', query.courseId.toLowerCase());
  }
  if (q !== '') {
    rows = rows.where(sql<boolean>`notes.search @@ plainto_tsquery('portuguese'::regconfig, ${q})`);
  }
  if (after) {
    rows = rows.where(
      sql<boolean>`(notes.updated_at, notes.id) < (${after.updatedAt}::timestamptz, ${after.id}::uuid)`,
    );
  }
  const page = await rows
    .orderBy('notes.updatedAt', 'desc')
    .orderBy('notes.id', 'desc')
    .limit(limit + 1)
    .execute();

  const items = page.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items: items.map(toNoteSummary),
    nextCursor: page.length > limit && last ? encodeCursor(last.updatedAt, last.id) : null,
  };
}
