import { AdminButton, useToast } from '@nuva-edu/ui';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../api/errors';
import { useCertificateDownload } from './certificates';

interface CertificateDownloadProps {
  certificateId: string;
  code: string | null;
  /** Título do curso: entra no nome lido do botão. */
  title: string;
  variant?: 'default' | 'primary';
  size?: 'sm' | 'md';
}

/**
 * "Baixar certificado": o PDF vem pela API, com a sessão (spec 015, RF-04). PDF ainda não gerado
 * avisa "em preparação"; outra falha, o erro com o código da requisição.
 */
export function CertificateDownload({
  certificateId,
  code,
  title,
  variant = 'default',
  size = 'md',
}: CertificateDownloadProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const { download, pendingId } = useCertificateDownload();
  const busy = pendingId === certificateId;
  const action = t('certificates.download.action');

  const run = async () => {
    const failure = await download(certificateId, code);
    if (!failure) return;
    if (failure.kind === 'preparing') {
      toast.warning(t('certificates.download.preparing'), {
        title: t('certificates.state.preparing'),
        id: `certificate-${certificateId}`,
      });
      return;
    }
    const error = describeError(t, failure.error);
    toast.error([error.message, error.detail].filter(Boolean).join(' '), {
      title: t('certificates.download.errorTitle'),
      id: `certificate-${certificateId}`,
    });
  };

  return (
    <AdminButton
      variant={variant}
      size={size}
      disabled={busy}
      icon={<Download size={14} aria-hidden="true" />}
      onClick={() => void run()}
      // o nome lido começa pelo texto visível (WCAG 2.5.3) e diz de que curso se trata
      aria-label={busy ? undefined : t('certificates.download.actionOf', { title })}
    >
      {busy ? t('certificates.download.downloading') : action}
    </AdminButton>
  );
}
