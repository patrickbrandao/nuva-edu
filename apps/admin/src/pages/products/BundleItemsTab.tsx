import {
  AdminButton,
  AdminDetails,
  AdminMenu,
  AdminSearch,
  AdminSection,
  AdminStatus,
  AdminTag,
  Dialog,
  SortableList,
  TextLink,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { type AccessMode, coursePath, useCoursesList } from '../../api/courses';
import { useMeta } from '../../api/meta';
import { QueryErrorState } from '../../api/problems';
import {
  BUNDLE_ITEMS_MAX,
  type BundleDetail,
  type BundleItem,
  type BundleItemRef,
  productChanged,
  productPath,
  productsKeys,
  putBundleItems,
  useProductsList,
} from '../../api/products';
import { ConfirmAction, useSortableLabels } from '../courses/CourseBits';
import { formatPrice } from '../courses/format';
import { useProductError } from './errors';

const itemKey = (item: BundleItemRef) => `${item.productType}:${item.productId}`;

/**
 * Itens do pacote (spec 009, "Pacotes"): cursos e ebooks, na ordem em que aparecem. Cada mudança
 * grava a lista inteira (`PUT /api/v1/bundles/{id}/items`). Remover um item pede confirmação com
 * o número de alunos que têm o pacote, porque a cascata de acesso deles é recalculada.
 */
export function BundleItemsTab({ bundle }: { bundle: BundleDetail }) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const meta = useMeta();
  const queryClient = useQueryClient();
  const message = useProductError();
  const labels = useSortableLabels();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<BundleItem | null>(null);
  const save = useAction((items: readonly BundleItemRef[]) =>
    putBundleItems(api, bundle.id, items),
  );
  const currency = meta.data?.currency;
  const archived = bundle.archivedAt !== null;
  const full = bundle.items.length >= BUNDLE_ITEMS_MAX;

  const reorder = async (next: BundleItem[]) => {
    // a ordem nova aparece antes de a API confirmar; se ela recusar, o pacote é lido de novo
    queryClient.setQueryData<BundleDetail>(productsKeys.detail('bundle', bundle.id), (current) =>
      current ? { ...current, items: next } : current,
    );
    const result = await save.run(next);
    if (result.ok) productChanged(queryClient, 'bundle', result.data);
    else {
      toast.error(message(result.error), { title: t('products.items.reorderError') });
      void queryClient.invalidateQueries({ queryKey: productsKeys.detail('bundle', bundle.id) });
    }
  };

  const price = (cents: number | null) =>
    cents !== null && currency ? formatPrice(cents, currency) : t('courses.data.noPrice');

  const row = (item: BundleItem) => {
    const state = item.archived ? 'archived' : item.status;
    return (
      <div className="flex w-full flex-wrap items-center gap-2">
        <AdminTag>{t(`products.links.types.${item.productType}`)}</AdminTag>
        <TextLink
          href={
            item.productType === 'course'
              ? coursePath(item.productId)
              : productPath('ebook', item.productId)
          }
          quiet
        >
          {item.title}
        </TextLink>
        <AdminStatus tone={state === 'published' ? 'green' : state === 'archived' ? 'red' : 'gray'}>
          {t(`courses.status.${state}`)}
        </AdminStatus>
        <span className="text-sm text-ink-3">
          {item.accessMode === 'paid' && item.priceCents !== null && currency
            ? t('courses.accessWithPrice', {
                mode: t('courses.accessModes.paid'),
                price: formatPrice(item.priceCents, currency),
              })
            : t(`courses.accessModes.${item.accessMode as AccessMode}`)}
        </span>
        <span className="ml-auto">
          <AdminButton
            size="sm"
            disabled={save.busy}
            aria-label={t('products.items.removeOf', { title: item.title })}
            onClick={() => setRemoving(item)}
          >
            {t('products.items.remove')}
          </AdminButton>
        </span>
      </div>
    );
  };

  return (
    <AdminSection
      title={t('products.items.title')}
      actions={
        <AdminButton variant="primary" disabled={full} onClick={() => setAdding(true)}>
          {t('products.items.add')}
        </AdminButton>
      }
    >
      <AdminDetails
        wrap
        className="mb-4"
        items={[
          { label: t('products.items.count'), value: String(bundle.items.length) },
          { label: t('products.items.itemsPrice'), value: price(bundle.itemsPriceCents) },
          {
            label: t('products.items.bundlePrice'),
            value:
              bundle.accessMode === 'paid'
                ? price(bundle.priceCents)
                : t(`courses.accessModes.${bundle.accessMode}`),
          },
          {
            label: t('products.items.students'),
            value: t('products.items.studentCount', { count: bundle.studentCount }),
          },
        ]}
      />
      {bundle.items.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">{t('products.items.empty')}</p>
      ) : (
        <SortableList
          aria-label={t('products.items.list')}
          items={bundle.items}
          getId={itemKey}
          getLabel={(item) => item.title}
          onReorder={(next) => void reorder(next)}
          labels={labels}
          disabled={save.busy || archived}
          renderItem={row}
        />
      )}
      {full ? (
        <p className="mt-3 mb-0 text-sm text-ink-3">
          {t('products.items.full', { max: BUNDLE_ITEMS_MAX })}
        </p>
      ) : null}

      {removing ? (
        <ConfirmAction
          destructive
          title={t('products.items.removeTitle')}
          itemName={removing.title}
          message={t('products.items.removeText', { count: bundle.studentCount })}
          confirmLabel={t('products.items.removeConfirm')}
          busyLabel={t('products.items.removing')}
          action={() =>
            putBundleItems(
              api,
              bundle.id,
              bundle.items.filter((item) => itemKey(item) !== itemKey(removing)),
            )
          }
          describeError={message}
          onClose={() => setRemoving(null)}
          onDone={(result) => {
            productChanged(queryClient, 'bundle', result);
            toast.success(t('products.items.removed', { title: removing.title }));
          }}
        />
      ) : null}
      {adding ? <AddItemDialog bundle={bundle} onClose={() => setAdding(false)} /> : null}
    </AdminSection>
  );
}

