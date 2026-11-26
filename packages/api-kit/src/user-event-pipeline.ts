import type { Logger } from '@nuva-edu/core';
import { createStreamHub, type StreamHub, type StreamHubOptions } from './stream-hub.ts';
import {
  parseUserStreamEventPayload,
  type StreamEventBody,
  toStreamEventBody,
  type UserEventKinds,
} from './user-events.ts';

/** O que a base pede à escuta do canal: cada aviso e a queda da conexão. */
export interface UserEventChannelHandlers {
  onNotification(payload: string): void;
  onDisconnected(): void;
}

/** A escuta do canal, injetada pelo serviço (o núcleo entrega `listenChannel`). */
export interface UserEventChannelListener {
  isConnected(): boolean;
  whenConnected(): Promise<void>;
  close(): Promise<void>;
}

export interface UserEventPipelineOptions<Kind extends string> {
  /** Tipos que o serviço reconhece e entrega (ADR 0028). */
  kinds: UserEventKinds<Kind>;
  /** Abre a escuta do canal. A base cuida de chamar `onNotification` e `onDisconnected`. */
  listen(handlers: UserEventChannelHandlers): UserEventChannelListener;
  /**
   * Confere o corpo do evento contra o contrato do serviço e devolve os campos recusados. Vazio:
   * entrega. A validação é do serviço: a base não conhece esquema nem OpenAPI.
   */
  validate?: (body: StreamEventBody<Kind>) => readonly string[];
  logger: Logger;
  /** Nome do canal, só nos campos de log. */
  channel?: string;
  /** Ajustes do hub (intervalo do `ping`, limites); os padrões são os das specs 003 e 004. */
  hub?: StreamHubOptions;
}

/**
 * O fluxo de eventos de usuário de um serviço: a escuta do canal, o parser, o filtro por tipo, a
 * conferência contra o contrato e o hub de conexões SSE. Cada API monta o seu, com a própria
 * escuta e o próprio contrato (ADR 0028).
 */
export interface UserEventPipeline<Kind extends string = string> {
  /** As conexões abertas: a rota de stream as abre por `hub.open`. */
  hub: StreamHub<Kind>;
  /** `true` enquanto a escuta do canal está de pé. */
  isListening(): boolean;
  /** Abre a escuta, se ainda não abriu. Idempotente. */
  start(): void;
  /** Resolve quando a escuta fica ativa pela primeira vez (ou já sem escuta, se não abriu). */
  whenListening(): Promise<void>;
  /** Trata uma carga do canal como a escuta faria. Serve à escuta injetada e aos testes. */
  ingest(payload: string): void;
  /** Encerra a escuta e as conexões abertas. */
  close(): Promise<void>;
}

/**
 * Junta as peças do fluxo SSE numa só, com a escuta e a validação injetadas. Evento de tipo que o
 * serviço não entrega é descartado em silêncio, sem ir para o hub: nem chega ao cliente, nem
 * fica guardado para o reenvio por `Last-Event-ID`.
 */
export function createUserEventPipeline<Kind extends string>(
  options: UserEventPipelineOptions<Kind>,
): UserEventPipeline<Kind> {
  const { logger } = options;
  const hub = createStreamHub<Kind>(options.hub);
  const context = options.channel === undefined ? {} : { channel: options.channel };
  let listener: UserEventChannelListener | null = null;

  const ingest = (payload: string): void => {
    const parsed = parseUserStreamEventPayload(payload, options.kinds);
    if (!parsed.ok) {
      // Tipo de outro serviço: descartado sem aviso (o volume do canal é grande, ADR 0028).
      if (parsed.reason === 'foreign_kind') {
        return;
      }
      // Só o motivo: a carga pode trazer identificadores de usuário.
      logger.warn(
        { ...context, reason: parsed.reason },
        'Aviso de evento fora do formato; descartado',
      );
      return;
    }
    if (options.validate) {
      const fields = options.validate(toStreamEventBody(parsed.event));
      if (fields.length > 0) {
        // Só o tipo do evento e o caminho dos campos recusados, nunca os valores.
        logger.warn(
          {
            ...context,
            reason: 'contract_mismatch',
            event: parsed.event.event,
            fields: [...fields],
          },
          'Aviso de evento fora do formato; descartado',
        );
        return;
      }
    }
    hub.publish(parsed.event);
  };

  return {
    hub,
    ingest,
    isListening: () => listener?.isConnected() ?? false,
    start() {
      if (listener) {
        return;
      }
      listener = options.listen({
        onNotification: ingest,
        // Banco indisponível: avisos se perdem, então as conexões SSE são fechadas e o
        // navegador reconecta com espera crescente (spec 004, "Casos de erro").
        onDisconnected: () => hub.closeAll(),
      });
    },
    whenListening: async () => {
      await listener?.whenConnected();
    },
    async close() {
      const current = listener;
      listener = null;
      await current?.close();
      hub.stop();
    },
  };
}
