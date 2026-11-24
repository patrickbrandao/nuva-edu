import { STATUS_CODES } from 'node:http';
import type { Socket } from 'node:net';
import type { Readable } from 'node:stream';
import {
  type Logger,
  notFound,
  PROBLEM_CONTENT_TYPE,
  type Problem,
  REQUEST_ID_HEADER,
  resolveRequestId,
  toProblem,
  validationFailed,
} from '@nuva-edu/core';
import fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  LogController,
} from 'fastify';
import {
  type ClientAddress,
  createTrustedProxies,
  normalizeAddress,
  resolveClientAddress,
} from './client-ip.ts';
import type { Contract, ContractOperation } from './contract.ts';
import {
  type ContractCheckOptions,
  ContractMismatchError,
  type ContractReport,
  checkContract,
  DEFAULT_INTERNAL_ROUTES,
  type RegisteredRoute,
} from './contract-check.ts';
import { ResponseContractError, resolveError, unsupportedMediaType } from './errors.ts';
import {
  createReadinessLogger,
  DEFAULT_CHECK_TIMEOUT_MS,
  type ReadinessChecks,
  runReadinessChecks,
} from './health.ts';
import {
  createMetricsRegistry,
  DEFAULT_DURATION_BUCKETS,
  METRICS_CONTENT_TYPE,
  type MetricsRegistry,
  registerProcessMetrics,
} from './metrics.ts';
import { createEventStreamTracker, type EventStreams, SSE_HEADERS } from './sse.ts';
import { createContractValidator, type SchemaValidator } from './validation.ts';

/** Onde uma exigência de segurança está sendo conferida. */
export interface SecurityContext {
  /** Operação do contrato que a requisição pediu. */
  operation: ContractOperation;
  /** Nome do esquema em `components.securitySchemes` (`sessionCookie`, `csrfToken`...). */
  scheme: string;
  /** Escopos pedidos pela operação para este esquema (vazio nos esquemas `apiKey`). */
  scopes: readonly string[];
}

/**
 * Ponto de extensão da autenticação: confere UM esquema de segurança do contrato. Roda antes da
 * validação da requisição e antes da rota. Para recusar, lança um `DomainError`
 * (`unauthenticated()`, `permissionDenied()` ou o de código `csrf_token_invalid`); se voltar
 * sem lançar, a exigência está atendida. Pode guardar o resultado em `request` (decorado pela
 * API) para a rota e os esquemas seguintes usarem.
 */
export type SecurityHandler = (
  request: FastifyRequest,
  context: SecurityContext,
) => void | Promise<void>;

/** Um tratador por esquema de segurança do contrato. */
export type SecurityHandlers = Readonly<Record<string, SecurityHandler>>;

export type OperationHandler = (request: FastifyRequest, reply: FastifyReply) => unknown;

export interface OperationOptions {
  /** Limite do corpo desta operação, em bytes, quando difere do padrão do serviço. */
  bodyLimit?: number;
}

export interface ApiAppOptions {
  /** Contrato do serviço (`loadContract`). */
  contract: Contract;
  /** Logger do core (`createLogger`); as linhas de requisição levam `request_id`. */
  logger: Logger;
  /** `config.trustedProxies`: de quem os cabeçalhos de IP do proxy são aceitos (spec 031). */
  trustedProxies: readonly string[];
  /** Verificações do `/readyz`; nas APIs, `databaseReadiness(...)`. */
  readiness: ReadinessChecks;
  /**
   * Tratadores dos esquemas de segurança do contrato. Toda operação registrada precisa ter
   * tratador para os esquemas que declara; operação pública (`security: []`) não usa nenhum.
   */
  security?: SecurityHandlers;
  /** Rotas fora do contrato além de `GET /metrics`, no formato `MÉTODO /caminho`. */
  internalRoutes?: readonly string[];
  /** Limite padrão do corpo, em bytes. Padrão: 1 MB (spec 003, RNF-02). */
  bodyLimit?: number;
  /** Prazo de cada verificação do `/readyz`, em ms. */
  readinessTimeoutMs?: number;
  /** Registro de métricas já existente; por padrão a base cria um. */
  metrics?: MetricsRegistry;
  /**
   * `true` no serviço que tem fluxo SSE: registra o medidor `sse_connections` e fecha os fluxos
   * abertos no `preClose`. Sem isto, `app.eventStreams.open(...)` lança.
   */
  eventStreams?: boolean;
}

