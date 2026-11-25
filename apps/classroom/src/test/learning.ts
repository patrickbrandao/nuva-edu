import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import { COURSE } from './catalog';
import { jsonResponse, problemResponse } from './renderApp';

type CourseView = ClassroomSchemas['CourseView'];
type LessonView = ClassroomSchemas['LessonView'];
type ProgressCounts = ClassroomSchemas['ProgressCounts'];
type LessonProgressResult = ClassroomSchemas['LessonProgressResult'];
type Handlers = Record<string, (request: Request) => Response | Promise<Response>>;

export const MODULE_1 = '0193a5b2-0000-7000-8000-0000000000a1';
export const MODULE_2 = '0193a5b2-0000-7000-8000-0000000000a2';
/** "Boas-vindas ao curso" (amostra), "Seu primeiro componente" e "useState na prática". */
export const LESSON_1 = '0193a5b2-0000-7000-8000-000000000011';
export const LESSON_2 = '0193a5b2-0000-7000-8000-000000000012';
export const LESSON_3 = '0193a5b2-0000-7000-8000-000000000013';

export const COURSE_PATH = '/meus-cursos/react-do-zero';
export const lessonUrl = (id: string) => `${COURSE_PATH}/aulas/${id}`;

function counts(completed: number, total: number, opened = false): ProgressCounts {
  return {
    completedLessons: completed,
    totalLessons: total,
    percent: total ? Math.round((completed / total) * 100) : 0,
    state:
      total > 0 && completed === total
        ? 'completed'
        : completed > 0 || opened
          ? 'in_progress'
          : 'not_started',
  };
}

/** O curso `React do zero` com acesso e nenhuma aula concluída (esquema `CourseView`). */
export function makeCourseView(overrides: Partial<CourseView> = {}): CourseView {
  return {
    id: COURSE.id,
    slug: COURSE.slug,
    title: COURSE.title,
    summary: COURSE.summary,
    description: COURSE.description,
    cover: COURSE.cover,
    level: 'beginner',
    accessMode: 'paid',
    priceCents: 19700,
    accessDays: 365,
    moduleCount: 2,
    lessonCount: 3,
    durationSeconds: 12000,
    instructorName: 'Bruno Lima',
    access: { allowed: true, reason: null, expiresAt: '2027-03-12T12:00:00Z' },
    progress: counts(0, 3),
    continueLessonId: LESSON_1,
    modules: [
      {
        id: MODULE_2,
        title: 'Estado e efeitos',
        position: 1,
        progress: counts(0, 1),
        durationSeconds: 6000,
        lessons: [
          {
            id: LESSON_3,
            title: 'useState na prática',
            durationSeconds: 6000,
            isSample: false,
            position: 0,
            accessible: true,
            completed: false,
          },
        ],
      },
      {
        id: MODULE_1,
        title: 'Primeiros passos',
        position: 0,
        progress: counts(0, 2),
        durationSeconds: 6000,
        lessons: [
          {
            id: LESSON_2,
            title: 'Seu primeiro componente',
            durationSeconds: 5400,
            isSample: false,
            position: 1,
            accessible: true,
            completed: false,
          },
          {
            id: LESSON_1,
            title: 'Boas-vindas ao curso',
            durationSeconds: 600,
            isSample: true,
            position: 0,
            accessible: true,
            completed: false,
          },
        ],
      },
    ],
    ebooks: [],
    certificate: null,
    updatedAt: COURSE.updatedAt,
    ...overrides,
  };
}

/** A primeira aula, em vídeo nativo (`file`), com um link de apoio e um ebook (`LessonView`). */
export function makeLesson(overrides: Partial<LessonView> = {}): LessonView {
  return {
    id: LESSON_1,
    title: 'Boas-vindas ao curso',
    description: 'O que você vai **aprender**.\n\n<script>alert(1)</script>',
    durationSeconds: 600,
    isSample: true,
    videoProvider: 'file',
    videoUrl: 'https://cdn.exemplo.test/aulas/boas-vindas.mp4',
    course: { id: COURSE.id, slug: COURSE.slug, title: COURSE.title },
    module: { id: MODULE_1, title: 'Primeiros passos' },
    links: [
      {
        id: '0193a5b2-0000-7000-8000-0000000000d1',
        label: 'Slides da aula',
        url: 'https://cdn.exemplo.test/slides.pdf',
        kind: 'file',
        position: 0,
      },
    ],
    ebooks: [
      {
        id: '0193a5b2-0000-7000-8000-0000000000e1',
        slug: 'guia-de-git',
        title: 'Guia de Git',
        cover: null,
        accessible: true,
      },
    ],
    previousLessonId: null,
    nextLessonId: LESSON_2,
    isLastLesson: false,
    userState: {
      completedAt: null,
      completedVia: null,
      positionSeconds: null,
      lastOpenedAt: '2026-11-25T12:00:00Z',
    },
    ...overrides,
  };
}

