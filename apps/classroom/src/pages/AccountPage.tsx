import { AdminCard, PageTitle, TextLink } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';

const SECTIONS = [
  { path: '/conta/perfil', title: 'account.profile', text: 'account.profileText' },
  { path: '/conta/acesso', title: 'account.access', text: 'account.accessText' },
] as const;

/** `/conta`: entrada das configurações da conta (spec 006, `/conta/*`). */
export function AccountPage() {
  const { t } = useTranslation();
  usePageMeta(t('account.title'), t('account.description'));
  return (
    <RequireSession>
      {() => (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8 sm:px-6">
          <PageTitle>{t('account.title')}</PageTitle>
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
            {SECTIONS.map((section) => (
              <li key={section.path}>
                <AdminCard pad className="flex h-full flex-col gap-1">
                  <TextLink href={section.path} className="text-sm font-medium">
                    {t(section.title)}
                  </TextLink>
                  <span className="text-[13px] text-ink-3">{t(section.text)}</span>
                </AdminCard>
              </li>
            ))}
          </ul>
        </div>
      )}
    </RequireSession>
  );
}