/**
 * Status registrado no log e em `http_requests_total` quando o cliente fecha a conexão antes
 * de a resposta terminar (o fim normal de um fluxo SSE). É o código que o nginx usa para o
 * mesmo caso; nunca vai ao cliente.
 */
export const CLIENT_CLOSED_REQUEST_STATUS = 499;

/**
 * Campos que a API acrescenta ao `request`, com tipo e sem depender de `fastify`:
 *
 * ```ts
 * declare module '@nuva-edu/api-kit' {
 *   interface ApiRequestExtensions { session: SessionUser | null }
 * }
 * app.decorateRequest('session', null);
 * ```
 *
 * Para um dado que não precisa estar no `request`, `createRequestState` é mais simples.
 */
// biome-ignore lint/suspicious/noEmptyInterface: ponto de extensão preenchido por quem usa o pacote.
export interface ApiRequestExtensions {}

/** Campos que a API acrescenta à instância (`app.decorate`), como `ApiRequestExtensions`. */
// biome-ignore lint/suspicious/noEmptyInterface: ponto de extensão preenchido por quem usa o pacote.
export interface ApiInstanceExtensions {}

/** Fluxos SSE do serviço, mais a abertura de um fluxo numa resposta. */
export interface ApiEventStreams extends EventStreams {
  /**
   * Prepara a resposta SSE (cabeçalhos `SSE_HEADERS`), passa a contar o fluxo em
   * `sse_connections` e o devolve para a rota retornar: `return app.eventStreams.open(reply, s)`.
   */
  open<T extends Readable>(reply: FastifyReply, stream: T): T;
}

declare module 'fastify' {
  interface FastifyInstance extends ApiInstanceExtensions {
    /** Contrato que este serviço implementa. */
    contract: Contract;
    /** Registro de métricas exposto em `/metrics`; as APIs criam as suas aqui. */
    metrics: MetricsRegistry;
    /**
     * Registra a rota de uma operação do contrato. Método, caminho, segurança e validação de
     * requisição e de resposta vêm do contrato; é a única forma de criar rota de negócio.
     * O valor devolvido pela função é o corpo da resposta (status 200, ou o de `reply.status`).
     */
    operation(operationId: string, handler: OperationHandler, options?: OperationOptions): void;
    /** Rotas registradas até agora. */
    registeredRoutes(): RegisteredRoute[];
    /** Compara as rotas registradas com o contrato; é o que o teste de contrato chama. */
    checkContract(
      options?: Pick<ContractCheckOptions, 'csrfExceptions' | 'allowPending'>,
    ): ContractReport;
    /**
     * Validador de um esquema avulso de `components.schemas` do contrato (como `StreamEvent`):
     * `app.contractSchema('StreamEvent')(valor)` devolve os campos recusados.
     */
    contractSchema(name: string): SchemaValidator;
    /** Fluxos SSE abertos; exige `eventStreams: true` em `createApiApp`. */
    eventStreams: ApiEventStreams;
  }
  interface FastifyRequest extends ApiRequestExtensions {
    /** IP real do cliente e IP da conexão, já resolvidos conforme `TRUSTED_PROXIES`. */
    client: ClientAddress;
    /** Operação do contrato atendida; `null` em `/metrics` e em rota inexistente. */
    operation: ContractOperation | null;
    /** `code` do problem+json enviado, quando a requisição terminou em erro. */
    problemCode: string | null;
  }
}

