import type { Client } from 'openapi-fetch';
import { type ApiClientOptions, createApiClient } from './client';
import type { components, operations, paths } from './generated/admin';

export type AdminPaths = paths;
export type AdminOperations = operations;
export type AdminComponents = components;
/** Esquemas do contrato da admin-api, por nome: `AdminSchemas['Meta']`. */
export type AdminSchemas = components['schemas'];
export type AdminClient = Client<paths>;

/** Cliente da admin-api (`apps/admin-api/openapi.yaml`), para o site admin. */
export function createAdminClient(options?: ApiClientOptions): AdminClient {
  return createApiClient<paths>(options);
}

export type { ApiClientOptions } from './client';
export {
  ApiError,
  ApiNetworkError,
  isApiError,
  type Problem,
  type ProblemFieldError,
} from './problem';
