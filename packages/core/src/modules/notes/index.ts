// Anotações (spec 016): notas por aula e avulsas, privadas do dono. Tarefa 414.

export {
  createNote,
  deleteNote,
  getNote,
  listLessonNotes,
  listNotes,
  updateNote,
} from './notes.ts';
export {
  type CreateNoteInput,
  type ListNotesQuery,
  NOTE_BODY_MAX_LENGTH,
  NOTE_EXCERPT_MAX_LENGTH,
  NOTE_KINDS,
  NOTE_MAX_PER_USER,
  NOTE_PAGE_DEFAULT_LIMIT,
  NOTE_PAGE_MAX_LIMIT,
  NOTE_SEARCH_MAX_LENGTH,
  NOTE_TITLE_MAX_LENGTH,
  type Note,
  type NoteKind,
  type NoteLessonRef,
  type NoteOwner,
  type NoteSummary,
  type NoteSummaryPage,
  type UpdateNoteInput,
} from './types.ts';
export { noteExcerpt } from './view.ts';
