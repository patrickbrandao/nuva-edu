import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  ErrorState,
  LoadingState,
  PageTitle,
  ProductCard,
  ProductCardList,
} from '@nuva-edu/ui';
import { BookOpen, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { describeError, type ErrorText } from '../api/errors';
import { ErrorAlert } from '../auth/ErrorAlert';
import { productPath, useDateFormatter } from '../catalog/format';
import { useEbookDownload, useMyEbooks } from '../learning/shelf';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';
import { HOME_PATH } from '../shell/navigation';

function EbooksContent() {
  const { t } = useTranslation();
  const formatDate = useDateFormatter();
  const query = useMyEbooks();
  const { download, pendingId, failure } = useEbookDownload();

  if (query.isPending) {
    return (
      <AdminCard pad aria-busy="true">
        <LoadingState label={t('study.ebooks.loading')} />
      </AdminCard>
    );
  }
  if (query.isError) {
    const error = describeError(t, query.error);
    return (
      <AdminCard pad>
        <ErrorState
          title={t('study.ebooks.errorTitle')}
          text={error.message}
          detail={error.detail}
          retryLabel={t('common.retry')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </AdminCard>
    );
  }
  const ebooks = query.data;
  if (ebooks.length === 0) {
    return (
      <AdminCard>
        <AdminEmpty
          icon={<BookOpen aria-hidden="true" />}
          title={t('study.ebooks.emptyTitle')}
          text={t('study.ebooks.emptyText')}
        >
          <span className="mt-3 flex">
            <AdminButton href={HOME_PATH}>{t('study.start.showcase')}</AdminButton>
          </span>
        </AdminEmpty>
      </AdminCard>
    );
  }

  let error: ErrorText | null = null;
  if (failure?.kind === 'denied') {
    error = { code: 'access_denied', message: t('study.ebooks.accessDenied') };
  } else if (failure?.kind === 'bad_link') {
    error = { code: 'bad_link', message: t('study.ebooks.badLink') };
  } else if (failure?.kind === 'error') {
    error = describeError(t, failure.error);
  }
  const failed = failure ? ebooks.find((ebook) => ebook.id === failure.ebookId) : undefined;

  return (
    <>
      <ErrorAlert
        error={error}
        title={t('study.ebooks.downloadErrorTitle', { title: failed?.title ?? '' })}
      />
      <ProductCardList aria-label={t('study.ebooks.list')}>
        {ebooks.map((ebook) => (
          <ProductCard
            key={ebook.id}
            headingLevel={2}
            title={ebook.title}
            href={productPath('ebook', ebook.slug)}
            coverUrl={ebook.cover?.url}
            summary={ebook.authorName ? t('study.ebooks.author', { name: ebook.authorName }) : null}
            totals={
              typeof ebook.pages === 'number'
                ? [t('product.totals.pages', { count: ebook.pages })]
                : undefined
            }
            meta={
              ebook.expiresAt
                ? t('study.ebooks.accessUntil', { date: formatDate(ebook.expiresAt) })
                : t('study.ebooks.lifetime')
            }
            action={
              <AdminButton
                variant="primary"
                icon={<Download size={14} aria-hidden="true" />}
                disabled={pendingId !== null}
                aria-label={t('study.ebooks.downloadOf', { title: ebook.title })}
                onClick={() => void download(ebook.id)}
              >
                {pendingId === ebook.id
                  ? t('study.ebooks.downloading')
                  : t('study.ebooks.download')}
              </AdminButton>
            }
          />
        ))}
      </ProductCardList>
    </>
  );
}

/**
 * `/meus-ebooks`: os ebooks com direito ativo, com a validade e o botão de download (spec 014,
 * "Estante"). O arquivo é externo: a API confere o acesso e devolve o endereço.
 */
export function MyEbooksPage() {
  const { t } = useTranslation();
  usePageMeta(t('menu.items.myEbooks'), t('study.ebooks.description'));
  return (
    <RequireSession>
      {() => (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
          <PageTitle>{t('menu.items.myEbooks')}</PageTitle>
          <EbooksContent />
        </div>
      )}
    </RequireSession>
  );
}
