import {
  AdminButton,
  AdminEmpty,
  AdminField,
  AdminMenu,
  AdminPageHeader,
  AdminStatus,
  AdminTable,
  Alert,
  LoadingState,
  TextLink,
} from '@nuva-edu/ui';
import { ScrollText, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  AUDIT_ACTION_PATTERN,
  AUDIT_ORIGINS,
  AUDIT_OUTCOMES,
  type AuditEntry,
  type AuditOrigin,
  type AuditOutcome,
  type AuditQuery,
  useAuditList,
} from '../../api/audit';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { HOME_PATH } from '../../shell/menu';

export const AUDIT_PATH = '/auditoria';
const ALL = 'all';
const MAX_DAYS = 366;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Início do dia (hora local) de `AAAA-MM-DD`, em ISO; `plusDays` para o fim exclusivo. */
function dayStart(date: string, plusDays = 0): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + plusDays);
  return value.toISOString();
}

function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

export const OUTCOME_TONE: Record<AuditOutcome, 'green' | 'amber' | 'red'> = {
  ok: 'green',
  denied: 'amber',
  error: 'red',
};

interface Draft {
  from: string;
  to: string;
  action: string;
  targetType: string;
  targetId: string;
}

/**
 * Auditoria (spec 028, "Consulta"; só `audit.view`): período, ator, ação (exata ou `prefixo.*`),
 * alvo, origem e resultado, com "carregar mais" por cursor. Os filtros ficam no endereço; cada
 * consulta grava `audit.search`, por isso a lista só é buscada ao aplicar os filtros.
 */
