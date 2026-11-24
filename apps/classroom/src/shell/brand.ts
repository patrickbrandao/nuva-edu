import { useEffect } from 'react';
import { useMeta } from '../api/meta';

/**
 * Repositório público do código (spec 006, RF-11; AGPL-3.0): vale enquanto `/api/v1/meta` carrega
 * ou falha. O endereço em uso vem de `sourceCodeUrl`, que a escola ajusta nas configurações.
 */
export const DEFAULT_SOURCE_CODE_URL = 'https://github.com/patrickbrandao/nuva-edu';

/** Variável CSS da cor de destaque da escola (a mesma no site admin). */
export const ACCENT_VARIABLE = '--minui-accent';

const ACCENT_FORMAT = /^#[0-9A-Fa-f]{6}$/;

/** A cor de destaque só é aplicada no formato `#RRGGBB` do contrato. */
export function isAccentColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && ACCENT_FORMAT.test(value);
}

/** Endereço do código-fonte: só `http(s)`; qualquer outra coisa cai no repositório padrão. */
export function sourceCodeHref(value: string | null | undefined): string {
  if (!value) return DEFAULT_SOURCE_CODE_URL;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : DEFAULT_SOURCE_CODE_URL;
  } catch {
    return DEFAULT_SOURCE_CODE_URL;
  }
}

/**
 * Cor de destaque da escola (spec 006, RF-06): `accentColor` de `/api/v1/meta` vai para a variável
 * `--minui-accent` em `<html>`. É escrita pelo CSSOM, que a CSP `style-src 'self'` dos sites não
 * bloqueia (atributo `style` no HTML e folha inline seriam bloqueados). Sem cor, ou com valor
 * fora do formato, a variável é retirada e vale o padrão de @nuva-edu/ui.
 */
export function useBrandAccent(): void {
  const { data } = useMeta();
  const accent = isAccentColor(data?.accentColor) ? data.accentColor : null;

  useEffect(() => {
    const { style } = document.documentElement;
    if (accent) style.setProperty(ACCENT_VARIABLE, accent);
    else style.removeProperty(ACCENT_VARIABLE);
  }, [accent]);
}
