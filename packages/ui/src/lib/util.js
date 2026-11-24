/** Junta nomes de classe ignorando valores vazios. */
export const cx = (...parts) => parts.filter(Boolean).join(' ');

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Primeiro nome ("Ana Silva" -> "Ana"). */
export const firstName = (name = '') => String(name).split(' ')[0];

/** Matiz (0–359) derivado do nome — a mesma conta usada no canvas. */
export function hueOf(name = '') {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** Estilo para posicionar um primitivo em coordenadas absolutas do cartão. */
export function place(x, y) {
  if (x == null && y == null) return null;
  return { position: 'absolute', left: x ?? 0, top: y ?? 0 };
}

/** Porcentagem (0–100) para color-mix(), a partir de uma fração 0..1. */
export const pct = (fraction) => `${(clamp(fraction, 0, 1) * 100).toFixed(1)}%`;

/** `color` com a opacidade multiplicada por `alpha` (0..1). */
export const fade = (color, alpha) => `color-mix(in srgb, ${color} ${pct(alpha)}, transparent)`;

/** Mistura linear de duas cores CSS: 0 = `from`, 1 = `to`. */
export const mix = (from, to, amount) =>
  amount <= 0 ? from : `color-mix(in srgb, ${to} ${pct(amount)}, ${from})`;

/** Cor do texto digitado conforme o "calor" (0 = cor normal, 1 = laranja quente). */
export const heatInk = (heat = 0) => mix('var(--minui-text)', 'var(--minui-ink-hot)', heat);

/** Gerador pseudoaleatório determinístico (mulberry32). */
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
