import type { FastifyInstance } from '@nuva-edu/api-kit';
import { unauthenticated, unavailable } from '@nuva-edu/core';
import { getSessionUser } from '../session.ts';
import { parseEventId } from '../stream/events.ts';
import type { StreamHub } from '../stream/hub.ts';

export interface StreamRouteOptions {
  hub: StreamHub;
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
    const user = getSessionUser(request);
    if (!user) {
      throw unauthenticated();
    }
    // Sem a escuta nenhum evento chegaria: o cliente recebe 503 e tenta de novo depois.
    if (!options.isListening()) {
      throw unavailable('database_unavailable', 'O fluxo de eventos está indisponível.');
    }
    const stream = hub.open(user.userId, parseEventId(request.headers['last-event-id']));
    // A linha de log da base só sai quando a resposta termina pelo servidor; o fluxo quase
    // sempre acaba pelo cliente, então o fim é registrado aqui. Sem o usuário: basta o
    // `request_id` para cruzar com o proxy.
    const openedAt = performance.now();
    stream.once('close', () => {
      request.log.info(
        { route: request.routeOptions.url, duration_ms: Math.round(performance.now() - openedAt) },
        'Fluxo SSE encerrado',
      );
    });
    reply
      .header('Content-Type', 'text/event-stream')
      .header('Cache-Control', 'no-store')
      // Proxies que seguram a resposta para juntar ou comprimir (nginx e afins) não o fazem.
      .header('X-Accel-Buffering', 'no');
    return stream;
  });
}
