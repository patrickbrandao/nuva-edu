import {
  createApiApp,
  databaseReadiness,
  type FastifyInstance,
  type ReadinessChecks,
} from '@nuva-edu/api-kit';
import type { Config, Database, Logger } from '@nuva-edu/core';
import { loadAdminContract } from './contract.ts';
import { readServiceVersion } from './meta.ts';
import { registerMetaRoutes } from './routes/meta.ts';

export const SERVICE = 'admin-api';

export interface AdminAppOptions {
  config: Config;
  db: Database;
  logger: Logger;
  /** Versão exibida em `/api/v1/meta`. Padrão: a do `package.json`. */
  version?: string;
  /** Verificações do `/readyz`. Padrão: banco e migrations. */
  readiness?: ReadinessChecks;
}

/**
 * Monta a admin-api sobre a base HTTP comum. Só registra rotas; quem chama decide se escuta
 * numa porta (`main.ts`) ou se injeta requisições (testes).
 */
export function buildAdminApp(options: AdminAppOptions): FastifyInstance {
  const { config, db, logger } = options;
  const app = createApiApp({
    contract: loadAdminContract(),
    logger,
    trustedProxies: config.trustedProxies,
    readiness: options.readiness ?? databaseReadiness({ db, connectionString: config.databaseUrl }),
    // Sessão e CSRF entram na Fase 1 (spec 007): os tratadores de `sessionCookie` e `csrfToken`
    // são registrados aqui. Hoje todas as operações do contrato são públicas.
    security: {},
  });

  registerMetaRoutes(app, { config, version: options.version ?? readServiceVersion() });
  return app;
}
