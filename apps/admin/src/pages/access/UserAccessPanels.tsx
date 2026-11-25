import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  AdminSection,
  AdminStatus,
  AdminTag,
  LoadingState,
  ProgressBar,
  TextLink,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { GraduationCap, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  accessChanged,
  type EntitlementNode,
  type EntitlementState,
  isRevocable,
  useUserEntitlements,
  useUserProgress,
} from '../../api/access';
import { coursePath } from '../../api/courses';
import { QueryErrorState } from '../../api/problems';
import { formatDate, formatDateTime } from '../../format';
import { useCan } from '../../session/session';
import { GrantDialog } from './GrantDialog';
import { RevokeDialog } from './RevokeDialog';

interface Props {
  user: { id: string; name: string };
}

/**
 * Acessos e progresso na ficha do usuário (spec 006, mapa de telas; specs 010 e 014). Cada
 * seção só aparece com a ação da spec 008 (`entitlement.manage`, `progress.view`); a API é quem
 * autoriza.
 */
export function UserAccessPanels({ user }: Props) {
  const can = useCan();
  return (
    <>
      {can('entitlement.manage') ? <EntitlementsSection user={user} /> : null}
      {can('progress.view') ? <ProgressSection user={user} /> : null}
    </>
  );
}

const STATE_TONES: Record<EntitlementState, string> = {
  active: 'green',
  scheduled: 'gray',
  expired: 'gray',
  revoked: 'red',
};

function EntitlementsSection({ user }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const entitlements = useUserEntitlements(user.id);
  const [granting, setGranting] = useState(false);
  const [revoking, setRevoking] = useState<EntitlementNode | null>(null);

  return (
    <AdminSection
      title={t('access.title')}
      actions={
        <AdminButton size="sm" onClick={() => setGranting(true)}>
          {t('access.grant.open')}
        </AdminButton>
      }
    >
      {entitlements.isPending ? (
        <LoadingState label={t('access.loading')} />
      ) : entitlements.isError ? (
        <QueryErrorState
          error={entitlements.error}
          title={t('access.errorTitle')}
          onRetry={() => void entitlements.refetch()}
          retrying={entitlements.isFetching}
        />
      ) : entitlements.data.length === 0 ? (
        <AdminCard>
          <AdminEmpty
            icon={<KeyRound aria-hidden="true" />}
            title={t('access.empty')}
            text={t('access.emptyText')}
          />
        </AdminCard>
      ) : (
        <AdminCard pad>
          <ul
            aria-label={t('access.treeLabel', { name: user.name })}
            className="m-0 flex list-none flex-col gap-4 p-0"
          >
            {entitlements.data.map((node) => (
              <EntitlementItem key={node.id} node={node} onRevoke={setRevoking} />
            ))}
          </ul>
        </AdminCard>
      )}

      {granting ? (
        <GrantDialog
          user={user}
          onClose={() => setGranting(false)}
          onDone={(entitlement, created) => {
            setGranting(false);
            void accessChanged(queryClient, user.id);
            const title = entitlement.product.title;
            if (created) toast.success(t('access.grant.done', { title }));
            else toast.info(t('access.grant.existing', { title }));
          }}
        />
      ) : null}
      {revoking ? (
        <RevokeDialog
          entitlement={revoking}
          userName={user.name}
          onClose={() => setRevoking(null)}
          onStale={() => void accessChanged(queryClient, user.id)}
          onDone={(revoked) => {
            setRevoking(null);
            void accessChanged(queryClient, user.id);
            toast.success(t('access.revoke.done', { title: revoked.product.title }));
          }}
        />
      ) : null}
    </AdminSection>
  );
}

