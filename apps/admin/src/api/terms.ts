import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import { useQuery } from '@tanstack/react-query';
import { useApi } from './client';

export type TermsDocument = AdminSchemas['TermsDocument'];
export type TermsVersionEntry = AdminSchemas['TermsVersionEntry'];

/** Os dois documentos legais da spec 030, na ordem em que aparecem. */
export const TERMS_DOCUMENTS: readonly TermsDocument[] = ['terms', 'privacy'];

export const TERMS_PATH = '/configuracoes/termos';

export function termsKey(document: TermsDocument) {
  return ['terms', document] as const;
}

/** Versões de um documento, mais nova primeiro (`GET /api/v1/terms`; `settings.manage`). */
export function useTermsVersions(document: TermsDocument, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: termsKey(document),
    queryFn: async ({ signal }): Promise<TermsVersionEntry[]> => {
      const { data } = await api.GET('/api/v1/terms', {
        params: { query: { document } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/terms respondeu sem corpo');
      return data.items;
    },
    enabled,
  });
}

/** Se o documento tem alguma versão publicada (a vigente é a publicada de maior `version`). */
export function hasPublished(items: readonly TermsVersionEntry[]): boolean {
  return items.some((item) => item.status === 'published');
}
