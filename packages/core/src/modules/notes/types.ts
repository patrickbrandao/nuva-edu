// Tipos e limites das anotações (spec 016, RNF-02 e "Dados"). Os valores repetem as restrições
// da migration 0011; os limites de notas por usuário e por aula só existem aqui.

/** Corpo da nota: até 20.000 caracteres (pontos de código, como o `char_length` do banco). */
export const NOTE_BODY_MAX_LENGTH = 20_000;
/** Título da nota: até 160 caracteres. */
export const NOTE_TITLE_MAX_LENGTH = 160;
/** Notas por usuário. */
export const NOTE_MAX_PER_USER = 5_000;
/** Notas de um usuário na mesma aula: a lista da aba "Minhas notas" não é paginada. */
export const NOTE_MAX_PER_LESSON = 100;
/** Trecho do corpo na página "Anotações" (`NoteSummary.excerpt`). */
export const NOTE_EXCERPT_MAX_LENGTH = 300;
/** Termo de busca (`q`): 1 a 200 caracteres. */
export const NOTE_SEARCH_MAX_LENGTH = 200;
/** Página "Anotações": 30 por página (spec 016), no máximo 100. */
export const NOTE_PAGE_DEFAULT_LIMIT = 30;
export const NOTE_PAGE_MAX_LIMIT = 100;
/** `video_seconds` é `integer` no banco. */
export const NOTE_VIDEO_SECONDS_MAX = 2_147_483_647;

export const NOTE_KINDS = ['lesson', 'standalone'] as const;
/** `lesson`: nota de aula (mesmo com a aula excluída); `standalone`: avulsa. */
export type NoteKind = (typeof NOTE_KINDS)[number];

/** Dono das notas: sempre o usuário da sessão. Toda consulta filtra por ele (RF-06). */
export interface NoteOwner {
  readonly id: string;
}

/** A aula de uma nota, para o link de volta (`NoteLesson` do contrato). */
export interface NoteLessonRef {
  /** `null` quando a aula foi excluída. */
  id: string | null;
  /** Título atual; o guardado na criação quando a aula está despublicada ou foi excluída. */
  title: string;
  courseId: string | null;
  courseSlug: string | null;
  courseTitle: string;
  /** Falso com a aula (ou o curso) despublicada, arquivada ou excluída: sem link de volta. */
  available: boolean;
}

interface NoteBase {
  id: string;
  /** `null` na nota avulsa. */
  lesson: NoteLessonRef | null;
  videoSeconds: number | null;
  title: string | null;
  createdAt: Date;
  /** Precisão de milissegundos: é o valor que o cliente devolve em `updateNote`. */
  updatedAt: Date;
}

/** Uma nota inteira (`Note` do contrato). */
export interface Note extends NoteBase {
  /** Markdown. */
  body: string;
}

/** Item da página "Anotações" (`NoteSummary`). */
export interface NoteSummary extends NoteBase {
  /** Início do corpo, sem Markdown, até 300 caracteres. */
  excerpt: string;
}

export interface NoteSummaryPage {
  items: NoteSummary[];
  nextCursor: string | null;
}

export interface CreateNoteInput {
  /** Presente: nota de aula (exige acesso à aula agora). Ausente ou `null`: avulsa. */
  lessonId?: string | null | undefined;
  title?: string | null | undefined;
  body: string;
  /** Instante do vídeo, só em nota de aula; a fração é descartada. */
  videoSeconds?: number | null | undefined;
}

export interface UpdateNoteInput {
  /** O `updatedAt` da versão que o cliente leu (data ou texto ISO 8601). */
  updatedAt: Date | string;
  /** `undefined` mantém; `null` (ou só espaços) remove o título. */
  title?: string | null | undefined;
  /** `undefined` mantém. */
  body?: string | undefined;
  /** `undefined` mantém; `null` remove o instante. */
  videoSeconds?: number | null | undefined;
}

export interface ListNotesQuery {
  /** Busca textual no título e no corpo; só espaços conta como ausente. */
  q?: string | undefined;
  kind?: NoteKind | undefined;
  courseId?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}