/** Um direito e, abaixo dele, o que ele liberou em cascata. */
function EntitlementItem({
  node,
  onRevoke,
}: {
  node: EntitlementNode;
  onRevoke: (node: EntitlementNode) => void;
}) {
  const { t } = useTranslation();
  const title = node.product.title;
  const validity =
    node.state === 'revoked' && node.revokedAt
      ? node.revokeReason
        ? t('access.revokedAt', {
            date: formatDate(node.revokedAt),
            reason: t(`access.revokeReasons.${node.revokeReason}`),
          })
        : t('access.revokedAtNoReason', { date: formatDate(node.revokedAt) })
      : node.state === 'scheduled'
        ? t('access.from', { date: formatDate(node.startsAt) })
        : node.expiresAt
          ? t('access.until', { date: formatDate(node.expiresAt) })
          : t('access.lifetime');
  const granted = node.grantedReason
    ? node.grantedBy
      ? t('access.grantedBy', { name: node.grantedBy.name, reason: node.grantedReason })
      : t('access.grantedReason', { reason: node.grantedReason })
    : null;

  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-3">{t(`access.types.${node.product.type}`)}</span>
        <strong className="font-medium text-ink">{title}</strong>
        <AdminTag>{t(`access.sources.${node.source}`)}</AdminTag>
        <AdminStatus tone={STATE_TONES[node.state]}>{t(`access.states.${node.state}`)}</AdminStatus>
        <span className="text-sm text-ink-2">{validity}</span>
        {isRevocable(node) ? (
          <span className="ml-auto">
            <AdminButton
              size="sm"
              aria-label={t('access.revoke.openOf', { title })}
              onClick={() => onRevoke(node)}
            >
              {t('access.revoke.open')}
            </AdminButton>
          </span>
        ) : null}
      </div>
      {granted ? <p className="m-0 text-sm text-ink-3">{granted}</p> : null}
      {node.children.length > 0 ? (
        <ul
          aria-label={t('access.cascadeLabel', { title })}
          className="m-0 mt-1 flex list-none flex-col gap-2 border-l border-line py-0 pr-0 pl-4"
        >
          {node.children.map((child) => (
            <EntitlementItem key={child.id} node={child} onRevoke={onRevoke} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ProgressSection({ user }: Props) {
  const { t } = useTranslation();
  const can = useCan();
  const progress = useUserProgress(user.id);
  // a API responde `404` quando nenhum curso do usuário está ao alcance de quem vê (o
  // instrutor só vê os próprios cursos): é lista vazia, não erro
  const none = isApiError(progress.error) && progress.error.status === 404;
  const items = none ? [] : (progress.data ?? []);

  return (
    <AdminSection title={t('access.progress.title')}>
      {progress.isPending ? (
        <LoadingState label={t('access.progress.loading')} />
      ) : progress.isError && !none ? (
        <QueryErrorState
          error={progress.error}
          title={t('access.progress.errorTitle')}
          onRetry={() => void progress.refetch()}
          retrying={progress.isFetching}
        />
      ) : items.length === 0 ? (
        <AdminCard>
          <AdminEmpty
            icon={<GraduationCap aria-hidden="true" />}
            title={t('access.progress.empty')}
            text={t('access.progress.emptyText')}
          />
        </AdminCard>
      ) : (
        <AdminCard pad>
          <ul
            aria-label={t('access.progress.listLabel', { name: user.name })}
            className="m-0 flex list-none flex-col gap-4 p-0"
          >
            {items.map(({ course, progress: counts, lastActivityAt, certificate }) => (
              <li key={course.id} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {can('course.edit') ? (
                    <TextLink href={coursePath(course.id)} quiet>
                      {course.title}
                    </TextLink>
                  ) : (
                    <strong className="font-medium text-ink">{course.title}</strong>
                  )}
                  <AdminStatus tone={counts.state === 'completed' ? 'green' : 'gray'}>
                    {t(`access.progress.states.${counts.state}`)}
                  </AdminStatus>
                  {certificate ? (
                    <AdminTag>
                      {t('access.progress.certificate', { code: certificate.code })} ·{' '}
                      {t(`access.progress.certificateStates.${certificate.state}`)}
                    </AdminTag>
                  ) : null}
                </div>
                <ProgressBar
                  size="sm"
                  value={counts.percent}
                  label={t('access.progress.barLabel', { title: course.title })}
                  valueText={t('access.progress.lessons', {
                    completed: counts.completedLessons,
                    total: counts.totalLessons,
                  })}
                  caption={t('access.progress.percent', { percent: counts.percent })}
                />
                <p className="m-0 text-sm text-ink-3">
                  {t('access.progress.lessons', {
                    completed: counts.completedLessons,
                    total: counts.totalLessons,
                  })}
                  {' · '}
                  {lastActivityAt
                    ? t('access.progress.lastActivity', { date: formatDateTime(lastActivityAt) })
                    : t('access.progress.noActivity')}
                </p>
              </li>
            ))}
          </ul>
        </AdminCard>
      )}
    </AdminSection>
  );
}
