import { AdminCheckbox, TextLink } from '@nuva-edu/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { LEGAL_PATHS, type TermsVersion } from './legal';

/**
 * Aceite dos termos vigentes (spec 030, RF-02): os documentos com a versão, em links que abrem
 * em outra aba (o formulário não se perde), e a caixa de aceite. Sem versão publicada não há o que
 * aceitar e nada aparece.
 */
export function TermsAcceptance({
  versions,
  checked,
  onChange,
  error,
  lead,
}: {
  versions: readonly Pick<TermsVersion, 'id' | 'document' | 'version'>[];
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string | undefined;
  /** Frase antes da lista; padrão: a do cadastro. */
  lead?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  if (!versions.length) return null;
  const errorId = `${id}-error`;
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 p-0 text-[13px] font-medium text-ink">{t('terms.legend')}</legend>
      <p className="m-0 text-[13px] text-ink-3">{lead ?? t('terms.lead')}</p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
        {versions.map((version) => (
          <li key={version.id}>
            <TextLink
              href={LEGAL_PATHS[version.document]}
              external
              newTabLabel={t('common.newTab')}
            >
              {t('terms.versionLink', {
                document: t(`terms.documents.${version.document}`),
                version: version.version,
              })}
            </TextLink>
          </li>
        ))}
      </ul>
      <AdminCheckbox
        checked={checked}
        onChange={onChange}
        name="acceptedTerms"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      >
        <span className="text-[13px] text-ink">{t('terms.accept')}</span>
      </AdminCheckbox>
      {error ? (
        <span id={errorId} className="text-[12px] text-danger">
          {error}
        </span>
      ) : null}
    </fieldset>
  );
}
