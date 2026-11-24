import { AdminAvatar, AdminStatus, AdminTag, TextLink } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import type { UserSummary } from '../../api/users';

export const STUDENTS_PATH = '/alunos';

export function userPath(id: string): string {
  return `${STUDENTS_PATH}/${encodeURIComponent(id)}`;
}

/** Nome com avatar (ou iniciais), ligado à ficha. */
export function UserNameCell({ user }: { user: Pick<UserSummary, 'id' | 'name' | 'avatarUrl'> }) {
  return (
    <span className="inline-flex items-center gap-2">
      <AdminAvatar name={user.name} src={user.avatarUrl ?? undefined} size={22} />
      <TextLink href={userPath(user.id)} quiet>
        {user.name}
      </TextLink>
    </span>
  );
}

/** Situação: ativo ou suspenso; e-mail não confirmado como etiqueta à parte. */
export function UserStatusCell({ user }: { user: Pick<UserSummary, 'status' | 'emailVerified'> }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <AdminStatus tone={user.status === 'suspended' ? 'red' : 'green'}>
        {t(`users.status.${user.status}`)}
      </AdminStatus>
      {user.emailVerified ? null : <AdminTag>{t('users.status.unverified')}</AdminTag>}
    </span>
  );
}
