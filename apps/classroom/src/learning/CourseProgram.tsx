import { Accordion, AdminTag, TextLink } from '@nuva-edu/ui';
import { Circle, CircleCheck, CirclePlay, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatDuration } from '../catalog/format';
import { type CourseView, type CourseViewLesson, lessonPath, orderedModules } from './progress';

interface CourseProgramProps {
  course: CourseView;
  /** Aula aberta na página da aula: marcada como atual, com o módulo dela aberto. */
  currentLessonId?: string | undefined;
  headingLevel?: 2 | 3;
}

type LessonStatus = 'completed' | 'current' | 'pending' | 'locked';

function statusOf(lesson: CourseViewLesson, currentLessonId: string | undefined): LessonStatus {
  if (lesson.completed) return 'completed';
  if (lesson.id === currentLessonId) return 'current';
  return lesson.accessible ? 'pending' : 'locked';
}

const ICONS = {
  completed: CircleCheck,
  current: CirclePlay,
  pending: Circle,
  locked: Lock,
} as const;

/**
 * Programa do curso para o aluno (spec 014): um painel por módulo, com o progresso do módulo no
 * cabeçalho e, em cada aula, o estado (concluída, atual, pendente ou bloqueada). Aula sem acesso
 * aparece pelo título, sem link.
 */
export function CourseProgram({ course, currentLessonId, headingLevel = 2 }: CourseProgramProps) {
  const { t } = useTranslation();
  const modules = orderedModules(course);
  if (modules.length === 0) {
    return <p className="m-0 text-sm text-ink-3">{t('learning.course.programEmpty')}</p>;
  }
  const currentModule = modules.find((module) =>
    module.lessons.some((lesson) => lesson.id === currentLessonId),
  );
  const firstOpen = currentModule ?? modules[0];

  return (
    <Accordion
      // outra aula de outro módulo: o painel dela abre
      key={currentModule?.id ?? 'program'}
      headingLevel={headingLevel}
      defaultOpen={firstOpen ? [firstOpen.id] : []}
      items={modules.map((module) => ({
        id: module.id,
        title: module.title,
        meta: [
          t('learning.progress.lessons', {
            completed: module.progress.completedLessons,
            count: module.progress.totalLessons,
          }),
          t('learning.progress.percent', { percent: module.progress.percent }),
        ].join(' · '),
        content: (
          <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-ink">
            {module.lessons.map((lesson) => {
              const status = statusOf(lesson, currentLessonId);
              const Icon = ICONS[status];
              const current = lesson.id === currentLessonId;
              return (
                <li key={lesson.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span
                    className={`inline-flex shrink-0 ${status === 'completed' ? 'text-ink' : 'text-ink-3'}`}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span className="sr-only">{t(`learning.status.${status}`)}</span>
                  </span>
                  <span className="min-w-0 flex-1 basis-40 break-words">
                    {lesson.accessible ? (
                      <TextLink
                        href={lessonPath(course.slug, lesson.id)}
                        className={current ? 'font-semibold' : undefined}
                        {...(current ? { 'aria-current': 'page' as const } : {})}
                      >
                        {lesson.title}
                      </TextLink>
                    ) : (
                      <span className="text-ink-2">{lesson.title}</span>
                    )}
                  </span>
                  {lesson.isSample ? <AdminTag>{t('product.sample')}</AdminTag> : null}
                  {lesson.durationSeconds ? (
                    <span className="text-ink-3">{formatDuration(t, lesson.durationSeconds)}</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ),
      }))}
    />
  );
}
