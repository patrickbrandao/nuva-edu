import type { AdminOperations, AdminSchemas } from '@nuva-edu/api-client/admin';
import { type QueryClient, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from './client';
import { coursePath } from './courses';

/*
 * Certificados vistos pelo admin (spec 015): a lista com filtros, as configurações (signatário
 * e cargo) e o endereço do template do curso, para onde a recusa `certificate_template_missing`
 * aponta.
 */
export type Certificate = AdminSchemas['Certificate'];
export type CertificateState = AdminSchemas['CertificateState'];
export type CertificateSettings = AdminSchemas['CertificateSettings'];
export type CertificatesQuery = NonNullable<
  AdminOperations['listCertificates']['parameters']['query']
>;

export const CERTIFICATES_PATH = '/certificados';
export const CERTIFICATE_STATES: readonly CertificateState[] = ['preparing', 'issued', 'revoked'];
export const CERTIFICATES_PAGE_SIZE = 25;
/** Limites do contrato: motivo, código na busca, signatário e cargo. */
export const CERTIFICATE_REASON_MAX = 500;
export const CERTIFICATE_CODE_MAX = 32;
export const SIGNER_MAX = 120;
/** Enquanto houver PDF em preparação, a lista é lida de novo neste intervalo. */
const PREPARING_REFETCH_MS = 5000;

/** Aba do template no editor do curso (tarefa 467). */
export const TEMPLATE_TAB = 'template';
export function courseTemplatePath(courseId: string): string {
  return `${coursePath(courseId)}?aba=${TEMPLATE_TAB}`;
}

export const certificateKeys = {
  lists: () => ['certificates', 'list'] as const,
  list: (query: Omit<CertificatesQuery, 'cursor'>) => ['certificates', 'list', query] as const,
  settings: () => ['certificates', 'settings'] as const,
};

/** Lista por cursor (`GET /certificates`), mais recentes primeiro. */
export function useCertificatesList(query: Omit<CertificatesQuery, 'cursor' | 'limit'>) {
  const api = useApi();
  const full = { ...query, limit: CERTIFICATES_PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: certificateKeys.list(full),
    queryFn: async ({ pageParam, signal }) => {
      const { data } = await api.GET('/api/v1/certificates', {
        params: { query: pageParam ? { ...full, cursor: pageParam } : full },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/certificates respondeu sem corpo');
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: (current) =>
      current.state.data?.pages.some((page) => page.items.some(isPreparing))
        ? PREPARING_REFETCH_MS
        : false,
  });
}

export function certificatesChanged(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: certificateKeys.lists() });
}

export function isPreparing(certificate: Certificate): boolean {
  return certificate.state === 'preparing';
}

/**
 * Se a linha oferece "Baixar PDF" (spec 015, "Download pela equipe"): PDF gerado e titular com
 * conta; vale também para o revogado. A exclusão da conta apaga o nome e o PDF.
 */
export function hasPdf(certificate: Certificate): boolean {
  return (
    !isPreparing(certificate) &&
    certificate.pdfRenderedAt !== null &&
    certificate.studentName !== null
  );
}

export function certificateFileName(code: string): string {
  return `certificado-${code}.pdf`;
}

/** Signatário, cargo e, só leitura, o nome da escola (`GET /settings/certificates`). */
export function useCertificateSettings() {
  const api = useApi();
  return useQuery({
    queryKey: certificateKeys.settings(),
    queryFn: async ({ signal }): Promise<CertificateSettings> => {
      const { data } = await api.GET('/api/v1/settings/certificates', { signal });
      if (!data) throw new Error('GET /api/v1/settings/certificates respondeu sem corpo');
      return data;
    },
  });
}

/** Um usuário na busca da emissão manual. */
export interface UserOption {
  id: string;
  name: string;
  email: string;
}

/** Busca de aluno para a emissão manual: os primeiros por nome (`GET /users`). */
export function useUserSearch(q: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: ['certificates', 'user-search', q ?? ''] as const,
    queryFn: async ({ signal }): Promise<UserOption[]> => {
      const { data } = await api.GET('/api/v1/users', {
        params: { query: { ...(q ? { q } : {}), sort: 'name', limit: 10 } },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/users respondeu sem corpo');
      return data.items.map(({ id, name, email }) => ({ id, name, email }));
    },
  });
}
