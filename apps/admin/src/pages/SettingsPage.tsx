import { AdminCard, AdminPageHeader, AdminSection, TextLink } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { TERMS_PATH } from '../api/terms';

/**
 * Configurações (spec 006, mapa de telas). Nesta fase só há os termos (spec 030); escola e marca,
 * pagamento, login social e e-mail chegam com as próprias specs.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  return (
    <>
      <AdminPageHeader title={t('menu.items.settings')} subtitle={t('settings.subtitle')} />
      <AdminSection title={t('settings.legal')}>
        <AdminCard pad className="flex flex-col gap-1">
          <TextLink href={TERMS_PATH}>{t('terms.title')}</TextLink>
          <span className="text-sm text-ink-3">{t('settings.legalText')}</span>
        </AdminCard>
      </AdminSection>
    </>
  );
}
