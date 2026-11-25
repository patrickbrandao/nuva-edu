import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminMenu,
  AdminSearch,
  AdminSection,
  ErrorState,
  ExampleHead,
  ExamplePage,
  LoadingState,
  ProductCardList,
} from '@nuva-edu/ui';
import { LibraryBig, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { describeError } from '../api/errors';
import { useMeta } from '../api/meta';
import { CatalogCard } from '../catalog/CatalogCard';
import {
  type CatalogFilters,
  hasActiveFilters,
  readFilters,
  SEARCH_MAX_LENGTH,
  writeFilters,
} from '../catalog/filters';
import { usePriceFormatter } from '../catalog/format';
import { useCatalog } from '../catalog/queries';
import { usePageMeta } from '../lib/usePageMeta';
import { useSession } from '../session/session';

/** Espera depois da última tecla antes de buscar. */
const SEARCH_DELAY_MS = 300;
const ALL = 'all';
const RECENT = 'recent';

interface Option {
  id: string;
  label: string;
}

interface FilterMenuProps {
  /** O que o filtro escolhe (ex.: "Nível"); entra no nome lido do botão. */
  name: string;
  value: string;
  options: Option[];
  onChange: (id: string) => void;
}

/** Um filtro da vitrine: botão com a opção atual e a lista de opções. */
function FilterMenu({ name, value, options, onChange }: FilterMenuProps) {
  const chosen = options.find((option) => option.id === value);
  return (
    <AdminMenu
      options={options}
      value={value}
      onChange={onChange}
      // o nome lido contém o texto visível (WCAG 2.5.3) e diz de que filtro se trata
      aria-label={`${name}: ${chosen?.label ?? ''}`}
    />
  );
}

/** Vitrine pública (specs 006 e 009): cursos, pacotes e ebooks, com filtros, busca e ordenação. */
export function HomePage() {
  const { t } = useTranslation();
  const meta = useMeta();
  const { session } = useSession();
  const school = meta.data?.schoolName;
  const formatPrice = usePriceFormatter();

  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);
  const catalog = useCatalog(filters);

  const applied = filters.q ?? '';
  const [search, setSearch] = useState(applied);
  const [lastApplied, setLastApplied] = useState(applied);
  // "Limpar filtros" e o "voltar" do navegador mudam a busca por fora do campo.
  if (applied !== lastApplied) {
    setLastApplied(applied);
    setSearch(applied);
  }

  const update = (next: CatalogFilters) => setParams(writeFilters(next), { replace: true });

  useEffect(() => {
    const q = search.trim();
    if (q === applied) return undefined;
    const timer = window.setTimeout(() => {
      const { q: _old, ...rest } = readFilters(params);
      setParams(writeFilters(q ? { ...rest, q } : rest), { replace: true });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [search, applied, params, setParams]);

  usePageMeta(
    t('home.title'),
    school ? t('home.description', { school }) : t('home.descriptionFallback'),
  );

  const choose = <K extends 'type' | 'level' | 'price' | 'sort'>(key: K, id: string) => {
    const { [key]: _old, ...rest } = filters;
    update(id === ALL || id === RECENT ? rest : ({ ...rest, [key]: id } as CatalogFilters));
  };

  const items = catalog.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = hasActiveFilters(filters);
  const failure = catalog.isError ? describeError(t, catalog.error) : null;

  return (
    <>
      <ExamplePage>
        <ExampleHead title={school ?? t('home.welcome')} lead={t('home.lead')} />
      </ExamplePage>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6">
        <AdminSection title={t('home.catalog.title')}>
          <search
            aria-label={t('home.filters.label')}
            className="mb-4 flex flex-wrap items-center gap-2"
          >
            <AdminSearch
              className="min-w-0 flex-1 basis-56"
              value={search}
              onChange={setSearch}
              label={t('home.filters.search')}
              placeholder={t('home.filters.searchPlaceholder')}
              maxLength={SEARCH_MAX_LENGTH}
            />
            <FilterMenu
              name={t('home.filters.typeLabel')}
              value={filters.type ?? ALL}
              onChange={(id) => choose('type', id)}
              options={[
                { id: ALL, label: t('home.filters.type.all') },
                { id: 'course', label: t('home.filters.type.course') },
                { id: 'bundle', label: t('home.filters.type.bundle') },
                { id: 'ebook', label: t('home.filters.type.ebook') },
              ]}
            />
            <FilterMenu
              name={t('home.filters.levelLabel')}
              value={filters.level ?? ALL}
              onChange={(id) => choose('level', id)}
              options={[
                { id: ALL, label: t('home.filters.level.all') },
                { id: 'beginner', label: t('product.levels.beginner') },
                { id: 'intermediate', label: t('product.levels.intermediate') },
                { id: 'advanced', label: t('product.levels.advanced') },
              ]}
            />
            <FilterMenu
              name={t('home.filters.priceLabel')}
              value={filters.price ?? ALL}
              onChange={(id) => choose('price', id)}
              options={[
                { id: ALL, label: t('home.filters.price.all') },
                { id: 'free', label: t('home.filters.price.free') },
                { id: 'paid', label: t('home.filters.price.paid') },
              ]}
            />
            <FilterMenu
              name={t('home.filters.sortLabel')}
              value={filters.sort ?? RECENT}
              onChange={(id) => choose('sort', id)}
              options={[
                { id: RECENT, label: t('home.filters.sort.recent') },
                { id: 'title', label: t('home.filters.sort.title') },
                { id: 'priceCents', label: t('home.filters.sort.priceAsc') },
                { id: '-priceCents', label: t('home.filters.sort.priceDesc') },
              ]}
            />
            {filtered ? (
              <AdminButton variant="ghost" onClick={() => update({})}>
                {t('home.filters.clear')}
              </AdminButton>
            ) : null}
          </search>

          {catalog.isPending ? (
            <AdminCard pad aria-busy="true">
              <LoadingState label={t('home.catalog.loading')} />
            </AdminCard>
          ) : failure ? (
            <AdminCard pad>
              <ErrorState
                title={t('home.catalog.errorTitle')}
                text={failure.message}
                detail={failure.detail}
                retryLabel={t('common.retry')}
                onRetry={() => void catalog.refetch()}
                retrying={catalog.isFetching}
              />
            </AdminCard>
          ) : items.length === 0 ? (
            <AdminCard>
              {filtered ? (
                <AdminEmpty
                  icon={<SearchX aria-hidden="true" />}
                  title={t('home.catalog.noResultsTitle')}
                  text={t('home.catalog.noResultsText')}
                >
                  <span className="mt-3 flex">
                    <AdminButton onClick={() => update({})}>{t('home.filters.clear')}</AdminButton>
                  </span>
                </AdminEmpty>
              ) : (
                <AdminEmpty
                  icon={<LibraryBig aria-hidden="true" />}
                  title={t('home.catalog.emptyTitle')}
                  text={t('home.catalog.emptyText')}
                >
                  {session ? null : (
                    <span className="mt-3 flex">
                      <AdminButton href="/cadastro" variant="primary">
                        {t('home.catalog.action')}
                      </AdminButton>
                    </span>
                  )}
                </AdminEmpty>
              )}
            </AdminCard>
          ) : (
            <div className="flex flex-col gap-4" aria-busy={catalog.isPlaceholderData}>
              <ProductCardList aria-label={t('home.catalog.list')}>
                {items.map((item) => (
                  <CatalogCard
                    key={`${item.type}-${item.id}`}
                    item={item}
                    formatPrice={formatPrice}
                  />
                ))}
              </ProductCardList>
              {catalog.hasNextPage ? (
                <span className="flex justify-center">
                  <AdminButton
                    disabled={catalog.isFetchingNextPage}
                    onClick={() => void catalog.fetchNextPage()}
                  >
                    {catalog.isFetchingNextPage
                      ? t('home.catalog.loadingMore')
                      : t('home.catalog.more')}
                  </AdminButton>
                </span>
              ) : null}
            </div>
          )}
          <p className="sr-only" aria-live="polite">
            {catalog.isSuccess && !catalog.isPlaceholderData
              ? t('home.catalog.count', { count: items.length })
              : ''}
          </p>
        </AdminSection>
      </div>
    </>
  );
}
