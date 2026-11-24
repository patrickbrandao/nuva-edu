import { type ClassroomSchemas, isApiError } from '@nuva-edu/api-client/classroom';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/client';

export type TermsDocument = ClassroomSchemas['TermsDocument'];
export type LegalDocument = ClassroomSchemas['LegalDocument'];
export type TermsVersion = ClassroomSchemas['TermsVersion'];

/** Endereço público de cada documento (spec 006, mapa de telas). */
export const LEGAL_PATHS: Record<TermsDocument, string> = {
  terms: '/termos',
  privacy: '/privacidade',
};

export const LEGAL_DOCUMENTS: readonly TermsDocument[] = ['terms', 'privacy'];

/**
 * Versão vigente de um documento (`GET /api/v1/legal/{document}`). `404` é "sem versão
 * publicada" e volta como `null`; o resto é erro.
 */
export function useLegalDocument(document: TermsDocument) {
  const api = useApi();
  return useQuery({
    queryKey: ['legal', document],
    queryFn: async ({ signal }): Promise<LegalDocument | null> => {
      try {
        const { data } = await api.GET('/api/v1/legal/{document}', {
          params: { path: { document } },
          signal,
        });
        return data ?? null;
      } catch (error) {
        if (isApiError(error) && error.status === 404) return null;
        throw error;
      }
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** As duas versões vigentes, para o cadastro: `pending` enquanto alguma carrega. */
export function useCurrentTerms() {
  const terms = useLegalDocument('terms');
  const privacy = useLegalDocument('privacy');
  const queries = [terms, privacy];
  const versions = queries.flatMap((query) => (query.data ? [query.data] : []));
  return {
    versions,
    pending: queries.some((query) => query.isPending),
    error: queries.find((query) => query.isError)?.error ?? null,
    retrying: queries.some((query) => query.isFetching),
    refetch: () => Promise.all(queries.map((query) => query.refetch())),
  };
}
