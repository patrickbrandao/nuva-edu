import { AdminButton, AdminEmpty, PageTitle } from '@nuva-edu/ui';
import { Compass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePageMeta } from '../lib/usePageMeta';
import { HOME_PATH } from '../shell/navigation';

/** Endereço desconhecido (spec 006, casos de erro): aviso e link para a vitrine. */
export function NotFoundPage() {
  const { t } = useTranslation();

  usePageMeta(t('notFound.title'), t('notFound.description'));

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-2 px-4 py-10 sm:py-16">
      <PageTitle align="center">{t('notFound.title')}</PageTitle>
      <AdminEmpty icon={<Compass aria-hidden="true" />} text={t('notFound.text')}>
        <span className="mt-3 flex">
          <AdminButton href={HOME_PATH}>{t('common.backHome')}</AdminButton>
        </span>
      </AdminEmpty>
    </div>
  );
}
