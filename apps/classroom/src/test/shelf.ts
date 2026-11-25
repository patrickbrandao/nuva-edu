import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import { COURSE_ITEM, EBOOK_ITEM } from './catalog';
import { LESSON_1, LESSON_2, LESSON_3, MODULE_1, MODULE_2 } from './learning';
import { jsonResponse } from './renderApp';

type ShelfCourse = ClassroomSchemas['ShelfCourse'];
type Shelf = ClassroomSchemas['Shelf'];
type ProgressCounts = ClassroomSchemas['ProgressCounts'];
type Handlers = Record<string, (request: Request) => Response | Promise<Response>>;

const id = (suffix: string) => `0193a5b2-0000-7000-8000-0000000${suffix}`;

function counts(completed: number, total: number, opened = completed > 0): ProgressCounts {
  return {
    completedLessons: completed,
    totalLessons: total,
    percent: total ? Math.floor((completed / total) * 100) : 0,
    state: total > 0 && completed === total ? 'completed' : opened ? 'in_progress' : 'not_started',
  };
}

/** Um curso da estante (esquema `ShelfCourse`); por padrão, `React do zero` em andamento. */
export function makeShelfCourse(overrides: Partial<ShelfCourse> = {}): ShelfCourse {
  return {
    id: COURSE_ITEM.id,
    slug: COURSE_ITEM.slug,
    title: COURSE_ITEM.title,
    level: 'beginner',
    cover: COURSE_ITEM.cover,
    progress: counts(1, 3),
    access: { state: 'active', expiresAt: '2027-03-12T12:00:00Z' },
    action: 'continue',
    continueLessonId: LESSON_2,
    lastAccessedAt: '2026-11-24T12:00:00Z',
    acquiredAt: '2026-11-01T12:00:00Z',
    publishedAt: '2026-11-20T12:00:00Z',
    certificate: null,
    ...overrides,
  };
}

export const NODE_LESSON = id('000021');

/** Em andamento, não iniciado (vitalício), concluído (curso aberto) e em andamento vencido. */
export const SHELF_COURSES: ShelfCourse[] = [
  makeShelfCourse(),
  makeShelfCourse({
    id: id('0000c2'),
    slug: 'node-na-pratica',
    title: 'Node na prática',
    level: 'intermediate',
    cover: null,
    progress: counts(0, 10),
    access: { state: 'active', expiresAt: null },
    action: 'start',
    continueLessonId: NODE_LESSON,
    lastAccessedAt: null,
    acquiredAt: '2026-11-23T12:00:00Z',
    publishedAt: '2026-10-01T12:00:00Z',
  }),
  makeShelfCourse({
    id: id('0000c3'),
    slug: 'css-moderno',
    title: 'CSS moderno',
    level: null,
    cover: null,
    progress: counts(8, 8),
    access: { state: 'open', expiresAt: null },
    action: 'review',
    continueLessonId: id('000031'),
    lastAccessedAt: '2026-11-10T12:00:00Z',
    acquiredAt: null,
    publishedAt: '2026-09-01T12:00:00Z',
  }),
  makeShelfCourse({
    id: id('0000c4'),
    slug: 'git-essencial',
    title: 'Git essencial',
    level: 'beginner',
    cover: null,
    progress: counts(2, 4),
    access: { state: 'expired', expiresAt: '2026-10-01T12:00:00Z' },
    action: 'renew',
    continueLessonId: null,
    lastAccessedAt: '2026-09-20T12:00:00Z',
    acquiredAt: '2025-10-01T12:00:00Z',
    publishedAt: '2026-11-22T12:00:00Z',
  }),
];

const byDate = (a: string | null, b: string | null) => (b ?? '').localeCompare(a ?? '');

/**
 * `GET /api/v1/me/courses` simulado como a spec 014 descreve: os contadores saem do conjunto
 * todo; `filter`, `q` e `sort` valem só para os itens.
 */
