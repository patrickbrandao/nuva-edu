import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import {
  NOTE_EXCERPT_MAX_LENGTH,
  type Note,
  type NoteLessonRef,
  type NoteSummary,
} from './types.ts';

// Leitura das notas com a aula e o curso para o link de volta, e o trecho da página "Anotações".

/** Caracteres do corpo lidos para montar o trecho: sobra para o que o Markdown ocupa. */
const EXCERPT_SOURCE_LENGTH = NOTE_EXCERPT_MAX_LENGTH * 5;

/**
 * Notas com a aula e o curso atuais. A aula está disponível pela mesma regra de publicação de
 * `canAccess`: aula e curso publicados, curso não arquivado. `excerptOnly` lê só o começo do
 * corpo (lista paginada).
 */
export function selectNotes(db: Database, options: { excerptOnly?: boolean } = {}) {
  return db
    .selectFrom('notes')
    .leftJoin('lessons as l', 'l.id', 'notes.lessonId')
    .leftJoin('courses as c', 'c.id', 'notes.courseId')
    .select([
      'notes.id',
      'notes.lessonTitleSnapshot',
      'notes.courseTitleSnapshot',
      'notes.videoSeconds',
      'notes.title',
      'notes.createdAt',
      'notes.updatedAt',
      'l.id as lessonId',
      'l.title as lessonTitle',
      'c.id as courseId',
      'c.slug as courseSlug',
      'c.title as courseTitle',
      (options.excerptOnly
        ? sql<string>`left(notes.body, ${sql.lit(EXCERPT_SOURCE_LENGTH)})`
        : sql<string>`notes.body`
      ).as('body'),
      sql<boolean>`(l.id IS NOT NULL AND c.id IS NOT NULL AND l.status = 'published'
        AND c.status = 'published' AND c.archived_at IS NULL)`.as('available'),
    ]);
}

export interface NoteRow {
  id: string;
  lessonTitleSnapshot: string | null;
  courseTitleSnapshot: string | null;
  videoSeconds: number | null;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  lessonId: string | null;
  lessonTitle: string | null;
  courseId: string | null;
  courseSlug: string | null;
  courseTitle: string | null;
  body: string;
  available: boolean;
}

function toLessonRef(row: NoteRow): NoteLessonRef | null {
  // Nota de aula é a que guarda os títulos, mesmo com a aula excluída (migration 0011).
  if (row.lessonTitleSnapshot === null) return null;
  const available = row.available === true;
  return {
    id: row.lessonId,
    title: available && row.lessonTitle !== null ? row.lessonTitle : row.lessonTitleSnapshot,
    courseId: row.courseId,
    courseSlug: row.courseSlug,
    courseTitle:
      available && row.courseTitle !== null
        ? row.courseTitle
        : (row.courseTitleSnapshot ?? row.lessonTitleSnapshot),
    available,
  };
}

function base(row: NoteRow) {
  return {
    id: row.id,
    lesson: toLessonRef(row),
    videoSeconds: row.videoSeconds,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toNote(row: NoteRow): Note {
  return { ...base(row), body: row.body };
}

export function toNoteSummary(row: NoteRow): NoteSummary {
  return { ...base(row), excerpt: noteExcerpt(row.body) };
}

/**
 * Início do corpo sem a marcação do Markdown, numa linha só, com até `maxLength` caracteres
 * (reticências quando corta). É texto puro para a lista: a exibição da nota continua passando
 * pelo componente `Markdown`, que sanitiza.
 */
export function noteExcerpt(body: string, maxLength: number = NOTE_EXCERPT_MAX_LENGTH): string {
  const text = body
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/<[^>\n]{1,200}>/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]{0,3}(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d{1,9}[.)][ \t]+)/gm, '')
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, ' ')
    .replace(/[*_~`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...text];
  if (chars.length <= maxLength) return text;
  return `${chars
    .slice(0, maxLength - 1)
    .join('')
    .trimEnd()}…`;
}
