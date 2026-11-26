import { AdminCard, TextLink } from '@nuva-edu/ui';
import { Award } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CertificateDownload } from './CertificateDownload';
import { CertificateName } from './CertificateName';
import { type CourseCertificateState, validationPath } from './certificates';

interface CourseCertificateProps {
  certificate: CourseCertificateState;
  /** Título do curso, para o nome lido do botão de download. */
  title: string;
}

/**
 * O estado do certificado na página do curso (spec 015, "Estado do certificado para o aluno"):
 * em andamento traz o nome que sairá, com "Alterar"; emitido traz o download e o código.
 * Concluído sem template avisa que o instrutor ainda não liberou, sem botão de download.
 */
export function CourseCertificate({ certificate, title }: CourseCertificateProps) {
  const { t } = useTranslation();
  const { state, certificateId, code, studentName } = certificate;
  return (
    <AdminCard pad as="section" aria-label={t('certificates.section.title')}>
      <div className="flex flex-col gap-3">
        <h2 className="m-0 flex items-center gap-2 text-base font-semibold text-ink">
          <Award size={16} aria-hidden="true" />
          {t(`certificates.state.${state}`)}
        </h2>
        {state === 'in_progress' ? (
          <CertificateName name={studentName} label={t('certificates.name.label')} />
        ) : null}
        {state === 'awaiting_template' || state === 'in_progress' ? null : (
          <p className="m-0 flex flex-col text-sm">
            <span className="text-ink-3">{t('certificates.name.label')}</span>
            <span className="break-words font-semibold text-ink">{studentName}</span>
          </p>
        )}
        {state === 'issued' && code ? (
          <p className="m-0 text-sm text-ink-2">
            {t('certificates.section.code', { code })}{' '}
            <TextLink href={validationPath(code)}>{t('certificates.section.validate')}</TextLink>
          </p>
        ) : null}
        {state === 'issued' && certificateId ? (
          <span className="flex">
            <CertificateDownload
              certificateId={certificateId}
              code={code}
              title={title}
              variant="primary"
            />
          </span>
        ) : null}
      </div>
    </AdminCard>
  );
}

/**
 * O estado em uma linha, para o cartão da estante (spec 014, "Estante"); o emitido leva o
 * download.
 */
export function CertificateLine({ certificate, title }: CourseCertificateProps) {
  const { t } = useTranslation();
  const { state, certificateId, code } = certificate;
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="inline-flex items-center gap-1">
        <Award size={14} aria-hidden="true" />
        {t(`certificates.state.${state}`)}
      </span>
      {state === 'issued' && certificateId ? (
        <CertificateDownload certificateId={certificateId} code={code} title={title} size="sm" />
      ) : null}
    </span>
  );
}