const HEALTH_PATH = '/healthz';
const READINESS_PATH = '/readyz';
const METRICS_PATH = '/metrics';
/** Sondas: uma linha de log por chamada só no nível `debug`. */
const PROBE_PATHS = new Set([HEALTH_PATH, READINESS_PATH, METRICS_PATH]);

/** Cabeçalhos que só um proxy acrescenta: com eles, a requisição veio de fora. */
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-real-ip', 'forwarded'];

/** De onde o `/metrics` aceita conexão direta: laço local e redes privadas. */
const INTERNAL_NETWORKS = [
  '127.0.0.0/8',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '::1/128',
  'fc00::/7',
];

/**
 * Cria o Fastify de uma API do nuva-edu, já com: id de requisição, IP real, log por requisição,
 * erros em problem+json, `/healthz`, `/readyz`, `/metrics` e a conferência do contrato na
 * subida. As rotas de negócio entram por `app.operation(...)`.
 */
export function createApiApp(options: ApiAppOptions): FastifyInstance {
  const { contract, logger } = options;
  const validator = createContractValidator(contract);
  const trusted = createTrustedProxies(options.trustedProxies);
  const internal = createTrustedProxies(INTERNAL_NETWORKS);
  const security = options.security ?? {};
  const internalRoutes = [...DEFAULT_INTERNAL_ROUTES, ...(options.internalRoutes ?? [])];

  // O logger do core segue a interface do pino que o Fastify usa.
  const loggerInstance: FastifyBaseLogger = logger;
  const app = fastify({
    loggerInstance,
    // A linha de log de cada requisição é escrita aqui, com os campos da spec 033.
    logController: new LogController({
      disableRequestLogging: true,
      requestIdLogLabel: 'request_id',
    }),
    genReqId: (request) => resolveRequestId(request.headers[REQUEST_ID_HEADER]),
    trustProxy: (address: string) => trusted.contains(normalizeAddress(address) ?? ''),
    bodyLimit: options.bodyLimit ?? 1024 * 1024,
    // Só existe a rota que o contrato descreve: nada de HEAD automático.
    exposeHeadRoutes: false,
    return503OnClosing: true,
    // Requisição que o Node recusa antes de existir `request` (HTTP malformado, corpo cortado).
    clientErrorHandler: (error, socket) => rejectMalformedRequest(logger, error, socket),
  });

  const metrics = options.metrics ?? createMetricsRegistry();
  if (!options.metrics) {
    registerProcessMetrics(metrics);
  }
  const requestsTotal = metrics.counter({
    name: 'http_requests_total',
    help: 'Requisições HTTP atendidas, por rota, método e status.',
  });
  const requestDuration = metrics.histogram({
    name: 'http_request_duration_seconds',
    help: 'Duração das requisições HTTP, em segundos, por rota e método.',
    buckets: DEFAULT_DURATION_BUCKETS,
  });

  const routes: RegisteredRoute[] = [];
  app.addHook('onRoute', (route) => {
    for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
      routes.push({ method, path: route.url });
    }
  });

  app.decorate('contract', contract);
  app.decorate('metrics', metrics);
  app.decorate('registeredRoutes', () => [...routes]);
  // Pendente que já tem rota: não impede nada, mas a marca precisa sair do contrato (spec 003).
  const warnPendingWithRoute = (report: ContractReport): void => {
    if (report.pendingWithRoute.length > 0) {
      logger.warn(
        { operations: report.pendingWithRoute },
        'Operações com x-nuva-pending já têm rota: a marca precisa sair do contrato',
      );
    }
  };
  app.decorate('checkContract', (check = {}) => {
    const report = checkContract(contract, routes, { ...check, internalRoutes });
    warnPendingWithRoute(report);
    return report;
  });
  app.decorate('contractSchema', (name) => validator.schema(name));

  const streams = createEventStreamTracker();
  if (options.eventStreams) {
    metrics.gauge({
      name: 'sse_connections',
      help: 'Conexões SSE abertas neste processo.',
      collect: () => streams.count(),
    });
    // Antes de o servidor parar de aceitar conexões: fluxo aberto seguraria o encerramento
    // até o prazo do SIGTERM.
    app.addHook('preClose', async () => {
      streams.closeAll();
    });
  }
  app.decorate('eventStreams', {
    count: streams.count,
    closeAll: streams.closeAll,
    open(reply, stream) {
      if (!options.eventStreams) {
        throw new TypeError('Fluxo SSE exige "eventStreams: true" em createApiApp.');
      }
      streams.track(stream);
      reply.headers(SSE_HEADERS);
      return stream;
    },
  });
  app.decorateRequest('operation', null);
  app.decorateRequest('problemCode', null);
  // Preenchido no primeiro gancho de toda requisição.
  app.decorateRequest('client', null as unknown as ClientAddress);

  // Cada requisição é registrada (log e métricas) uma vez só: no fim da resposta ou, se o
  // cliente fechar antes, no aborto. O que chegar depois é ignorado.
  const replies = new WeakMap<FastifyRequest, FastifyReply>();
  const settled = new WeakSet<FastifyRequest>();
  const settle = (request: FastifyRequest, status: number, elapsedMs: number, aborted: boolean) => {
    if (settled.has(request)) {
      return;
    }
    settled.add(request);
    const route = request.is404 ? 'unmatched' : (request.routeOptions.url ?? 'unmatched');
    if (route !== METRICS_PATH) {
      requestsTotal.inc({ route, method: request.method, status });
      requestDuration.observe(elapsedMs / 1000, { route, method: request.method });
    }
    const line = {
      method: request.method,
      route,
      status,
      duration_ms: Math.round(elapsedMs),
      client_ip: request.client?.ip,
      client_ip_source: request.client?.source,
      peer_ip: request.client?.peerIp,
      ...(aborted ? { aborted: true } : {}),
      ...(request.problemCode === null ? {} : { error_code: request.problemCode }),
    };
    const message = aborted ? 'Requisição encerrada pelo cliente' : 'Requisição atendida';
    if (PROBE_PATHS.has(route)) {
      request.log.debug(line, message);
    } else {
      request.log.info(line, message);
    }
  };

  app.addHook('onRequest', async (request, reply) => {
    replies.set(request, reply);
    request.client = resolveClientAddress(request.socket.remoteAddress, request.headers, trusted);
    reply.header('X-Request-Id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    settle(request, reply.statusCode, reply.elapsedTime, false);
  });

  // O cliente fechou a conexão antes do fim da resposta (o caso normal do SSE): o `onResponse`
  // não roda, então a linha de log e a métrica saem daqui, com o status convencional 499.
  app.addHook('onRequestAbort', async (request) => {
    settle(request, CLIENT_CLOSED_REQUEST_STATUS, replies.get(request)?.elapsedTime ?? 0, true);
  });

  const sendProblem = (request: FastifyRequest, reply: FastifyReply, candidate: Problem) => {
    let problem = candidate;
    if (request.operation) {
      const check = validator
        .for(request.operation)
        .validateResponse(problem.status, PROBLEM_CONTENT_TYPE, problem);
      if (!check.ok && check.reason === 'undeclared_status') {
        // O cliente recebe o erro certo; o aviso serve para o contrato ganhar a resposta.
        request.log.warn(
          { operation: request.operation.operationId, status: problem.status },
          'Resposta de erro com status que o contrato não declara',
        );
      } else if (!check.ok) {
        request.log.error(
          { operation: request.operation.operationId, reason: check.reason },
          check.detail,
        );
        problem = toProblem(new ResponseContractError(check.reason, check.detail), {
          instance: problem.instance,
        });
      }
    }
    request.problemCode = problem.code;
    if (typeof problem.retryAfterSeconds === 'number') {
      reply.header('Retry-After', String(problem.retryAfterSeconds));
    }
    // Texto pronto: não passa de novo pela validação de resposta.
    return reply
      .status(problem.status)
      .header('Content-Type', PROBLEM_CONTENT_TYPE)
      .send(JSON.stringify(problem));
  };

  app.setErrorHandler((error, request, reply) => {
    const { problem, kind } = resolveError(error, pathOf(request.url));
    if (kind === 'unexpected') {
      request.log.error(
        { err: error, error_code: problem.code, operation: request.operation?.operationId },
        'Erro ao atender a requisição',
      );
    }
    return sendProblem(request, reply, problem);
  });

  app.setNotFoundHandler((request, reply) =>
    sendProblem(request, reply, resolveError(notFound(), pathOf(request.url)).problem),
  );

  app.decorate('operation', (operationId, handler, operationOptions = {}) => {
    const operation = contract.operation(operationId);
    for (const requirement of operation.security) {
      for (const scheme of Object.keys(requirement)) {
        if (!security[scheme]) {
          throw new TypeError(
            `A operação "${operationId}" exige o esquema de segurança "${scheme}", que não tem tratador em "security".`,
          );
        }
      }
    }
    const checks = validator.for(operation);

    app.route({
      method: operation.method.toUpperCase(),
      url: operation.routePath,
      ...(operationOptions.bodyLimit === undefined
        ? {}
        : { bodyLimit: operationOptions.bodyLimit }),
      // Sessão e CSRF vêm antes da validação: a falta deles é 401/403, não 400 (spec 003).
      onRequest: async (request) => {
        request.operation = operation;
        await authorize(request, operation, security);
      },
      preValidation: async (request) => {
        if (!checks.acceptsContentType(request.headers['content-type'], request.body)) {
          const accepted = Object.keys(operation.requestBody?.content ?? {}).join(' ou ');
          throw unsupportedMediaType(`Tipo de conteúdo não aceito. Use ${accepted}.`);
        }
        const errors = checks.validateRequest({
          params: request.params,
          query: request.query,
          headers: request.headers,
          body: request.body,
          contentType: request.headers['content-type'],
        });
        if (errors.length > 0) {
          throw validationFailed(errors, 'A requisição não confere com o contrato da API.');
        }
      },
      preSerialization: async (_request, reply, payload) => {
        const contentType = reply.getHeader('content-type');
        const check = checks.validateResponse(
          reply.statusCode,
          typeof contentType === 'string' ? contentType : undefined,
          payload,
        );
        if (!check.ok) {
          throw new ResponseContractError(check.reason, check.detail);
        }
        return payload;
      },
      handler: async (request, reply) => {
        const result = await handler(request, reply);
        // Sem corpo: confere aqui, porque o Fastify não chama `preSerialization` sem carga.
        if (result === undefined && !reply.sent) {
          const check = checks.validateResponse(reply.statusCode, undefined, undefined);
          if (!check.ok) {
            throw new ResponseContractError(check.reason, check.detail);
          }
        }
        return result;
      },
    });
  });

  // Sondas do processo (spec 033). Estão no contrato, então passam pela mesma validação.
  const health = contract.find('get', HEALTH_PATH);
  const readiness = contract.find('get', READINESS_PATH);
  if (health) {
    app.operation(health.operationId, () => ({ status: 'ok' }));
  }
  if (readiness) {
    const logReadiness = createReadinessLogger(logger);
    app.operation(readiness.operationId, async (_request, reply) => {
      const report = await runReadinessChecks(
        options.readiness,
        options.readinessTimeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS,
      );
      logReadiness(report);
      reply.status(report.status === 'ready' ? 200 : 503);
      return { status: report.status, checks: report.checks };
    });
  }

  // Fora do contrato e só para a rede interna: o proxy não a roteia (spec 031) e, se rotear por
  // engano, a requisição chega com cabeçalho de proxy e é recusada como rota inexistente.
  app.get(METRICS_PATH, (request, reply) => {
    const viaProxy = PROXY_HEADERS.some((header) => request.headers[header] !== undefined);
    if (viaProxy || !internal.contains(request.client.peerIp)) {
      return sendProblem(request, reply, resolveError(notFound(), METRICS_PATH).problem);
    }
    return reply.header('Content-Type', METRICS_CONTENT_TYPE).send(metrics.render());
  });

  // Contrato e rotas divergentes: o serviço não sobe (spec 003).
  app.addHook('onReady', async () => {
    const report = checkContract(contract, routes, { internalRoutes });
    if (report.routesMissingInContract.length > 0 || report.operationsMissingInApp.length > 0) {
      throw new ContractMismatchError(contract.source, {
        ...report,
        writesWithoutCsrf: [],
        staleCsrfExceptions: [],
        ok: false,
      });
    }
    // Sem rota é o caso normal da janela de contrato: só informa.
    if (report.pendingOperations.length > 0) {
      logger.info(
        { operations: report.pendingOperations },
        'Operações do contrato com x-nuva-pending ainda sem rota',
      );
    }
    warnPendingWithRoute(report);
  });

  return app;
}

