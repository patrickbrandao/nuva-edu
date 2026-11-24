import type { FastifyInstance } from 'fastify';

export interface StartServerOptions {
  /** Porta de escuta. A porta interna dos serviços é 3000 (spec 031). */
  port: number;
  /** Endereço de escuta. Padrão: `0.0.0.0`, porque o serviço roda em contêiner. */
  host?: string;
  /** Prazo para as requisições em curso terminarem depois do sinal, em ms. Padrão: 10 s. */
  shutdownTimeoutMs?: number;
  /** Sinais que encerram o serviço. Padrão: `SIGTERM` e `SIGINT`. */
  signals?: readonly NodeJS.Signals[];
  /** Para testes: de onde vêm os sinais e como o processo termina. */
  process?: SignalSource;
  exit?: (code: number) => void;
}

/** O que `startServer` usa de `process`. */
export interface SignalSource {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

export interface RunningServer {
  /** Endereço em que o serviço escuta, como `http://0.0.0.0:3000`. */
  address: string;
  /** Encerra como um SIGTERM faria, sem terminar o processo. */
  close(): Promise<void>;
}

/**
 * Sobe o serviço e instala o encerramento limpo: no SIGTERM o servidor para de aceitar
 * conexões, espera as requisições em curso, roda os ganchos `onClose` (onde cada API fecha o
 * banco) e sai com 0. Se passar do prazo, sai com 1.
 * Falha na subida (contrato divergente, porta ocupada) é lançada para quem chamou.
 */
export async function startServer(
  app: FastifyInstance,
  options: StartServerOptions,
): Promise<RunningServer> {
  const source: SignalSource = options.process ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const signals = options.signals ?? ['SIGTERM', 'SIGINT'];
  const timeoutMs = options.shutdownTimeoutMs ?? 10_000;

  const address = await app.listen({ port: options.port, host: options.host ?? '0.0.0.0' });

  let closing: Promise<void> | undefined;
  const listeners = new Map<NodeJS.Signals, () => void>();
  const removeListeners = () => {
    for (const [signal, listener] of listeners) {
      source.off(signal, listener);
    }
    listeners.clear();
  };
  const close = () => {
    if (!closing) {
      // Conexão keep-alive que termina uma requisição depois do início do fechamento fica
      // ociosa e seguraria o processo até o tempo limite dela: fecha as ociosas até acabar.
      const sweep = setInterval(() => app.server.closeIdleConnections(), 100);
      closing = app.close().finally(() => clearInterval(sweep));
    }
    return closing;
  };

  for (const signal of signals) {
    const listener = () => {
      if (closing) {
        return;
      }
      app.log.info({ signal }, 'Sinal recebido; encerrando o serviço');
      const timer = setTimeout(() => {
        app.log.error({ timeout_ms: timeoutMs }, 'Encerramento passou do prazo; saindo à força');
        exit(1);
      }, timeoutMs);
      timer.unref();
      close().then(
        () => {
          clearTimeout(timer);
          removeListeners();
          app.log.info('Serviço encerrado');
          exit(0);
        },
        (error: unknown) => {
          clearTimeout(timer);
          app.log.error({ err: error }, 'Falha ao encerrar o serviço');
          exit(1);
        },
      );
    };
    listeners.set(signal, listener);
    source.on(signal, listener);
  }

  return {
    address,
    close: async () => {
      removeListeners();
      await close();
    },
  };
}
