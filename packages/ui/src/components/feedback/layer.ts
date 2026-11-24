/*
 * Peças comuns às camadas por cima da página (diálogo e avisos): onde elas são montadas e
 * quais elementos recebem foco.
 */

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** Elementos alcançáveis por Tab dentro de `root`, na ordem do documento. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      element.tabIndex >= 0 && !element.hasAttribute('inert') && !element.closest('[hidden]'),
  );
}

/** Onde a camada é montada: o elemento pedido ou o `<body>`. */
export function layerTarget(container: Element | null | undefined): Element | null {
  if (container) return container;
  return typeof document === 'undefined' ? null : document.body;
}

export const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');
