import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';
import { useQuery } from '@tanstack/react-query';
import { useApi } from './client';

export type Meta = ClassroomSchemas['Meta'];

/** Dados públicos da instalação (`GET /api/v1/meta`): escola, versão, moeda, idioma e logins. */
export function useMeta() {
  const api = useApi();
  return useQuery({
    queryKey: ['meta'],
    queryFn: async ({ signal }): Promise<Meta> => {
      const { data } = await api.GET('/api/v1/meta', { signal });
      if (!data) throw new Error('GET /api/v1/meta respondeu sem corpo');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
