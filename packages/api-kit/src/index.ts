// Tipos do Fastify usados pelas APIs: importados daqui, a versão do Fastify fica num lugar só.
export type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
export {
  type ApiAppOptions,
  type ApiEventStreams,
  type ApiInstanceExtensions,
  type ApiRequestExtensions,
  CLIENT_CLOSED_REQUEST_STATUS,
  createApiApp,
  type OperationHandler,
  type OperationOptions,
  type SecurityContext,
  type SecurityHandler,
  type SecurityHandlers,
} from './app.ts';
export {
  type ClientAddress,
  type ClientIpSource,
  createTrustedProxies,
  normalizeAddress,
  resolveClientAddress,
  type TrustedProxies,
} from './client-ip.ts';
export {
  type Contract,
  ContractError,
  type ContractOperation,
  type ContractParameter,
  type ContractResponse,
  CSRF_SCHEME,
  type HttpMethod,
  loadContract,
  PENDING_EXTENSION,
  parseContract,
  READ_METHODS,
  type SecurityRequirement,
  toContractPath,
  toRoutePath,
} from './contract.ts';
export {
  type ContractCheckOptions,
  ContractMismatchError,
  type ContractReport,
  checkContract,
  DEFAULT_INTERNAL_ROUTES,
  type FormatContractReportOptions,
  findWritesWithoutCsrf,
  formatContractReport,
  formatContractWarnings,
  type RegisteredRoute,
} from './contract-check.ts';
export {
  isDatabaseUnavailable,
  payloadTooLarge,
  type ResolvedError,
  ResponseContractError,
  resolveError,
  unsupportedMediaType,
} from './errors.ts';
export {
  type CheckResult,
  createReadinessLogger,
  type DatabaseReadinessOptions,
  DEFAULT_CHECK_TIMEOUT_MS,
  databaseReadiness,
  type ReadinessCheck,
  type ReadinessChecks,
  type ReadinessReport,
  runReadinessChecks,
} from './health.ts';
export {
  type Counter,
  createMetricsRegistry,
  DEFAULT_DURATION_BUCKETS,
  type Gauge,
  type GaugeOptions,
  type Histogram,
  type HistogramOptions,
  type Labels,
  METRICS_CONTENT_TYPE,
  type MetricOptions,
  type MetricsRegistry,
  registerProcessMetrics,
} from './metrics.ts';
export { createRequestState, type RequestState } from './request-state.ts';
export {
  type RunningServer,
  type SignalSource,
  type StartServerOptions,
  startServer,
} from './server.ts';
export {
  createEventStreamTracker,
  type EventStreams,
  type EventStreamTracker,
  formatSseComment,
  formatSseEvent,
  SSE_CONTENT_TYPE,
  SSE_HEADERS,
  type SseEvent,
} from './sse.ts';
export {
  type ContractValidator,
  createContractValidator,
  type OperationValidator,
  type RequestParts,
  type ResponseCheck,
  type SchemaValidator,
  toFieldErrors,
} from './validation.ts';
