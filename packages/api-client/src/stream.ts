import type { components, paths } from './generated/classroom';
import { streamEventNames } from './generated/classroom-stream';
import { type EventStream, type EventStreamOptions, openEventStream } from './sse';

export { streamEventNames };

/** Um evento do fluxo SSE da classroom depois de lido (união discriminada por `event`). */
export type StreamEvent = components['schemas']['StreamEvent'];
export type StreamEventName = StreamEvent['event'];
/** O evento de um nome: `StreamEventOf<'presence'>`. */
export type StreamEventOf<Name extends StreamEventName> = Extract<StreamEvent, { event: Name }>;

/** Caminho do fluxo no contrato da classroom-api. */
export const STREAM_PATH = '/api/v1/stream' satisfies keyof paths;

export type ClassroomStreamOptions = Omit<
  EventStreamOptions<StreamEvent, StreamEventName>,
  'path' | 'eventNames'
>;
export type ClassroomStream = EventStream;

/**
 * Abre o fluxo SSE da classroom-api com `EventSource`, enviando o cookie de sessão.
 * A reconexão e o `Last-Event-ID` ficam por conta do navegador. O `data` é lido como JSON e
 * tipado pelo contrato, sem validação de esquema: o servidor é a fonte.
 */
export function openClassroomStream(options: ClassroomStreamOptions): ClassroomStream {
  return openEventStream({ ...options, path: STREAM_PATH, eventNames: streamEventNames });
}
