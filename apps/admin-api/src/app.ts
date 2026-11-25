import {
  createApiApp,
  databaseReadiness,
  type FastifyInstance,
  type RateLimiterOptions,
  type ReadinessChecks,
  registerMetaRoute,
} from '@nuva-edu/api-kit';
import {
  type Config,
  createOAuth,
  createSettingsReader,
  type Database,
  databasePoolStats,
  type ImageProcessingLimiter,
  type Logger,
  type OAuth,
  type SettingsReader,
} from '@nuva-edu/core';
import { loadAdminContract } from './contract.ts';
import { readServiceVersion } from './meta.ts';
import { registerAuditRoutes } from './routes/audit.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerCourseRoutes } from './routes/courses.ts';
import { registerImageRoutes } from './routes/images.ts';
import { registerOAuthRoutes } from './routes/oauth.ts';
import { registerTermsRoutes } from './routes/terms.ts';
import { registerUserRoutes } from './routes/users.ts';
import {
  adminRateLimits,
  auditPermissionDenied,
  registerSessionCookieHooks,
  sessionSecurity,
} from './session.ts';

export const SERVICE = 'admin-api';

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
  /** Limitador do processamento de imagens (spec 029). Padrão: o do processo. */
  imageLimiter?: ImageProcessingLimiter;
  /** Relógio do limite de taxa; para os testes. */
  rateLimiter?: RateLimiterOptions;
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
  });
  registerSessionCookieHooks(app, ttlDays);

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

  // `GET /api/v1/meta`: dados públicos da instalação e da marca, sem sessão (spec 003, RF-09).
  registerMetaRoute(app, {
    config,
    version: options.version ?? readServiceVersion(),
    settings,
  });
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
  registerAuditRoutes(app, { db });
  registerTermsRoutes(app, { db });
  // Catálogo (spec 009): cursos, módulos, aulas e links de apoio.
  registerCourseRoutes(app, { db });
  return app;
}
