import {
  createApiApp,
  databaseReadiness,
  type FastifyInstance,
  type RateLimiterOptions,
  type ReadinessChecks,
  registerMetaRoute,
  type StreamHub,
  type StreamHubOptions,
} from '@nuva-edu/api-kit';
import {
  type Config,
  createOAuth,
  createPaymentProvider,
  createSettingsReader,
  type Database,
  databasePoolStats,
  type ImageProcessingLimiter,
  type Logger,
  listSessions,
  type OAuth,
  type PaymentProvider,
  paymentUnavailable,
  type SettingsReader,
} from '@nuva-edu/core';
import { loadAdminContract } from './contract.ts';
import { readServiceVersion } from './meta.ts';
import { registerAuditRoutes } from './routes/audit.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerBrandingRoutes } from './routes/branding.ts';
import { registerCertificateRoutes } from './routes/certificates.ts';
import { registerCourseRoutes } from './routes/courses.ts';
import { registerEmailOperationsRoutes } from './routes/email-operations.ts';
import { registerEntitlementRoutes } from './routes/entitlements.ts';
import { registerAdminForumRoutes } from './routes/forum.ts';
import { registerImageRoutes } from './routes/images.ts';
import { registerModerationRoutes } from './routes/moderation.ts';
import { registerNotificationRoutes } from './routes/notifications.ts';
import { registerOAuthRoutes } from './routes/oauth.ts';
import { registerOpsJobRoutes } from './routes/ops-jobs.ts';
import { registerPaymentRoutes } from './routes/payments.ts';
import { registerProductRoutes } from './routes/products.ts';
import { registerProgressRoutes } from './routes/progress.ts';
import { registerSalesRoutes } from './routes/sales.ts';
import { registerStreamRoutes } from './routes/stream.ts';
import { registerSubscriptionRoutes } from './routes/subscriptions.ts';
import { registerTermsRoutes } from './routes/terms.ts';
import { registerUserRoutes } from './routes/users.ts';
import {
  adminRateLimits,
  adminSession,
  auditPermissionDenied,
  registerSessionCookieHooks,
  sessionSecurity,
} from './session.ts';
import { type AdminStreamKind, createAdminStreamPipeline } from './stream/events.ts';

export const SERVICE = 'admin-api';

/** O fluxo SSE deste processo, para a subida, os testes e quem precisar derrubar conexões. */
export interface AdminUserEventStream {
  hub: StreamHub<AdminStreamKind>;
  /** `true` enquanto a escuta do `nuva_user_events` está de pé. */
  isListening(): boolean;
  /** Sobe o serviço, se ainda não subiu, e resolve quando a escuta fica ativa. */
  whenListening(): Promise<void>;
  /** Confere agora as sessões dos fluxos abertos (o mesmo que roda a cada intervalo). */
  checkSessions(): Promise<void>;
}

const streams = new WeakMap<FastifyInstance, AdminUserEventStream>();

/** O fluxo SSE de uma API montada por `buildAdminApp`. */
export function userEventStream(app: FastifyInstance): AdminUserEventStream {
  const stream = streams.get(app);
  if (!stream) {
    throw new TypeError('Esta instância não foi montada por buildAdminApp.');
  }
  return stream;
}

