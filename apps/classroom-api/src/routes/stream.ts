import { type FastifyInstance, parseEventId, type StreamHub } from '@nuva-edu/api-kit';
import { type UserEventKind, unauthenticated, unavailable } from '@nuva-edu/core';
import { session } from '../session.ts';

export interface StreamRouteOptions {
  hub: StreamHub<UserEventKind>;
  /** `true` enquanto a escuta do `nuva_user_events` está de pé. */
  isListening: () => boolean;
}

/**
 * `GET /api/v1/stream`: o fluxo SSE do usuário da sessão (spec 004, RF-05). A sessão já foi
 * conferida pelo tratador de `sessionCookie` antes de chegar aqui.
 */
export function registerStreamRoutes(app: FastifyInstance, options: StreamRouteOptions): void {
  const { hub } = options;

  app.operation('openStream', (request, reply) => {
    const current = session.get(request);
    if (!current) {
      throw unauthenticated();
    }
    // Sem a escuta nenhum evento chegaria: o cliente recebe 503 e tenta de novo depois.
    if (!options.isListening()) {
      throw unavailable('database_unavailable', 'O fluxo de eventos está indisponível.');
    }
    // Com o id da sessão, o fluxo fecha quando ela é encerrada (spec 004, "Casos de erro").
    const stream = hub.open(
      current.user.id,
      parseEventId(request.headers['last-event-id']),
      current.id,
    );
    // Cabeçalhos de SSE, contagem em `sse_connections` e fechamento no encerramento do serviço
    // ficam com a base; o fim do fluxo sai na linha de log da própria requisição (499 quando é
    // o cliente que fecha), sem o usuário.
    return app.eventStreams.open(reply, stream);
  });
}
