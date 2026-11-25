import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminEmpty,
  AdminPageHeader,
  AdminTabs,
  Alert,
  LoadingState,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import {
  deleteProduct,
  isEbook,
  PRODUCTS_PATH,
  type ProductDetail,
  type ProductKind,
  postProductAction,
  productChanged,
  productsKeys,
  useBundle,
  useEbook,
} from '../../api/products';
import { formatDateTime } from '../../format';
import { useCan } from '../../session/session';
import { usePageCrumb } from '../../shell/crumbs';
import { ConfirmAction, CourseStatusCell } from '../courses/CourseBits';
import { BundleItemsTab } from './BundleItemsTab';
import { EbookTargetsTab } from './EbookTargetsTab';
import { useProductError } from './errors';
import { ProductDataTab } from './ProductDataTab';

const TAB_PARAM = 'aba';
type TabId = 'dados' | 'vinculos' | 'itens';
type ConfirmName = 'publish' | 'unpublish' | 'archive' | 'unarchive' | 'delete';

/**
 * Editor de ebook (`/ebooks/:id`) e de pacote (`/pacotes/:id`), spec 009: dados e capa, vínculos
 * do ebook ou itens do pacote, e as ações de publicação. Arquivar é só de quem tem
 * `product.archive` (admin); a API confere cada ação.
 */
export function ProductEditorPage({ kind }: { kind: ProductKind }) {
  const { id = '' } = useParams();
  return kind === 'ebook' ? <EbookLoader id={id} /> : <BundleLoader id={id} />;
}

function EbookLoader({ id }: { id: string }) {
  return <Loaded kind="ebook" query={useEbook(id)} />;
}

function BundleLoader({ id }: { id: string }) {
  return <Loaded kind="bundle" query={useBundle(id)} />;
}

interface LoadedProps {
  kind: ProductKind;
  query: {
    data: ProductDetail | undefined;
    error: unknown;
    isPending: boolean;
    isError: boolean;
    isFetching: boolean;
    refetch: () => unknown;
  };
}

