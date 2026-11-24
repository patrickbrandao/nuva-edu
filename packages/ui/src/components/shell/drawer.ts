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

/**
 * Comportamento de uma gaveta aberta sobre a página: o foco entra nela ao abrir (em
 * `closeRef`) e volta ao botão que a abriu (`toggleRef`) ao fechar; enquanto aberta, a
 * página não rola por baixo e a tecla Esc chama `onClose`.
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
