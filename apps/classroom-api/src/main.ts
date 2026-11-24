import { startServer } from '@nuva-edu/api-kit';
import { closeDatabase, createDatabase, createLogger, loadConfigOrExit } from '@nuva-edu/core';
import { buildClassroomApp, SERVICE } from './app.ts';

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

// A sessão não é assinada (spec 007, "Cookies"): `SESSION_SECRET` só assina o cookie de retorno
// do login social e passa a ser exigido com ele (tarefa 153; no Compose, tarefa 157).
const config = loadConfigOrExit({ service: SERVICE, required: [] });
const logger = createLogger({ service: SERVICE, level: config.logLevel });
const db = createDatabase({
  connectionString: config.databaseUrl,
  applicationName: SERVICE,
  logger,
});

try {
  const app = buildClassroomApp({ config, db, logger });
  app.addHook('onClose', () => closeDatabase(db));
  const server = await startServer(app, { port: readPort() });
  logger.info('Serviço no ar', {
    address: server.address,
    env: config.env,
    trusted_proxies: config.trustedProxies,
  });
} catch (error) {
  // Contrato divergente das rotas, porta ocupada, TRUSTED_PROXIES inválido: o serviço não sobe.
  logger.fatal({ err: error }, 'Falha ao subir o serviço');
  await closeDatabase(db).catch(() => {});
  process.exit(1);
}
