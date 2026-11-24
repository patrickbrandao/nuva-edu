import {
  createApiApp,
  databaseReadiness,
  type FastifyInstance,
  type ReadinessChecks,
} from '@nuva-edu/api-kit';
import type { Config, Database, Logger } from '@nuva-edu/core';
import { loadClassroomContract } from './contract.ts';
import { readServiceVersion } from './meta.ts';
import { registerMetaRoutes } from './routes/meta.ts';
import { registerStreamRoutes } from './routes/stream.ts';
import { rejectEverySession, type SessionAuthenticator, setSessionUser } from './session.ts';
import { type ChannelListener, listenChannel } from './stream/channel-listener.ts';
import { parseUserEventPayload, USER_EVENTS_CHANNEL } from './stream/events.ts';
import { createStreamHub, type StreamHub, type StreamHubOptions } from './stream/hub.ts';

export const SERVICE = 'classroom-api';

export interface ClassroomAppOptions {
  config: Config;
  db: Database;
  logger: Logger;
  /** Versão exibida em `/api/v1/meta`. Padrão: a do `package.json`. */
  version?: string;
  /** Verificações do `/readyz`. Padrão: banco e migrations. */
  readiness?: ReadinessChecks;
  /**
   * Tratador da sessão (`sessionCookie` do contrato). Padrão: recusa sempre com `401`, até a
   * sessão real existir (Fase 1, spec 007). Os testes injetam um que identifica um usuário.
   */
  authenticate?: SessionAuthenticator;
  /** Ajustes do fluxo SSE (intervalo do `ping`, limites); os padrões são os da spec 004. */
  stream?: StreamHubOptions;
}

/** O fluxo SSE deste processo, para a subida, os testes e quem precisar derrubar conexões. */
export interface UserEventStream {
  hub: StreamHub;
  /** `true` enquanto a escuta do `nuva_user_events` está de pé. */
  isListening(): boolean;
  /** Sobe o serviço, se ainda não subiu, e resolve quando a escuta fica ativa. */
  whenListening(): Promise<void>;
}

const streams = new WeakMap<FastifyInstance, UserEventStream>();

/** O fluxo SSE de uma API montada por `buildClassroomApp`. */
export function userEventStream(app: FastifyInstance): UserEventStream {
  const stream = streams.get(app);
  if (!stream) {
    throw new TypeError('Esta instância não foi montada por buildClassroomApp.');
  }
  return stream;
}

/**
 * Monta a classroom-api sobre a base HTTP comum. Só registra rotas; quem chama decide se escuta
 * numa porta (`main.ts`) ou se injeta requisições (testes). A escuta do `nuva_user_events`
 * (uma conexão por processo) abre na subida (`ready`/`listen`) e fecha no `close`.
 */
export function buildClassroomApp(options: ClassroomAppOptions): FastifyInstance {
  const { config, db, logger } = options;
  const authenticate = options.authenticate ?? rejectEverySession;

  const app = createApiApp({
    contract: loadClassroomContract(),
    logger,
    trustedProxies: config.trustedProxies,
    readiness: options.readiness ?? databaseReadiness({ db, connectionString: config.databaseUrl }),
    security: {
      sessionCookie: async (request) => {
        setSessionUser(request, await authenticate(request));
      },
      // `csrfToken` entra com a primeira operação de escrita (Fase 1, spec 007).
    },
  });

  const hub = createStreamHub(options.stream);
  let listener: ChannelListener | null = null;

  app.metrics.gauge({
    name: 'sse_connections',
    help: 'Conexões SSE abertas neste processo.',
    collect: () => hub.connectionCount(),
  });

  const onNotification = (payload: string): void => {
    const parsed = parseUserEventPayload(payload);
    if (!parsed.ok) {
      // Só o motivo: a carga pode trazer identificadores de usuário.
      logger.warn(
        { channel: USER_EVENTS_CHANNEL, reason: parsed.reason },
        'Aviso de evento fora do formato; descartado',
      );
      return;
    }
    hub.publish(parsed.event);
  };

  streams.set(app, {
    hub,
    isListening: () => listener?.isConnected() ?? false,
    whenListening: async () => {
      await app.ready();
      await listener?.whenConnected();
    },
  });

  // Depois da conferência do contrato (gancho registrado antes, na base): se o serviço não
  // sobe, nenhuma conexão com o banco fica para trás.
  app.addHook('onReady', async () => {
    listener = listenChannel({
      connectionString: config.databaseUrl,
      channel: USER_EVENTS_CHANNEL,
      applicationName: `${SERVICE}-user-events`,
      logger,
      onNotification,
      // Banco indisponível: avisos se perdem, então as conexões SSE são fechadas e o
      // navegador reconecta com espera crescente (spec 004, "Casos de erro").
      onDisconnected: () => hub.closeAll(),
    });
  });
  // Antes de o servidor parar de aceitar conexões: sem isto, os fluxos abertos seguram o
  // encerramento até o prazo do SIGTERM.
  app.addHook('preClose', async () => {
    hub.stop();
  });
  app.addHook('onClose', async () => {
    await listener?.close();
    listener = null;
  });

  registerMetaRoutes(app, { config, version: options.version ?? readServiceVersion() });
  registerStreamRoutes(app, { hub, isListening: () => listener?.isConnected() ?? false });
  return app;
}