/**
 * Confere as alternativas do `security` na ordem do contrato: basta uma passar inteira. Dentro
 * de uma alternativa os esquemas rodam na ordem declarada (sessão antes do CSRF). Se nenhuma
 * passar, vale o erro da primeira.
 */
async function authorize(
  request: FastifyRequest,
  operation: ContractOperation,
  handlers: SecurityHandlers,
): Promise<void> {
  let firstError: unknown;
  for (const [index, requirement] of operation.security.entries()) {
    try {
      for (const [scheme, scopes] of Object.entries(requirement)) {
        await handlers[scheme]?.(request, { operation, scheme, scopes });
      }
      return;
    } catch (error) {
      if (index === 0) {
        firstError = error;
      }
    }
  }
  if (operation.security.length > 0) {
    throw firstError;
  }
}

/**
 * Erro do analisador HTTP do Node (`clientError`): a requisição nem chega ao Fastify, então a
 * resposta é escrita direto no soquete. Erro de análise vira `400 validation_failed` em
 * problem+json; corpo menor do que o `Content-Length` anunciado leva `errors: [{ path: 'body' }]`
 * (spec 003, "Códigos de erro"). Prazo esgotado (408) e cabeçalhos grandes demais (431) não têm
 * código na spec e saem como no Fastify.
 */
