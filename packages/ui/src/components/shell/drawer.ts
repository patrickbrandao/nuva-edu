import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

/*
 * Peças comuns do menu em gaveta (spec 006, RNF-01), usadas pela casca do painel
 * (AdminShell) e pela casca do aluno (ClassroomShell).
 */

/** Acompanha uma consulta de mídia; fora do navegador vale `false`. */
export function useMediaQuery(query: string | null): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!query) return () => {};
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (query ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/**
 * `true` quando a janela é mais estreita que `below` px. O valor já vem certo na primeira
 * pintura (não há troca de estado depois de montar). Sem `below`, é sempre `false`.
 */
export function useNarrowViewport(below: number | null | undefined): boolean {
  return useMediaQuery(below ? `(max-width: ${below - 0.02}px)` : null);
}

interface Focusable {
  focus: () => void;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Controles da gaveta que o Tab alcança, na ordem do documento. */
function tabStops(dialog: Element): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (control) => !control.closest('[inert], [hidden]'),
  );
}

/**
 * Prende o Tab na gaveta: do último controle volta ao primeiro, do primeiro (com Shift) vai ao
 * último, e o foco que estiver fora dela (ex.: no link "Ir para o conteúdo") entra de volta.
 */
function keepTabInside(event: KeyboardEvent, dialog: Element): void {
  const stops = tabStops(dialog);
  const first = stops[0];
  const last = stops.at(-1);
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const current = document.activeElement;
  const outside = !dialog.contains(current);
  if (outside || current === (event.shiftKey ? first : last)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

/**
 * Comportamento de uma gaveta aberta sobre a página: o foco entra nela ao abrir (em
 * `closeRef`) e volta ao botão que a abriu (`toggleRef`) ao fechar; enquanto aberta, a
 * página não rola por baixo, a tecla Esc chama `onClose` e o Tab dá a volta dentro dela
 * (a gaveta é o `[role="dialog"]` que contém `closeRef`).
 */
export function useDrawerFocus(
  open: boolean,
  closeRef: RefObject<Focusable | null>,
  toggleRef: RefObject<Focusable | null>,
  onClose: () => void,
): void {
  const wasOpen = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (open) closeRef.current?.focus();
    else if (wasOpen.current) toggleRef.current?.focus();
    wasOpen.current = open;
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      const anchor = closeRef.current;
      const dialog = anchor instanceof Element ? anchor.closest('[role="dialog"]') : null;
      if (dialog) keepTabInside(event, dialog);
    };
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [open, closeRef, toggleRef]);
}
