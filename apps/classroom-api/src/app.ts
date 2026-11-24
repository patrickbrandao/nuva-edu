import {
  type Contract,
  createApiApp,
  databaseReadiness,
  type FastifyInstance,
  type ReadinessChecks,
  registerMetaRoute,
} from '@nuva-edu/api-kit';
import {
  type ChannelListener,
  type Config,
  createSettingsReader,
  type Database,
  databasePoolStats,
  type Logger,
  listenChannel,
  type SettingsReader,
  USER_EVENTS_CHANNEL,
} from '@nuva-edu/core';
import { loadClassroomContract } from './contract.ts';
import { readServiceVersion } from './meta.ts';
import { registerStreamRoutes } from './routes/stream.ts';
import { rejectEverySession, type SessionAuthenticator, session } from './session.ts';
import { parseUserEventPayload, toStreamEvent } from './stream/events.ts';
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
  /** Contrato a servir. Padrão: o `openapi.yaml` do serviço. Só o teste do `check-contract` troca. */
  contract?: Contract;
  /**
   * `false` monta a API sem abrir a escuta do `nuva_user_events`: nenhuma conexão com o banco é
   * aberta na subida e o fluxo SSE responde `503`. É para o comando `check-contract`, que só lê
   * rotas e contrato. Padrão: `true`.
   */
  listenUserEvents?: boolean;
  /**
   * Leitor das configurações da escola (`settings`). Padrão: um por app, com o cache do núcleo
   * e o `logger` do serviço. Só consulta o banco na primeira leitura, nunca na montagem.
   */
  settings?: SettingsReader;
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
    contract: options.contract ?? loadClassroomContract(),
    logger,
    trustedProxies: config.trustedProxies,
    readiness: options.readiness ?? databaseReadiness({ db, connectionString: config.databaseUrl }),
    security: {
      sessionCookie: async (request) => {
        session.set(request, await authenticate(request));
      },
      // `csrfToken` entra com a primeira operação de escrita (Fase 1, spec 007).
    },
    // Medidor `sse_connections` e fechamento dos fluxos abertos no encerramento do serviço.
    eventStreams: true,
  });

  const hub = createStreamHub(options.stream);
  let listener: ChannelListener | null = null;

  app.metrics.gauge({
    name: 'db_pool_connections',
    help: 'Conexões do pool do PostgreSQL neste processo, por estado.',
    collect: () => {
      const pool = databasePoolStats(db);
      return [
        { labels: { state: 'active' }, value: pool.active },
        { labels: { state: 'idle' }, value: pool.idle },
        { labels: { state: 'waiting' }, value: pool.waiting },
      ];
    },
  });

  const streamEventErrors = app.contractSchema('StreamEvent');
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
    // O cliente gerado confia no contrato: evento que não confere com `StreamEvent` não sai.
    const errors = streamEventErrors(toStreamEvent(parsed.event));
    if (errors.length > 0) {
      // Só o tipo do evento e o caminho dos campos recusados, nunca os valores.
      logger.warn(
        {
          channel: USER_EVENTS_CHANNEL,
          reason: 'contract_mismatch',
          event: parsed.event.event,
          fields: errors.map((error) => error.path),
        },
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
    if (options.listenUserEvents === false) {
      return;
    }
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
  // Os fluxos abertos já foram encerrados pela base no `preClose`; sobra parar o batimento.
  app.addHook('onClose', async () => {
    hub.stop();
    await listener?.close();
    listener = null;
  });

  // Um leitor por processo: o `/meta` não vai ao banco a cada requisição. Com o `logger`, valor
  // inválido gravado em `settings` gera aviso e vale o padrão (spec 003, "Meta").
  const settings = options.settings ?? createSettingsReader(db, { logger });

  // `GET /api/v1/meta`: dados públicos da instalação e da marca, sem sessão (spec 004, RF-02).
  registerMetaRoute(app, {
    config,
    version: options.version ?? readServiceVersion(),
    settings,
  });
  registerStreamRoutes(app, { hub, isListening: () => listener?.isConnected() ?? false });
  return app;
}
