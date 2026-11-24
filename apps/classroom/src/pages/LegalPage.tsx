import { AdminCard, Alert, ErrorState, LoadingState, PageTitle } from '@nuva-edu/ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../api/errors';
import { type TermsDocument, useLegalDocument } from '../legal/legal';
import { Markdown } from '../lib/markdown';
import { usePageMeta } from '../lib/usePageMeta';

const TITLE_KEYS = { terms: 'pages.terms', privacy: 'pages.privacy' } as const;

/** `/termos` e `/privacidade`: a versão vigente, pública (spec 030, "Termos e aceite"). */
export function LegalPage({ document }: { document: TermsDocument }) {
  const { t, i18n } = useTranslation();
  const query = useLegalDocument(document);
  const title = t(TITLE_KEYS[document]);

  usePageMeta(title, t('legal.description', { document: title }));

  let body: ReactNode;
  if (query.isPending) {
    body = <LoadingState label={t('legal.loading')} />;
  } else if (query.isError) {
    const failure = describeError(t, query.error);
    body = (
      <ErrorState
        title={t('legal.errorTitle')}
        text={failure.message}
        detail={failure.detail}
        retryLabel={t('common.retry')}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  } else if (!query.data) {
    body = (
      <Alert tone="info" title={t('legal.missingTitle')}>
        {t('legal.missingText')}
      </Alert>
    );
  } else {
    const date = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
      new Date(query.data.effectiveAt),
    );
    body = (
      <article className="flex flex-col gap-3">
        <p className="m-0 text-sm text-ink-3">
          {t('legal.versionInfo', { version: query.data.version, date })}
        </p>
        <Markdown source={query.data.bodyMd} className="nuva-prose" />
      </article>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 sm:px-6">
      <PageTitle>{title}</PageTitle>
      <AdminCard pad>{body}</AdminCard>
    </div>
  );
}