export function AuditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const actorName = (location.state as { actorName?: string } | null)?.actorName;

  const applied = {
    from: DATE.test(params.get('from') ?? '') ? (params.get('from') as string) : '',
    to: DATE.test(params.get('to') ?? '') ? (params.get('to') as string) : '',
    action: params.get('action') ?? '',
    targetType: params.get('targetType') ?? '',
    targetId: params.get('targetId') ?? '',
    actorId: params.get('actorId') ?? '',
    origin: pick(params.get('origin'), AUDIT_ORIGINS),
    outcome: pick(params.get('outcome'), AUDIT_OUTCOMES),
  };
  const [draft, setDraft] = useState<Draft>(applied);
  const [invalid, setInvalid] = useState<Partial<Record<keyof Draft, string>>>({});
  const paramsKey = params.toString();
  // biome-ignore lint/correctness/useExhaustiveDependencies: o rascunho volta ao aplicado quando o endereço muda
  useEffect(() => {
    setDraft(applied);
    setInvalid({});
  }, [paramsKey]);

  const query: Omit<AuditQuery, 'cursor' | 'limit'> = {
    ...(applied.from ? { from: dayStart(applied.from) } : {}),
    ...(applied.to ? { to: dayStart(applied.to, 1) } : {}),
    ...(applied.actorId ? { actorId: applied.actorId } : {}),
    ...(applied.action ? { action: applied.action } : {}),
    ...(applied.targetType ? { targetType: applied.targetType } : {}),
    ...(applied.targetId ? { targetId: applied.targetId } : {}),
    ...(applied.origin ? { origin: applied.origin } : {}),
    ...(applied.outcome ? { outcome: applied.outcome } : {}),
  };
  const list = useAuditList(query);
  const rows: AuditEntry[] = list.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = paramsKey !== '';

  const setParam = (key: string, value: string | undefined, state?: unknown) => {
    const next = new URLSearchParams(params);
    if (value && value !== ALL) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true, state });
  };

  const onApply = (event: FormEvent) => {
    event.preventDefault();
    const errors: Partial<Record<keyof Draft, string>> = {};
    const action = draft.action.trim();
    if (action && !AUDIT_ACTION_PATTERN.test(action))
      errors.action = t('audit.filters.actionInvalid');
    if (draft.from && draft.to) {
      const days =
        (Date.parse(dayStart(draft.to, 1)) - Date.parse(dayStart(draft.from))) / 86_400_000;
      if (days <= 0) errors.to = t('audit.filters.periodOrder');
      else if (days > MAX_DAYS) errors.to = t('audit.filters.periodTooLong', { days: MAX_DAYS });
    }
    setInvalid(errors);
    if (Object.keys(errors).length > 0) return;
    const next = new URLSearchParams(params);
    const fields: [keyof Draft, string][] = [
      ['from', draft.from],
      ['to', draft.to],
      ['action', action],
      ['targetType', draft.targetType.trim()],
      ['targetId', draft.targetId.trim()],
    ];
    for (const [key, value] of fields) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true, state: location.state });
  };

  const originOptions = [
    { id: ALL, label: t('audit.filters.allOrigins') },
    ...AUDIT_ORIGINS.map((id: AuditOrigin) => ({ id, label: t(`audit.origins.${id}`) })),
  ];
  const outcomeOptions = [
    { id: ALL, label: t('audit.filters.allOutcomes') },
    ...AUDIT_OUTCOMES.map((id: AuditOutcome) => ({ id, label: t(`audit.outcomes.${id}`) })),
  ];

  const actorCell = (entry: AuditEntry) =>
    entry.actor ? (
      <span className="inline-flex flex-col">
        <button
          type="button"
          className="nuva-linkbutton"
          aria-label={t('audit.filters.byActor', { name: entry.actor.name })}
          onClick={() => setParam('actorId', entry.actor?.id, { actorName: entry.actor?.name })}
        >
          {entry.actor.name}
        </button>
        {entry.actorRole ? (
          <span className="text-xs text-ink-3">{t(`roles.${entry.actorRole}`)}</span>
        ) : null}
      </span>
    ) : (
      <span className="text-ink-3">{t('audit.system')}</span>
    );

  const targetText = (entry: AuditEntry) =>
    entry.targetName ??
    (entry.targetType ? [entry.targetType, entry.targetId].filter(Boolean).join(' ') : '—');

  const columns = [
    {
      id: 'createdAt',
      label: t('audit.columns.createdAt'),
      render: (entry: AuditEntry) => (
        <TextLink
          href={`${AUDIT_PATH}/${encodeURIComponent(entry.id)}`}
          aria-label={t('audit.openEntry', {
            action: entry.action,
            date: formatDateTime(entry.createdAt),
          })}
        >
          {formatDateTime(entry.createdAt)}
        </TextLink>
      ),
    },
    { id: 'actor', label: t('audit.columns.actor'), render: actorCell },
    {
      id: 'action',
      label: t('audit.columns.action'),
      render: (entry: AuditEntry) => <code>{entry.action}</code>,
    },
    { id: 'target', label: t('audit.columns.target'), render: targetText },
    {
      id: 'origin',
      label: t('audit.columns.origin'),
      render: (entry: AuditEntry) => t(`audit.origins.${entry.origin}`),
    },
    {
      id: 'outcome',
      label: t('audit.columns.outcome'),
      render: (entry: AuditEntry) => (
        <AdminStatus tone={OUTCOME_TONE[entry.outcome]}>
          {t(`audit.outcomes.${entry.outcome}`)}
        </AdminStatus>
      ),
    },
  ];

  return (
    <>
      <AdminPageHeader title={t('menu.items.audit')} subtitle={t('audit.subtitle')} />

      <form
        className="mb-4 flex flex-col gap-3"
        noValidate
        aria-label={t('audit.filters.label')}
        onSubmit={onApply}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <AdminField
            label={t('audit.filters.from')}
            type="date"
            value={draft.from}
            onChange={(from: string) => setDraft({ ...draft, from })}
          />
          <AdminField
            label={t('audit.filters.to')}
            type="date"
            value={draft.to}
            onChange={(to: string) => setDraft({ ...draft, to })}
            error={invalid.to}
          />
          <AdminField
            label={t('audit.filters.action')}
            hint={invalid.action ? undefined : t('audit.filters.actionHint')}
            value={draft.action}
            onChange={(action: string) => setDraft({ ...draft, action })}
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            error={invalid.action}
          />
          <AdminField
            label={t('audit.filters.targetType')}
            value={draft.targetType}
            onChange={(targetType: string) => setDraft({ ...draft, targetType })}
            maxLength={64}
            autoComplete="off"
          />
          <AdminField
            label={t('audit.filters.targetId')}
            value={draft.targetId}
            onChange={(targetId: string) => setDraft({ ...draft, targetId })}
            maxLength={128}
            autoComplete="off"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AdminMenu
            options={originOptions}
            value={applied.origin ?? ALL}
            onChange={(id: string) => setParam('origin', id, location.state)}
            aria-label={t('audit.filters.originLabel', {
              value: originOptions.find((o) => o.id === (applied.origin ?? ALL))?.label,
            })}
          />
          <AdminMenu
            options={outcomeOptions}
            value={applied.outcome ?? ALL}
            onChange={(id: string) => setParam('outcome', id, location.state)}
            aria-label={t('audit.filters.outcomeLabel', {
              value: outcomeOptions.find((o) => o.id === (applied.outcome ?? ALL))?.label,
            })}
          />
          {applied.actorId ? (
            <AdminButton
              size="sm"
              iconEnd={<X size={14} aria-hidden="true" />}
              aria-label={t('audit.filters.removeActor', { name: actorName ?? applied.actorId })}
              onClick={() => setParam('actorId', undefined)}
            >
              {t('audit.filters.actor', { name: actorName ?? applied.actorId })}
            </AdminButton>
          ) : null}
          <AdminButton variant="primary" type="submit">
            {t('audit.filters.apply')}
          </AdminButton>
          {filtered ? (
            <AdminButton onClick={() => void navigate(AUDIT_PATH, { replace: true })}>
              {t('audit.filters.clear')}
            </AdminButton>
          ) : null}
        </div>
        {filtered ? null : <p className="m-0 text-xs text-ink-3">{t('audit.defaultPeriod')}</p>}
      </form>

      {list.isPending ? (
        <LoadingState label={t('audit.loading')} />
      ) : list.isError && rows.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('audit.errorTitle')}
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
                icon={<ScrollText aria-hidden="true" />}
                title={t('audit.empty')}
                text={filtered ? t('audit.emptyFilteredText') : t('audit.emptyText')}
              >
                {filtered ? (
                  <AdminButton onClick={() => void navigate(AUDIT_PATH, { replace: true })}>
                    {t('audit.filters.clear')}
                  </AdminButton>
                ) : (
                  <AdminButton href={HOME_PATH}>{t('common.backHome')}</AdminButton>
                )}
              </AdminEmpty>
            }
          />
          {list.hasNextPage ? (
            <div className="mt-4 flex justify-center">
              <AdminButton
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
              </AdminButton>
            </div>
          ) : null}
          {list.isFetchNextPageError ? (
            <Alert tone="error" className="mt-2">
              {t('audit.loadMoreError')}
            </Alert>
          ) : null}
        </>
      )}
    </>
  );
}
