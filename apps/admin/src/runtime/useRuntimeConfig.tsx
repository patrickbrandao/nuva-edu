import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext } from 'react';
import { loadRuntimeConfig, type RuntimeConfig, type RuntimeConfigLoader } from './runtimeConfig';

const defaultLoader: RuntimeConfigLoader = () => loadRuntimeConfig();
const LoaderContext = createContext<RuntimeConfigLoader>(defaultLoader);
const EMPTY: RuntimeConfig = {};

interface RuntimeConfigProviderProps {
  /** Como buscar o arquivo; por padrão, `/config.json` da própria origem. Os testes trocam. */
  loader?: RuntimeConfigLoader | undefined;
  children: ReactNode;
}

/**
 * Dispara a leitura do `/config.json` assim que o site monta, em paralelo com `/api/v1/meta`
 * (spec 006, "Configuração de execução"), e não segura a tela enquanto ele não chega.
 */
export function RuntimeConfigProvider({ loader, children }: RuntimeConfigProviderProps) {
  return (
    <LoaderContext.Provider value={loader ?? defaultLoader}>
      <RuntimeConfigPreload />
      {children}
    </LoaderContext.Provider>
  );
}

function RuntimeConfigPreload() {
  useRuntimeConfig();
  return null;
}

/**
 * Configuração de execução do site. Enquanto carrega, ou se o arquivo faltar, devolve um objeto
 * sem campos: quem usa esconde o que depende do campo ausente.
 */
export function useRuntimeConfig(): RuntimeConfig {
  const loader = useContext(LoaderContext);
  const { data } = useQuery({
    queryKey: ['runtime-config'],
    queryFn: loader,
    // O arquivo só muda quando o contêiner sobe de novo: uma leitura por carga da página.
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  return data ?? EMPTY;
}
