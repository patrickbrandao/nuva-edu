import type { components, paths } from './generated/admin';
import { streamEventNames } from './generated/admin-stream';
import { type EventStream, type EventStreamOptions, openEventStream } from './sse';

export { streamEventNames as adminStreamEventNames };

/** Um evento do fluxo SSE da equipe depois de lido (união discriminada por `event`). */
export type AdminStreamEvent = components['schemas']['StreamEvent'];
export type AdminStreamEventName = AdminStreamEvent['event'];
/** O evento de um nome: `AdminStreamEventOf<'notification.created'>`. */
export type AdminStreamEventOf<Name extends AdminStreamEventName> = Extract<
  AdminStreamEvent,
  { event: Name }
>;

/** Caminho do fluxo no contrato da admin-api. */
export const ADMIN_STREAM_PATH = '/api/v1/stream' satisfies keyof paths;

export type AdminStreamOptions = Omit<
  EventStreamOptions<AdminStreamEvent, AdminStreamEventName>,
  'path' | 'eventNames'
>;
export type AdminStream = EventStream;

/**
 * Abre o fluxo SSE da equipe na admin-api com `EventSource`, enviando o cookie da sessão do
 * próprio host (o cookie do classroom não vale aqui). O contrato só entrega
 * `notification.created` do titular e o `ping`; os demais tipos do canal são descartados pelo
 * servidor. A reconexão e o `Last-Event-ID` ficam por conta do navegador, e a central recarrega
 * listas e contadores a cada reconexão.
 */
export function openAdminStream(options: AdminStreamOptions): AdminStream {
  return openEventStream({
    ...options,
    path: ADMIN_STREAM_PATH,
    eventNames: streamEventNames,
  });
}
