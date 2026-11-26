import type { JsonObject } from '../../../db/generated/database.ts';
import {
  NOTIFICATION_TARGET_TYPE_MAX_LENGTH,
  NOTIFICATION_TARGET_TYPE_PATTERN,
  normalizeNotificationData,
} from './types.ts';

// Formato comum do alvo e do autor de uma notificação (spec 024, "Central"; migration 0016).
// Usado por `notify` (que enfileira) e por `createNotification` (que grava no worker).

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface NotificationPayload {
  /** Quem gerou o fato; nulo em aviso do sistema. */
  actorId?: string | null;
  /** Tipo do recurso apontado (`topic`, `course`...), junto com `targetId` ou nulo nos dois. */
  targetType?: string | null;
  targetId?: string | null;
  /** Dados do modelo do tipo; nunca senha nem token. */
  data?: JsonObject;
}

/** Payload já conferido, pronto para a linha e para a tarefa. */
export interface NormalizedNotificationPayload {
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  data: JsonObject;
}

/**
 * Confere e normaliza autor, alvo e dados. O alvo é polimórfico e sem chave estrangeira: aqui só
 * se confere o par (`targetType` com `targetId`, os dois ou nenhum), o formato do tipo e o UUID.
 * Lança `TypeError` para id fora do formato e `NotificationDataError` para o `data`.
 */
export function normalizeNotificationPayload(
  payload: NotificationPayload = {},
): NormalizedNotificationPayload {
  const actorId = normalizeOptionalUuid(payload.actorId, 'actorId');
  const targetType = payload.targetType ?? null;
  const targetId = normalizeOptionalUuid(payload.targetId, 'targetId');
  if ((targetType === null) !== (targetId === null)) {
    throw new TypeError('Notificação: targetType e targetId existem juntos.');
  }
  if (targetType !== null) {
    if (
      typeof targetType !== 'string' ||
      targetType.length > NOTIFICATION_TARGET_TYPE_MAX_LENGTH ||
      !NOTIFICATION_TARGET_TYPE_PATTERN.test(targetType)
    ) {
      throw new TypeError(
        `Notificação: targetType inválido "${String(targetType)}" (minúsculas, até ${NOTIFICATION_TARGET_TYPE_MAX_LENGTH} caracteres).`,
      );
    }
  }
  return {
    actorId,
    targetType,
    targetId,
    data: normalizeNotificationData(payload.data ?? {}),
  };
}

function normalizeOptionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError(`Notificação: ${field} precisa ser um UUID ou nulo.`);
  }
  return value.toLowerCase();
}
