import { useEffect } from 'react';
import { useMeta } from '../api/meta';
import { ACCENT_CSS_VARIABLE, validAccentColor } from './brand';

/**
 * Aplica a cor de destaque da escola (`accentColor` do `/meta`; spec 006, RF-06) na raiz da
 * página. Vai pelo CSSOM, e não por atributo `style` no HTML, que a CSP dos sites
 * (`style-src 'self'`) bloquearia. Sem cor, ou com valor fora de `#RRGGBB`, a variável sai e
 * vale o padrão de `@nuva-edu/ui`.
 */
export function BrandAccent() {
  const { data: meta } = useMeta();
  const color = validAccentColor(meta?.accentColor);

  useEffect(() => {
    const { style } = document.documentElement;
    if (!color) {
      style.removeProperty(ACCENT_CSS_VARIABLE);
      return;
    }
    style.setProperty(ACCENT_CSS_VARIABLE, color);
    return () => {
      style.removeProperty(ACCENT_CSS_VARIABLE);
    };
  }, [color]);

  return null;
}
