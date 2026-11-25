import {
  AdminAvatar,
  AdminButton,
  AdminCard,
  AdminDetails,
  AdminEmpty,
  AdminMenu,
  AdminSearch,
  AdminSection,
  AdminStats,
  AdminStatus,
  AdminTable,
  Alert,
  LoadingState,
  ProgressBar,
  TextLink,
} from '@nuva-edu/ui';
import { Users } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type CourseProgressState,
  type CourseStudent,
  DEFAULT_STUDENTS_SORT,
  PROGRESS_STATES,
  STUDENTS_SORTS,
  type StudentsSort,
  useCourseProgressSummary,
  useCourseStudents,
} from '../../api/access';
import type { CourseDetail } from '../../api/courses';
import { QueryErrorState, useProblemText } from '../../api/problems';
import { formatDate, formatDateTime } from '../../format';
import { useCan } from '../../session/session';
import { STUDENTS_PATH } from '../users/UserBits';

const ALL = 'all';
const BUCKETS = ['notStarted', 'upTo25', 'upTo50', 'upTo75', 'upTo99', 'completed'] as const;

/**
 * Alunos do curso e resumo de progresso (spec 006, mapa de telas; spec 014;
 * `GET /courses/{id}/progress-summary` e `GET /courses/{id}/students`). É a lista de alunos do
 * instrutor, só nos próprios cursos: nome, avatar e progresso, sem e-mail nem compras.
 */
export function CourseStudentsTab({ course }: { course: CourseDetail }) {
  return (
    <>
      <SummarySection courseId={course.id} />
      <StudentsSection courseId={course.id} />
    </>
  );
}

