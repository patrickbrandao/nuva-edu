import type { Client } from 'openapi-fetch';
import { type ApiClientOptions, createApiClient } from './client';
import type { components, operations, paths } from './generated/admin';
import { buildOAuthStartUrl } from './oauth';

export type AdminPaths = paths;
export type AdminOperations = operations;
export type AdminComponents = components;
/** Esquemas do contrato da admin-api, por nome: `AdminSchemas['Meta']`. */
export type AdminSchemas = components['schemas'];
export type AdminClient = Client<paths>;
/** `Session` do site admin; difere da `Session` da classroom-api, que tem o mesmo nome. */
export type AdminSession = components['schemas']['Session'];
export type AdminAuthProvider = components['schemas']['AuthProvider'];
export type AdminOAuthStartQuery = NonNullable<operations['startOAuth']['parameters']['query']>;
/**
 * Finalidade de imagem do admin (`product_cover` ou `school_logo`); difere da `ImagePurpose` da
 * classroom-api.
 */
export type AdminImagePurpose = components['schemas']['ImagePurpose'];

/** Cliente da admin-api (`apps/admin-api/openapi.yaml`), para o site admin. */
export function createAdminClient(options?: ApiClientOptions): AdminClient {
  return createApiClient<paths>(options);
}

/**
 * URL de `startOAuth` do admin, para o navegador navegar até ela (`window.location.assign`).
 * A operação só responde `302`: não a chame por `fetch`.
 */
export function adminOAuthStartUrl(
  provider: AdminAuthProvider,
  query: AdminOAuthStartQuery = {},
  baseUrl?: string,
): string {
  return buildOAuthStartUrl(provider, query, baseUrl);
}

/**
 * Envia uma imagem do admin (`uploadImage`, `POST /api/v1/images`) em `multipart/form-data`,
 * como a capa de um produto ou o logotipo da escola. Mesmo formato do `uploadImage` do classroom:
 * recebe o `File`/`Blob` e monta o `FormData`; o `Content-Type`, com o `boundary`, fica por conta
 * do `fetch`.
 */
export function uploadAdminImage(
  client: AdminClient,
  file: Blob,
  purpose: AdminImagePurpose,
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

export {
  ADMIN_STREAM_PATH,
  type AdminStream,
  type AdminStreamEvent,
  type AdminStreamEventName,
  type AdminStreamEventOf,
  type AdminStreamOptions,
  adminStreamEventNames,
  openAdminStream,
} from './admin-stream';
export type { ApiClientOptions } from './client';
export { buildOAuthStartUrl, OAUTH_START_PATH, type OAuthStartQuery } from './oauth';
export {
  ApiError,
  ApiNetworkError,
  isApiError,
  type Problem,
  type ProblemFieldError,
} from './problem';
