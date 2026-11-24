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
  createSettingsReader,
  type Database,
  databasePoolStats,
  type Logger,
  type SettingsReader,
} from '@nuva-edu/core';
import { loadAdminContract } from './contract.ts';
import { readServiceVersion } from './meta.ts';
import { registerAuditRoutes } from './routes/audit.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerImageRoutes } from './routes/images.ts';
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
    // Assina só o cookie de retorno OAuth (tarefa 156); a sessão não é assinada.
    ...(config.sessionSecret === null ? {} : { cookieSecret: config.sessionSecret }),
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
  registerImageRoutes(app, { db });
  registerUserRoutes(app, { db });
  registerAuditRoutes(app, { db });
  registerTermsRoutes(app, { db });
  return app;
}