function SummarySection({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const summary = useCourseProgressSummary(courseId);
  return (
    <AdminSection title={t('access.summary.title')}>
      {summary.isPending ? (
        <LoadingState label={t('access.summary.loading')} />
      ) : summary.isError ? (
        <QueryErrorState
          error={summary.error}
          title={t('access.summary.errorTitle')}
          onRetry={() => void summary.refetch()}
          retrying={summary.isFetching}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <AdminStats
            stats={[
              {
                id: 'students',
                value: summary.data.studentCount,
                label: t('access.summary.students'),
              },
              {
                id: 'rate',
                value: t('access.progress.percent', {
                  percent: Math.round(summary.data.completionRate * 100),
                }),
                label: t('access.summary.completionRate'),
              },
              {
                id: 'lessons',
                value: summary.data.totalLessons,
                label: t('access.summary.lessons'),
              },
            ]}
          />
          <AdminCard pad>
            <h3 className="mt-0 mb-3 text-sm font-medium text-ink">
              {t('access.summary.bucketsTitle')}
            </h3>
            <AdminDetails
              items={BUCKETS.map((id) => ({
                label: t(`access.summary.buckets.${id}`),
                value: summary.data.buckets[id],
              }))}
            />
          </AdminCard>
        </div>
      )}
    </AdminSection>
  );
}

function StudentsSection({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const can = useCan();
  const describe = useProblemText();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState<string | undefined>(undefined);
  const [state, setState] = useState<CourseProgressState | undefined>(undefined);
  const [sort, setSort] = useState<StudentsSort>(DEFAULT_STUDENTS_SORT);
  const list = useCourseStudents(courseId, {
    ...(q ? { q } : {}),
    ...(state ? { state } : {}),
    sort,
  });
  const rows = (list.data?.pages.flatMap((page) => page.items) ?? []).map((item) => ({
    ...item,
    id: item.user.id,
  }));
  const filtered = Boolean(q || state);

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    setQ(search.trim() || undefined);
  };

  const stateOptions = [
    { id: ALL, label: t('access.students.allStates') },
    ...PROGRESS_STATES.map((id) => ({ id, label: t(`access.progress.states.${id}`) })),
  ];
  const sortOptions = STUDENTS_SORTS.map((id) => ({ id, label: t(`access.students.sort.${id}`) }));
  const labelOf = (options: { id: string; label: string }[], id: string) =>
    options.find((option) => option.id === id)?.label ?? '';

  // a ficha do aluno é de quem vê os dados dele; o instrutor vê só o nome
  const linked = can('users.view_private');
  const columns = [
    {
      id: 'student',
      label: t('access.students.columns.student'),
      render: ({ user }: CourseStudent) => (
        <span className="inline-flex items-center gap-2">
          <AdminAvatar name={user.name} src={user.avatarUrl ?? undefined} />
          {linked ? (
            <TextLink href={`${STUDENTS_PATH}/${encodeURIComponent(user.id)}`} quiet>
              {user.name}
            </TextLink>
          ) : (
            user.name
          )}
        </span>
      ),
    },
    {
      id: 'progress',
      label: t('access.students.columns.progress'),
      render: ({ user, progress }: CourseStudent) => (
        <ProgressBar
          size="sm"
          value={progress.percent}
          label={t('access.progress.barLabel', { title: user.name })}
          valueText={t('access.progress.lessons', {
            completed: progress.completedLessons,
            total: progress.totalLessons,
          })}
          caption={t('access.progress.percent', { percent: progress.percent })}
        />
      ),
    },
    {
      id: 'state',
      label: t('access.students.columns.state'),
      render: ({ progress }: CourseStudent) => (
        <AdminStatus tone={progress.state === 'completed' ? 'green' : 'gray'}>
          {t(`access.progress.states.${progress.state}`)}
        </AdminStatus>
      ),
    },
    {
      id: 'lastActivity',
      label: t('access.students.columns.lastActivity'),
      render: ({ lastActivityAt }: CourseStudent) =>
        lastActivityAt ? formatDateTime(lastActivityAt) : t('access.progress.noActivity'),
    },
    {
      id: 'accessUntil',
      label: t('access.students.columns.accessUntil'),
      render: ({ accessExpiresAt }: CourseStudent) =>
        accessExpiresAt ? formatDate(accessExpiresAt) : t('access.students.noExpiry'),
    },
  ];

  return (
    <AdminSection title={t('access.students.title')}>
      <p className="mt-0 mb-3 text-sm text-ink-3">{t('access.students.hint')}</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex items-center gap-2" onSubmit={onSearch}>
          <AdminSearch
            value={search}
            onChange={setSearch}
            label={t('access.students.search')}
            placeholder={t('access.students.searchPlaceholder')}
            maxLength={200}
          />
          <AdminButton type="submit">{t('access.students.searchButton')}</AdminButton>
        </form>
        <AdminMenu
          options={stateOptions}
          value={state ?? ALL}
          onChange={(id: CourseProgressState | typeof ALL) => setState(id === ALL ? undefined : id)}
          aria-label={t('access.students.stateLabel', {
            value: labelOf(stateOptions, state ?? ALL),
          })}
        />
        <AdminMenu
          options={sortOptions}
          value={sort}
          onChange={(id: StudentsSort) => setSort(id)}
          aria-label={t('access.students.sortLabel', { value: labelOf(sortOptions, sort) })}
        />
      </div>

      {list.isPending ? (
        <LoadingState label={t('access.students.loading')} />
      ) : list.isError && rows.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('access.students.errorTitle')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={rows}
            empty={
              <AdminEmpty
                icon={<Users aria-hidden="true" />}
                title={filtered ? t('access.students.emptyFiltered') : t('access.students.empty')}
                text={
                  filtered ? t('access.students.emptyFilteredText') : t('access.students.emptyText')
                }
              />
            }
          />
          {list.isError ? (
            <Alert tone="error" className="mt-4" title={t('access.students.loadMoreError')}>
              {describe(list.error).text}
            </Alert>
          ) : null}
          {list.hasNextPage ? (
            <div className="mt-4">
              <AdminButton
                disabled={list.isFetchingNextPage}
                aria-busy={list.isFetchingNextPage || undefined}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
              </AdminButton>
            </div>
          ) : null}
        </>
      )}
    </AdminSection>
  );
}
