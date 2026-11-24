import pg from 'pg';
import { summarizeDatabaseError } from '../../db/database.ts';
import type { Logger } from '../../logging/logger.ts';

/** Canal do `NOTIFY` emitido pelos gatilhos de `jobs` (migration 0002). Sem conteúdo. */
export const JOBS_CHANNEL = 'nuva_jobs';

export interface JobListenerOptions {
  /** `config.databaseUrl`. A escuta usa uma conexão própria, fora do pool. */
  connectionString: string;
  /**
   * Chamado a cada aviso de tarefa pronta e depois de cada reconexão (avisos emitidos com a
   * conexão caída se perdem). Deve só acordar o laço de consumo; não espere nada dele.
   */
  onNotify: () => void;
  logger?: Logger;
  /** Aparece em `pg_stat_activity`. Padrão: `nuva-edu-jobs-listener`. */
  applicationName?: string;
  /** Primeira espera antes de reconectar; dobra a cada falha seguida. Padrão: 1 s. */
  reconnectMinDelayMs?: number;
  /** Teto da espera de reconexão. Padrão: 30 s. */
  reconnectMaxDelayMs?: number;
}

export interface JobListener {
  /** `true` enquanto a conexão está de pé e escutando. */
  isConnected(): boolean;
  /** Resolve quando a escuta fica ativa pela primeira vez. */
  whenConnected(): Promise<void>;
  /** Encerra a escuta e para de reconectar. */
  close(): Promise<void>;
}

/**
 * Escuta o canal `nuva_jobs` numa conexão dedicada, para o worker acordar sem esperar a
 * varredura. Não lança se o banco estiver fora: tenta de novo com espera crescente. A escuta é
 * um atalho, não uma garantia: o worker mantém a varredura periódica.
 */
export function listenForJobs(options: JobListenerOptions): JobListener {
  const { logger } = options;
  const minDelay = options.reconnectMinDelayMs ?? 1_000;
  const maxDelay = options.reconnectMaxDelayMs ?? 30_000;

  let client: pg.Client | null = null;
  let connected = false;
  let everConnected = false;
  let closed = false;
  let failures = 0;
  let timer: NodeJS.Timeout | null = null;
  let resolveFirst: () => void = () => {};
  const first = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });

  const wake = (): void => {
    try {
      options.onNotify();
    } catch (error) {
      logger?.error({ err: error }, 'Falha ao acordar o consumo da fila');
    }
  };

  const drop = (current: pg.Client, error?: unknown): void => {
    if (client !== current) {
      return;
    }
    client = null;
    connected = false;
    current.removeAllListeners();
    // Um cliente abandonado ainda pode emitir `error`; sem ouvinte, derruba o processo.
    current.on('error', () => {});
    current.end().catch(() => {});
    if (closed) {
      return;
    }
    const delay = Math.min(minDelay * 2 ** failures, maxDelay);
    failures += 1;
    logger?.warn(
      { err: summarizeDatabaseError(error), retry_in_ms: delay },
      'Escuta da fila caiu; reconectando',
    );
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, delay);
  };

  const connect = async (): Promise<void> => {
    const current = new pg.Client({
      connectionString: options.connectionString,
      application_name: options.applicationName ?? 'nuva-edu-jobs-listener',
      connectionTimeoutMillis: 5_000,
    });
    client = current;
    current.on('error', (error) => drop(current, error));
    current.on('end', () => drop(current));
    current.on('notification', (message) => {
      if (message.channel === JOBS_CHANNEL) {
        wake();
      }
    });
    try {
      await current.connect();
      await current.query(`LISTEN ${JOBS_CHANNEL}`);
    } catch (error) {
      drop(current, error);
      return;
    }
    if (client !== current) {
      return;
    }
    connected = true;
    failures = 0;
    if (everConnected) {
      logger?.info('Escuta da fila reconectada');
      wake();
    } else {
      everConnected = true;
      resolveFirst();
    }
  };

  void connect();

  return {
    isConnected: () => connected,
    whenConnected: () => first,
    close: async () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      const current = client;
      client = null;
      connected = false;
      if (current) {
        current.removeAllListeners();
        current.on('error', () => {});
        await current.end().catch(() => {});
      }
    },
  };
}
