import { AdminCard, AdminPageHeader, AdminSection, LoadingState, TextLink } from '@nuva-edu/ui';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { TERMS_PATH } from '../api/terms';
import { PaymentSettingsSection } from '../features/payments/PaymentSettingsSection';
import { useCan } from '../session/session';
import { CertificateSettingsSection } from './certificates/CertificateSettingsSection';

// o editor do template padrão fica fora do JavaScript inicial (spec 006, RNF-03)
const TemplateEditor = lazy(() =>
  import('./certificates/template/TemplateEditor').then((module) => ({
    default: module.TemplateEditor,
  })),
);

/**
 * Configurações (spec 006, mapa de telas): os termos (spec 030), o signatário e o template padrão
 * do certificado (spec 015) e o estado da integração de pagamento (spec 013); escola e marca,
 * login social e e-mail chegam com as próprias specs.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const can = useCan();
  return (
    <>
      <AdminPageHeader title={t('menu.items.settings')} subtitle={t('settings.subtitle')} />
      <AdminSection title={t('settings.legal')}>
        <AdminCard pad className="flex flex-col gap-1">
          <TextLink href={TERMS_PATH}>{t('terms.title')}</TextLink>
          <span className="text-sm text-ink-3">{t('settings.legalText')}</span>
        </AdminCard>
      </AdminSection>
      <CertificateSettingsSection />
      <PaymentSettingsSection />
      {can('settings.manage') ? (
        <Suspense fallback={<LoadingState label={t('certificateTemplate.loading')} />}>
          <TemplateEditor scope={{ kind: 'school' }} />
        </Suspense>
      ) : null}
    </>
  );
}
