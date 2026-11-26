import {
  AdminAvatar,
  AdminButton,
  AdminEmpty,
  AdminMenu,
  AdminSection,
  AdminStatus,
  AdminTable,
  AdminTag,
  Alert,
  LoadingState,
  TextLink,
} from '@nuva-edu/ui';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  DEFAULT_ENTITLEMENT_STATE,
  ENTITLEMENT_STATES,
  type EntitlementState,
  type ProductEntitlement,
  type ProductType,
  useProductEntitlements,
} from '../../api/access';
import { coursePath } from '../../api/courses';
import { QueryErrorState, useProblemText } from '../../api/problems';
import { productPath } from '../../api/products';
import { formatDate } from '../../format';
import { useCan } from '../../session/session';
import { STUDENTS_PATH } from '../users/UserBits';
import { setParam } from './params';

/** Parâmetro do endereço com o estado filtrado; ausente é "ativos". */
export const ACCESS_STATE_PARAM = 'acesso';

const STATE_TONES: Record<EntitlementState, string> = {
  active: 'green',
  scheduled: 'gray',
  expired: 'gray',
  revoked: 'red',
};

interface Props {
  type: ProductType;
  id: string;
}

/**
 * Quem tem acesso a um produto (spec 010; `GET /products/{type}/{id}/entitlements`): um item por
 * direito, raiz ou derivado, com a fonte, o produto de onde veio e o estado. O filtro de estado
 * fica no endereço (spec 006, RF-07). Só aparece com `entitlement.manage`; a API é quem autoriza.
 */
export function ProductAccessSection({ type, id }: Props) {
  const { t } = useTranslation();
  const can = useCan();
  const describe = useProblemText();
  const [params, setParams] = useSearchParams();
  const state =
    ENTITLEMENT_STATES.find((item) => item === params.get(ACCESS_STATE_PARAM)) ??
    DEFAULT_ENTITLEMENT_STATE;
  const list = useProductEntitlements(type, id, state);
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];

  const stateOptions = ENTITLEMENT_STATES.map((item) => ({
    id: item,
    label: t(`access.who.states.${item}`),
  }));
  const stateLabel = stateOptions.find((option) => option.id === state)?.label ?? '';
  const onState = (next: EntitlementState) =>
    setParams(
      (current) =>
        setParam(
          current,
          ACCESS_STATE_PARAM,
          next === DEFAULT_ENTITLEMENT_STATE ? undefined : next,
        ),
      { replace: true },
    );

  const linked = can('users.view_private');
  const viaHref = (via: NonNullable<ProductEntitlement['via']>): string | undefined => {
    if (via.type === 'course') return can('course.edit') ? coursePath(via.id) : undefined;
    return can('ebook_bundle.manage') ? productPath(via.type, via.id) : undefined;
  };

  const validity = (item: ProductEntitlement): string => {
    if (item.state === 'revoked' && item.revokedAt) {
      return t('access.revokedAtNoReason', { date: formatDate(item.revokedAt) });
    }
    if (item.state === 'scheduled') return t('access.from', { date: formatDate(item.startsAt) });
    if (item.state === 'expired' && item.expiresAt) {
      return t('access.who.expiredAt', { date: formatDate(item.expiresAt) });
    }
    return item.expiresAt
      ? t('access.until', { date: formatDate(item.expiresAt) })
      : t('access.lifetime');
  };

  const columns = [
    {
      id: 'student',
      label: t('access.who.columns.student'),
      render: ({ user }: ProductEntitlement) => (
        <span className="inline-flex items-center gap-2">
          <AdminAvatar name={user.name} src={user.avatarUrl ?? undefined} />
          {linked ? (
            <TextLink href={`${STUDENTS_PATH}/${encodeURIComponent(user.id)}`} quiet>
              {user.name}
            </TextLink>
          ) : (
            user.name
          )}
        </span>
      ),
    },
    {
      id: 'source',
      label: t('access.who.columns.source'),
      render: ({ source, via }: ProductEntitlement) => {
        const href = via ? viaHref(via) : undefined;
        return (
          <span className="inline-flex flex-wrap items-center gap-2">
            <AdminTag>{t(`access.sources.${source}`)}</AdminTag>
            {via ? (
              <span className="text-sm text-ink-2">
                {t(`access.who.via.${via.type}`)}{' '}
                {href ? (
                  <TextLink href={href} quiet>
                    {via.title}
                  </TextLink>
                ) : (
                  via.title
                )}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      id: 'state',
      label: t('access.who.columns.state'),
      render: ({ state: value }: ProductEntitlement) => (
        <AdminStatus tone={STATE_TONES[value]}>{t(`access.states.${value}`)}</AdminStatus>
      ),
    },
    {
      id: 'validity',
      label: t('access.who.columns.validity'),
      render: validity,
    },
  ];

  return (
    <AdminSection title={t('access.who.title')}>
      <p className="mt-0 mb-3 text-sm text-ink-3">{t(`access.who.hint.${type}`)}</p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AdminMenu
          options={stateOptions}
          value={state}
          onChange={onState}
          aria-label={t('access.who.stateLabel', { value: stateLabel })}
        />
      </div>

      {list.isPending ? (
        <LoadingState label={t('access.who.loading')} />
      ) : list.isError && rows.length === 0 ? (
        <QueryErrorState
          error={list.error}
          title={t('access.who.errorTitle')}
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
                icon={<KeyRound aria-hidden="true" />}
                title={t(`access.who.empty.${state}`)}
                text={t(`access.who.emptyText.${state}`)}
              />
            }
          />
          {list.isError ? (
            <Alert tone="error" className="mt-4" title={t('access.who.loadMoreError')}>
              {describe(list.error).text}
            </Alert>
          ) : null}
          {list.hasNextPage ? (
            <div className="mt-4">
              <AdminButton
                disabled={list.isFetchingNextPage}
                aria-busy={list.isFetchingNextPage || undefined}
                onClick={() => void list.fetchNextPage()}
              >
                {list.isFetchingNextPage ? t('common.loadingMore') : t('common.loadMore')}
              </AdminButton>
            </div>
          ) : null}
        </>
      )}
    </AdminSection>
  );
}
