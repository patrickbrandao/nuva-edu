import {
  ActivityHeatmap,
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminSection,
  ErrorState,
  LoadingState,
  PageTitle,
  ProgressBar,
  TextLink,
} from '@nuva-edu/ui';
import { TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../api/errors';
import { MyCertificates } from '../certificates/MyCertificates';
import { coursePath } from '../learning/progress';
import { type MyProgressCourse, useMyActivity, useMyProgress } from '../learning/shelf';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';
import { MY_COURSES_PATH } from '../shell/navigation';

const SQUARE = 'inline-block size-3.5 rounded-[3px] border';
const DONE = `${SQUARE} border-ink bg-ink`;
const PENDING = `${SQUARE} border-ink-3 bg-transparent`;

/** Mapa de atividade dos últimos 12 meses; os dias chegam no fuso do aluno (spec 014). */
function Activity() {
  const { t, i18n } = useTranslation();
  const query = useMyActivity();
  return (
    <AdminSection title={t('study.activity.title')}>
      {query.isPending ? (
        <AdminCard pad aria-busy="true">
          <LoadingState label={t('study.activity.loading')} />
        </AdminCard>
      ) : query.isError ? (
        <AdminCard pad>
          <ErrorState
            title={t('study.activity.errorTitle')}
            text={describeError(t, query.error).message}
            detail={describeError(t, query.error).detail}
            retryLabel={t('common.retry')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        </AdminCard>
      ) : (
        <AdminCard pad>
          <ActivityHeatmap
            days={query.data.days.map((day) => ({ day: day.date, total: day.total }))}
            today={query.data.to}
            locale={i18n.language}
            labels={{
              title: t('study.activity.tableTitle'),
              day: (date, total) =>
                total > 0
                  ? t('study.activity.day', { count: total, date })
                  : t('study.activity.dayNone', { date }),
              summary: (total, activeDays) =>
                total > 0
                  ? t('study.activity.summary', {
                      count: total,
                      days: t('study.activity.days', { count: activeDays }),
                    })
                  : t('study.activity.summaryNone'),
              less: t('study.activity.less'),
              more: t('study.activity.more'),
            }}
          />
        </AdminCard>
      )}
    </AdminSection>
  );
}

/** Um curso: a barra com o percentual e, por módulo, um quadrado por aula. */
function CourseGrid({ item }: { item: MyProgressCourse }) {
  const { t } = useTranslation();
  const { course, progress, modules } = item;
  const counts = { completed: progress.completedLessons, count: progress.totalLessons };
  return (
    <AdminCard pad as="article" aria-label={course.title}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h3 className="m-0 break-words text-base font-semibold text-ink">
            <TextLink href={coursePath(course.slug)} quiet>
              {course.title}
            </TextLink>
          </h3>
          <ProgressBar
            value={progress.percent}
            label={t('study.shelf.progressOf', { title: course.title })}
            valueText={t('learning.progress.lessonsDone', counts)}
            caption={t('learning.progress.percent', { percent: progress.percent })}
          />
          <p className="m-0 text-sm text-ink-2">{t('learning.progress.lessonsDone', counts)}</p>
        </div>
        {modules.map((module) => (
          <div key={module.id} className="flex flex-col gap-1.5">
            <h4 className="m-0 break-words text-sm font-medium text-ink-2">
              {module.title}
              <span className="font-normal text-ink-3">
                {' · '}
                {t('learning.progress.lessons', {
                  completed: module.progress.completedLessons,
                  count: module.progress.totalLessons,
                })}
              </span>
            </h4>
            <ul
              aria-label={t('study.progress.lessonsOf', { module: module.title })}
              className="m-0 flex list-none flex-wrap gap-1 p-0"
            >
              {module.lessons.map((lesson) => {
                const done = lesson.completedAt !== null;
                const label = t(
                  done ? 'study.progress.lessonDone' : 'study.progress.lessonPending',
                  {
                    lesson: lesson.title,
                  },
                );
                return (
                  <li key={lesson.id} className="flex" title={label}>
                    <span
                      className={done ? DONE : PENDING}
                      data-done={done ? 'true' : 'false'}
                      aria-hidden="true"
                    />
                    <span className="sr-only">{label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </AdminCard>
  );
}

function Courses() {
  const { t } = useTranslation();
  const query = useMyProgress();
  return (
    <AdminSection
      title={t('study.progress.coursesTitle')}
      actions={
        <span aria-hidden="true" className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <span className={DONE} /> {t('study.progress.legendDone')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className={PENDING} /> {t('study.progress.legendPending')}
          </span>
        </span>
      }
    >
      {query.isPending ? (
        <AdminCard pad aria-busy="true">
          <LoadingState label={t('study.progress.loading')} />
        </AdminCard>
      ) : query.isError ? (
        <AdminCard pad>
          <ErrorState
            title={t('study.progress.errorTitle')}
            text={describeError(t, query.error).message}
            detail={describeError(t, query.error).detail}
            retryLabel={t('common.retry')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        </AdminCard>
      ) : query.data.length === 0 ? (
        <AdminCard>
          <AdminEmpty
            icon={<TrendingUp aria-hidden="true" />}
            title={t('study.progress.emptyTitle')}
            text={t('study.progress.emptyText')}
          >
            <span className="mt-3 flex">
              <AdminButton href={MY_COURSES_PATH}>{t('study.start.allCourses')}</AdminButton>
            </span>
          </AdminEmpty>
        </AdminCard>
      ) : (
        <div className="flex flex-col gap-4">
          {query.data.map((item) => (
            <CourseGrid key={item.course.id} item={item} />
          ))}
        </div>
      )}
    </AdminSection>
  );
}

/**
 * `/progresso`: "Meu progresso" (spec 014, RF-08), com a grade de aulas de cada curso iniciado, os
 * certificados (spec 015) e o mapa de atividade dos últimos 12 meses.
 */
export function ProgressPage() {
  const { t } = useTranslation();
  usePageMeta(t('menu.items.progress'), t('study.progress.description'));
  return (
    <RequireSession>
      {() => (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
          <PageTitle subtitle={t('study.progress.lead')}>{t('menu.items.progress')}</PageTitle>
          <Courses />
          <MyCertificates />
          <Activity />
        </div>
      )}
    </RequireSession>
  );
}
