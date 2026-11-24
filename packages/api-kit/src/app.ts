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
import { ResponseContractError, resolveError } from './errors.ts';
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
import { createContractValidator } from './validation.ts';

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
}

declare module 'fastify' {
  interface FastifyInstance {
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
    checkContract(options?: Pick<ContractCheckOptions, 'csrfExceptions'>): ContractReport;
  }
  interface FastifyRequest {
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
  app.decorate('checkContract', (check = {}) =>
    checkContract(contract, routes, { ...check, internalRoutes }),
  );
  app.decorateRequest('operation', null);
  app.decorateRequest('problemCode', null);
  // Preenchido no primeiro gancho de toda requisição.
  app.decorateRequest('client', null as unknown as ClientAddress);

  app.addHook('onRequest', async (request, reply) => {
    request.client = resolveClientAddress(request.socket.remoteAddress, request.headers, trusted);
    reply.header('X-Request-Id', request.id);
  });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.is404 ? 'unmatched' : (request.routeOptions.url ?? 'unmatched');
    const seconds = reply.elapsedTime / 1000;
    if (route !== METRICS_PATH) {
      requestsTotal.inc({ route, method: request.method, status: reply.statusCode });
      requestDuration.observe(seconds, { route, method: request.method });
    }
    const line = {
      method: request.method,
      route,
      status: reply.statusCode,
      duration_ms: Math.round(reply.elapsedTime),
      client_ip: request.client?.ip,
      client_ip_source: request.client?.source,
      peer_ip: request.client?.peerIp,
      ...(request.problemCode === null ? {} : { error_code: request.problemCode }),
    };
    if (PROBE_PATHS.has(route)) {
      request.log.debug(line, 'Requisição atendida');
    } else {
      request.log.info(line, 'Requisição atendida');
    }
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

/** Caminho sem a consulta: é o que vai em `instance`, e a consulta pode carregar um token. */
function pathOf(url: string): string {
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}
