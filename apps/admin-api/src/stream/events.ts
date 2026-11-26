import {
  createUserEventPipeline,
  type StreamEventBody,
  type StreamHubOptions,
  type UserEventPipeline,
} from '@nuva-edu/api-kit';
import {
  type Config,
  isUserEventKind,
  type Logger,
  listenChannel,
  USER_EVENTS_CHANNEL,
} from '@nuva-edu/core';

// Fluxo SSE da equipe (spec 003, "Fluxo SSE da equipe"; ADR 0028): o mesmo canal, a mesma
// sequência e o mesmo formato do classroom, filtrados a `notification.created`. A escuta, o
// parser e o hub vêm de `packages/api-kit` (task 630); aqui ficam o filtro do admin, a escuta
// deste processo e a conferência com o `StreamEvent` do contrato do admin.

/** O único tipo que a admin-api entrega: o `notification.created` do titular da sessão. */
export type AdminStreamKind = 'notification.created';

/**
 * O filtro da ADR 0028. Reconhece todos os tipos do núcleo (carga de tipo desconhecido continua
 * gerando aviso no log), mas só entrega `notification.created`; os demais tipos do canal saem
 * como `foreign_kind`, sem entrega e sem reenvio por `Last-Event-ID`.
 */
export const ADMIN_STREAM_KINDS = {
  isKnownKind: isUserEventKind,
  acceptsKind: (kind: string): kind is AdminStreamKind => kind === 'notification.created',
} as const;

export interface AdminStreamPipelineOptions {
  config: Config;
  logger: Logger;
  /**
   * Confere o corpo do evento contra o `StreamEvent` do contrato do admin e devolve os campos
   * recusados. A validação é do serviço: a base não conhece o OpenAPI.
   */
  validate: (body: StreamEventBody<AdminStreamKind>) => readonly string[];
  /** Ajustes do hub (intervalo do `ping`, limites); os padrões são os das specs 003 e 004. */
  hub?: StreamHubOptions;
}

/**
 * O fluxo de eventos de usuário deste processo, com a escuta do `nuva_user_events` própria. A
 * aplicação chama `start` na subida e `close` no encerramento.
 */
export function createAdminStreamPipeline(
  options: AdminStreamPipelineOptions,
): UserEventPipeline<AdminStreamKind> {
  return createUserEventPipeline<AdminStreamKind>({
    kinds: ADMIN_STREAM_KINDS,
    ...(options.hub ? { hub: options.hub } : {}),
    channel: USER_EVENTS_CHANNEL,
    logger: options.logger,
    validate: options.validate,
    listen: ({ onNotification, onDisconnected }) =>
      listenChannel({
        connectionString: options.config.databaseUrl,
        channel: USER_EVENTS_CHANNEL,
        applicationName: 'admin-api-user-events',
        logger: options.logger,
        onNotification,
        onDisconnected,
      }),
  });
}
