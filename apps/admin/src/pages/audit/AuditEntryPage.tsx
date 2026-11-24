import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminCard,
  AdminDetails,
  AdminEmpty,
  AdminPageHeader,
  AdminSection,
  AdminStatus,
  Alert,
  LoadingState,
} from '@nuva-edu/ui';
import { SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { type AuditEntryDetail, useAuditEntry } from '../../api/audit';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { usePageCrumb } from '../../shell/crumbs';
import { AUDIT_PATH, OUTCOME_TONE } from './AuditPage';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Um registro da auditoria com `details` (spec 028; `GET /api/v1/audit/{id}`). */
export function AuditEntryPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const entry = useAuditEntry(id);
  usePageCrumb(entry.data ? t('audit.entry.crumb', { action: entry.data.action }) : undefined);

  if (entry.isPending) return <LoadingState label={t('audit.entry.loading')} />;
  if (entry.isError && !entry.data) {
    if (isApiError(entry.error) && entry.error.status === 404) {
      return (
        <AdminEmpty
          icon={<SearchX aria-hidden="true" />}
          title={t('audit.entry.notFound')}
          text={t('audit.entry.notFoundText')}
        >
          <AdminButton href={AUDIT_PATH}>{t('audit.entry.back')}</AdminButton>
        </AdminEmpty>
      );
    }
    return (
      <QueryErrorState
        error={entry.error}
        title={t('audit.entry.errorTitle')}
        onRetry={() => void entry.refetch()}
        retrying={entry.isFetching}
      />
    );
  }
  return <EntryView entry={entry.data} />;
}

function EntryView({ entry }: { entry: AuditEntryDetail }) {
  const { t } = useTranslation();
  const none = t('audit.entry.none');
  const items = [
    { label: t('audit.columns.createdAt'), value: formatDateTime(entry.createdAt) },
    {
      label: t('audit.columns.actor'),
      value: entry.actor
        ? `${entry.actor.name}${entry.actorRole ? ` (${t(`roles.${entry.actorRole}`)})` : ''}`
        : t('audit.system'),
    },
    { label: t('audit.columns.action'), value: <code>{entry.action}</code> },
    {
      label: t('audit.columns.target'),
      value:
        [entry.targetName, entry.targetType, entry.targetId].filter(Boolean).join(' · ') || none,
    },
    { label: t('audit.columns.origin'), value: t(`audit.origins.${entry.origin}`) },
    {
      label: t('audit.columns.outcome'),
      value: (
        <AdminStatus tone={OUTCOME_TONE[entry.outcome]}>
          {t(`audit.outcomes.${entry.outcome}`)}
        </AdminStatus>
      ),
    },
    ...(entry.mcpKeyId ? [{ label: t('audit.entry.mcpKey'), value: entry.mcpKeyId }] : []),
    { label: t('audit.entry.ip'), value: entry.ip ?? none },
    { label: t('audit.entry.userAgent'), value: entry.userAgent ?? none },
    { label: t('audit.entry.requestId'), value: entry.requestId ?? none },
  ];

  const details = entry.details;
  const { before, after, truncated, ...rest } = isObject(details) ? details : ({} as Json);
  const hasDiff = before !== undefined || after !== undefined;
  const others = Object.keys(rest).length > 0 ? rest : null;

  return (
    <>
      <AdminPageHeader
        title={t('audit.entry.title')}
        subtitle={`${entry.action} · ${formatDateTime(entry.createdAt)}`}
        actions={<AdminButton href={AUDIT_PATH}>{t('audit.entry.back')}</AdminButton>}
      />
      <div className="flex flex-col gap-6">
        <AdminSection title={t('audit.entry.summary')}>
          <AdminCard pad>
            <AdminDetails wrap items={items} />
          </AdminCard>
        </AdminSection>
        <AdminSection title={t('audit.entry.details')}>
          {truncated === true ? (
            <Alert tone="info" className="mb-3">
              {t('audit.entry.truncated')}
            </Alert>
          ) : null}
          {details == null ? (
            <AdminCard pad>
              <p className="m-0 text-ink-3">{t('audit.entry.noDetails')}</p>
            </AdminCard>
          ) : (
            <div className="flex flex-col gap-4">
              {hasDiff ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <JsonBlock title={t('audit.entry.before')} value={before ?? null} />
                  <JsonBlock title={t('audit.entry.after')} value={after ?? null} />
                </div>
              ) : null}
              {others || !hasDiff ? (
                <JsonBlock
                  title={hasDiff ? t('audit.entry.other') : t('audit.entry.content')}
                  value={hasDiff ? others : details}
                />
              ) : null}
            </div>
          )}
        </AdminSection>
      </div>
    </>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-1">
      <figcaption className="text-sm font-medium text-ink">{title}</figcaption>
      <pre className="nuva-json">{JSON.stringify(value, null, 2)}</pre>
    </figure>
  );
}
