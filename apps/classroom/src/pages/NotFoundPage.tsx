import { AdminEmpty } from '@nuva-edu/ui';
import { Compass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LinkButton } from '../lib/LinkButton';
import { usePageMeta } from '../lib/usePageMeta';
import { HOME_PATH } from '../shell/navigation';

/** Endereço desconhecido (spec 006, casos de erro): aviso e link para a vitrine. */
export function NotFoundPage() {
  const { t } = useTranslation();

  usePageMeta(t('notFound.title'), t('notFound.description'));

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-2 px-4 py-10 sm:py-16">
      <h1 className="m-0 text-center text-2xl font-semibold tracking-tight text-ink">
        {t('notFound.title')}
      </h1>
      <AdminEmpty icon={<Compass aria-hidden="true" />} text={t('notFound.text')}>
        <span className="mt-3 flex">
          <LinkButton to={HOME_PATH}>{t('common.backHome')}</LinkButton>
        </span>
      </AdminEmpty>
    </div>
  );
}
