import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext } from 'react';
import { loadRuntimeConfig, type RuntimeConfig } from './runtime-config';

export type RuntimeConfigLoader = () => Promise<RuntimeConfig | null>;

const defaultLoader: RuntimeConfigLoader = () => loadRuntimeConfig();
const LoaderContext = createContext<RuntimeConfigLoader>(defaultLoader);

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
 * consultas da API. `null` enquanto carrega e quando o arquivo falta ou é inválido: quem usa
 * apenas deixa de mostrar o link para o outro site, nunca uma tela de erro.
 */
export function useRuntimeConfig(): RuntimeConfig | null {
  const loader = useContext(LoaderContext);
  const { data } = useQuery({
    queryKey: ['runtime-config'],
    queryFn: async () => {
      try {
        return await loader();
      } catch {
        return null;
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return data ?? null;
}
