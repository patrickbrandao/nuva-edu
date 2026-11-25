import {
  AdminButton,
  AdminCheckbox,
  AdminEmpty,
  AdminField,
  AdminMenu,
  AdminPageHeader,
  AdminSearch,
  AdminTable,
  AdminTextArea,
  Alert,
  Dialog,
  LoadingState,
  TextLink,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { GraduationCap } from 'lucide-react';
import { type FormEvent, lazy, Suspense, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import {
  ACCESS_MODES,
  type AccessMode,
  COURSE_STATUSES,
  COURSES_SORTS,
  type CourseDetail,
  type CourseStatusFilter,
  type CourseSummary,
  type CoursesSort,
  coursePath,
  coursesKeys,
  DEFAULT_COURSES_SORT,
  SUMMARY_MAX,
  TITLE_MAX,
  useCoursesList,
} from '../../api/courses';
import { useMeta } from '../../api/meta';
import { QueryErrorState } from '../../api/problems';
import { useUser } from '../../api/users';
import { formatDateTime } from '../../format';
import { useCan } from '../../session/session';
import { CourseStatusCell } from './CourseBits';
import { useCourseError, useFieldRefusal } from './errors';
import { formatDuration, formatPrice } from './format';

const ALL = 'all';
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/* A escolha do dono para o filtro entra sob demanda (spec 006, RNF-03). */
const OwnerFilterDialog = lazy(() =>
  import('./CourseOwner').then((module) => ({ default: module.OwnerFilterDialog })),
);

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

/**
 * Cursos (spec 006, mapa de telas; `GET /api/v1/courses`): busca, filtros de situação e de modo
 * de acesso, "aguardando publicação", ordenação e "carregar mais". Os filtros ficam no endereço
 * (RF-07). O instrutor recebe da API só os cursos de que é dono.
 */
export function CoursesPage() {
  const { t } = useTranslation();
  const can = useCan();
  const navigate = useNavigate();
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() || undefined;
  const status = pick(params.get('status'), COURSE_STATUSES);
  const accessMode = pick(params.get('access'), ACCESS_MODES);
  const awaitingReview = params.get('awaiting') === '1';
  // filtro por dono: só de quem troca o dono (gerente e admin); o instrutor já recebe só os dele
  const canFilterOwner = can('course.set_owner');
  const ownerParam = params.get('dono');
  const ownerId = canFilterOwner && ownerParam && UUID.test(ownerParam) ? ownerParam : undefined;
  const [pickingOwner, setPickingOwner] = useState(false);
  const [pickedOwner, setPickedOwner] = useState<{ id: string; name: string } | null>(null);
  const sort = pick(params.get('sort'), COURSES_SORTS) ?? DEFAULT_COURSES_SORT;
  const [search, setSearch] = useState(q ?? '');
  useEffect(() => setSearch(q ?? ''), [q]);
  const [creating, setCreating] = useState(false);

  const list = useCoursesList({
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(accessMode ? { accessMode } : {}),
    ...(awaitingReview ? { awaitingReview: true } : {}),
    ...(ownerId ? { ownerId } : {}),
    sort,
  });
  const rows: CourseSummary[] = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(q || status || accessMode || awaitingReview || ownerId);
  // o nome do dono no botão: o escolhido agora, o de um curso da lista ou, no endereço
  // recarregado sem cursos, a ficha dele
  const knownOwner =
    pickedOwner?.id === ownerId
      ? pickedOwner?.name
      : rows.find((course) => course.owner?.id === ownerId)?.owner?.name;
  const ownerUser = useUser(ownerId ?? '', Boolean(ownerId) && !knownOwner && !list.isPending);
  const ownerName = knownOwner ?? ownerUser.data?.name;

  const update = (key: string, value: string | undefined) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value && value !== ALL) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    update('q', search.trim() || undefined);
  };

  const statusOptions = [
    { id: ALL, label: t('courses.filters.allStatuses') },
    ...COURSE_STATUSES.map((id: CourseStatusFilter) => ({
      id,
      label: t(`courses.filters.status.${id}`),
    })),
  ];
  const accessOptions = [
    { id: ALL, label: t('courses.filters.allAccessModes') },
    ...ACCESS_MODES.map((id: AccessMode) => ({ id, label: t(`courses.accessModes.${id}`) })),
  ];
  const sortOptions = COURSES_SORTS.map((id: CoursesSort) => ({
    id,
    label: t(`courses.sort.${id}`),
  }));
  const labelOf = (options: { id: string; label: string }[], id: string) =>
    options.find((option) => option.id === id)?.label ?? '';

  const currency = meta.data?.currency;
  const columns = [
    {
      id: 'title',
      label: t('courses.columns.title'),
      render: (course: CourseSummary) => (
        <TextLink href={coursePath(course.id)} quiet>
          {course.title}
        </TextLink>
      ),
    },
    {
      id: 'status',
      label: t('courses.columns.status'),
      render: (course: CourseSummary) => <CourseStatusCell course={course} />,
    },
    {
      id: 'access',
      label: t('courses.columns.access'),
      render: (course: CourseSummary) =>
        course.accessMode === 'paid' && course.priceCents !== null && currency
          ? t('courses.accessWithPrice', {
              mode: t('courses.accessModes.paid'),
              price: formatPrice(course.priceCents, currency),
            })
          : t(`courses.accessModes.${course.accessMode}`),
    },
    {
      id: 'owner',
      label: t('courses.columns.owner'),
      render: (course: CourseSummary) => course.owner?.name ?? t('courses.noOwner'),
    },
    {
      id: 'content',
      label: t('courses.columns.content'),
      render: (course: CourseSummary) =>
        [
          t('courses.moduleCount', { count: course.moduleCount }),
          t('courses.lessonCount', { count: course.lessonCount }),
          course.durationSeconds > 0 ? formatDuration(course.durationSeconds) : null,
        ]
          .filter(Boolean)
          .join(' · '),
    },
    {
      id: 'updatedAt',
      label: t('courses.columns.updatedAt'),
      render: (course: CourseSummary) => formatDateTime(course.updatedAt),
    },
  ];

  const createButton = can('course.create') ? (
    <AdminButton variant="primary" onClick={() => setCreating(true)}>
      {t('courses.create.open')}
    </AdminButton>
  ) : null;

  return (
    <>
      <AdminPageHeader
        title={t('menu.items.courses')}
        subtitle={t('courses.subtitle')}
        actions={createButton}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex items-center gap-2" onSubmit={onSearch}>
          <AdminSearch
            value={search}
            onChange={setSearch}
            label={t('courses.filters.search')}
            placeholder={t('courses.filters.searchPlaceholder')}
            maxLength={200}
          />
          <AdminButton type="submit">{t('courses.filters.searchButton')}</AdminButton>
        </form>
        <AdminMenu
          options={statusOptions}
          value={status ?? ALL}
          onChange={(id: string) => update('status', id)}
          aria-label={t('courses.filters.statusLabel', {
            value: labelOf(statusOptions, status ?? ALL),
          })}
        />
        <AdminMenu
          options={accessOptions}
          value={accessMode ?? ALL}
          onChange={(id: string) => update('access', id)}
          aria-label={t('courses.filters.accessLabel', {
            value: labelOf(accessOptions, accessMode ?? ALL),
          })}
        />
        <AdminMenu
          options={sortOptions}
          value={sort}
          onChange={(id: string) => update('sort', id === DEFAULT_COURSES_SORT ? undefined : id)}
          aria-label={t('courses.filters.sortLabel', { value: labelOf(sortOptions, sort) })}
        />
        {canFilterOwner ? (
          <AdminButton aria-haspopup="dialog" onClick={() => setPickingOwner(true)}>
            {ownerId
              ? ownerName
                ? t('courses.filters.ownerOf', { name: ownerName })
                : t('courses.filters.ownerUnknown')
              : t('courses.filters.ownerAll')}
          </AdminButton>
        ) : null}
        <AdminCheckbox
          checked={awaitingReview}
          onChange={(checked: boolean) => update('awaiting', checked ? '1' : undefined)}
        >
          {t('courses.awaitingReview')}
        </AdminCheckbox>
      </div>

      {list.isPending ? (
        <LoadingState label={t('courses.loading')} />
      ) : list.isError && rows.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('courses.errorTitle')}
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
                icon={<GraduationCap aria-hidden="true" />}
                title={filtered ? t('courses.emptyFiltered') : t('courses.empty')}
                text={filtered ? t('courses.emptyFilteredText') : t('courses.emptyText')}
              >
                {filtered ? (
                  <AdminButton onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                    {t('courses.filters.clear')}
                  </AdminButton>
                ) : (
                  createButton
                )}
              </AdminEmpty>
            }
          />
          {list.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <AdminButton
                disabled={list.isFetchingNextPage}
                aria-busy={list.isFetchingNextPage || undefined}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
              </AdminButton>
            </div>
          ) : null}
          {list.isFetchNextPageError ? (
            <p role="alert" className="mt-2 text-center text-sm text-ink-2">
              {t('courses.loadMoreError')}
            </p>
          ) : null}
        </>
      )}

      {pickingOwner ? (
        <Suspense fallback={null}>
          <OwnerFilterDialog
            ownerId={ownerId}
            onClose={() => setPickingOwner(false)}
            onPick={(owner) => {
              setPickedOwner(owner ?? null);
              update('dono', owner?.id);
              setPickingOwner(false);
            }}
          />
        </Suspense>
      ) : null}
      {creating ? (
        <CreateCourseDialog
          onClose={() => setCreating(false)}
          onDone={(course) => void navigate(coursePath(course.id))}
        />
      ) : null}
    </>
  );
}

