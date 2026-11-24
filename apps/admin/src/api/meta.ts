import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import { useQuery } from '@tanstack/react-query';
import { useApi } from './client';

export type Meta = AdminSchemas['Meta'];

/**
 * Dados públicos da instalação (`GET /api/v1/meta`): marca da escola (nome, logotipo e cor de
 * destaque), endereço do código-fonte, versão, moeda e idioma.
 */
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
