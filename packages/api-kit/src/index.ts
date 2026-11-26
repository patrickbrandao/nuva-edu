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
  type PermissionDeniedContext,
  type PermissionDeniedHandler,
  type SecurityContext,
  type SecurityHandler,
  type SecurityHandlers,
} from './app.ts';
export {
  FORM_MEDIA_TYPE,
  JSON_MEDIA_TYPE,
  MULTIPART_MEDIA_TYPE,
  type MultipartBody,
  readMultipart,
  UploadedFile,
} from './bodies.ts';
export {
  CHECK_CONTRACT_EXIT,
  type CheckContractCommandOptions,
  runCheckContract,
} from './check-contract-command.ts';
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
  PERMISSION_EXTENSION,
  parseContract,
  READ_METHODS,
  type SecurityRequirement,
  toContractPath,
  toRoutePath,
} from './contract.ts';
export {
  API_PREFIX,
  type ContractCheckOptions,
  ContractMismatchError,
  type ContractReport,
  checkContract,
  DEFAULT_INTERNAL_ROUTES,
  type FormatContractReportOptions,
  findMissingErrorResponses,
  findWritesWithoutCsrf,
  formatContractReport,
  formatContractWarnings,
  type RegisteredRoute,
  requiredErrorResponses,
} from './contract-check.ts';
export {
  type ApiCookieAttributes,
  type ApiCookieKind,
  type ApiSite,
  COOKIE_ATTRIBUTES,
  clearApiCookie,
  cookieName,
  readApiCookie,
  type SetApiCookieOptions,
  setApiCookie,
} from './cookies.ts';
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
  type InstallationMeta,
  installationMeta,
  META_OPERATION,
  type MetaConfig,
  type MetaRouteOptions,
  type MetaSettings,
  readPackageVersion,
  registerMetaRoute,
} from './meta.ts';
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
export {
  createRateLimiter,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimiterOptions,
  type RateLimitRule,
  rateLimitByIp,
} from './rate-limit.ts';
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
  createStreamHub,
  type StreamHub,
  type StreamHubOptions,
} from './stream-hub.ts';
export {
  createUserEventPipeline,
  type UserEventChannelHandlers,
  type UserEventChannelListener,
  type UserEventPipeline,
  type UserEventPipelineOptions,
} from './user-event-pipeline.ts';
export {
  OPEN_FRAME,
  type ParsedUserStreamEvent,
  PING_FRAME,
  parseEventId,
  parseUserStreamEventPayload,
  type StreamEventBody,
  toStreamEventBody,
  type UserEventKinds,
  type UserStreamEvent,
  type UserStreamEventRejection,
  userEventFrame,
} from './user-events.ts';
export {
  type ContractValidator,
  createContractValidator,
  type OperationValidator,
  type RequestParts,
  type ResponseCheck,
  type SchemaValidator,
  toFieldErrors,
} from './validation.ts';