export const LESSON_2_VIEW = (): LessonView =>
  makeLesson({
    id: LESSON_2,
    title: 'Seu primeiro componente',
    description: null,
    durationSeconds: 5400,
    isSample: false,
    videoUrl: 'https://cdn.exemplo.test/aulas/componente.mp4',
    links: [],
    ebooks: [],
    previousLessonId: LESSON_1,
    nextLessonId: LESSON_3,
  });

export const LESSON_3_VIEW = (): LessonView =>
  makeLesson({
    id: LESSON_3,
    title: 'useState na prática',
    description: null,
    durationSeconds: 6000,
    isSample: false,
    videoUrl: 'https://cdn.exemplo.test/aulas/estado.mp4',
    module: { id: MODULE_2, title: 'Estado e efeitos' },
    links: [],
    ebooks: [],
    previousLessonId: LESSON_2,
    nextLessonId: null,
    isLastLesson: true,
  });

/**
 * API de aprendizado simulada, com estado: `GET /courses/{slug}`, `GET /lessons/{id}` e
 * `PUT /lessons/{id}/progress`, que grava a conclusão e a posição e recalcula o progresso do
 * módulo e do curso como a spec 014 manda (concluídas ÷ publicadas).
 */
export function fakeLearning(
  course: CourseView = makeCourseView(),
  lessons: LessonView[] = [makeLesson(), LESSON_2_VIEW(), LESSON_3_VIEW()],
) {
  const state = { course: structuredClone(course), lessons: structuredClone(lessons) };

  const recount = () => {
    for (const module of state.course.modules) {
      const done = module.lessons.filter((lesson) => lesson.completed).length;
      module.progress = counts(done, module.lessons.length, true);
    }
    const all = state.course.modules.flatMap((module) => module.lessons);
    state.course.progress = counts(
      all.filter((lesson) => lesson.completed).length,
      all.length,
      true,
    );
  };

  const handlers: Handlers = {
    [`GET /api/v1/courses/${state.course.slug}`]: () => jsonResponse(state.course),
  };
  for (const lesson of state.lessons) {
    handlers[`GET /api/v1/lessons/${lesson.id}`] = () => jsonResponse(lesson);
    handlers[`PUT /api/v1/lessons/${lesson.id}/progress`] = async (request) => {
      const body = (await request.json()) as {
        completed?: boolean;
        completedVia?: 'manual' | 'video_end';
        positionSeconds?: number | null;
      };
      const module = state.course.modules.find((item) => item.id === lesson.module.id);
      const listed = module?.lessons.find((item) => item.id === lesson.id);
      if (!module || !listed) return problemResponse(404, 'not_found');
      if (body.completed === true && lesson.userState.completedAt === null) {
        lesson.userState.completedAt = '2026-11-25T12:30:00Z';
        lesson.userState.completedVia = body.completedVia ?? 'manual';
        listed.completed = true;
      } else if (body.completed === false) {
        lesson.userState.completedAt = null;
        lesson.userState.completedVia = null;
        listed.completed = false;
      }
      if (body.positionSeconds !== undefined) {
        lesson.userState.positionSeconds = body.positionSeconds;
      }
      recount();
      const result: LessonProgressResult = {
        lessonId: lesson.id,
        userState: lesson.userState,
        module: { id: module.id, progress: module.progress },
        course: { id: state.course.id, progress: state.course.progress },
        countsForCourse: state.course.access.allowed,
      };
      return jsonResponse(result);
    };
  }
  return { handlers, state };
}
