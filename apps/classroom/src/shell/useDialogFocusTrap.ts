import { useEffect } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex="0"]';

/**
 * Prende o Tab dentro do diálogo modal aberto (a gaveta do menu). O `ClassroomShell` deixa o
 * resto da página inerte, mas o link "Ir para o conteúdo" fica fora dessa área e recebia o foco
 * com Shift+Tab; aqui o foco dá a volta entre o primeiro e o último controle da gaveta.
 */
export function useDialogFocusTrap(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
      if (!dialog) return;
      const controls = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      const current = document.activeElement;
      const outside = !dialog.contains(current);
      if (event.shiftKey ? outside || current === first : outside || current === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
