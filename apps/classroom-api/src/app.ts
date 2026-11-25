import {
  type Contract,
  createApiApp,
  databaseReadiness,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type RateLimiterOptions,
  type RateLimitRule,
  type ReadinessChecks,
  registerMetaRoute,
} from '@nuva-edu/api-kit';
import {
  assertCsrfToken,
  assertTermsGate,
  type ChannelListener,
  type Config,
  createOAuth,
  createSettingsReader,
  type Database,
  databasePoolStats,
  type ImageProcessingLimiter,
  isDomainError,
  type Logger,
  listenChannel,
  listSessions,
  type OAuth,
  type SettingsReader,
  USER_EVENTS_CHANNEL,
} from '@nuva-edu/core';
import { loadClassroomContract } from './contract.ts';
import { readServiceVersion } from './meta.ts';
import { CLASSROOM_RATE_LIMITS } from './rate-limits.ts';
import { registerAccountRoutes } from './routes/account.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerCatalogRoutes } from './routes/catalog.ts';
import type { RouteContext } from './routes/context.ts';
import { registerImageRoutes } from './routes/images.ts';
import { registerLegalRoutes } from './routes/legal.ts';
import { registerOAuthRoutes } from './routes/oauth.ts';
import { registerStreamRoutes } from './routes/stream.ts';
import {
  createSessionAuthenticator,
  establishSession,
  type SessionAuthenticator,
  session,
} from './session.ts';
import { parseUserEventPayload, toStreamEvent } from './stream/events.ts';
import { createStreamHub, type StreamHub, type StreamHubOptions } from './stream/hub.ts';

export const SERVICE = 'classroom-api';

export interface ClassroomAppOptions {
  config: Config;
  db: Database;
  logger: Logger;
  /** Versão exibida em `/api/v1/meta`. Padrão: a do `package.json`. */
  version?: string;
  /** Verificações do `/readyz`. Padrão: banco e migrations. */
  readiness?: ReadinessChecks;
  /**
   * Tratador da sessão (`sessionCookie` do contrato). Padrão: o cookie conferido no banco
   * (`authenticateSession` do núcleo, spec 007). Os testes do fluxo SSE injetam um falso.
   */
  authenticate?: SessionAuthenticator;
  /** Limites de taxa. Padrão: os da spec 004, RNF-04 (`CLASSROOM_RATE_LIMITS`). */
  rateLimits?: readonly RateLimitRule[];
  /** Relógio e limpeza do limite de taxa; para os testes. */
  rateLimiter?: RateLimiterOptions;
  /**
   * Intervalo da conferência das sessões dos fluxos SSE abertos, em ms: fluxo de sessão
   * encerrada por outro processo (a admin-api suspende, outro processo encerra) é fechado.
   * Padrão: 30 s; `0` desliga.
   */
  streamSessionCheckMs?: number;
  /** Limitador do processamento de imagens; padrão, o do processo. */
  imageLimiter?: ImageProcessingLimiter;
  /** Ajustes do fluxo SSE (intervalo do `ping`, limites); os padrões são os da spec 004. */
  stream?: StreamHubOptions;
  /** Contrato a servir. Padrão: o `openapi.yaml` do serviço. Só o teste do `check-contract` troca. */
  contract?: Contract;
  /**
   * `false` monta a API sem abrir a escuta do `nuva_user_events`: nenhuma conexão com o banco é
   * aberta na subida e o fluxo SSE responde `503`. É para o comando `check-contract`, que só lê
   * rotas e contrato. Padrão: `true`.
   */
  listenUserEvents?: boolean;
  /**
   * Leitor das configurações da escola (`settings`). Padrão: um por app, com o cache do núcleo
   * e o `logger` do serviço. Só consulta o banco na primeira leitura, nunca na montagem.
   */
  settings?: SettingsReader;
  /**
   * Login social (`createOAuth` do núcleo), um por processo. Padrão: o montado da configuração,
   * com o `fetch` global. Os testes passam o do provedor falso (`createFakeOAuthProvider`).
   */
  oauth?: OAuth;
}

