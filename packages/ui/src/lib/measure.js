import { useEffect, useState } from 'react';

/*
 * Medição de texto com as MESMAS regras do canvas original.
 * O canvas decide reticências, quebras de linha e redução de fonte com
 * ctx.measureText; usar o mesmo método aqui garante os mesmos cortes.
 */

export const SANS = '"Inter Variable", ui-sans-serif, system-ui';
export const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

/* Distância (em em) entre a linha de base "middle" do canvas e a alfabética. */
export const MIDDLE_SANS = 0.3006;
export const MIDDLE_MONO = 0.2598;

let ctx = null;
function context() {
  if (ctx) return ctx;
  if (typeof document === 'undefined') return null;
  ctx = document.createElement('canvas').getContext('2d');
  return ctx;
}

export const fontOf = (weight, size, mono = false) => `${weight} ${size}px ${mono ? MONO : SANS}`;

export function textWidth(text, font) {
  const c = context();
  if (!c) return String(text).length * 6.5;
  c.font = font;
  return c.measureText(text).width;
}

/** Corta o texto com "…" até caber em `max` (igual ao canvas). */
export function ellipsize(text, font, max) {
  if (textWidth(text, font) <= max) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}…`, font) > max) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Quebra por palavras em até `maxLines` linhas; a última ganha reticências. */
export function wrapLines(text, font, max, maxLines) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, font) > max && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = ellipsize(`${lines[maxLines - 1]} …`, font, max);
  }
  return lines;
}

/** Reduz a fonte de 0,5 em 0,5 px até o texto caber em `max` (ou chegar em `min`). */
export function fitSize(text, { weight, start, min, max, extra = 0 }) {
  let size = start;
  while (textWidth(text, fontOf(weight, size)) + extra > max && size > min) size -= 0.5;
  return size;
}

/**
 * Número que muda quando as fontes terminam de carregar.
 * Componentes que medem texto o usam para medir de novo com a fonte certa.
 */
export function useFontEpoch() {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : null;
    if (!fonts) return undefined;
    let alive = true;
    const bump = () => alive && setEpoch((n) => n + 1);
    fonts.ready.then(bump);
    fonts.addEventListener?.('loadingdone', bump);
    return () => {
      alive = false;
      fonts.removeEventListener?.('loadingdone', bump);
    };
  }, []);
  return epoch;
}
