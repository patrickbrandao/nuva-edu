import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminMenu,
  AdminSearch,
  AdminStats,
  AdminTabs,
  ErrorState,
  LoadingState,
  PageTitle,
  ProductCardList,
} from '@nuva-edu/ui';
import { GraduationCap, LayoutGrid, List, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { describeError } from '../api/errors';
import { SEARCH_MAX_LENGTH } from '../catalog/filters';
import { formatDuration, useDateFormatter } from '../catalog/format';
import { SampleLessons } from '../learning/SampleLessons';
import { ShelfCard, shelfActionPath } from '../learning/ShelfCard';
import { type Shelf, type ShelfCourse, useShelf } from '../learning/shelf';
import {
  readShelfFilters,
  readShelfView,
  type ShelfFilter,
  type ShelfFilters,
  type ShelfSort,
  type ShelfViewMode,
  saveShelfView,
  writeShelfFilters,
} from '../learning/shelfFilters';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';
import { HOME_PATH } from '../shell/navigation';

/** Espera depois da última tecla antes de buscar. */
const SEARCH_DELAY_MS = 300;
const ALL = 'all';
const RECENT = 'recent';

/** Contadores do topo: valem para a estante inteira, antes do filtro e da busca. */
function Counters({ counts }: { counts: Shelf['counts'] }) {
  const { t } = useTranslation();
  const hours =
    counts.completedLessonSeconds > 0
      ? formatDuration(t, counts.completedLessonSeconds)
      : t('product.duration.minutes', { minutes: 0 });
  return (
    <section aria-label={t('study.shelf.counts.label')}>
      <AdminStats
        stats={[
          { id: 'all', value: counts.all, label: t('study.shelf.counts.all') },
          { id: 'inProgress', value: counts.inProgress, label: t('study.shelf.counts.inProgress') },
          { id: 'notStarted', value: counts.notStarted, label: t('study.shelf.counts.notStarted') },
          { id: 'completed', value: counts.completed, label: t('study.shelf.counts.completed') },
          { id: 'hours', value: hours, label: t('study.shelf.counts.hours') },
        ]}
      />
    </section>
  );
}

/** "Comece por aqui": com cursos e nenhum iniciado, o de aquisição mais recente. */
function StartHere({ course }: { course: ShelfCourse }) {
  const { t } = useTranslation();
  return (
    <AdminCard pad as="section" aria-label={t('study.shelf.startHere.title')}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
          <h2 className="m-0 text-base font-semibold text-ink">
            {t('study.shelf.startHere.title')}
          </h2>
          <p className="m-0 text-sm text-ink-2">{t('study.shelf.startHere.text')}</p>
          <p className="m-0 break-words text-sm font-semibold text-ink">{course.title}</p>
        </div>
        <AdminButton
          href={shelfActionPath(course)}
          variant="primary"
          aria-label={t('study.shelf.startHere.action', { title: course.title })}
        >
          {t('study.shelf.actions.start')}
        </AdminButton>
      </div>
    </AdminCard>
  );
}

function ShelfContent() {
  const { t } = useTranslation();
  const formatDate = useDateFormatter();
  const [params, setParams] = useSearchParams();
  const filters = readShelfFilters(params);
  const shelf = useShelf(filters);

  const [view, setView] = useState<ShelfViewMode>(readShelfView);
  const chooseView = (mode: ShelfViewMode) => {
    setView(mode);
    saveShelfView(mode);
  };

  const applied = filters.q ?? '';
  const [search, setSearch] = useState(applied);
  const [lastApplied, setLastApplied] = useState(applied);
  // "Limpar filtros" e o "voltar" do navegador mudam a busca por fora do campo.
  if (applied !== lastApplied) {
    setLastApplied(applied);
    setSearch(applied);
  }

  const update = (next: ShelfFilters) => setParams(writeShelfFilters(next), { replace: true });

  useEffect(() => {
    const q = search.trim();
    if (q === applied) return undefined;
    const timer = window.setTimeout(() => {
      const { q: _old, ...rest } = readShelfFilters(params);
      setParams(writeShelfFilters(q ? { ...rest, q } : rest), { replace: true });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search, applied, params, setParams]);

  if (shelf.isPending) {
    return (
      <AdminCard pad aria-busy="true">
        <LoadingState label={t('study.shelf.loading')} />
      </AdminCard>
    );
  }
  if (shelf.isError) {
    const failure = describeError(t, shelf.error);
    return (
      <AdminCard pad>
        <ErrorState
          title={t('study.shelf.errorTitle')}
          text={failure.message}
          detail={failure.detail}
          retryLabel={t('common.retry')}
          onRetry={() => void shelf.refetch()}
          retrying={shelf.isFetching}
        />
      </AdminCard>
    );
  }

  const { counts, items, startHereCourseId } = shelf.data;
  if (counts.all === 0) {
    return (
      <AdminCard>
        <AdminEmpty
          icon={<GraduationCap aria-hidden="true" />}
          title={t('study.shelf.emptyTitle')}
          text={t('study.shelf.emptyText')}
        >
          <span className="mt-3 flex">
            <AdminButton href={HOME_PATH} variant="primary">
              {t('study.start.showcase')}
            </AdminButton>
          </span>
        </AdminEmpty>
      </AdminCard>
    );
  }

  const startHere = items.find((course) => course.id === startHereCourseId);
  const narrowed = Boolean(filters.filter || filters.q);
  const sortOptions = [
    { id: RECENT, label: t('study.shelf.filters.sort.recent') },
    { id: '-publishedAt', label: t('study.shelf.filters.sort.catalog') },
    { id: 'title', label: t('study.shelf.filters.sort.title') },
    { id: '-percent', label: t('study.shelf.filters.sort.progress') },
  ];
  const sort = filters.sort ?? RECENT;

  return (
    <>
      <Counters counts={counts} />
      {startHere ? <StartHere course={startHere} /> : null}

      <search aria-label={t('study.shelf.filters.label')} className="flex flex-col gap-3">
        <div className="overflow-x-auto">
          <AdminTabs
            label={t('study.shelf.filters.tabs')}
            value={filters.filter ?? ALL}
            onChange={(id: string) => {
              const { filter: _old, ...rest } = filters;
              update(id === ALL ? rest : { ...rest, filter: id as ShelfFilter });
            }}
            tabs={[
              { id: ALL, label: t('study.shelf.filters.all'), count: counts.all },
              {
                id: 'in_progress',
                label: t('study.shelf.filters.inProgress'),
                count: counts.inProgress,
              },
              {
                id: 'not_started',
                label: t('study.shelf.filters.notStarted'),
                count: counts.notStarted,
              },
              {
                id: 'completed',
                label: t('study.shelf.filters.completed'),
                count: counts.completed,
              },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminSearch
            className="min-w-0 flex-1 basis-56"
            value={search}
            onChange={setSearch}
            label={t('study.shelf.filters.search')}
            placeholder={t('study.shelf.filters.searchPlaceholder')}
            maxLength={SEARCH_MAX_LENGTH}
          />
          <AdminMenu
            options={sortOptions}
            value={sort}
            onChange={(id: string) => {
              const { sort: _old, ...rest } = filters;
              update(id === RECENT ? rest : { ...rest, sort: id as ShelfSort });
            }}
            // o nome lido contém o texto visível (WCAG 2.5.3) e diz de que escolha se trata
            aria-label={`${t('study.shelf.filters.sortLabel')}: ${
              sortOptions.find((option) => option.id === sort)?.label ?? ''
            }`}
          />
          {/* biome-ignore lint/a11y/useSemanticElements: dois botões de alternância não são um fieldset de formulário */}
          <span role="group" aria-label={t('study.shelf.view.label')} className="flex gap-1">
            <AdminButton
              variant={view === 'grid' ? 'default' : 'ghost'}
              aria-pressed={view === 'grid'}
              icon={<LayoutGrid size={14} aria-hidden="true" />}
              onClick={() => chooseView('grid')}
            >
              {t('study.shelf.view.grid')}
            </AdminButton>
            <AdminButton
              variant={view === 'list' ? 'default' : 'ghost'}
              aria-pressed={view === 'list'}
              icon={<List size={14} aria-hidden="true" />}
              onClick={() => chooseView('list')}
            >
              {t('study.shelf.view.list')}
            </AdminButton>
          </span>
        </div>
      </search>

      {items.length === 0 ? (
        <AdminCard>
          <AdminEmpty
            icon={<SearchX aria-hidden="true" />}
            title={t('study.shelf.noResultsTitle')}
            text={t('study.shelf.noResultsText')}
          >
            {narrowed ? (
              <span className="mt-3 flex">
                <AdminButton onClick={() => update(filters.sort ? { sort: filters.sort } : {})}>
                  {t('study.shelf.filters.clear')}
                </AdminButton>
              </span>
            ) : null}
          </AdminEmpty>
        </AdminCard>
      ) : (
        <div aria-busy={shelf.isPlaceholderData}>
          <ProductCardList layout={view} aria-label={t('study.shelf.list')}>
            {items.map((course) => (
              <ShelfCard key={course.id} course={course} layout={view} formatDate={formatDate} />
            ))}
          </ProductCardList>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {shelf.isPlaceholderData ? '' : t('study.shelf.count', { count: items.length })}
      </p>
    </>
  );
}

/**
 * `/meus-cursos`: a estante do aluno (spec 014, RF-05), com contadores, filtros com contagem,
 * busca, ordenação, grade ou lista (lembrada no navegador), "Comece por aqui" e as aulas
 * liberadas. O estado do certificado de cada curso é da tarefa 454.
 */
export function MyCoursesPage() {
  const { t } = useTranslation();
  usePageMeta(t('menu.items.myCourses'), t('study.shelf.description'));
  return (
    <RequireSession>
      {() => (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
          <PageTitle>{t('menu.items.myCourses')}</PageTitle>
          <ShelfContent />
          <SampleLessons />
        </div>
      )}
    </RequireSession>
  );
}
