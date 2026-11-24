import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

/*
 * Último pedaço da trilha e do título da aba numa tela abaixo de um item do menu (ex.: o nome do
 * aluno em `/alunos/:id`). A trilha mostra sempre um rótulo legível, nunca o identificador
 * (spec 006, RF-07).
 */
type Setter = (label: string | null) => void;
const CrumbContext = createContext<Setter>(() => {});

export function useCrumbState(): [string | null, (children: ReactNode) => ReactNode] {
  const [label, setLabel] = useState<string | null>(null);
  return [
    label,
    (children) => <CrumbContext.Provider value={setLabel}>{children}</CrumbContext.Provider>,
  ];
}

/** A tela informa o rótulo da página atual; ao sair, a trilha volta ao item do menu. */
export function usePageCrumb(label: string | null | undefined): void {
  const set = useContext(CrumbContext);
  useEffect(() => {
    set(label ?? null);
    return () => set(null);
  }, [label, set]);
}
