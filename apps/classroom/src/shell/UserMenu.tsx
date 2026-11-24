import type { ClassroomSession } from '@nuva-edu/api-client/classroom';
import { AdminAvatar, AdminMenu, initialsOf } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useRuntimeConfig } from '../config/useRuntimeConfig';
import { browser } from '../lib/browser';
import { isStaff } from '../session/session';
import { useSignOut } from '../session/useSignOut';
import { ACCOUNT_PATH } from './navigation';

/**
 * Menu do usuário na barra superior: avatar (ou iniciais do nome), "Minha conta",
 * "Administração" (só para a equipe e só com o `adminUrl` do `/config.json`, spec 006,
 * "Configuração de execução") e "Sair".
 */
export function UserMenu({ session }: { session: ClassroomSession }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { adminUrl } = useRuntimeConfig();
  const { signOut } = useSignOut();
  const { user } = session;
  const showAdmin = Boolean(adminUrl) && isStaff(user.role);

  const options = [
    { id: 'account', label: t('shell.account') },
    ...(showAdmin ? [{ id: 'admin', label: t('shell.administration') }] : []),
    'separator' as const,
    { id: 'signOut', label: t('shell.signOut') },
  ];

  const onChange = (id: string) => {
    if (id === 'account') navigate(ACCOUNT_PATH);
    else if (id === 'admin' && adminUrl) browser.assign(adminUrl);
    else if (id === 'signOut') void signOut();
  };

  return (
    <AdminMenu
      variant="ghost"
      align="end"
      options={options}
      onChange={onChange}
      icon={
        <AdminAvatar
          name={user.name}
          src={user.avatarUrl ?? undefined}
          initials={initialsOf(user.name)}
          size={22}
        />
      }
      label={<span className="hidden max-w-32 truncate sm:inline">{user.name}</span>}
      aria-label={t('shell.accountMenu', { name: user.name })}
    />
  );
}
