import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ACCENT_HOVER_LIGHTEN_BELOW,
  ACCENT_HOVER_LIGHTEN_UNTIL,
  ACCENT_HOVER_MIX,
  ACCENT_ON_THRESHOLD,
  ACCENT_TEXT_MAX_LIGHT,
  ACCENT_TEXT_MIN_DARK,
  accentHover,
  accentOn,
  accentText,
  contrastRatio,
  isHexColor,
  relativeLuminance,
} from './accent';

/** As três cores de exemplo do catálogo: clara, média e escura. */
const SAMPLES = { clara: '#ffd166', media: '#2563eb', escura: '#1e3a5f' };

/** Superfícies `--adm-*` (admin.css, tons frio e quente) por tema. */
const SURFACES = {
  light: ['#ffffff', '#f6f6f7', '#f5f5f6', '#f7f7f8', '#f5f4f2', '#eceae6', '#f3f2ef'],
  dark: ['#0f0f11', '#141416', '#151518', '#1b1b1f', '#212126', '#232327', '#1a1a18', '#262624'],
} as const;

const AA = 4.5;

/** Uma grade de 4.096 cores que cobre o cubo RGB, com os extremos. */
function grid(): string[] {
  const steps = Array.from({ length: 16 }, (_, index) =>
    (index * 17).toString(16).padStart(2, '0'),
  );
  return steps.flatMap((r) => steps.flatMap((g) => steps.map((b) => `#${r}${g}${b}`)));
}

describe('contas de contraste da cor de destaque', () => {
  it('mede a luminância e o contraste como a WCAG', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#ffffff', '#767676')).toBe(contrastRatio('#767676', '#ffffff'));
  });

  it('só aceita #RRGGBB', () => {
    expect(isHexColor('#2F6fed')).toBe(true);
    for (const value of ['#fff', '2f6fed', '#2f6fedff', 'red', '', null, undefined, 7]) {
      expect(isHexColor(value)).toBe(false);
    }
    expect(() => relativeLuminance('red')).toThrow(TypeError);
  });

  it.each(Object.entries(SAMPLES))('cor %s: texto sobre a cor com 4,5:1 ou mais', (_, color) => {
    expect(contrastRatio(accentOn(color), color)).toBeGreaterThanOrEqual(AA);
    expect(contrastRatio(accentOn(color), accentHover(color))).toBeGreaterThanOrEqual(AA);
  });

  it('escolhe texto preto na cor clara e branco na média e na escura', () => {
    expect(accentOn(SAMPLES.clara)).toBe('#000000');
    expect(accentOn(SAMPLES.media)).toBe('#ffffff');
    expect(accentOn(SAMPLES.escura)).toBe('#ffffff');
  });

  it.each(Object.entries(SAMPLES))(
    'cor %s: como texto, 4,5:1 ou mais sobre as superfícies dos dois temas',
    (_, color) => {
      for (const theme of ['light', 'dark'] as const) {
        for (const surface of SURFACES[theme]) {
          expect(contrastRatio(accentText(color, theme), surface)).toBeGreaterThanOrEqual(AA);
        }
      }
    },
  );

  it('mantém o AA com qualquer cor que a escola escolher', () => {
    for (const color of grid()) {
      const on = accentOn(color);
      expect(contrastRatio(on, color), `texto sobre ${color}`).toBeGreaterThanOrEqual(AA);
      expect(contrastRatio(on, accentHover(color)), `ponteiro em ${color}`).toBeGreaterThanOrEqual(
        AA,
      );
      for (const theme of ['light', 'dark'] as const) {
        const text = accentText(color, theme);
        for (const surface of SURFACES[theme]) {
          expect(
            contrastRatio(text, surface),
            `${color} como texto sobre ${surface}`,
          ).toBeGreaterThanOrEqual(AA);
        }
      }
    }
  });

  it('não mexe na cor que já serve como texto', () => {
    expect(accentText('#1e3a5f', 'light')).toBe('#1e3a5f');
    expect(accentText('#ffd166', 'dark')).toBe('#ffd166');
    expect(accentText('#ffd166', 'light')).not.toBe('#ffd166');
    expect(accentText('#1e3a5f', 'dark')).not.toBe('#1e3a5f');
  });

  it('muda o fundo sob o ponteiro, inclusive no preto e no branco', () => {
    for (const color of ['#000000', '#ffffff', ...Object.values(SAMPLES)]) {
      expect(accentHover(color)).not.toBe(color);
    }
  });
});

// numa constante, para o Vite não tratar o endereço como um recurso estático
const TOKENS_FILE = '../styles/tokens.css';

describe('tokens --minui-accent-* (tokens.css)', () => {
  const css = readFileSync(fileURLToPath(new URL(TOKENS_FILE, import.meta.url)), 'utf8');
  const block = css.slice(css.indexOf('@supports (color: color(from'));

  it('usam os mesmos números das contas em TypeScript', () => {
    expect(block).toContain(`(${ACCENT_ON_THRESHOLD} - r) * 1e9`);
    expect(block).toContain(`(${ACCENT_HOVER_LIGHTEN_BELOW} - r) * 1e9`);
    expect(block).toContain(`(${ACCENT_HOVER_LIGHTEN_UNTIL} - r) * 1e9`);
    expect(block).toContain(`var(--minui-accent) ${100 - ACCENT_HOVER_MIX * 100}%`);
    expect(block).toContain(`min(1, ${ACCENT_TEXT_MAX_LIGHT} / `);
    expect(block).toContain(`(${ACCENT_TEXT_MIN_DARK} - (0.2126 * r + 0.7152 * g + 0.0722 * b))`);
    expect(block).toContain(`max(1, ${ACCENT_TEXT_MIN_DARK} / max(`);
  });

  it('não declaram --minui-accent: sem a cor da escola, vale o padrão de cada componente', () => {
    expect(css).not.toMatch(/--minui-accent\s*:/);
    for (const token of ['fill', 'on', 'hover', 'edge', 'up', 'text', 'tint']) {
      expect(block).toMatch(new RegExp(`--minui-accent-${token}\\s*:`));
    }
  });
});
