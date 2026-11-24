import { AdminEmpty } from '@nuva-edu/ui';
import { Construction } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LinkButton } from '../lib/LinkButton';
import { usePageMeta } from '../lib/usePageMeta';
import { HOME_PATH, type TextKey } from '../shell/navigation';

/** Página das telas do mapa que ainda não foram construídas. */
export function UnderConstructionPage({ titleKey }: { titleKey: TextKey }) {
  const { t } = useTranslation();
  const page = t(titleKey);

  usePageMeta(page, t('construction.description', { page }));

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-2 px-4 py-10 sm:py-16">
      <h1 className="m-0 text-center text-2xl font-semibold tracking-tight text-ink">{page}</h1>
      <AdminEmpty
        icon={<Construction aria-hidden="true" />}
        title={t('construction.title')}
        text={t('construction.text', { page })}
      >
        <span className="mt-3 flex">
          <LinkButton to={HOME_PATH}>{t('common.backHome')}</LinkButton>
        </span>
      </AdminEmpty>
    </div>
  );
}
