import type { AdminClient } from '@nuva-edu/api-client/admin';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { ApiProvider } from './api/client';
import { createQueryClient } from './api/query';
import i18n from './i18n/i18n';

interface AppProvidersProps {
  /** Cliente da API; por padrão, o da própria origem. */
  api?: AdminClient;
  queryClient?: QueryClient;
  children: ReactNode;
}

/** Tudo de que as telas dependem: traduções, cliente da API e cache de dados do servidor. */
export function AppProviders({ api, queryClient, children }: AppProvidersProps) {
  const [ownQueryClient] = useState(createQueryClient);
  return (
    <I18nextProvider i18n={i18n}>
      <ApiProvider {...(api ? { client: api } : {})}>
        <QueryClientProvider client={queryClient ?? ownQueryClient}>{children}</QueryClientProvider>
      </ApiProvider>
    </I18nextProvider>
  );
}