export interface AdminAppOptions {
  config: Config;
  db: Database;
  logger: Logger;
  /** Versão exibida em `/api/v1/meta`. Padrão: a do `package.json`. */
  version?: string;
  /** Verificações do `/readyz`. Padrão: banco e migrations. */
  readiness?: ReadinessChecks;
  /**
   * Leitor das configurações da escola (`settings`). Padrão: um por app, com o cache do núcleo
   * e o `logger` do serviço.
   */
  settings?: SettingsReader;
  /**
   * Login social da equipe (spec 007). Padrão: um por app, montado da configuração; os testes
   * passam um com o `fetch` do provedor falso.
   */
  oauth?: OAuth;
  /**
   * Porta de pagamento (specs 012 e 013), usada pelo cancelamento administrativo de assinatura.
   * Padrão: `createPaymentProvider` da configuração, resolvido na primeira chamada; os testes
   * passam o provedor `fake`.
   */
  paymentProvider?: PaymentProvider;
  /** Limitador do processamento de imagens (spec 029). Padrão: o do processo. */
  imageLimiter?: ImageProcessingLimiter;
  /** Relógio do limite de taxa; para os testes. */
  rateLimiter?: RateLimiterOptions;
  /**
   * Intervalo da conferência das sessões dos fluxos SSE abertos, em ms: fluxo de sessão
   * encerrada por outro processo (suspensão `full`, troca de senha, expiração) é fechado.
   * Padrão: 30 s; `0` desliga.
   */
  streamSessionCheckMs?: number;
  /** Ajustes do fluxo SSE (intervalo do `ping`, limites); os padrões são os das specs 003 e 004. */
  stream?: StreamHubOptions;
  /**
   * `false` monta a API sem abrir a escuta do `nuva_user_events`: nenhuma conexão é aberta na
   * subida e o fluxo SSE responde `503`. É para quem só lê rotas e contrato.
   */
  listenUserEvents?: boolean;
}

/**
 * Monta a admin-api sobre a base HTTP comum. Só registra rotas; quem chama decide se escuta
 * numa porta (`main.ts`) ou se injeta requisições (testes).
 */
