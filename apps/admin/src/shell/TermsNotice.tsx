import { AdminButton, Alert } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { hasPublished, TERMS_PATH, useTermsVersions } from '../api/terms';
import { useCan } from '../session/session';

/**
 * Aviso fixo no painel enquanto os Termos de Uso ou a Política de Privacidade não têm versão
 * publicada (spec 030, "Termos e aceite"). Só para quem pode publicá-los (`settings.manage`).
 * Se a lista não carregar, não há aviso: a tela de termos mostra o erro.
 */
export function TermsNotice() {
  const { t } = useTranslation();
  const can = useCan();
  const allowed = can('settings.manage');
  const terms = useTermsVersions('terms', allowed);
  const privacy = useTermsVersions('privacy', allowed);

  if (!allowed) return null;
  const missing = [
    terms.data && !hasPublished(terms.data) ? t('terms.documents.terms') : null,
    privacy.data && !hasPublished(privacy.data) ? t('terms.documents.privacy') : null,
  ].filter((name): name is string => name !== null);
  if (missing.length === 0) return null;

  return (
    <Alert
      tone="warning"
      layout="banner"
      title={t('termsNotice.title')}
      actions={
        <AdminButton size="sm" href={TERMS_PATH}>
          {t('termsNotice.action')}
        </AdminButton>
      }
    >
      {t('termsNotice.text', { documents: missing.join(t('termsNotice.and')) })}
    </Alert>
  );
}
