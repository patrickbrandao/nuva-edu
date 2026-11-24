import { createLogger, loadConfigOrExit } from '@nuva-edu/core';
import { startApp } from './app.ts';

/** Porta interna dos serviços (spec 031). `PORT` troca, para rodar fora do contêiner. */
const DEFAULT_PORT = 3000;
/** Folga depois do encerramento ordenado antes de forçar a saída. */
const EXIT_GRACE_MS = 5_000;

// Nesta fase o worker não usa segredo algum (SMTP e Mercado Pago entram com as tarefas que os
// usam); a conexão com o banco é sempre obrigatória.
const config = loadConfigOrExit({ service: 'worker', required: [] });
const logger = createLogger({ service: 'worker', level: config.logLevel });

function readPort(): number {
  const raw = process.env.PORT?.trim();
  if (!raw) {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    logger.fatal({ variables: ['PORT'] }, 'PORT deve ser um inteiro entre 1 e 65535');
    process.exit(1);
  }
  return port;
}

for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(event, (error: unknown) => {
    logger.fatal({ err: error }, 'Erro não tratado; encerrando');
    process.exit(1);
  });
}

const app = await startApp({ config, logger, port: readPort() });

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) {
      return;
    }
    stopping = true;
    logger.info({ signal }, 'Sinal recebido; encerrando');
    app.stop().then(
      ({ released }) => {
        logger.info({ released }, 'Worker encerrado');
        process.exitCode = 0;
        // Manipulador que estourou o prazo ainda segura o processo: sai mesmo assim.
        setTimeout(() => process.exit(0), released > 0 ? 0 : EXIT_GRACE_MS).unref();
      },
      (error: unknown) => {
        logger.fatal({ err: error }, 'Falha no encerramento');
        process.exit(1);
      },
    );
  });
}
