import {
  AdminButton,
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
import { BookOpen, Package } from 'lucide-react';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import {
  ACCESS_MODES,
  type AccessMode,
  COURSE_STATUSES,
  COURSES_SORTS,
  type CourseStatusFilter,
  type CoursesSort,
  DEFAULT_COURSES_SORT,
  SUMMARY_MAX,
  TITLE_MAX,
} from '../../api/courses';
import { useMeta } from '../../api/meta';
import { QueryErrorState } from '../../api/problems';
import {
  type ProductDetail,
  type ProductKind,
  type ProductSummary,
  productPath,
  productsKeys,
  useProductsList,
} from '../../api/products';
import { formatDateTime } from '../../format';
import { CourseStatusCell } from '../courses/CourseBits';
import { formatPrice } from '../courses/format';
import { useProductError, useProductRefusal } from './errors';

const ALL = 'all';

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

/**
 * Ebooks (`/ebooks`) e pacotes (`/pacotes`) do mapa de telas da spec 006: busca, filtros de
 * situação e de modo de acesso, ordenação e "carregar mais", com os filtros no endereço. As duas
 * listas têm os mesmos filtros do contrato; muda a coluna de detalhe.
 */
export function ProductsPage({ kind }: { kind: ProductKind }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() || undefined;
  const status = pick(params.get('status'), COURSE_STATUSES);
  const accessMode = pick(params.get('access'), ACCESS_MODES);
  const sort = pick(params.get('sort'), COURSES_SORTS) ?? DEFAULT_COURSES_SORT;
  const [search, setSearch] = useState(q ?? '');
  useEffect(() => setSearch(q ?? ''), [q]);
  const [creating, setCreating] = useState(false);

  const list = useProductsList(kind, {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    ...(accessMode ? { accessMode } : {}),
    sort,
  });
  const rows: ProductSummary[] = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(q || status || accessMode);

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
      label: t(`products.${kind}.columnTitle`),
      render: (product: ProductSummary) => (
        <TextLink href={productPath(kind, product.id)} quiet>
          {product.title}
        </TextLink>
      ),
    },
    {
      id: 'status',
      label: t('courses.columns.status'),
      render: (product: ProductSummary) => (
        <CourseStatusCell course={{ ...product, reviewRequestedAt: null }} />
      ),
    },
    {
      id: 'access',
      label: t('courses.columns.access'),
      render: (product: ProductSummary) =>
        product.accessMode === 'paid' && product.priceCents !== null && currency
          ? t('courses.accessWithPrice', {
              mode: t('courses.accessModes.paid'),
              price: formatPrice(product.priceCents, currency),
            })
          : t(`courses.accessModes.${product.accessMode}`),
    },
    {
      id: 'detail',
      label: t(`products.${kind}.columnDetail`),
      render: (product: ProductSummary) =>
        'itemCount' in product
          ? t('products.itemCount', { count: product.itemCount })
          : [
              product.authorName,
              product.pages === null ? null : t('products.pageCount', { count: product.pages }),
            ]
              .filter(Boolean)
              .join(' · ') || t('products.noDetail'),
    },
    {
      id: 'updatedAt',
      label: t('courses.columns.updatedAt'),
      render: (product: ProductSummary) => formatDateTime(product.updatedAt),
    },
  ];

  const createButton = (
    <AdminButton variant="primary" onClick={() => setCreating(true)}>
      {t(`products.${kind}.create.open`)}
    </AdminButton>
  );
  const Icon = kind === 'ebook' ? BookOpen : Package;

  return (
    <>
      <AdminPageHeader
        title={t(`menu.items.${kind === 'ebook' ? 'ebooks' : 'bundles'}`)}
        subtitle={t(`products.${kind}.subtitle`)}
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
      </div>

      {list.isPending ? (
        <LoadingState label={t(`products.${kind}.loading`)} />
      ) : list.isError && rows.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t(`products.${kind}.errorTitle`)}
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
                icon={<Icon aria-hidden="true" />}
                title={t(filtered ? `products.${kind}.emptyFiltered` : `products.${kind}.empty`)}
                text={filtered ? t('products.emptyFilteredText') : t(`products.${kind}.emptyText`)}
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
              {t('products.loadMoreError')}
            </p>
          ) : null}
        </>
      )}

      {creating ? (
        <CreateProductDialog
          kind={kind}
          onClose={() => setCreating(false)}
          onDone={(product) => void navigate(productPath(kind, product.id))}
        />
      ) : null}
    </>
  );
}

interface CreateProps {
  kind: ProductKind;
  onClose: () => void;
  onDone: (product: ProductDetail) => void;
}

/**
 * Novo ebook ou pacote (`POST /api/v1/ebooks`, `POST /api/v1/bundles`): nasce rascunho e privado,
 * e o editor abre em seguida, com os demais dados.
 */
function CreateProductDialog({ kind, onClose, onDone }: CreateProps) {
  const { t } = useTranslation();
  const api = useApi();
  const queryClient = useQueryClient();
  const formId = useId();
  const message = useProductError();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [missing, setMissing] = useState(false);

  const create = useAction(async (): Promise<ProductDetail> => {
    const body = {
      title: title.trim(),
      ...(summary.trim() === '' ? {} : { summary: summary.trim() }),
    };
    const { data } =
      kind === 'ebook'
        ? await api.POST('/api/v1/ebooks', { body })
        : await api.POST('/api/v1/bundles', { body });
    if (!data) throw new Error('a criação respondeu sem corpo');
    return data;
  });
  const refusal = useProductRefusal(create.error);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const empty = title.trim() === '';
    setMissing(empty);
    if (empty) return;
    const result = await create.run();
    if (result.ok) {
      void queryClient.invalidateQueries({ queryKey: productsKeys.lists(kind) });
      onDone(result.data);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(`products.${kind}.create.title`)}
      description={t(`products.${kind}.create.description`)}
      closeLabel={t('common.close')}
      dismissible={!create.busy}
      footer={
        <>
          <AdminButton disabled={create.busy} onClick={onClose}>
            {t('common.cancel')}
          </AdminButton>
          <AdminButton variant="primary" type="submit" form={formId} disabled={create.busy}>
            {create.busy ? t('courses.create.busy') : t(`products.${kind}.create.submit`)}
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
