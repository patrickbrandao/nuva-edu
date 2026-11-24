import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext } from 'react';
import { loadRuntimeConfig, type RuntimeConfig, type RuntimeConfigLoader } from './runtime-config';

export type { RuntimeConfigLoader };

const defaultLoader: RuntimeConfigLoader = () => loadRuntimeConfig();
const LoaderContext = createContext<RuntimeConfigLoader>(defaultLoader);
const EMPTY: RuntimeConfig = {};

/** Troca a origem do `/config.json`; os testes entregam aqui o valor simulado. */
export function RuntimeConfigProvider({
  loader,
  children,
}: {
  loader?: RuntimeConfigLoader;
  children: ReactNode;
}) {
  return (
    <LoaderContext.Provider value={loader ?? defaultLoader}>{children}</LoaderContext.Provider>
  );
}

/**
 * Configuração de execução do site, lida uma vez por carga da página, em paralelo com as
 * consultas da API. Enquanto carrega, ou se o arquivo faltar, devolve um objeto sem campos; campo
 * fora do formato também fica de fora. Quem usa esconde o que depende do campo ausente, nunca
 * mostra uma tela de erro.
 */
export function useRuntimeConfig(): RuntimeConfig {
  const loader = useContext(LoaderContext);
  const { data } = useQuery({
    queryKey: ['runtime-config'],
    queryFn: async () => {
      try {
        return await loader();
      } catch {
        return EMPTY;
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return data ?? EMPTY;
}
