import type { AdminClient } from '@nuva-edu/api-client/admin';
import { type LinkComponent, LinkProvider } from '@nuva-edu/ui';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Link } from 'react-router';
import { ApiProvider } from './api/client';
import { createQueryClient } from './api/query';
import i18n from './i18n/i18n';
import type { RuntimeConfigLoader } from './runtime/runtimeConfig';
import { RuntimeConfigProvider } from './runtime/useRuntimeConfig';

/** Link interno dos componentes de @nuva-edu/ui: navega pelo roteador, sem recarregar a página. */
const RouterLink: LinkComponent = ({ href, ...rest }) => <Link to={href} {...rest} />;

interface AppProvidersProps {
  /** Cliente da API; por padrão, o da própria origem. */
  api?: AdminClient;
  queryClient?: QueryClient;
  /** Leitura do `/config.json`; por padrão, o da própria origem. */
  runtimeConfigLoader?: RuntimeConfigLoader;
  children: ReactNode;
}

/**
 * Tudo de que as telas dependem: traduções, cliente da API, cache, configuração de execução e
 * link do roteador.
 */
export function AppProviders({
  api,
  queryClient,
  runtimeConfigLoader,
  children,
}: AppProvidersProps) {
  const [ownQueryClient] = useState(createQueryClient);
  return (
    <I18nextProvider i18n={i18n}>
      <ApiProvider {...(api ? { client: api } : {})}>
        <QueryClientProvider client={queryClient ?? ownQueryClient}>
          <RuntimeConfigProvider loader={runtimeConfigLoader}>
            <LinkProvider component={RouterLink}>{children}</LinkProvider>
          </RuntimeConfigProvider>
        </QueryClientProvider>
      </ApiProvider>
    </I18nextProvider>
  );
}
