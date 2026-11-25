import {
  AdminButton,
  AdminCard,
  AdminSection,
  AdminTag,
  ErrorState,
  LoadingState,
  TextLink,
} from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { describeError } from '../api/errors';
import { formatDuration } from '../catalog/format';
import { lessonPath } from './progress';
import { useSampleLessons } from './shelf';

/**
 * Seção "Aulas liberadas" (spec 014, RF-10): as aulas amostra de cursos que o aluno não possui,
 * cada uma com o curso e a duração, levando direto à aula.
 */
export function SampleLessons() {
  const { t } = useTranslation();
  const samples = useSampleLessons();
  const lessons = samples.data?.pages.flatMap((page) => page.items) ?? [];
  const failure = samples.isError ? describeError(t, samples.error) : null;

  return (
    <AdminSection title={t('study.samples.title')}>
      {samples.isPending ? (
        <AdminCard pad aria-busy="true">
          <LoadingState label={t('study.samples.loading')} />
        </AdminCard>
      ) : failure ? (
        <AdminCard pad>
          <ErrorState
            title={t('study.samples.errorTitle')}
            text={failure.message}
            detail={failure.detail}
            retryLabel={t('common.retry')}
            onRetry={() => void samples.refetch()}
            retrying={samples.isFetching}
          />
        </AdminCard>
      ) : lessons.length === 0 ? (
        <AdminCard pad>
          <p className="m-0 text-sm text-ink-3">{t('study.samples.empty')}</p>
        </AdminCard>
      ) : (
        <div className="flex flex-col gap-4">
          <AdminCard pad>
            <ul
              aria-label={t('study.samples.list')}
              className="m-0 flex list-none flex-col gap-3 p-0 text-sm text-ink"
            >
              {lessons.map((lesson) => (
                <li key={lesson.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5 break-words">
                    <TextLink href={lessonPath(lesson.course.slug, lesson.id)}>
                      {lesson.title}
                    </TextLink>
                    <span className="text-ink-3">
                      {t('study.samples.course', { title: lesson.course.title })}
                    </span>
                  </span>
                  <AdminTag>{t('learning.lesson.sample')}</AdminTag>
                  {lesson.durationSeconds ? (
                    <span className="text-ink-3">{formatDuration(t, lesson.durationSeconds)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </AdminCard>
          {samples.hasNextPage ? (
            <span className="flex justify-center">
              <AdminButton
                disabled={samples.isFetchingNextPage}
                onClick={() => void samples.fetchNextPage()}
              >
                {samples.isFetchingNextPage
                  ? t('study.samples.loadingMore')
                  : t('study.samples.more')}
              </AdminButton>
            </span>
          ) : null}
        </div>
      )}
    </AdminSection>
  );
}
