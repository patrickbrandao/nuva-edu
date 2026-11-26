import type { AdminClient, AdminSchemas } from '@nuva-edu/api-client/admin';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useApi } from '../../api/client';

/*
 * Operação da fila, dos e-mails e da identidade da escola (specs 024 e 033). A tela "Operação"
 * é só do `admin` (`ops.manage`); quem não tem a ação não vê o item nem os dados, porque o site
 * nem consulta. Tudo pelo cliente gerado; nenhuma URL escrita à mão.
 */

export type OpsSummary = AdminSchemas['OpsSummary'];
export type OpsJob = AdminSchemas['OpsJob'];
export type OpsJobPage = AdminSchemas['OpsJobPage'];
export type OpsJobStatus = AdminSchemas['OpsJobStatus'];
export type OpsJobTypeSummary = AdminSchemas['OpsJobTypeSummary'];
export type OpsEmail = AdminSchemas['OpsEmail'];
export type OpsEmailPage = AdminSchemas['OpsEmailPage'];
export type OpsEmailStatus = AdminSchemas['OpsEmailStatus'];
export type SchoolBranding = AdminSchemas['SchoolBranding'];
export type SchoolBrandingInput = AdminSchemas['SchoolBrandingInput'];

/** Estados da fila na tela, na ordem em que importam: falha primeiro. */
export const JOB_STATUSES = [
  'failed',
  'queued',
  'running',
] as const satisfies readonly OpsJobStatus[];
/** Estados do e-mail na tela. */
export const EMAIL_STATUSES = ['failed', 'queued'] as const satisfies readonly OpsEmailStatus[];

export const OPS_PAGE_SIZE = 25;

export const opsKeys = {
  summary: () => ['ops', 'summary'] as const,
  jobs: (status: OpsJobStatus) => ['ops', 'jobs', status] as const,
  emails: (status: OpsEmailStatus) => ['ops', 'emails', status] as const,
  branding: () => ['settings', 'branding'] as const,
};

/**
 * Resumo da operação (`GET /api/v1/ops/summary`), também usado pelo selo do menu. `enabled`
 * recebe a ação `ops.manage`: sem ela, nenhuma leitura sai do navegador. Revalida a cada minuto,
 * porque o selo precisa acompanhar as falhas sem recarregar a página.
 */
export function useOpsSummary(enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: opsKeys.summary(),
    queryFn: async ({ signal }): Promise<OpsSummary> => {
      const { data } = await api.GET('/api/v1/ops/summary', { signal });
      if (!data) throw new Error('GET /api/v1/ops/summary respondeu sem corpo');
      return data;
    },
    refetchInterval: 60 * 1000,
    enabled,
  });
}

/** Tarefas da fila num estado (`GET /api/v1/ops/jobs`): concluídas não aparecem. */
export function useOpsJobs(status: OpsJobStatus) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: opsKeys.jobs(status),
    queryFn: async ({ pageParam, signal }): Promise<OpsJobPage> => {
      const { data } = await api.GET('/api/v1/ops/jobs', {
        params: {
          query: pageParam
            ? { status, limit: OPS_PAGE_SIZE, cursor: pageParam }
            : { status, limit: OPS_PAGE_SIZE },
        },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/ops/jobs respondeu sem corpo');
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** E-mails pendentes e com falha (`GET /api/v1/ops/emails`), com o destinatário mascarado. */
export function useOpsEmails(status: OpsEmailStatus) {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: opsKeys.emails(status),
    queryFn: async ({ pageParam, signal }): Promise<OpsEmailPage> => {
      const { data } = await api.GET('/api/v1/ops/emails', {
        params: {
          query: pageParam
            ? { status, limit: OPS_PAGE_SIZE, cursor: pageParam }
            : { status, limit: OPS_PAGE_SIZE },
        },
        signal,
      });
      if (!data) throw new Error('GET /api/v1/ops/emails respondeu sem corpo');
      return data;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** Identidade da escola nos e-mails (`GET /api/v1/settings/branding`, `settings.manage`). */
export function useBranding() {
  const api = useApi();
  return useQuery({
    queryKey: opsKeys.branding(),
    queryFn: async ({ signal }): Promise<SchoolBranding> => {
      const { data } = await api.GET('/api/v1/settings/branding', { signal });
      if (!data) throw new Error('GET /api/v1/settings/branding respondeu sem corpo');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** "Tentar de novo" de uma tarefa com falha (`POST /api/v1/ops/jobs/{id}/retry`). */
export async function retryOpsJob(api: AdminClient, id: string): Promise<OpsJob> {
  const { data } = await api.POST('/api/v1/ops/jobs/{id}/retry', { params: { path: { id } } });
  if (!data) throw new Error('POST /api/v1/ops/jobs/{id}/retry respondeu sem corpo');
  return data;
}

/** "Descartar" uma tarefa com falha (`DELETE /api/v1/ops/jobs/{id}`). */
export async function discardOpsJob(api: AdminClient, id: string): Promise<void> {
  await api.DELETE('/api/v1/ops/jobs/{id}', { params: { path: { id } } });
}

/** "Reenviar" um e-mail com falha (`POST /api/v1/ops/emails/{id}/retry`). */
export async function retryOpsEmail(api: AdminClient, id: string): Promise<OpsEmail> {
  const { data } = await api.POST('/api/v1/ops/emails/{id}/retry', { params: { path: { id } } });
  if (!data) throw new Error('POST /api/v1/ops/emails/{id}/retry respondeu sem corpo');
  return data;
}

/** Grava nome, logotipo, cor de destaque e rodapé juntos (`PUT /api/v1/settings/branding`). */
export async function saveBranding(
  api: AdminClient,
  body: SchoolBrandingInput,
): Promise<SchoolBranding> {
  const { data } = await api.PUT('/api/v1/settings/branding', { body });
  if (!data) throw new Error('PUT /api/v1/settings/branding respondeu sem corpo');
  return data;
}
