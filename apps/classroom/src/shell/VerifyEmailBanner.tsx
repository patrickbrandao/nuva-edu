import { Alert } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { ResendVerification } from '../auth/ResendVerification';

/**
 * Faixa "confirme seu e-mail" para quem ainda não confirmou (spec 007, "Cadastro por e-mail e
 * senha", item 6), com o reenvio do link. Já está na página desde o carregamento: sem papel de
 * aviso, para não ser anunciada a cada troca de página.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const { t } = useTranslation();
  return (
    // biome-ignore lint/a11y/useValidAriaRole: `role={null}` é a propriedade do Alert que tira o papel, não um atributo
    <Alert
      tone="warning"
      layout="banner"
      role={null}
      title={t('verifyEmail.title')}
      actions={<ResendVerification email={email} size="sm" />}
    >
      {t('verifyEmail.text', { email })}
    </Alert>
  );
}
