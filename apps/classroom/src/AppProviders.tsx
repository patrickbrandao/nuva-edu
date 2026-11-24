import type { ClassroomClient } from '@nuva-edu/api-client/classroom';
import { type LinkComponent, LinkProvider } from '@nuva-edu/ui';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Link } from 'react-router';
import { ApiProvider } from './api/client';
import { createQueryClient } from './api/query';
import i18n from './i18n/i18n';

/** Link do roteador para os componentes de @nuva-edu/ui: endereço interno não recarrega a página. */
const RouterLink: LinkComponent = ({ href, ...rest }) => <Link to={href} {...rest} />;

interface AppProvidersProps {
  /** Cliente da API; por padrão, o da própria origem. */
  api?: ClassroomClient;
  queryClient?: QueryClient;
  children: ReactNode;
}

/** Tudo de que as telas dependem: traduções, cliente da API, cache de dados do servidor e o link
 * do roteador (os links só são desenhados dentro do `RouterProvider`, que fica em `children`). */
export function AppProviders({ api, queryClient, children }: AppProvidersProps) {
  const [ownQueryClient] = useState(createQueryClient);
  return (
    <I18nextProvider i18n={i18n}>
      <ApiProvider {...(api ? { client: api } : {})}>
        <QueryClientProvider client={queryClient ?? ownQueryClient}>
          <LinkProvider component={RouterLink}>{children}</LinkProvider>
        </QueryClientProvider>
      </ApiProvider>
    </I18nextProvider>
  );
}