type ItemType = BundleItem['productType'];
const ITEM_TYPES: readonly ItemType[] = ['course', 'ebook'];

interface Candidate {
  id: string;
  title: string;
  status: 'draft' | 'published';
  archivedAt: string | null;
}

/** Escolher cursos e ebooks do catálogo para o pacote; cada "Adicionar" grava na hora. */
function AddItemDialog({ bundle, onClose }: { bundle: BundleDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const message = useProductError();
  const [type, setType] = useState<ItemType>('course');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState<string | undefined>(undefined);
  const query = { ...(q ? { q } : {}), sort: 'title' as const };
  const courses = useCoursesList(query);
  const ebooks = useProductsList('ebook', query, type === 'ebook');
  const list = type === 'course' ? courses : ebooks;
  const rows: Candidate[] = list.data?.pages.flatMap((page) => page.items as Candidate[]) ?? [];
  const included = new Set(bundle.items.map(itemKey));
  const full = bundle.items.length >= BUNDLE_ITEMS_MAX;

  const add = useAction((item: BundleItemRef) =>
    putBundleItems(api, bundle.id, [...bundle.items, item]),
  );
  const onAdd = async (candidate: Candidate) => {
    const result = await add.run({ productType: type, productId: candidate.id });
    if (result.ok) {
      productChanged(queryClient, 'bundle', result.data);
      toast.success(t('products.items.added', { title: candidate.title }));
    } else {
      toast.error(message(result.error), { title: t('products.items.addError') });
    }
  };

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    setQ(search.trim() || undefined);
  };
  const typeOptions = ITEM_TYPES.map((id) => ({ id, label: t(`products.items.types.${id}`) }));

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={t('products.items.addTitle')}
      description={t('products.items.addDescription')}
      closeLabel={t('common.close')}
      dismissible={!add.busy}
      footer={<AdminButton onClick={onClose}>{t('products.items.addDone')}</AdminButton>}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <AdminMenu
          options={typeOptions}
          value={type}
          onChange={(id: ItemType) => setType(id)}
          aria-label={t('products.items.typeLabel', {
            value: t(`products.items.types.${type}`),
          })}
        />
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
      </div>
      {list.isPending ? (
        <p role="status" className="m-0 text-sm text-ink-3">
          {t('products.items.searching')}
        </p>
      ) : list.isError && rows.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('products.items.searchError')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : rows.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">{t('products.items.noCandidates')}</p>
      ) : (
        <ul
          aria-label={t('products.items.candidates')}
          className="m-0 flex list-none flex-col gap-2 p-0"
        >
          {rows.map((candidate) => {
            const state = candidate.archivedAt ? 'archived' : candidate.status;
            return (
              <li
                key={candidate.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2"
              >
                <span>{candidate.title}</span>
                <AdminStatus
                  tone={state === 'published' ? 'green' : state === 'archived' ? 'red' : 'gray'}
                >
                  {t(`courses.status.${state}`)}
                </AdminStatus>
                <span className="ml-auto">
                  {included.has(itemKey({ productType: type, productId: candidate.id })) ? (
                    <AdminTag>{t('products.items.included')}</AdminTag>
                  ) : (
                    <AdminButton
                      size="sm"
                      disabled={add.busy || full}
                      aria-label={t('products.items.addOf', { title: candidate.title })}
                      onClick={() => void onAdd(candidate)}
                    >
                      {t('products.items.addOne')}
                    </AdminButton>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {list.hasNextPage ? (
        <div className="mt-3">
          <AdminButton
            disabled={list.isFetchingNextPage}
            aria-busy={list.isFetchingNextPage || undefined}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
          </AdminButton>
        </div>
      ) : null}
    </Dialog>
  );
}
