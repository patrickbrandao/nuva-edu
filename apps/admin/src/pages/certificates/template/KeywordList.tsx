import { AdminButton, AdminTag, useToast } from '@nuva-edu/ui';
import { Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CertificateTemplateKey } from '../../../api/certificateTemplates';

/**
 * Palavras-chave do template (`GET /certificate-templates/reference`), na ordem da spec 015:
 * como escrever, descrição, valor do exemplo, se é obrigatória, e o botão de copiar.
 */
export function KeywordList({ keys }: { keys: CertificateTemplateKey[] }) {
  const { t } = useTranslation();
  const toast = useToast();

  const copy = async (placeholder: string) => {
    try {
      await navigator.clipboard.writeText(placeholder);
      toast.success(t('certificateTemplate.keys.copied', { key: placeholder }));
    } catch {
      toast.error(t('certificateTemplate.keys.copyFailed', { key: placeholder }));
    }
  };

  return (
    <ul
      aria-label={t('certificateTemplate.keys.title')}
      className="m-0 flex list-none flex-col gap-3 p-0"
    >
      {keys.map((item) => (
        <li key={item.key} className="flex flex-col gap-1 border-b border-line pb-3">
          <span className="flex flex-wrap items-center gap-2">
            <code className="text-sm text-ink">{item.placeholder}</code>
            {item.required ? <AdminTag>{t('certificateTemplate.keys.required')}</AdminTag> : null}
            {item.requiredOneOf ? (
              <AdminTag>{t('certificateTemplate.keys.requiredOneOf')}</AdminTag>
            ) : null}
            <AdminButton
              size="sm"
              className="ms-auto"
              icon={<Copy size={14} aria-hidden="true" />}
              onClick={() => void copy(item.placeholder)}
            >
              {t('certificateTemplate.keys.copy')}{' '}
              <span className="minui-sr-only">{item.placeholder}</span>
            </AdminButton>
          </span>
          <span className="text-sm text-ink-2">{item.description}</span>
          <span className="text-sm text-ink-3">
            {t('certificateTemplate.keys.example', { value: item.example })}
          </span>
        </li>
      ))}
    </ul>
  );
}
