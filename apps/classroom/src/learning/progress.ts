import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';

export type CourseView = ClassroomSchemas['CourseView'];
export type CourseViewModule = ClassroomSchemas['CourseViewModule'];
export type CourseViewLesson = ClassroomSchemas['CourseViewLesson'];
export type ProgressCounts = ClassroomSchemas['ProgressCounts'];
export type LessonProgressResult = ClassroomSchemas['LessonProgressResult'];

/** Tempo do aviso com "Desfazer" depois do fim do vídeo (spec 014, "Conclusão da aula"). */
export const UNDO_MS = 8000;

/** Endereço da página do curso do aluno. */
export function coursePath(slug: string): string {
  return `/meus-cursos/${encodeURIComponent(slug)}`;
}

/** Endereço da página da aula. */
export function lessonPath(slug: string, lessonId: string): string {
  return `${coursePath(slug)}/aulas/${encodeURIComponent(lessonId)}`;
}

/** Módulos e aulas na ordem do programa (`position`). */
export function orderedModules(course: CourseView): CourseViewModule[] {
  return [...course.modules]
    .sort((a, b) => a.position - b.position)
    .map((module) => ({
      ...module,
      lessons: [...module.lessons].sort((a, b) => a.position - b.position),
    }));
}

/**
 * Contagem depois de concluir (`+1`) ou desmarcar (`-1`) uma aula, pela regra da spec 014
 * ("Progresso"): concluídas ÷ publicadas. É a previsão da interface otimista; a resposta da API
 * a substitui em seguida.
 */
export function shiftCounts(counts: ProgressCounts, delta: 1 | -1): ProgressCounts {
  const completedLessons = Math.min(
    counts.totalLessons,
    Math.max(0, counts.completedLessons + delta),
  );
  const done = counts.totalLessons > 0 && completedLessons === counts.totalLessons;
  return {
    completedLessons,
    totalLessons: counts.totalLessons,
    percent: counts.totalLessons
      ? Math.floor((completedLessons / counts.totalLessons) * 100)
      : counts.percent,
    // aula aberta já conta como "em andamento": o estado só anda para a frente ao desmarcar
    state: done
      ? 'completed'
      : completedLessons > 0 || counts.state !== 'not_started'
        ? 'in_progress'
        : 'not_started',
  };
}

/**
 * O curso com a aula marcada ou desmarcada, antes de a API responder (RNF-03). Sem acesso ao
 * curso, a aula amostra muda de estado mas não entra no progresso (spec 014, "Conclusão da aula").
 */
export function applyCompletion(
  course: CourseView,
  lessonId: string,
  completed: boolean,
): CourseView {
  const owner = course.modules.find((module) =>
    module.lessons.some((lesson) => lesson.id === lessonId),
  );
  const current = owner?.lessons.find((lesson) => lesson.id === lessonId);
  if (!owner || !current || current.completed === completed) return course;
  const counts = course.access.allowed;
  const delta = completed ? 1 : -1;
  return {
    ...course,
    progress: counts ? shiftCounts(course.progress, delta) : course.progress,
    modules: course.modules.map((module) =>
      module.id === owner.id
        ? {
            ...module,
            progress: counts ? shiftCounts(module.progress, delta) : module.progress,
            lessons: module.lessons.map((lesson) =>
              lesson.id === lessonId ? { ...lesson, completed } : lesson,
            ),
          }
        : module,
    ),
  };
}

/** O curso com o que a API gravou: estado da aula e progresso recalculado do módulo e do curso. */
export function applyProgressResult(course: CourseView, result: LessonProgressResult): CourseView {
  if (course.id !== result.course.id) return course;
  const completed = result.userState.completedAt !== null;
  return {
    ...course,
    progress: result.countsForCourse ? result.course.progress : course.progress,
    modules: course.modules.map((module) => {
      const own = module.lessons.some((lesson) => lesson.id === result.lessonId);
      if (!own) return module;
      return {
        ...module,
        progress:
          result.countsForCourse && module.id === result.module.id
            ? result.module.progress
            : module.progress,
        lessons: module.lessons.map((lesson) =>
          lesson.id === result.lessonId ? { ...lesson, completed } : lesson,
        ),
      };
    }),
  };
}
