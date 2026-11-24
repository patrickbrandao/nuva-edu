import { listenChannel } from '../../db/channel-listener.ts';
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
 * É `listenChannel` com o canal da fila e sem a carga útil.
 */
export function listenForJobs(options: JobListenerOptions): JobListener {
  const { logger } = options;
  const wake = (): void => {
    try {
      options.onNotify();
    } catch (error) {
      logger?.error({ err: error }, 'Falha ao acordar o consumo da fila');
    }
  };
  return listenChannel({
    connectionString: options.connectionString,
    channel: JOBS_CHANNEL,
    logLabel: 'da fila',
    applicationName: options.applicationName ?? 'nuva-edu-jobs-listener',
    onNotification: wake,
    // Ao reconectar acorda uma vez, pelo que pode ter perdido com a conexão caída.
    onConnected: ({ reconnected }) => {
      if (reconnected) {
        wake();
      }
    },
    ...(logger ? { logger } : {}),
    ...(options.reconnectMinDelayMs === undefined
      ? {}
      : { reconnectMinDelayMs: options.reconnectMinDelayMs }),
    ...(options.reconnectMaxDelayMs === undefined
      ? {}
      : { reconnectMaxDelayMs: options.reconnectMaxDelayMs }),
  });
}
