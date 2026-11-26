/**
 * Fluxo SSE comum às duas APIs. `classroom` (`./stream.ts`) e `admin` (`./admin-stream.ts`)
 * especializam os tipos do contrato; o comportamento do `EventSource` fica aqui.
 */

export interface EventStreamOptions<Event, Name extends string> {
  /** Origem da API. Padrão: a origem da própria página. */
  baseUrl?: string;
  /** Caminho do fluxo no contrato (`/api/v1/stream`). */
  path: string;
  /** Nomes de evento do discriminador, gerados do contrato. */
  eventNames: readonly Name[];
  /** Chamado a cada evento, inclusive `ping`. Use `switch (event.event)` para afunilar o tipo. */
  onEvent: (event: Event) => void;
  /** Conexão aberta (também depois de cada reconexão automática). */
  onOpen?: () => void;
  /**
   * Conexão caiu ou foi recusada. O navegador reconecta sozinho enquanto `closed` for `false`;
   * com `closed: true` (por exemplo, sessão encerrada) o fluxo terminou e não volta.
   */
  onError?: (info: { closed: boolean }) => void;
  /** Evento cujo `data` não é JSON válido; o evento é descartado. */
  onInvalidEvent?: (info: { event: Name; data: string; cause: unknown }) => void;
  /** Substitui o `EventSource` global (testes). */
  EventSource?: typeof EventSource;
}

export interface EventStream {
  /** Encerra a conexão e desliga a reconexão automática. */
  close(): void;
}

/**
 * Abre um fluxo SSE com `EventSource`, enviando o cookie de sessão. A reconexão e o
 * `Last-Event-ID` ficam por conta do navegador, que repete o último `id` recebido. O `data` é
 * lido como JSON e tipado pelo contrato, sem validação de esquema: o servidor é a fonte.
 */
export function openEventStream<Event, Name extends string>(
  options: EventStreamOptions<Event, Name>,
): EventStream {
  const EventSourceImpl = options.EventSource ?? globalThis.EventSource;
  const source = new EventSourceImpl(`${options.baseUrl ?? ''}${options.path}`, {
    withCredentials: true,
  });

  for (const name of options.eventNames) {
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
      options.onEvent(event as Event);
    });
  }
  source.addEventListener('open', () => options.onOpen?.());
  source.addEventListener('error', () => {
    options.onError?.({ closed: source.readyState === EventSourceImpl.CLOSED });
  });

  return { close: () => source.close() };
}
