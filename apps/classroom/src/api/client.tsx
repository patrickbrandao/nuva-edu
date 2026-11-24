import { type ClassroomClient, createClassroomClient } from '@nuva-edu/api-client/classroom';
import { createContext, type ReactNode, useContext } from 'react';

// O site chama a API da própria origem (spec 006, RF-01). Os testes trocam o cliente pelo provedor.
const defaultClient = createClassroomClient();
const ApiContext = createContext<ClassroomClient>(defaultClient);

export function ApiProvider({
  client,
  children,
}: {
  client?: ClassroomClient;
  children: ReactNode;
}) {
  return <ApiContext.Provider value={client ?? defaultClient}>{children}</ApiContext.Provider>;
}

/** Cliente tipado da classroom-api. */
export function useApi(): ClassroomClient {
  return useContext(ApiContext);
}