/** O fluxo SSE deste processo, para a subida, os testes e quem precisar derrubar conexões. */
export interface UserEventStream {
  hub: StreamHub;
  /** `true` enquanto a escuta do `nuva_user_events` está de pé. */
  isListening(): boolean;
  /** Sobe o serviço, se ainda não subiu, e resolve quando a escuta fica ativa. */
  whenListening(): Promise<void>;
  /** Confere agora as sessões dos fluxos abertos (o mesmo que roda a cada intervalo). */
  checkSessions(): Promise<void>;
}

const streams = new WeakMap<FastifyInstance, UserEventStream>();

/** O fluxo SSE de uma API montada por `buildClassroomApp`. */
export function userEventStream(app: FastifyInstance): UserEventStream {
  const stream = streams.get(app);
  if (!stream) {
    throw new TypeError('Esta instância não foi montada por buildClassroomApp.');
  }
  return stream;
}

/**
 * Monta a classroom-api sobre a base HTTP comum. Só registra rotas; quem chama decide se escuta
 * numa porta (`main.ts`) ou se injeta requisições (testes). A escuta do `nuva_user_events`
 * (uma conexão por processo) abre na subida (`ready`/`listen`) e fecha no `close`.
 */
export function buildClassroomApp(options: ClassroomAppOptions): FastifyInstance {
  const { config, db, logger } = options;
  const ttlDays = config.retention.sessionDays;
  const authenticate = options.authenticate ?? createSessionAuthenticator(db, ttlDays);
  // O tratador de segurança só recebe o `request`; o cookie é apagado ou regravado na resposta.
  const replies = new WeakMap<FastifyRequest, FastifyReply>();

  const app = createApiApp({
    contract: options.contract ?? loadClassroomContract(),
    logger,
    trustedProxies: config.trustedProxies,
    readiness: options.readiness ?? databaseReadiness({ db, connectionString: config.databaseUrl }),
    security: {
      sessionCookie: async (request) => {
        const reply = replies.get(request);
        if (!reply) {
          throw new TypeError('Resposta da requisição não registrada.');
        }
        await establishSession(request, reply, authenticate, ttlDays);
      },
      // Escritas: o `X-CSRF-Token` da sessão e, depois, a trava dos termos pendentes (spec 007).
      csrfToken: async (request) => {
        const current = session.require(request);
        assertCsrfToken(current, request.headers['x-csrf-token']);
        await assertTermsGate(db, current, { method: request.method, path: request.url });
      },
    },
    rateLimits: options.rateLimits ?? CLASSROOM_RATE_LIMITS,
    ...(options.rateLimiter ? { rateLimiter: options.rateLimiter } : {}),
    // Medidor `sse_connections` e fechamento dos fluxos abertos no encerramento do serviço.
    eventStreams: true,
  });

  app.addHook('onRequest', async (request, reply) => {
    replies.set(request, reply);
  });

  const hub = createStreamHub(options.stream);
  let listener: ChannelListener | null = null;
  let sessionCheck: NodeJS.Timeout | null = null;

  // Fecha os fluxos cujas sessões deixaram de valer (encerradas em outro processo). Suspensão
  // `full` e exclusão também encerram as sessões, então a lista das válidas basta.
  const checkStreamSessions = async (): Promise<void> => {
    for (const userId of hub.connectedUsers()) {
      try {
        const valid = await listSessions(db, userId);
        hub.retainSessions(userId, new Set(valid.map((item) => item.id)));
      } catch (error) {
        logger.warn({ err: error }, 'Falha ao conferir as sessões dos fluxos SSE');
        return;
      }
    }
  };

  app.metrics.gauge({
    name: 'db_pool_connections',
    help: 'Conexões do pool do PostgreSQL neste processo, por estado.',
    collect: () => {
      const pool = databasePoolStats(db);
      return [
        { labels: { state: 'active' }, value: pool.active },
        { labels: { state: 'idle' }, value: pool.idle },
        { labels: { state: 'waiting' }, value: pool.waiting },
      ];
    },
  });

  const streamEventErrors = app.contractSchema('StreamEvent');
  const onNotification = (payload: string): void => {
    const parsed = parseUserEventPayload(payload);
    if (!parsed.ok) {
      // Só o motivo: a carga pode trazer identificadores de usuário.
      logger.warn(
        { channel: USER_EVENTS_CHANNEL, reason: parsed.reason },
        'Aviso de evento fora do formato; descartado',
      );
      return;
    }
    // O cliente gerado confia no contrato: evento que não confere com `StreamEvent` não sai.
    const errors = streamEventErrors(toStreamEvent(parsed.event));
    if (errors.length > 0) {
      // Só o tipo do evento e o caminho dos campos recusados, nunca os valores.
      logger.warn(
        {
          channel: USER_EVENTS_CHANNEL,
          reason: 'contract_mismatch',
          event: parsed.event.event,
          fields: errors.map((error) => error.path),
        },
        'Aviso de evento fora do formato; descartado',
      );
      return;
    }
    hub.publish(parsed.event);
  };

  streams.set(app, {
    hub,
    isListening: () => listener?.isConnected() ?? false,
    whenListening: async () => {
      await app.ready();
      await listener?.whenConnected();
    },
    checkSessions: () => checkStreamSessions(),
  });

  // Depois da conferência do contrato (gancho registrado antes, na base): se o serviço não
  // sobe, nenhuma conexão com o banco fica para trás.
  app.addHook('onReady', async () => {
    if (options.listenUserEvents === false) {
      return;
    }
    listener = listenChannel({
      connectionString: config.databaseUrl,
      channel: USER_EVENTS_CHANNEL,
      applicationName: `${SERVICE}-user-events`,
      logger,
      onNotification,
      // Banco indisponível: avisos se perdem, então as conexões SSE são fechadas e o
      // navegador reconecta com espera crescente (spec 004, "Casos de erro").
      onDisconnected: () => hub.closeAll(),
    });
    const interval = options.streamSessionCheckMs ?? 30_000;
    if (interval > 0) {
      sessionCheck = setInterval(() => void checkStreamSessions(), interval);
      sessionCheck.unref();
    }
  });
  // Os fluxos abertos já foram encerrados pela base no `preClose`; sobra parar o batimento.
  app.addHook('onClose', async () => {
    if (sessionCheck) {
      clearInterval(sessionCheck);
      sessionCheck = null;
    }
    hub.stop();
    await listener?.close();
    listener = null;
  });

  // Um leitor por processo: o `/meta` não vai ao banco a cada requisição. Com o `logger`, valor
  // inválido gravado em `settings` gera aviso e vale o padrão (spec 003, "Meta").
  const settings = options.settings ?? createSettingsReader(db, { logger });

  // `GET /api/v1/meta`: dados públicos da instalação e da marca, sem sessão (spec 004, RF-02).
  const oauth = options.oauth ?? createOAuth(config);
  const enabledProviders = new Set<string>(oauth.enabledProviders);
  registerMetaRoute(app, {
    // `authProviders`: só os provedores que o login social montou (spec 007, RF-13).
    config: {
      ...config,
      authProviders: {
        google: enabledProviders.has('google') ? config.authProviders.google : null,
        facebook: enabledProviders.has('facebook') ? config.authProviders.facebook : null,
        apple: enabledProviders.has('apple') ? config.authProviders.apple : null,
      },
    },
    version: options.version ?? readServiceVersion(),
    settings,
  });
  registerStreamRoutes(app, { hub, isListening: () => listener?.isConnected() ?? false });

  const routes: RouteContext = { config, db, hub, ttlDays };
  registerAuthRoutes(app, routes);
  registerOAuthRoutes(app, {
    ...routes,
    oauth,
    // Operações públicas: sessão ausente ou inválida vale `null` (o cookie inválido é apagado).
    optionalSession: async (request, reply) => {
      try {
        return await establishSession(request, reply, authenticate, ttlDays);
      } catch (error) {
        if (isDomainError(error) && (error.status === 401 || error.status === 403)) {
          return null;
        }
        throw error;
      }
    },
  });
  registerAccountRoutes(app, routes);
  registerLegalRoutes(app, routes);
  registerCatalogRoutes(app, routes);
  registerImageRoutes(app, routes, options.imageLimiter ? { limiter: options.imageLimiter } : {});
  return app;
}
