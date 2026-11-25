import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminSection,
  ErrorState,
  firstName,
  LoadingState,
  PageTitle,
  ProductCard,
  ProductCardList,
} from '@nuva-edu/ui';
import { GraduationCap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../api/errors';
import { coursePath, lessonPath } from '../learning/progress';
import { SampleLessons } from '../learning/SampleLessons';
import { type ContinueItem, useContinueWatching } from '../learning/shelf';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';
import { HOME_PATH, MY_COURSES_PATH } from '../shell/navigation';

function ContinueCard({ item }: { item: ContinueItem }) {
  const { t } = useTranslation();
  const { course, lesson, progress } = item;
  const counts = { completed: progress.completedLessons, count: progress.totalLessons };
  return (
    <ProductCard
      title={course.title}
      href={coursePath(course.slug)}
      coverUrl={course.cover?.url}
      meta={t('study.start.nextLesson', { lesson: lesson.title })}
      progress={{
        value: progress.percent,
        label: t('study.shelf.progressOf', { title: course.title }),
        valueText: t('learning.progress.lessonsDone', counts),
        caption: t('learning.progress.lessons', counts),
      }}
      action={
        <AdminButton
          href={lessonPath(course.slug, lesson.id)}
          variant="primary"
          aria-label={t('study.start.continueCourse', { title: course.title })}
        >
          {t('study.shelf.actions.continue')}
        </AdminButton>
      }
    />
  );
}

/** "Continue assistindo": até 3 cursos em andamento, do mais recente ao mais antigo. */
function ContinueWatching() {
  const { t } = useTranslation();
  const query = useContinueWatching();
  const items = query.data ?? [];
  const failure = query.isError ? describeError(t, query.error) : null;

  return (
    <AdminSection
      title={t('study.start.continueTitle')}
      actions={
        <AdminButton href={MY_COURSES_PATH} variant="ghost" size="sm">
          {t('study.start.allCourses')}
        </AdminButton>
      }
    >
      {query.isPending ? (
        <AdminCard pad aria-busy="true">
          <LoadingState label={t('study.start.continueLoading')} />
        </AdminCard>
      ) : failure ? (
        <AdminCard pad>
          <ErrorState
            title={t('study.start.continueErrorTitle')}
            text={failure.message}
            detail={failure.detail}
            retryLabel={t('common.retry')}
            onRetry={() => void query.refetch()}
            retrying={query.isFetching}
          />
        </AdminCard>
      ) : items.length === 0 ? (
        <AdminCard>
          <AdminEmpty
            icon={<GraduationCap aria-hidden="true" />}
            title={t('study.start.continueEmptyTitle')}
            text={t('study.start.continueEmptyText')}
          >
            <span className="mt-3 flex">
              <AdminButton href={HOME_PATH}>{t('study.start.showcase')}</AdminButton>
            </span>
          </AdminEmpty>
        </AdminCard>
      ) : (
        <ProductCardList aria-label={t('study.start.continueList')}>
          {items.map((item) => (
            <ContinueCard key={item.course.id} item={item} />
          ))}
        </ProductCardList>
      )}
    </AdminSection>
  );
}

/**
 * `/inicio`: a entrada do aluno, com "Continue assistindo" e "Aulas liberadas" (spec 014,
 * RF-06 e RF-10).
 */
export function StartPage() {
  const { t } = useTranslation();
  usePageMeta(t('menu.items.start'), t('study.start.description'));
  return (
    <RequireSession>
      {(session) => (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
          <PageTitle subtitle={t('study.start.lead')}>
            {t('study.start.greeting', { name: firstName(session.user.name) })}
          </PageTitle>
          <ContinueWatching />
          <SampleLessons />
        </div>
      )}
    </RequireSession>
  );
}
