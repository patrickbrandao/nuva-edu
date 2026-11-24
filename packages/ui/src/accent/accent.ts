/*
 * Cor de destaque da escola (spec 006, RF-06): as contas de contraste.
 *
 * Quem pinta os componentes é o CSS (`src/styles/tokens.css`, tokens `--minui-accent-*`), sem
 * JavaScript. Este arquivo repete as mesmas contas, com os mesmos números, para que os testes
 * confiram o contraste e para o site que precisar do resultado fora do CSS (ex.: a prévia da
 * cor nas configurações da escola). Mudou um número aqui, mude lá.
 */

/** Luminância relativa abaixo da qual o texto sobre a cor é branco (acima, preto). */
export const ACCENT_ON_THRESHOLD = 0.179;
/** Parte de branco ou preto misturada ao fundo cheio sob o ponteiro. */
export const ACCENT_HOVER_MIX = 0.14;
/** O fundo sob o ponteiro clareia abaixo deste valor e entre o corte do texto e o teto. */
export const ACCENT_HOVER_LIGHTEN_BELOW = 0.05;
export const ACCENT_HOVER_LIGHTEN_UNTIL = 0.7;
/** Luminância máxima da cor usada como texto no tema claro. */
export const ACCENT_TEXT_MAX_LIGHT = 0.115;
/** Luminância mínima da cor usada como texto no tema escuro. */
export const ACCENT_TEXT_MIN_DARK = 0.32;

export type AccentTheme = 'light' | 'dark';

type Rgb = readonly [number, number, number];

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/** Só o formato `#RRGGBB` do contrato (`accentColor` do `/api/v1/meta`). */
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

function toLinear(hex: string): Rgb {
  const match = HEX.exec(hex);
  if (!match) throw new TypeError(`Cor fora do formato #RRGGBB: ${hex}`);
  const channel = (pair: string | undefined): number => {
    const value = Number.parseInt(pair ?? '0', 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return [channel(match[1]), channel(match[2]), channel(match[3])];
}

function fromLinear(rgb: Rgb): string {
  const channel = (value: number): string => {
    const clamped = Math.min(1, Math.max(0, value));
    const encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

const luminance = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * `hsl(h s% l%)` em `#RRGGBB`, para medir o contraste de uma cor que nasce de um matiz
 * (o fundo das iniciais do `AdminAvatar`). `h` em graus, `s` e `l` de 0 a 100.
 */
export function hslToHex(h: number, s: number, l: number): string {
  const saturation = Math.min(100, Math.max(0, s)) / 100;
  const lightness = Math.min(100, Math.max(0, l)) / 100;
  const hue = ((h % 360) + 360) % 360;
  const chroma = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number): string => {
    const k = (n + hue / 30) % 12;
    const value = lightness - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

/** Luminância relativa da WCAG 2.1 (0 = preto, 1 = branco). */
export function relativeLuminance(hex: string): number {
  return luminance(toLinear(hex));
}

/** Razão de contraste da WCAG 2.1 entre duas cores `#RRGGBB` (de 1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const [low, high] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => x - y) as [
    number,
    number,
  ];
  return (high + 0.05) / (low + 0.05);
}

/** Cor do texto sobre o fundo cheio (`--minui-accent-on`): sempre 4,5:1 ou mais. */
export function accentOn(accent: string): '#ffffff' | '#000000' {
  return relativeLuminance(accent) < ACCENT_ON_THRESHOLD ? '#ffffff' : '#000000';
}

/** Fundo cheio sob o ponteiro (`--minui-accent-hover`): mistura em sRGB, como no CSS. */
export function accentHover(accent: string): string {
  const y = relativeLuminance(accent);
  const lighten =
    y < ACCENT_HOVER_LIGHTEN_BELOW || (y > ACCENT_ON_THRESHOLD && y < ACCENT_HOVER_LIGHTEN_UNTIL);
  const target = lighten ? 255 : 0;
  const match = HEX.exec(accent) as RegExpExecArray;
  const mix = (pair: string | undefined): string =>
    Math.round(
      Number.parseInt(pair ?? '0', 16) * (1 - ACCENT_HOVER_MIX) + target * ACCENT_HOVER_MIX,
    )
      .toString(16)
      .padStart(2, '0');
  return `#${mix(match[1])}${mix(match[2])}${mix(match[3])}`;
}

/**
 * A cor como texto, ícone ou anel de foco sobre as superfícies do tema
 * (`--minui-accent-text`): escurecida no claro, clareada no escuro, sempre com
 * 4,5:1 ou mais sobre qualquer superfície `--adm-*`.
 */
export function accentText(accent: string, theme: AccentTheme): string {
  const rgb = toLinear(accent);
  const y = luminance(rgb);
  if (theme === 'light') {
    const scale = Math.min(1, ACCENT_TEXT_MAX_LIGHT / Math.max(y, 0.0001));
    return fromLinear([rgb[0] * scale, rgb[1] * scale, rgb[2] * scale]);
  }
  // sobe os três canais na mesma proporção (mantém a saturação) até a luminância mínima ou até
  // um canal chegar ao teto; o que faltar vem de branco
  const scale = Math.min(
    Math.max(1, ACCENT_TEXT_MIN_DARK / Math.max(y, 0.0001)),
    1 / Math.max(...rgb, 0.0001),
  );
  const up: Rgb = [rgb[0] * scale, rgb[1] * scale, rgb[2] * scale];
  const upY = luminance(up);
  const lift = Math.max(0, (ACCENT_TEXT_MIN_DARK - upY) / Math.max(1 - upY, 0.0001));
  return fromLinear([
    up[0] + (1 - up[0]) * lift,
    up[1] + (1 - up[1]) * lift,
    up[2] + (1 - up[2]) * lift,
  ]);
}
