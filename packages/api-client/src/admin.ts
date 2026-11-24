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

export type { ApiClientOptions } from './client';
export { buildOAuthStartUrl, OAUTH_START_PATH, type OAuthStartQuery } from './oauth';
export {
  ApiError,
  ApiNetworkError,
  isApiError,
  type Problem,
  type ProblemFieldError,
} from './problem';
