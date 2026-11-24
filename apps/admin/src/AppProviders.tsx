import type { AdminClient } from '@nuva-edu/api-client/admin';
import { type LinkComponent, LinkProvider, ToastProvider } from '@nuva-edu/ui';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ApiProvider } from './api/client';
import { createQueryClient } from './api/query';
import i18n from './i18n/i18n';
import type { RuntimeConfigLoader } from './runtime/runtimeConfig';
import { RuntimeConfigProvider } from './runtime/useRuntimeConfig';
import { BrandAccent } from './shell/BrandAccent';

/** Link interno dos componentes de @nuva-edu/ui: navega pelo roteador, sem recarregar a página. */
const RouterLink: LinkComponent = ({ href, ...rest }) => <Link to={href} {...rest} />;

/** Avisos passageiros das telas (`useToast`), com os rótulos das traduções. */
function Toasts({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <ToastProvider dismissLabel={t('common.dismiss')} regionLabel={t('common.notifications')}>
      {children}
    </ToastProvider>
  );
}

interface AppProvidersProps {
  /** Cliente da API; por padrão, o da própria origem. */
  api?: AdminClient;
  queryClient?: QueryClient;
  /** Leitura do `/config.json`; por padrão, o da própria origem. */
  runtimeConfigLoader?: RuntimeConfigLoader;
  children: ReactNode;
}

/**
 * Tudo de que as telas dependem: traduções, cliente da API, cache, configuração de execução,
 * cor de destaque da escola e link do roteador.
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
            <BrandAccent />
            <LinkProvider component={RouterLink}>
              <Toasts>{children}</Toasts>
            </LinkProvider>
          </RuntimeConfigProvider>
        </QueryClientProvider>
      </ApiProvider>
    </I18nextProvider>
  );
}