export function buildAdminApp(options: AdminAppOptions): FastifyInstance {
  const { config, db, logger } = options;
  const ttlDays = config.retention.sessionDays;
  const app = createApiApp({
    contract: loadAdminContract(),
    logger,
    trustedProxies: config.trustedProxies,
    readiness: options.readiness ?? databaseReadiness({ db, connectionString: config.databaseUrl }),
    // Sessão do site admin, papel de equipe e CSRF (spec 007; spec 003 RF-03).
    security: sessionSecurity({ db, ttlDays }),
    rateLimits: adminRateLimits(),
    ...(options.rateLimiter === undefined ? {} : { rateLimiter: options.rateLimiter }),
    // Negação por permissão: `outcome = denied` na auditoria (spec 028).
    onPermissionDenied: auditPermissionDenied(db),
    // Medidor `sse_connections` e fechamento dos fluxos abertos no encerramento do serviço.
    eventStreams: true,
  });
  registerSessionCookieHooks(app, ttlDays);

  // Porta de pagamento montada sob demanda: a API sobe (e as demais rotas respondem) mesmo com o
  // provedor mal configurado; a rota que fala com ele responde `503 payment_provider_unavailable`
  // (spec 013 RF-09). O adaptador do Mercado Pago é injetado pela composição do serviço.
  let configuredProvider: PaymentProvider | null = null;
  const paymentProvider = (): PaymentProvider => {
    if (options.paymentProvider !== undefined) return options.paymentProvider;
    if (configuredProvider !== null) return configuredProvider;
    try {
      configuredProvider = createPaymentProvider(config);
    } catch {
      throw paymentUnavailable();
    }
    return configuredProvider;
  };

  // O fluxo SSE do processo (spec 003, "Fluxo SSE da equipe"; ADR 0028): escuta do canal, filtro
  // a `notification.created`, conferência com o `StreamEvent` do contrato e hub das conexões.
  const streamEventErrors = app.contractSchema('StreamEvent');
  const pipeline = createAdminStreamPipeline({
    config,
    logger,
    ...(options.stream === undefined ? {} : { hub: options.stream }),
    // O cliente gerado confia no contrato: evento que não confere com `StreamEvent` não sai.
    validate: (body) => streamEventErrors(body).map((error) => error.path),
  });
  const hub = pipeline.hub;
  let sessionCheck: NodeJS.Timeout | null = null;

  // Fecha os fluxos cujas sessões deixaram de valer (encerradas em outro processo). Suspensão
  // `full`, troca de senha e exclusão também encerram as sessões, então a lista basta.
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

  // Saída da própria sessão: os fluxos que ela abriu terminam já, sem esperar a conferência
  // periódica. Qualquer rota que encerre a sessão na requisição passa por aqui.
  app.addHook('onResponse', async (request) => {
    const current = adminSession.get(request);
    if (current?.ended) {
      hub.disconnectSession(current.session.id);
    }
  });

  streams.set(app, {
    hub,
    isListening: () => pipeline.isListening(),
    whenListening: async () => {
      await app.ready();
      await pipeline.whenListening();
    },
    checkSessions: () => checkStreamSessions(),
  });

  // Depois da conferência do contrato (gancho registrado antes, na base): se o serviço não
  // sobe, nenhuma conexão com o banco fica para trás.
  app.addHook('onReady', async () => {
    if (options.listenUserEvents === false) {
      return;
    }
    pipeline.start();
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
    await pipeline.close();
  });

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

  // Um leitor por processo: o `/meta` não vai ao banco a cada requisição. Com o `logger`, valor
  // inválido gravado em `settings` gera aviso e vale o padrão (spec 003, "Meta").
  const settings = options.settings ?? createSettingsReader(db, { logger });
  const version = options.version ?? readServiceVersion();

  // `GET /api/v1/meta`: dados públicos da instalação e da marca, sem sessão (spec 003, RF-09).
  registerMetaRoute(app, {
    config,
    version,
    settings,
  });
  registerStreamRoutes(app, { hub, isListening: () => pipeline.isListening() });
  registerAuthRoutes(app, { db, ttlDays });
  // O cookie de retorno é assinado pelo núcleo (HMAC com `SESSION_SECRET`), não pelo
  // `@fastify/cookie`: o app não recebe `cookieSecret`.
  registerOAuthRoutes(app, { db, ttlDays, oauth: options.oauth ?? createOAuth(config) });
  registerImageRoutes(app, {
    db,
    config,
    ...(options.imageLimiter === undefined ? {} : { limiter: options.imageLimiter }),
  });
  registerUserRoutes(app, { db });
  registerAdminForumRoutes(app, { db });
  registerModerationRoutes(app, { db });
  registerAuditRoutes(app, { db });
  registerTermsRoutes(app, { db });
  // Catálogo (spec 009): cursos, módulos, aulas e links de apoio.
  registerCourseRoutes(app, { db });
  // Ebooks, pacotes, itens do pacote e vínculos do ebook.
  registerProductRoutes(app, { db });
  // Direitos de acesso (spec 010): árvore do usuário, concessão e revogação manual.
  registerEntitlementRoutes(app, { db });
  // Progresso para a equipe (spec 014): do usuário, resumo e alunos do curso.
  registerProgressRoutes(app, { db });
  // Planos e assinaturas (spec 012): planos, consulta, cancelamento e reembolso de cobrança.
  registerSubscriptionRoutes(app, { db, provider: paymentProvider });
  // Vendas e checkout (spec 011): pedidos, detalhe, CSV, reembolsos e cupons.
  registerSalesRoutes(app, { db });
  // Pagamentos e webhooks (spec 013): cobranças, avisos com falha/rejeitados e estado do provedor.
  registerPaymentRoutes(app, { db, config });
  // Certificados (spec 015): gestão, templates, exemplos e signatário.
  registerCertificateRoutes(app, { db, config, settings });
  // Central da equipe e preferências por grupo (spec 024).
  registerNotificationRoutes(app, { db });
  // Operação da fila e da identidade da escola (specs 005, 024 e 033).
  registerOpsJobRoutes(app, { db, config, version });
  registerEmailOperationsRoutes(app, { db });
  registerBrandingRoutes(app, { db, settings });
  return app;
}
