import type { components, paths } from './generated/classroom';
import { streamEventNames } from './generated/classroom-stream';

export { streamEventNames };

/** Um evento do fluxo SSE depois de lido (união discriminada por `event`). */
export type StreamEvent = components['schemas']['StreamEvent'];
export type StreamEventName = StreamEvent['event'];
/** O evento de um nome: `StreamEventOf<'presence'>`. */
export type StreamEventOf<Name extends StreamEventName> = Extract<StreamEvent, { event: Name }>;

/** Caminho do fluxo no contrato da classroom-api. */
export const STREAM_PATH = '/api/v1/stream' satisfies keyof paths;

export interface ClassroomStreamOptions {
  /** Origem da API. Padrão: a origem da própria página. */
  baseUrl?: string;
  /** Chamado a cada evento, inclusive `ping`. Use `switch (event.event)` para afunilar o tipo. */
  onEvent: (event: StreamEvent) => void;
  /** Conexão aberta (também depois de cada reconexão automática). */
  onOpen?: () => void;
  /**
   * Conexão caiu ou foi recusada. O navegador reconecta sozinho enquanto `closed` for `false`;
   * com `closed: true` (por exemplo, sessão encerrada) o fluxo terminou e não volta.
   */
  onError?: (info: { closed: boolean }) => void;
  /** Evento cujo `data` não é JSON válido; o evento é descartado. */
  onInvalidEvent?: (info: { event: StreamEventName; data: string; cause: unknown }) => void;
  /** Substitui o `EventSource` global (testes). */
  EventSource?: typeof EventSource;
}

export interface ClassroomStream {
  /** Encerra a conexão e desliga a reconexão automática. */
  close(): void;
}

/**
 * Abre o fluxo SSE da classroom-api com `EventSource`, enviando o cookie de sessão.
 * A reconexão e o `Last-Event-ID` ficam por conta do navegador. O `data` é lido como JSON e
 * tipado pelo contrato, sem validação de esquema: o servidor é a fonte.
 */
export function openClassroomStream(options: ClassroomStreamOptions): ClassroomStream {
  const EventSourceImpl = options.EventSource ?? globalThis.EventSource;
  const source = new EventSourceImpl(`${options.baseUrl ?? ''}${STREAM_PATH}`, {
    withCredentials: true,
  });

  for (const name of streamEventNames) {
    source.addEventListener(name, (message: MessageEvent<string>) => {
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch (cause) {
        options.onInvalidEvent?.({ event: name, data: message.data, cause });
        return;
      }
      // `ping` não tem `id`; nos demais o navegador repete o último `id` recebido.
      const event =
        name === 'ping' ? { event: name, data } : { id: message.lastEventId, event: name, data };
      options.onEvent(event as StreamEvent);
    });
  }
  source.addEventListener('open', () => options.onOpen?.());
  source.addEventListener('error', () => {
    options.onError?.({ closed: source.readyState === EventSourceImpl.CLOSED });
  });

  return { close: () => source.close() };
}
