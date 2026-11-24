import { useEffect, useState, useSyncExternalStore } from 'react';

/** Abaixo de 1024 px o menu lateral começa recolhido na coluna de ícones (spec 006, RNF-01). */
const NARROW_QUERY = '(max-width: 1023.98px)';

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const isNarrow = (): boolean => window.matchMedia(NARROW_QUERY).matches;

/**
 * Estado do menu lateral: segue a largura da tela desde a primeira pintura, até a pessoa usar o
 * botão de recolher; a escolha dela vale enquanto a tela não cruzar o limite de novo.
 */
export function useMenuCollapsed(): [boolean, (collapsed: boolean) => void] {
  const narrow = useSyncExternalStore(subscribe, isNarrow, () => false);
  const [choice, setChoice] = useState<{ narrow: boolean; collapsed: boolean } | null>(null);

  useEffect(() => {
    setChoice((current) => (current && current.narrow !== narrow ? null : current));
  }, [narrow]);

  const collapsed = choice && choice.narrow === narrow ? choice.collapsed : narrow;
  return [collapsed, (next) => setChoice({ narrow, collapsed: next })];
}
