import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import { COURSE } from './catalog';
import { LESSON_1 } from './learning';
import { jsonResponse, missingRouteResponse, noContent, problemResponse } from './renderApp';

type Note = ClassroomSchemas['Note'];
type NoteLesson = ClassroomSchemas['NoteLesson'];
type NoteSummary = ClassroomSchemas['NoteSummary'];
type FetchMock = (request: Request) => Response | Promise<Response>;

export const NOTE_1 = '0193a5b2-0000-7000-8000-000000000a01';
export const NOTE_2 = '0193a5b2-0000-7000-8000-000000000a02';
export const NOTE_3 = '0193a5b2-0000-7000-8000-000000000a03';

/** A aula `Boas-vindas ao curso`, disponível (esquema `NoteLesson`). */
export const NOTE_LESSON: NoteLesson = {
  id: LESSON_1,
  title: 'Boas-vindas ao curso',
  courseId: COURSE.id,
  courseSlug: COURSE.slug,
  courseTitle: COURSE.title,
  available: true,
};

/** Uma nota de aula com instante (esquema `Note`). */
export function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: NOTE_1,
    lesson: NOTE_LESSON,
    videoSeconds: 83,
    title: null,
    body: 'Componentes são **funções**.\n\n<script>alert(1)</script>',
    createdAt: '2026-11-20T12:00:00.000Z',
    updatedAt: '2026-11-20T12:00:00.000Z',
    ...overrides,
  };
}

interface FakeNotesOptions {
  /** `code` do `422` devolvido por toda criação (ex.: `note_lesson_limit_reached`). */
  createFails?: string | null;
  /** Notas por página em `GET /notes` quando o pedido não diz (padrão do contrato: 30). */
  pageSize?: number;
}

/**
 * API de anotações simulada, com estado (spec 016): `GET /notes` (filtros `q`, `kind`,
 * `courseId`, cursor), `POST /notes`, `GET`/`PATCH`/`DELETE /notes/{id}` e
 * `GET /lessons/{id}/notes`. O `PATCH` compara o `updatedAt` (`409 version_conflict` com
 * `current`), devolve a nota como está quando nada muda e avança o `updatedAt` quando muda. O que
 * não for de notas vai para `fallback`.
 */
export function fakeNotes(
  initial: Note[] = [],
  fallback: FetchMock = () => missingRouteResponse(),
  options: FakeNotesOptions = {},
) {
  const state = { notes: structuredClone(initial), options: { ...options } };
  let created = 0;
  let clock = Date.parse('2026-11-25T12:00:00.000Z');
  const tick = () => {
    clock += 1;
    return new Date(clock).toISOString();
  };
  const summary = ({ body, ...rest }: Note): NoteSummary => ({
    ...rest,
    excerpt: body.replace(/[*_#`<>]/g, '').slice(0, 300),
  });

  const fetch: FetchMock = async (request) => {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    const lessonList = /^\/api\/v1\/lessons\/([^/]+)\/notes$/.exec(pathname);
    if (lessonList && method === 'GET') {
      const items = state.notes
        .filter((note) => note.lesson?.id === lessonList[1])
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return jsonResponse({ items });
    }
    if (pathname === '/api/v1/notes' && method === 'GET') {
      const query = url.searchParams;
      const words = (query.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const kind = query.get('kind');
      const courseId = query.get('courseId');
      const all = state.notes
        .filter((note) => !kind || (kind === 'lesson') === (note.lesson !== null))
        .filter((note) => !courseId || note.lesson?.courseId === courseId)
        .filter((note) => {
          const text = `${note.title ?? ''} ${note.body}`.toLowerCase();
          return words.every((word) => text.includes(word));
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const size = Number(query.get('limit') ?? 30);
      const page = Math.min(size, state.options.pageSize ?? size);
      const start = Number(query.get('cursor') ?? 0);
      return jsonResponse({
        items: all.slice(start, start + page).map(summary),
        nextCursor: start + page < all.length ? String(start + page) : null,
      });
    }
    if (pathname === '/api/v1/notes' && method === 'POST') {
      const body = (await request.json()) as {
        lessonId?: string | null;
        title?: string | null;
        body: string;
        videoSeconds?: number | null;
      };
      if (state.options.createFails) return problemResponse(422, state.options.createFails);
      if (!body.lessonId && body.videoSeconds != null) {
        return problemResponse(422, 'note_video_seconds_invalid');
      }
      created += 1;
      const now = tick();
      const note: Note = {
        id: `0193a5b2-0000-7000-8000-000000000b${String(created).padStart(2, '0')}`,
        lesson: body.lessonId ? { ...NOTE_LESSON, id: body.lessonId } : null,
        videoSeconds: body.videoSeconds == null ? null : Math.floor(body.videoSeconds),
        title: body.title?.trim() || null,
        body: body.body,
        createdAt: now,
        updatedAt: now,
      };
      state.notes.push(note);
      return jsonResponse(note, 201);
    }
    const one = /^\/api\/v1\/notes\/([^/]+)$/.exec(pathname);
    if (one) {
      const note = state.notes.find((item) => item.id === one[1]);
      if (!note) return problemResponse(404, 'not_found');
      if (method === 'GET') return jsonResponse(note);
      if (method === 'DELETE') {
        state.notes = state.notes.filter((item) => item !== note);
        return noContent();
      }
      if (method === 'PATCH') {
        const body = (await request.json()) as {
          title?: string | null;
          body?: string;
          videoSeconds?: number | null;
          updatedAt: string;
        };
        if (body.updatedAt !== note.updatedAt) {
          return problemResponse(409, 'version_conflict', { current: note });
        }
        const next: Note = {
          ...note,
          ...(body.title !== undefined ? { title: body.title?.trim() || null } : {}),
          ...(body.body !== undefined ? { body: body.body } : {}),
          ...(body.videoSeconds !== undefined ? { videoSeconds: body.videoSeconds } : {}),
        };
        const changed =
          next.title !== note.title ||
          next.body !== note.body ||
          next.videoSeconds !== note.videoSeconds;
        if (changed) Object.assign(note, next, { updatedAt: tick() });
        return jsonResponse(note);
      }
    }
    return fallback(request);
  };

  /** Outra gravação "em outro dispositivo": muda o texto e avança o `updatedAt`. */
  const editElsewhere = (id: string, body: string): Note => {
    const note = state.notes.find((item) => item.id === id);
    if (!note) throw new Error(`nota ${id} não existe`);
    Object.assign(note, { body, updatedAt: tick() });
    return note;
  };

  return { fetch: fetch as (request: Request) => Promise<Response>, state, editElsewhere };
}
