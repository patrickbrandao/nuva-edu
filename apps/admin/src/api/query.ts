import { isApiError } from '@nuva-edu/api-client/admin';
import { QueryClient } from '@tanstack/react-query';

/** Repete só o que pode melhorar sozinho: falha de rede e erro 5xx, no máximo duas vezes. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) => failures < 2 && !(isApiError(error) && error.status < 500),
        refetchOnWindowFocus: false,
      },
    },
  });
}
