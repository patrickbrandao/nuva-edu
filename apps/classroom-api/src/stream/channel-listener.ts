import { type Logger, summarizeDatabaseError } from '@nuva-edu/core';
import pg from 'pg';

export interface ChannelListenerOptions {
  /** `config.databaseUrl`. A escuta usa uma conexão própria, fora do pool. */
  connectionString: string;
  /** Canal do `LISTEN`. Só letras minúsculas, dígitos e `_`. */
  channel: string;
  /** Chamado a cada `NOTIFY` do canal, com a carga útil (texto vazio quando não há). */
  onNotification: (payload: string) => void;
  /** Escuta ativa: na primeira conexão e depois de cada reconexão. */
  onConnected?: () => void;
  /** A conexão caiu. Avisos emitidos até a reconexão se perdem. */
  onDisconnected?: () => void;
  logger?: Logger;
  /** Aparece em `pg_stat_activity`. */
  applicationName?: string;
  /** Primeira espera antes de reconectar; dobra a cada falha seguida. Padrão: 1 s. */
  reconnectMinDelayMs?: number;
  /** Teto da espera de reconexão. Padrão: 30 s. */
  reconnectMaxDelayMs?: number;
}

export interface ChannelListener {
  /** `true` enquanto a conexão está de pé e escutando. */
  isConnected(): boolean;
  /** Resolve quando a escuta fica ativa pela primeira vez. */
  whenConnected(): Promise<void>;
  /** Encerra a escuta e para de reconectar. */
  close(): Promise<void>;
}

const CHANNEL_PATTERN = /^[a-z_][a-z0-9_]*$/;

/**
 * Escuta um canal do PostgreSQL numa conexão dedicada, com reconexão de espera crescente. Não
 * lança se o banco estiver fora. É o `listenForJobs` do core generalizado para qualquer canal e
 * com a carga útil; candidato a morar em `packages/core` (pedido aberto ao `nucleo`).
 */
export function listenChannel(options: ChannelListenerOptions): ChannelListener {
  const { logger, channel } = options;
  if (!CHANNEL_PATTERN.test(channel)) {
    throw new TypeError(`Nome de canal inválido: "${channel}".`);
  }
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

  const call = (callback: (() => void) | undefined, what: string): void => {
    try {
      callback?.();
    } catch (error) {
      logger?.error({ err: error, channel }, what);
    }
  };

  const drop = (current: pg.Client, error?: unknown): void => {
    if (client !== current) {
      return;
    }
    const wasConnected = connected;
    client = null;
    connected = false;
    current.removeAllListeners();
    // Um cliente abandonado ainda pode emitir `error`; sem ouvinte, derruba o processo.
    current.on('error', () => {});
    current.end().catch(() => {});
    if (closed) {
      return;
    }
    if (wasConnected) {
      call(options.onDisconnected, 'Falha ao tratar a queda da escuta do canal');
    }
    const delay = Math.min(minDelay * 2 ** failures, maxDelay);
    failures += 1;
    logger?.warn(
      { err: summarizeDatabaseError(error), channel, retry_in_ms: delay },
      'Escuta do canal caiu; reconectando',
    );
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, delay);
  };

  const connect = async (): Promise<void> => {
    const current = new pg.Client({
      connectionString: options.connectionString,
      application_name: options.applicationName ?? `nuva-edu-${channel}-listener`,
      connectionTimeoutMillis: 5_000,
    });
    client = current;
    current.on('error', (error) => drop(current, error));
    current.on('end', () => drop(current));
    current.on('notification', (message) => {
      if (message.channel !== channel) {
        return;
      }
      try {
        options.onNotification(message.payload ?? '');
      } catch (error) {
        // Sem a carga no log: ela pode trazer identificadores de usuário.
        logger?.error({ err: error, channel }, 'Falha ao tratar o aviso do canal');
      }
    });
    try {
      await current.connect();
      await current.query(`LISTEN ${channel}`);
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
      logger?.info({ channel }, 'Escuta do canal reconectada');
    } else {
      everConnected = true;
      resolveFirst();
    }
    call(options.onConnected, 'Falha ao tratar a conexão da escuta do canal');
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