function rejectMalformedRequest(
  logger: Logger,
  error: Error & { code?: string },
  socket: Socket,
): void {
  // Conexão derrubada: não há a quem responder.
  if (error.code === 'ECONNRESET' || socket.destroyed) {
    return;
  }
  const requestId = resolveRequestId(undefined);
  let status = 400;
  let contentType = PROBLEM_CONTENT_TYPE;
  let body: string;
  if (error.code === 'ERR_HTTP_REQUEST_TIMEOUT') {
    status = 408;
    contentType = 'application/json';
    body = `{"error":"${STATUS_CODES[status]}","message":"Client Timeout","statusCode":408}`;
  } else if (error.code === 'HPE_HEADER_OVERFLOW') {
    status = 431;
    contentType = 'application/json';
    body = `{"error":"${STATUS_CODES[status]}","message":"Exceeded maximum allowed HTTP header size","statusCode":431}`;
  } else {
    const truncatedBody = error.code === 'HPE_INVALID_EOF_STATE';
    const detail = truncatedBody
      ? 'O Content-Length não confere com o corpo enviado.'
      : 'Requisição HTTP malformada.';
    body = JSON.stringify(
      toProblem(validationFailed(truncatedBody ? [{ path: 'body', message: detail }] : [], detail)),
    );
  }
  logger.debug(
    { request_id: requestId, status, parser_code: error.code },
    'Requisição recusada antes do roteamento',
  );
  if (socket.writable) {
    socket.write(
      `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\n` +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Content-Type: ${contentType}\r\n` +
        `X-Request-Id: ${requestId}\r\n` +
        `Connection: close\r\n\r\n${body}`,
    );
  }
  socket.destroy(error);
}

/** Caminho sem a consulta: é o que vai em `instance`, e a consulta pode carregar um token. */
function pathOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}
