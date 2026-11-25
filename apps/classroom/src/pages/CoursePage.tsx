import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminSection,
  Alert,
  ErrorState,
  LoadingState,
  PageTitle,
  ProgressBar,
  TextLink,
} from '@nuva-edu/ui';
import { PackageSearch } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { describeError } from '../api/errors';
import { productPath, useDateFormatter } from '../catalog/format';
import { CourseProgram } from '../learning/CourseProgram';
import { type CourseView, lessonPath } from '../learning/progress';
import { useCourseView } from '../learning/queries';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';
import { HOME_PATH } from '../shell/navigation';

const ACTIONS = {
  not_started: 'learning.course.start',
  in_progress: 'learning.course.continue',
  completed: 'learning.course.review',
} as const;

/** Progresso do curso com o botão que leva à aula certa (`continueLessonId`, spec 014). */
function ProgressPanel({ course }: { course: CourseView }) {
  const { t } = useTranslation();
  const formatDate = useDateFormatter();
  const { progress } = course;
  const counts = { completed: progress.completedLessons, count: progress.totalLessons };
  return (
    <AdminCard pad as="section" aria-label={t('learning.progress.course')}>
      <div className="flex flex-col gap-3">
        <ProgressBar
          value={progress.percent}
          label={t('learning.progress.course')}
          valueText={t('learning.progress.lessonsDone', counts)}
          caption={t('learning.progress.percent', { percent: progress.percent })}
        />
        <p className="m-0 text-sm text-ink-2">{t('learning.progress.lessonsDone', counts)}</p>
        {course.access.allowed && course.access.expiresAt ? (
          <p className="m-0 text-sm text-ink-3">
            {t('learning.course.accessUntil', { date: formatDate(course.access.expiresAt) })}
          </p>
        ) : null}
        {course.continueLessonId ? (
          <span className="flex">
            <AdminButton href={lessonPath(course.slug, course.continueLessonId)} variant="primary">
              {t(ACTIONS[progress.state])}
            </AdminButton>
          </span>
        ) : null}
      </div>
    </AdminCard>
  );
}

function CourseBody({ course }: { course: CourseView }) {
  const { t } = useTranslation();
  return (
    <article className="flex flex-col gap-6">
      <PageTitle subtitle={course.summary ?? undefined}>{course.title}</PageTitle>

      {course.access.allowed ? null : (
        <Alert
          tone="warning"
          role="status"
          title={t('learning.course.lockedTitle')}
          actions={
            <AdminButton href={productPath('course', course.slug)}>
              {t('learning.course.publicPage')}
            </AdminButton>
          }
        >
          {t(`learning.reasons.${course.access.reason ?? 'unknown'}`)}{' '}
          {course.modules.some((module) => module.lessons.some((lesson) => lesson.accessible))
            ? t('learning.course.sampleHint')
            : null}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <AdminSection title={t('learning.course.program')}>
            <CourseProgram course={course} headingLevel={3} />
          </AdminSection>

          {course.ebooks.length > 0 ? (
            <AdminSection title={t('learning.course.ebooks')}>
              <AdminCard pad>
                <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-ink">
                  {course.ebooks.map((ebook) => (
                    <li key={ebook.id}>
                      <TextLink href={productPath('ebook', ebook.slug)}>{ebook.title}</TextLink>
                    </li>
                  ))}
                </ul>
              </AdminCard>
            </AdminSection>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <ProgressPanel course={course} />
        </div>
      </div>
    </article>
  );
}

function CourseContent() {
  const { t } = useTranslation();
  const { slug = '' } = useParams();
  const query = useCourseView(slug);
  const course = query.data ?? null;

  usePageMeta(
    course
      ? course.title
      : query.isSuccess
        ? t('learning.course.notFoundTitle')
        : t('pages.myCourse'),
    course
      ? t('learning.course.description', { title: course.title })
      : t('learning.course.notFoundText'),
  );

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <AdminCard pad aria-busy="true">
        <LoadingState label={t('learning.course.loading')} />
      </AdminCard>
    );
  } else if (query.isError) {
    const failure = describeError(t, query.error);
    body = (
      <AdminCard pad>
        <ErrorState
          title={t('learning.course.errorTitle')}
          text={failure.message}
          detail={failure.detail}
          retryLabel={t('common.retry')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </AdminCard>
    );
  } else if (!course) {
    body = (
      <>
        <PageTitle align="center">{t('learning.course.notFoundTitle')}</PageTitle>
        <AdminEmpty
          icon={<PackageSearch aria-hidden="true" />}
          text={t('learning.course.notFoundText')}
        >
          <span className="mt-3 flex">
            <AdminButton href={HOME_PATH}>{t('common.backHome')}</AdminButton>
          </span>
        </AdminEmpty>
      </>
    );
  } else {
    body = <CourseBody course={course} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6">{body}</div>
  );
}

/**
 * `/meus-cursos/:slug`: o curso do aluno, com o programa em acordeão, o progresso por módulo e do
 * curso e o botão "Continuar" (spec 014). O bloco do certificado é da tarefa 454.
 */
export function CoursePage() {
  return <RequireSession>{() => <CourseContent />}</RequireSession>;
}
