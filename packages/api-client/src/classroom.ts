import type { Client } from 'openapi-fetch';
import { type ApiClientOptions, createApiClient } from './client';
import type { components, operations, paths } from './generated/classroom';

export type ClassroomPaths = paths;
export type ClassroomOperations = operations;
export type ClassroomComponents = components;
/** Esquemas do contrato da classroom-api, por nome: `ClassroomSchemas['Meta']`. */
export type ClassroomSchemas = components['schemas'];
export type ClassroomClient = Client<paths>;

/** Cliente da classroom-api (`apps/classroom-api/openapi.yaml`), para o site classroom. */
export function createClassroomClient(options?: ApiClientOptions): ClassroomClient {
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