export function fakeShelf(
  courses: ShelfCourse[] = SHELF_COURSES,
  extra: Partial<Pick<Shelf, 'startHereCourseId'>> & { completedLessonSeconds?: number } = {},
): Handlers {
  const count = (state: ProgressCounts['state']) =>
    courses.filter((course) => course.progress.state === state).length;
  return {
    'GET /api/v1/me/courses': (request) => {
      const query = new URL(request.url).searchParams;
      const filter = query.get('filter') ?? 'all';
      const q = (query.get('q') ?? '').toLowerCase();
      const sort = query.get('sort') ?? '-lastAccessedAt';
      const items = courses
        .filter((course) => filter === 'all' || course.progress.state === filter)
        .filter((course) => course.title.toLowerCase().includes(q))
        .sort((a, b) => {
          if (sort === 'title') return a.title.localeCompare(b.title);
          if (sort === '-percent') return b.progress.percent - a.progress.percent;
          if (sort === '-publishedAt') return byDate(a.publishedAt, b.publishedAt);
          return byDate(a.lastAccessedAt, b.lastAccessedAt);
        });
      const shelf: Shelf = {
        counts: {
          all: courses.length,
          inProgress: count('in_progress'),
          notStarted: count('not_started'),
          completed: count('completed'),
          completedLessonSeconds: extra.completedLessonSeconds ?? 9000,
        },
        startHereCourseId: extra.startHereCourseId ?? null,
        items,
      };
      return jsonResponse(shelf);
    },
  };
}

/** "Continue assistindo" (esquema `ContinueList`): dois cursos em andamento. */
export const CONTINUE_LIST: ClassroomSchemas['ContinueList'] = {
  items: [
    {
      course: {
        id: COURSE_ITEM.id,
        slug: COURSE_ITEM.slug,
        title: COURSE_ITEM.title,
        cover: COURSE_ITEM.cover,
      },
      lesson: { id: LESSON_2, title: 'Seu primeiro componente', positionSeconds: 120 },
      progress: counts(1, 3),
      lastOpenedAt: '2026-11-24T12:00:00Z',
    },
    {
      course: { id: id('0000c5'), slug: 'sql-do-zero', title: 'SQL do zero', cover: null },
      lesson: { id: id('000051'), title: 'Primeira consulta', positionSeconds: null },
      progress: counts(0, 5, true),
      lastOpenedAt: '2026-11-20T12:00:00Z',
    },
  ],
};

/** Aulas amostra de cursos que a aluna não possui (esquema `SampleLesson`). */
export const SAMPLE_LESSONS: ClassroomSchemas['SampleLesson'][] = [
  {
    id: id('000061'),
    title: 'O que é TypeScript',
    durationSeconds: 900,
    course: {
      id: id('0000c6'),
      slug: 'typescript-na-pratica',
      title: 'TypeScript na prática',
      cover: null,
    },
  },
  {
    id: id('000071'),
    title: 'Instalando o Docker',
    durationSeconds: null,
    course: { id: id('0000c7'), slug: 'docker-essencial', title: 'Docker essencial', cover: null },
  },
];

/** "Meus ebooks" (esquema `MyEbookList`): um vitalício e um com validade. */
export const MY_EBOOKS: ClassroomSchemas['MyEbookList'] = {
  items: [
    {
      id: EBOOK_ITEM.id,
      slug: EBOOK_ITEM.slug,
      title: EBOOK_ITEM.title,
      cover: null,
      authorName: 'Carla Dias',
      pages: 48,
      expiresAt: null,
    },
    {
      id: id('0000e3'),
      slug: 'sql-de-bolso',
      title: 'SQL de bolso',
      cover: null,
      authorName: null,
      pages: null,
      expiresAt: '2027-03-12T12:00:00Z',
    },
  ],
};

/** "Meu progresso" (esquema `MyProgress`): `React do zero` com 1 de 3 aulas. */
export const MY_PROGRESS: ClassroomSchemas['MyProgress'] = {
  items: [
    {
      course: { id: COURSE_ITEM.id, slug: COURSE_ITEM.slug, title: COURSE_ITEM.title },
      progress: counts(1, 3),
      modules: [
        {
          id: MODULE_1,
          title: 'Primeiros passos',
          progress: counts(1, 2),
          lessons: [
            { id: LESSON_1, title: 'Boas-vindas ao curso', completedAt: '2026-11-24T12:30:00Z' },
            { id: LESSON_2, title: 'Seu primeiro componente', completedAt: null },
          ],
        },
        {
          id: MODULE_2,
          title: 'Estado e efeitos',
          progress: counts(0, 1),
          lessons: [{ id: LESSON_3, title: 'useState na prática', completedAt: null }],
        },
      ],
    },
  ],
};

/** Mapa de atividade (esquema `ActivityMap`): só os dias com atividade vêm na lista. */
export const ACTIVITY: ClassroomSchemas['ActivityMap'] = {
  timezone: 'America/Sao_Paulo',
  from: '2025-11-23',
  to: '2026-11-25',
  days: [
    {
      date: '2026-11-20',
      total: 1,
      lessonsCompleted: 1,
      forumPosts: 0,
      communityActions: 0,
      level: 2,
    },
    {
      date: '2026-11-24',
      total: 2,
      lessonsCompleted: 2,
      forumPosts: 0,
      communityActions: 0,
      level: 4,
    },
  ],
};
