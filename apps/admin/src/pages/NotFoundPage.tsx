import { AdminButton, AdminEmpty } from '@nuva-edu/ui';
import { SearchX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HOME_PATH } from '../shell/menu';

/** Endereço que não existe no painel (spec 006, casos de erro). */
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <AdminEmpty
      icon={<SearchX aria-hidden="true" />}
      title={t('notFound.title')}
      text={t('notFound.text')}
    >
      <AdminButton href={HOME_PATH}>{t('common.backHome')}</AdminButton>
    </AdminEmpty>
  );
}
