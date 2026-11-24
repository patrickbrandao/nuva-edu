import { type AdminClient, createAdminClient } from '@nuva-edu/api-client/admin';
import { createContext, type ReactNode, useContext } from 'react';
import { getCsrfToken } from './csrf';

// O site chama a API da própria origem (spec 006, RF-01). Os testes trocam o cliente pelo provedor.
const defaultClient = createAdminClient({ csrfToken: getCsrfToken });
const ApiContext = createContext<AdminClient>(defaultClient);

export function ApiProvider({ client, children }: { client?: AdminClient; children: ReactNode }) {
  return <ApiContext.Provider value={client ?? defaultClient}>{children}</ApiContext.Provider>;
}

/** Cliente tipado da admin-api. */
export function useApi(): AdminClient {
  return useContext(ApiContext);
}
