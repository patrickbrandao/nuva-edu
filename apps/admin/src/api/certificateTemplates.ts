import { type AdminSchemas, isApiError } from '@nuva-edu/api-client/admin';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { useApi } from './client';

/*
 * Templates do certificado (spec 015, "Template" e "Pré-visualização"; ADR 0026): o do curso
 * (`certificate.template.edit`, instrutor só nos próprios cursos) e o padrão da escola
 * (`settings.manage`), no mesmo formato, mais a referência das palavras-chave e o PDF de exemplo.
 */
export type CertificateTemplate = AdminSchemas['CertificateTemplate'];
export type CertificateTemplateSaved = AdminSchemas['CertificateTemplateSaved'];
export type CertificateTemplateSource = AdminSchemas['CertificateTemplateSource'];
export type CertificateTemplateProblem = AdminSchemas['CertificateTemplateProblem'];
export type CertificateTemplateKey = AdminSchemas['CertificateTemplateKey'];
export type CertificateTemplateReference = AdminSchemas['CertificateTemplateReference'];
export type CertificatePreview = AdminSchemas['CertificatePreview'];

/** De quem é o template: de um curso ou o padrão da escola. */
export type TemplateScope = { kind: 'course'; courseId: string } | { kind: 'school' };

/** Teto do template em UTF-8, com as imagens embutidas (spec 015, RNF-03): 768 KiB. */
export const TEMPLATE_MAX_BYTES = 768 * 1024;
/** A API devolve no máximo esta quantidade de problemas; com ela, pode haver outros. */
export const TEMPLATE_PROBLEMS_MAX = 200;
/** Tipos de imagem aceitos em `data:` (spec 015, "Higienização"). */
export const TEMPLATE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
/** Intervalo da consulta ao estado do PDF de exemplo, enquanto `pending`. */
export const PREVIEW_POLL_MS = 1500;

export const templateKeys = {
  all: () => ['certificate-template'] as const,
  of: (scope: TemplateScope) =>
    scope.kind === 'course'
      ? (['certificate-template', 'course', scope.courseId] as const)
      : (['certificate-template', 'school'] as const),
  reference: () => ['certificate-template-reference'] as const,
  preview: (id: string) => ['certificate-preview', id] as const,
};

/** O template do curso ou o padrão da escola, com a origem do efetivo. */
export function useCertificateTemplate(scope: TemplateScope) {
  const api = useApi();
  return useQuery({
    queryKey: templateKeys.of(scope),
    queryFn: async ({ signal }): Promise<CertificateTemplate> => {
      const { data } =
        scope.kind === 'course'
          ? await api.GET('/api/v1/courses/{id}/certificate-template', {
              params: { path: { id: scope.courseId } },
              signal,
            })
          : await api.GET('/api/v1/settings/certificate-template', { signal });
      if (!data) throw new Error('GET do template do certificado respondeu sem corpo');
      return data;
    },
  });
}

/**
 * O template mudou: o padrão da escola muda a origem dos cursos sem template próprio, e o do
 * curso, a do próprio curso. Relê todos.
 */
export function templatesChanged(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: templateKeys.all() });
}

/** Palavras-chave e modelo inicial (`GET /certificate-templates/reference`). */
export function useTemplateReference() {
  const api = useApi();
  return useQuery({
    queryKey: templateKeys.reference(),
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }): Promise<CertificateTemplateReference> => {
      const { data } = await api.GET('/api/v1/certificate-templates/reference', { signal });
      if (!data) throw new Error('GET /api/v1/certificate-templates/reference respondeu sem corpo');
      return data;
    },
  });
}

/** Estado de um PDF de exemplo, consultado enquanto está `pending`. */
export function useCertificatePreview(id: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: templateKeys.preview(id ?? ''),
    enabled: id !== null,
    queryFn: async ({ signal }): Promise<CertificatePreview> => {
      const { data } = await api.GET('/api/v1/certificate-templates/previews/{id}', {
        params: { path: { id: id ?? '' } },
        signal,
      });
      if (!data)
        throw new Error('GET /api/v1/certificate-templates/previews/{id} respondeu sem corpo');
      return data;
    },
    refetchInterval: (query) => (query.state.data?.status === 'pending' ? PREVIEW_POLL_MS : false),
  });
}

/**
 * Endereço do PDF de exemplo, aberto numa aba nova: a mesma origem do site, com a sessão do
 * cookie. O admin não monta `iframe` (a CSP dele não tem `frame-src`, ADR 0026).
 */
export function previewPdfPath(id: string): string {
  return `/api/v1/certificate-templates/previews/${encodeURIComponent(id)}/pdf`;
}

/** Corpo do pedido de exemplo: o curso dá o título e o instrutor do PDF; o padrão, nenhum. */
export function templatePreviewInput(
  html: string,
  scope: TemplateScope,
): { html: string; courseId?: string } {
  return scope.kind === 'course' ? { html, courseId: scope.courseId } : { html };
}

/** Tamanho do texto em UTF-8, como a API mede. */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Problemas da recusa `422` `certificate_template_invalid`; `null` quando é outra recusa. */
export function templateProblems(error: unknown): CertificateTemplateProblem[] | null {
  if (!isApiError(error) || error.code !== 'certificate_template_invalid') return null;
  const details: unknown = error.problem.details;
  if (typeof details !== 'object' || details === null) return [];
  const problems: unknown = (details as { problems?: unknown }).problems;
  return Array.isArray(problems) ? (problems as CertificateTemplateProblem[]) : [];
}

/** Posição no texto (índice) da linha e coluna, contadas a partir de 1. */
export function offsetOf(text: string, line: number, column: number): number {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf('\n', offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  const end = text.indexOf('\n', offset);
  const lineLength = (end === -1 ? text.length : end) - offset;
  return offset + Math.min(Math.max(column - 1, 0), lineLength);
}
