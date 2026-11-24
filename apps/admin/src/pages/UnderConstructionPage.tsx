import { AdminButton, AdminEmpty, AdminPageHeader } from '@nuva-edu/ui';
import { Construction } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HOME_PATH, type MenuItemId } from '../shell/menu';

/** Tela de um item do menu que ainda não foi construído. */
export function UnderConstructionPage({ item }: { item: MenuItemId }) {
  const { t } = useTranslation();
  const page = t(`menu.items.${item}`);
  return (
    <>
      <AdminPageHeader title={page} />
      <AdminEmpty
        icon={<Construction aria-hidden="true" />}
        title={t('underConstruction.title')}
        text={t('underConstruction.text', { page })}
      >
        <AdminButton href={HOME_PATH}>{t('common.backHome')}</AdminButton>
      </AdminEmpty>
    </>
  );
}