function Loaded({ kind, query }: LoadedProps) {
  const { t } = useTranslation();
  usePageCrumb(query.data?.title);

  if (query.isPending) return <LoadingState label={t(`products.${kind}.editor.loading`)} />;
  if (!query.data) {
    if (isApiError(query.error) && query.error.status === 404) {
      return (
        <AdminEmpty
          icon={<SearchX aria-hidden="true" />}
          title={t(`products.${kind}.editor.notFound`)}
          text={t(`products.${kind}.editor.notFoundText`)}
        >
          <AdminButton href={PRODUCTS_PATH[kind]}>
            {t(`products.${kind}.editor.backToList`)}
          </AdminButton>
        </AdminEmpty>
      );
    }
    return (
      <QueryErrorState
        error={query.error}
        title={t(`products.${kind}.editor.errorTitle`)}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  return <ProductEditor kind={kind} product={query.data} />;
}

function ProductEditor({ kind, product }: { kind: ProductKind; product: ProductDetail }) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const can = useCan();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const message = useProductError();
  const [params, setParams] = useSearchParams();
  const [confirm, setConfirm] = useState<ConfirmName | null>(null);
  const close = () => setConfirm(null);

  const archived = product.archivedAt !== null;
  const published = product.status === 'published';
  const canManage = can('ebook_bundle.manage');
  const canArchive = can('product.archive');
  // "Excluir" só sem vínculos (spec 009): com alunos, o caminho é arquivar; a API confere o resto
  const canDelete = canManage && product.studentCount === 0;

  const second: TabId = kind === 'ebook' ? 'vinculos' : 'itens';
  const tabs: readonly TabId[] = ['dados', second];
  const tab: TabId = params.get(TAB_PARAM) === second ? second : 'dados';
  const selectTab = (next: TabId) =>
    setParams(next === 'dados' ? {} : { [TAB_PARAM]: next }, { replace: true });

  const done = (text: string) => (result: ProductDetail) => {
    productChanged(queryClient, kind, result);
    toast.success(text);
  };
  const post = (action: Exclude<ConfirmName, 'delete'>) => () =>
    postProductAction(api, kind, product.id, action);

  const actions = (
    <>
      {!archived && !published && canManage ? (
        <AdminButton variant="primary" onClick={() => setConfirm('publish')}>
          {t('courses.publish.open')}
        </AdminButton>
      ) : null}
      {!archived && published && canManage ? (
        <AdminButton onClick={() => setConfirm('unpublish')}>
          {t('courses.unpublish.open')}
        </AdminButton>
      ) : null}
      {canArchive ? (
        <AdminButton onClick={() => setConfirm(archived ? 'unarchive' : 'archive')}>
          {t(archived ? 'courses.unarchive.open' : 'courses.archive.open')}
        </AdminButton>
      ) : null}
      {canDelete ? (
        <AdminButton onClick={() => setConfirm('delete')}>{t('courses.delete.open')}</AdminButton>
      ) : null}
    </>
  );

  return (
    <>
      <AdminPageHeader
        title={product.title}
        subtitle={<CourseStatusCell course={{ ...product, reviewRequestedAt: null }} />}
        actions={actions}
      />
      {archived ? (
        <Alert tone="warning" className="mb-4" title={t(`products.${kind}.archive.noticeTitle`)}>
          {t('courses.archive.notice', { date: formatDateTime(product.archivedAt) })}
        </Alert>
      ) : null}
      <AdminTabs
        className="mb-4"
        label={t(`products.${kind}.editor.tabsLabel`)}
        tabs={tabs.map((item) => ({ id: item, label: t(`products.tabs.${item}`) }))}
        value={tab}
        onChange={selectTab}
      />
      {tab === 'dados' ? (
        <ProductDataTab
          kind={kind}
          product={product}
          canSetAccess={can('product.set_access')}
          canSetPrice={can('product.set_price')}
        />
      ) : isEbook(product) ? (
        <EbookTargetsTab ebook={product} />
      ) : (
        <BundleItemsTab bundle={product} />
      )}

      {confirm === 'publish' ? (
        <ConfirmAction
          title={t(`products.${kind}.publish.title`)}
          itemName={product.title}
          message={t('courses.publish.text')}
          confirmLabel={t('courses.publish.open')}
          busyLabel={t('courses.publish.busy')}
          action={post('publish')}
          describeError={message}
          onClose={close}
          onDone={done(t(`products.${kind}.publish.done`))}
        />
      ) : null}
      {confirm === 'unpublish' ? (
        <ConfirmAction
          destructive
          title={t(`products.${kind}.unpublish.title`)}
          itemName={product.title}
          message={t('courses.unpublish.text', { count: product.studentCount })}
          confirmLabel={t('courses.unpublish.open')}
          busyLabel={t('courses.unpublish.busy')}
          action={post('unpublish')}
          describeError={message}
          onClose={close}
          onDone={done(t(`products.${kind}.unpublish.done`))}
        />
      ) : null}
      {confirm === 'archive' ? (
        <ConfirmAction
          destructive
          title={t(`products.${kind}.archive.title`)}
          itemName={product.title}
          message={t('courses.archive.text', { count: product.studentCount })}
          confirmLabel={t('courses.archive.open')}
          busyLabel={t('courses.archive.busy')}
          action={post('archive')}
          describeError={message}
          onClose={close}
          onDone={done(t(`products.${kind}.archive.done`))}
        />
      ) : null}
      {confirm === 'unarchive' ? (
        <ConfirmAction
          title={t(`products.${kind}.unarchive.title`)}
          itemName={product.title}
          message={t('courses.unarchive.text')}
          confirmLabel={t('courses.unarchive.open')}
          busyLabel={t('courses.unarchive.busy')}
          action={post('unarchive')}
          describeError={message}
          onClose={close}
          onDone={done(t(`products.${kind}.unarchive.done`))}
        />
      ) : null}
      {confirm === 'delete' ? (
        <ConfirmAction
          destructive
          title={t(`products.${kind}.delete.title`)}
          itemName={product.title}
          message={t(`products.${kind}.delete.text`)}
          confirmLabel={t('courses.delete.open')}
          busyLabel={t('courses.deleting')}
          action={() => deleteProduct(api, kind, product.id)}
          describeError={message}
          onClose={close}
          onDone={() => {
            toast.success(t(`products.${kind}.delete.done`, { title: product.title }));
            void navigate(PRODUCTS_PATH[kind]);
            void queryClient.invalidateQueries({ queryKey: productsKeys.lists(kind) });
          }}
        />
      ) : null}
    </>
  );
}