interface CreateProps {
  onClose: () => void;
  onDone: (course: CourseDetail) => void;
}

/**
 * Novo curso (`POST /api/v1/courses`): nasce rascunho e privado, e o editor abre em seguida.
 * Modo de acesso, preço e dono ficam no editor, para quem tem a ação.
 */
function CreateCourseDialog({ onClose, onDone }: CreateProps) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const formId = useId();
  const message = useCourseError();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [missing, setMissing] = useState(false);

  const create = useAction(async () => {
    const { data } = await api.POST('/api/v1/courses', {
      body: {
        title: title.trim(),
        ...(summary.trim() === '' ? {} : { summary: summary.trim() }),
      },
    });
    if (!data) throw new Error('POST /api/v1/courses respondeu sem corpo');
    return data;
  });
  const refusal = useFieldRefusal(create.error);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const empty = title.trim() === '';
    setMissing(empty);
    if (empty) return;
    const result = await create.run();
    if (result.ok) {
      void queryClient.invalidateQueries({ queryKey: coursesKeys.lists() });
      onDone(result.data);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('courses.create.title')}
      description={t('courses.create.description')}
      closeLabel={t('common.close')}
      dismissible={!create.busy}
      footer={
        <>
          <AdminButton disabled={create.busy} onClick={onClose}>
            {t('common.cancel')}
          </AdminButton>
          <AdminButton variant="primary" type="submit" form={formId} disabled={create.busy}>
            {create.busy ? t('courses.create.busy') : t('courses.create.submit')}
          </AdminButton>
        </>
      }
    >
      {refusal.general(['title', 'summary']) ? (
        <Alert tone="error" className="mb-4">
          {message(create.error)}
        </Alert>
      ) : null}
      <form id={formId} className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        <AdminField
          label={t('courses.fields.title')}
          value={title}
          onChange={setTitle}
          maxLength={TITLE_MAX}
          autoComplete="off"
          error={missing ? t('forms.required') : refusal.of('title')}
        />
        <AdminTextArea
          label={t('courses.fields.summary')}
          hint={t('courses.fields.summaryHint')}
          value={summary}
          onChange={setSummary}
          rows={2}
          maxLength={SUMMARY_MAX}
          counter={({ length, max }) => t('courses.counter', { length, max })}
          error={refusal.of('summary')}
        />
      </form>
    </Dialog>
  );
}
