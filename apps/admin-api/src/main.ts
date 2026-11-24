import { startServer } from '@nuva-edu/api-kit';
import { closeDatabase, createDatabase, createLogger, loadConfigOrExit } from '@nuva-edu/core';
import { buildAdminApp, SERVICE } from './app.ts';
import { ensureInitialAdminOnStartup } from './initial-admin.ts';

/** Porta interna do serviço (spec 031). `PORT` permite outra fora do contêiner. */
function readPort(): number {
  const raw = process.env.PORT;
  if (raw === undefined || raw.trim() === '') {
    return 3000;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT deve ser um número de porta entre 1 e 65535.');
  }
  return port;
}

// Fora do Compose a API sobe sem `ADMIN_EMAIL` e `ADMIN_PASSWORD` (aviso no log) e sem
// `SESSION_SECRET` (só o login social precisa dele); no Compose os três são exigidos com
// `${VAR:?}` (spec 031, "Segredos exigidos"). `ADMIN_PASSWORD` fora de 8 a 128 impede a subida.
const config = loadConfigOrExit({ service: SERVICE, required: [] });
const logger = createLogger({ service: SERVICE, level: config.logLevel });
const db = createDatabase({
  connectionString: config.databaseUrl,
  applicationName: SERVICE,
  logger,
});

try {
  await ensureInitialAdminOnStartup(db, config, logger);
  const app = buildAdminApp({ config, db, logger });
  app.addHook('onClose', () => closeDatabase(db));
  const server = await startServer(app, { port: readPort() });
  logger.info('Serviço no ar', {
    address: server.address,
    env: config.env,
    trusted_proxies: config.trustedProxies,
  });
} catch (error) {
  // Contrato divergente das rotas, porta ocupada, TRUSTED_PROXIES inválido, ADMIN_EMAIL que o
  // núcleo recusa: o serviço não sobe.
  logger.fatal({ err: error }, 'Falha ao subir o serviço');
  await closeDatabase(db).catch(() => {});
  process.exit(1);
}
