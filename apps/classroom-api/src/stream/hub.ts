import { PassThrough, type Readable } from 'node:stream';
import { formatEvent, OPEN_FRAME, PING_FRAME, type UserEvent } from './events.ts';

export interface StreamHubOptions {
  /** Intervalo do `ping`. Padrão: 25 s (spec 004). */
  pingIntervalMs?: number;
  /** Conexões por usuário; a seguinte derruba a mais antiga. Padrão: 3 (spec 004). */
  maxConnectionsPerUser?: number;
  /** Por quanto tempo um evento pode ser reenviado na reconexão. Padrão: 5 min (spec 004). */
  replayWindowMs?: number;
  /** Teto de eventos guardados por usuário para reenvio. Padrão: 500. */
  replayMaxEventsPerUser?: number;
  /** Bytes pendentes de envio a partir dos quais o cliente lento é derrubado. Padrão: 256 KB. */
  maxPendingBytes?: number;
  /** Relógio, para testes. */
  now?: () => number;
}

export interface StreamHub {
  /**
   * Abre o fluxo de um usuário: o texto SSE a enviar na resposta. Com `lastEventId`, começa
   * pelos eventos guardados de `id` maior. O fluxo termina quando o cliente desconecta, quando
   * passa do limite de conexões do usuário ou num `disconnectUser`/`closeAll`/`stop`.
   */
  open(userId: string, lastEventId?: number): Readable;
  /** Entrega o evento às conexões do destinatário e o guarda para reenvio. Devolve quantas. */
  publish(event: UserEvent): number;
  /** Fecha as conexões de um usuário (sessão encerrada, suspensão `full`). */
  disconnectUser(userId: string): void;
  /** Fecha todas as conexões (banco indisponível); o navegador reconecta sozinho. */
  closeAll(): void;
  /** Conexões abertas agora (métrica `sse_connections`). */
  connectionCount(): number;
  /** Fecha tudo e para o batimento. */
  stop(): void;
}

interface StoredEvent {
  id: number;
  frame: string;
  at: number;
}

/**
 * Distribui os eventos às conexões SSE abertas neste processo. Não fala com o banco: recebe os
 * eventos por `publish` (da escuta única do `nuva_user_events`) e os separa por usuário.
 *
 * O reenvio por `Last-Event-ID` vem da memória deste processo: cobre a queda de rede do
 * navegador, não o reinício da API nem a queda da escuta (o `NOTIFY` não é durável, ADR 0008);
 * nesses casos a interface recarrega as listas.
 */
export function createStreamHub(options: StreamHubOptions = {}): StreamHub {
  const pingIntervalMs = options.pingIntervalMs ?? 25_000;
  const maxPerUser = options.maxConnectionsPerUser ?? 3;
  const replayWindowMs = options.replayWindowMs ?? 5 * 60_000;
  const replayMax = options.replayMaxEventsPerUser ?? 500;
  const maxPendingBytes = options.maxPendingBytes ?? 256 * 1024;
  const now = options.now ?? Date.now;

  /** Conexões por usuário, da mais antiga para a mais nova. */
  const clients = new Map<string, PassThrough[]>();
  const replay = new Map<string, StoredEvent[]>();
  let total = 0;

  const remove = (userId: string, stream: PassThrough): void => {
    const list = clients.get(userId);
    const index = list?.indexOf(stream) ?? -1;
    if (!list || index === -1) {
      return;
    }
    list.splice(index, 1);
    total -= 1;
    if (list.length === 0) {
      clients.delete(userId);
    }
  };

  /** Encerra a resposta do jeito normal: o cliente vê o fim do fluxo e reconecta. */
  const end = (userId: string, stream: PassThrough): void => {
    remove(userId, stream);
    stream.end();
  };

  const send = (userId: string, stream: PassThrough, frame: string): boolean => {
    if (stream.writableLength + stream.readableLength > maxPendingBytes) {
      // Cliente que não lê: derruba a conexão em vez de acumular memória.
      remove(userId, stream);
      stream.destroy();
      return false;
    }
    stream.write(frame);
    return true;
  };

  const fresh = (userId: string): StoredEvent[] => {
    const stored = replay.get(userId);
    if (!stored) {
      return [];
    }
    const limit = now() - replayWindowMs;
    const first = stored.findIndex((entry) => entry.at >= limit);
    if (first === -1) {
      replay.delete(userId);
      return [];
    }
    if (first > 0) {
      stored.splice(0, first);
    }
    return stored;
  };

  const tick = (): void => {
    for (const [userId, list] of clients) {
      for (const stream of [...list]) {
        send(userId, stream, PING_FRAME);
      }
    }
    for (const userId of [...replay.keys()]) {
      fresh(userId);
    }
  };
  let timer: NodeJS.Timeout | null = setInterval(tick, pingIntervalMs);
  timer.unref();

  const closeAll = (): void => {
    for (const [userId, list] of [...clients]) {
      for (const stream of [...list]) {
        end(userId, stream);
      }
    }
  };

  return {
    open(userId, lastEventId) {
      const stream = new PassThrough();
      const list = clients.get(userId) ?? [];
      clients.set(userId, list);
      while (list.length >= maxPerUser) {
        const oldest = list[0];
        if (!oldest) {
          break;
        }
        end(userId, oldest);
      }
      // `end` pode ter esvaziado e removido a lista do mapa.
      const current = clients.get(userId) ?? [];
      clients.set(userId, current);
      current.push(stream);
      total += 1;
      stream.once('close', () => remove(userId, stream));

      stream.write(OPEN_FRAME);
      if (lastEventId !== undefined) {
        for (const entry of fresh(userId)) {
          if (entry.id > lastEventId) {
            stream.write(entry.frame);
          }
        }
      }
      return stream;
    },

    publish(event) {
      const frame = formatEvent(event);
      const stored = fresh(event.userId);
      stored.push({ id: event.id, frame, at: now() });
      if (stored.length > replayMax) {
        stored.splice(0, stored.length - replayMax);
      }
      replay.set(event.userId, stored);

      let delivered = 0;
      for (const stream of [...(clients.get(event.userId) ?? [])]) {
        if (send(event.userId, stream, frame)) {
          delivered += 1;
        }
      }
      return delivered;
    },

    disconnectUser(userId) {
      for (const stream of [...(clients.get(userId) ?? [])]) {
        end(userId, stream);
      }
    },

    closeAll,
    connectionCount: () => total,

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      closeAll();
      replay.clear();
    },
  };
}
