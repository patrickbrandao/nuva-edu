import { type ClassroomSchemas, isApiError } from '@nuva-edu/api-client/classroom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useApi } from '../api/client';
import { browser } from '../lib/browser';
import { useSession } from '../session/session';

export type MyCertificates = ClassroomSchemas['MyCertificates'];
export type MyCertificate = ClassroomSchemas['MyCertificate'];
export type AwaitingCertificate = ClassroomSchemas['AwaitingCertificate'];
export type CourseCertificateState = ClassroomSchemas['CourseCertificateState'];
export type CertificateVerification = ClassroomSchemas['CertificateVerification'];

/** Validação pública (mapa de telas da spec 006): o formulário e a página de um código. */
export const CERTIFICATES_PATH = '/certificados';
/** Onde o aluno vê os próprios certificados: a seção de `/progresso`. */
export const MY_CERTIFICATES_ID = 'certificados';
export const MY_CERTIFICATES_PATH = `/progresso#${MY_CERTIFICATES_ID}`;
/** Limite de `users.full_name` no contrato. */
export const CERTIFICATE_NAME_MAX = 160;

export function validationPath(code: string): string {
  return `${CERTIFICATES_PATH}/${encodeURIComponent(code)}`;
}

/** Tamanho máximo do código no contrato (`GET /certificates/verify/{code}`). */
export const CODE_MAX_LENGTH = 32;

/**
 * Código como o aluno digitou, no formato impresso: sem espaços, em maiúsculas e, com 12
 * caracteres sem hífen, em `XXXX-XXXX-XXXX` (spec 015, RNF-04). A API aceita as duas formas.
 */
export function normalizeCode(input: string): string {
  const code = input.replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9]{12}$/.test(code)
    ? `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`
    : code;
}

const mineKey = (userId: string | null) => ['certificates', 'mine', userId] as const;

/**
 * Os certificados do aluno (`GET /api/v1/me/certificates`): os emitidos, os cursos concluídos que
 * aguardam o template (`awaitingTemplate`) e o nome que sairá nos próximos.
 */
export function useMyCertificates() {
  const api = useApi();
  const { session } = useSession();
  return useQuery({
    queryKey: mineKey(session?.user.id ?? null),
    enabled: session !== null,
    queryFn: async ({ signal }): Promise<MyCertificates> => {
      const { data } = await api.GET('/api/v1/me/certificates', { signal });
      if (!data) throw new Error('GET /api/v1/me/certificates respondeu sem corpo');
      return data;
    },
  });
}

/**
 * Grava o nome que sai no certificado (`PUT /api/v1/me/certificate-name`), sem prazo de
 * confirmação (ADR 0026). `null` apaga, e passa a valer o nome de exibição. O nome aparece na
 * página do curso, na estante e na lista de certificados: as três consultam de novo.
 */
export function useCertificateName() {
  const api = useApi();
  const client = useQueryClient();
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  return useMutation({
    mutationFn: async (fullName: string | null) => {
      const { data } = await api.PUT('/api/v1/me/certificate-name', { body: { fullName } });
      if (!data) throw new Error('PUT /api/v1/me/certificate-name respondeu sem corpo');
      return data;
    },
    onSuccess: (result) => {
      client.setQueryData<MyCertificates>(mineKey(userId), (mine) =>
        mine ? { ...mine, studentName: result.studentName } : mine,
      );
      void client.invalidateQueries({ queryKey: ['learning'] });
    },
  });
}

/** Por que o PDF não veio: ainda em preparação (`409 certificate_preparing`) ou outra falha. */
export type CertificateDownloadFailure =
  | { certificateId: string; kind: 'preparing' }
  | { certificateId: string; kind: 'error'; error: unknown };

/**
 * Download do PDF (`GET /api/v1/me/certificates/{id}/pdf`): o arquivo vem pela API, com a sessão,
 * e é entregue ao navegador como `certificado-<código>.pdf`. PDF ainda não gerado responde `409`
 * `certificate_preparing`: a tela avisa "em preparação" e consulta os estados de novo. `download`
 * devolve a falha (ou `null`), para a tela avisar.
 */
export function useCertificateDownload() {
  const api = useApi();
  const client = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [failure, setFailure] = useState<CertificateDownloadFailure | null>(null);

  const download = useCallback(
    async (
      certificateId: string,
      code: string | null,
    ): Promise<CertificateDownloadFailure | null> => {
      setPendingId(certificateId);
      setFailure(null);
      let result: CertificateDownloadFailure | null = null;
      try {
        const { data } = await api.GET('/api/v1/me/certificates/{id}/pdf', {
          params: { path: { id: certificateId } },
          headers: { Accept: 'application/pdf, application/problem+json' },
          parseAs: 'blob',
        });
        if (!data) throw new Error('GET /api/v1/me/certificates/{id}/pdf respondeu sem arquivo');
        browser.saveFile(data, code ? `certificado-${code}.pdf` : 'certificado.pdf');
      } catch (error) {
        if (isApiError(error) && error.status === 409 && error.code === 'certificate_preparing') {
          result = { certificateId, kind: 'preparing' };
          void client.invalidateQueries({ queryKey: ['certificates', 'mine'] });
          void client.invalidateQueries({ queryKey: ['learning'] });
        } else {
          result = { certificateId, kind: 'error', error };
        }
      } finally {
        setPendingId(null);
      }
      setFailure(result);
      return result;
    },
    [api, client],
  );

  return { download, pendingId, failure };
}

/** O certificado do código, ou `missing` (`404 certificate_not_found`, qualquer código inválido). */
export type VerificationResult =
  | { kind: 'found'; certificate: CertificateVerification }
  | { kind: 'missing' };

/** Validação pública (`GET /api/v1/certificates/verify/{code}`), sem login. */
export function useCertificateVerification(code: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['certificates', 'verify', code],
    enabled: code !== '',
    queryFn: async ({ signal }): Promise<VerificationResult> => {
      try {
        const { data } = await api.GET('/api/v1/certificates/verify/{code}', {
          params: { path: { code } },
          signal,
        });
        if (!data) throw new Error('GET /api/v1/certificates/verify/{code} respondeu sem corpo');
        return { kind: 'found', certificate: data };
      } catch (error) {
        // código fora do formato (`400`) também é "não encontrado" para quem consulta; `404` sem
        // o código próprio é rota ausente, e vira o aviso de erro
        if (isApiError(error) && (error.code === 'certificate_not_found' || error.status === 400)) {
          return { kind: 'missing' };
        }
        throw error;
      }
    },
  });
}
