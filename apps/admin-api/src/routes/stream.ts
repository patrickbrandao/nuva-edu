import { type FastifyInstance, parseEventId, type StreamHub } from '@nuva-edu/api-kit';
import { unavailable } from '@nuva-edu/core';
import { requireSession } from '../session.ts';
import type { AdminStreamKind } from '../stream/events.ts';

export interface StreamRouteOptions {
  hub: StreamHub<AdminStreamKind>;
  /** `true` enquanto a escuta do `nuva_user_events` está de pé. */
  isListening: () => boolean;
}

/**
 * `GET /api/v1/stream`: o fluxo SSE do sino da equipe (spec 003, "Fluxo SSE da equipe"; ADR
 * 0028). A sessão do admin, a recusa ao `student` e a permissão `admin.access` já foram
 * conferidas pelo tratador de `sessionCookie` antes de chegar aqui.
 */
export function registerStreamRoutes(app: FastifyInstance, options: StreamRouteOptions): void {
  const { hub } = options;

  app.operation('openStream', (request, reply) => {
    // O `sessionCookie` garante a sessão; `requireSession` só a recupera para o fluxo.
    const current = requireSession(request);
    // Sem a escuta nenhum evento chegaria: o cliente recebe 503 e tenta de novo depois.
    if (!options.isListening()) {
      throw unavailable('database_unavailable', 'O fluxo de eventos está indisponível.');
    }
    // Com o id da sessão, o fluxo fecha quando ela é encerrada (spec 004, "Casos de erro"):
    // saída, suspensão `full`, troca de senha ou encerramento por outro processo.
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
