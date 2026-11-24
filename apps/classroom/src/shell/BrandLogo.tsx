import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface BrandLogoProps {
  /** Endereço da imagem, na própria origem (`/api/v1/images/...`). */
  src: string;
  school: string;
  /** Chamado quando a imagem não carrega: a casca volta às iniciais da escola. */
  onError: () => void;
}

/**
 * Logotipo da escola na marca da barra superior (spec 006, RF-06). A altura é a do quadrado de
 * iniciais que ele substitui e a largura tem teto, para o nome e as ações caberem a 360 px.
 */
export function BrandLogo({ src, school, onError }: BrandLogoProps) {
  const { t } = useTranslation();
  return (
    <img
      src={src}
      alt={t('shell.logoAlt', { school })}
      className="block h-6 w-auto max-w-20 object-contain sm:max-w-32"
      decoding="async"
      onError={onError}
    />
  );
}

/** Logotipo em uso: o de `/api/v1/meta`, a não ser que a imagem tenha falhado ao carregar. */
export function useBrandLogo(logoUrl: string | null | undefined): [string | null, () => void] {
  const [failed, setFailed] = useState<string | null>(null);
  const src = logoUrl && logoUrl !== failed ? logoUrl : null;
  return [src, () => setFailed(logoUrl ?? null)];
}
