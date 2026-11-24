import { GraduationCap } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface BrandMarkProps {
  /** `logoUrl` do `/meta`: caminho da imagem na própria origem, ou `null` sem logotipo. */
  logoUrl: string | null | undefined;
  /** Nome da escola, para o texto alternativo do logotipo. */
  name: string;
}

/**
 * Marca do menu (spec 006, RF-06): o logotipo da escola quando o `/meta` traz um; sem logotipo,
 * ou se a imagem não carregar, o ícone padrão, que é decorativo (o nome vem ao lado).
 */
export function BrandMark({ logoUrl, name }: BrandMarkProps) {
  const { t } = useTranslation();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!logoUrl || failedUrl === logoUrl) {
    return <GraduationCap size={20} aria-hidden="true" />;
  }
  return (
    <img
      src={logoUrl}
      alt={t('shell.logoAlt', { name })}
      className="block h-6 w-auto max-w-24 object-contain"
      decoding="async"
      onError={() => setFailedUrl(logoUrl)}
    />
  );
}
