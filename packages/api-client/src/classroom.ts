import type { Client } from 'openapi-fetch';
import { type ApiClientOptions, createApiClient } from './client';
import type { components, operations, paths } from './generated/classroom';
import { buildOAuthStartUrl } from './oauth';

export type ClassroomPaths = paths;
export type ClassroomOperations = operations;
export type ClassroomComponents = components;
/** Esquemas do contrato da classroom-api, por nome: `ClassroomSchemas['Meta']`. */
export type ClassroomSchemas = components['schemas'];
export type ClassroomClient = Client<paths>;
/** `Session` do classroom; difere da `Session` da admin-api, que tem o mesmo nome. */
export type ClassroomSession = components['schemas']['Session'];
export type ClassroomAuthProvider = components['schemas']['AuthProvider'];
export type ImagePurpose = components['schemas']['ImagePurpose'];
export type ClassroomOAuthStartQuery = NonNullable<operations['startOAuth']['parameters']['query']>;

/** Cliente da classroom-api (`apps/classroom-api/openapi.yaml`), para o site classroom. */
export function createClassroomClient(options?: ApiClientOptions): ClassroomClient {
  return createApiClient<paths>(options);
}

/**
 * URL de `startOAuth` do classroom, para o navegador navegar até ela
 * (`window.location.assign`). A operação só responde `302`: não a chame por `fetch`.
 */
export function classroomOAuthStartUrl(
  provider: ClassroomAuthProvider,
  query: ClassroomOAuthStartQuery = {},
  baseUrl?: string,
): string {
  return buildOAuthStartUrl(provider, query, baseUrl);
}

/**
 * Envia uma imagem (`uploadImage`, `POST /api/v1/images`) em `multipart/form-data`.
 *
 * O contrato declara `file` como `string` com `contentMediaType` (OpenAPI 3.1), e o tipo gerado
 * fica `string`; aqui ele recebe o `File`/`Blob` e monta o `FormData`. O `Content-Type`, com o
 * `boundary`, fica por conta do `fetch`; o tipo de cada parte é o `type` do próprio arquivo.
 */
export function uploadImage(
  client: ClassroomClient,
  file: Blob,
  purpose: ImagePurpose,
  init: { signal?: AbortSignal } = {},
) {
  return client.POST('/api/v1/images', {
    ...init,
    body: { purpose, file: '' },
    bodySerializer: () => {
      const form = new FormData();
      form.append('purpose', purpose);
      form.append('file', file, file instanceof File ? file.name : 'imagem');
      return form;
    },
  });
}

export type { ApiClientOptions } from './client';
export { buildOAuthStartUrl, OAUTH_START_PATH, type OAuthStartQuery } from './oauth';
export {
  ApiError,
  ApiNetworkError,
  isApiError,
  type Problem,
  type ProblemFieldError,
} from './problem';
export {
  type ClassroomStream,
  type ClassroomStreamOptions,
  openClassroomStream,
  STREAM_PATH,
  type StreamEvent,
  type StreamEventName,
  type StreamEventOf,
  streamEventNames,
} from './stream';
