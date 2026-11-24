import { type RefObject, useEffect } from 'react';
import { useNavigate } from 'react-router';

/**
 * Os componentes de @nuva-edu/ui desenham links como `<a href>` simples. Este gancho faz os
 * cliques em links internos (`/caminho`) passarem pelo roteador, sem recarregar a página;
 * clique com tecla modificadora, botão do meio e link externo seguem o navegador.
 */
export function useInternalLinks(ref: RefObject<HTMLElement | null>): void {
  const navigate = useNavigate();

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest('a[href]');
      if (!anchor || !node.contains(anchor)) return;
      const target = anchor.getAttribute('target');
      const href = anchor.getAttribute('href') ?? '';
      if ((target && target !== '_self') || anchor.hasAttribute('download')) return;
      if (!href.startsWith('/') || href.startsWith('//')) return;
      event.preventDefault();
      void navigate(href);
    };
    node.addEventListener('click', onClick);
    return () => node.removeEventListener('click', onClick);
  }, [ref, navigate]);
}
