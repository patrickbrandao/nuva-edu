import type { Database } from '../../../db/database.ts';
import { type FieldError, validationFailed } from '../../../errors/domain-error.ts';
import {
  isNotificationEmailRequired,
  isNotificationGroup,
  NOTIFICATION_GROUP_DEFINITIONS,
  NOTIFICATION_GROUPS,
  type NotificationGroup,
  notificationGroupHasInApp,
} from './types.ts';

// Preferências por grupo (spec 024, RF-03 e RF-04). A tabela `notification_prefs` só tem linha
// do grupo que o usuário mudou; a ausência vale o padrão do catálogo. Dono dos dados:
// classroom-api (aluno) e admin-api (equipe), sempre por estas funções.

export interface NotificationGroupPrefs {
  /** Canal "plataforma": central e sino. Sempre `false` no grupo `account`. */
  inApp: boolean;
  /** Canal "e-mail". Sempre `true` nos grupos obrigatórios. */
  email: boolean;
}

/** Os onze grupos, cada um com o canal efetivo. */
export type NotificationPrefs = Record<NotificationGroup, NotificationGroupPrefs>;

/** O que o usuário pode mudar: os canais de um, vários ou todos os grupos. */
export type NotificationPrefsUpdate = Partial<
  Record<NotificationGroup, Partial<NotificationGroupPrefs>>
>;

/** Padrões da spec 024: canal plataforma nos grupos que o têm e e-mail conforme o grupo. */
export function defaultNotificationPrefs(): NotificationPrefs {
  return Object.fromEntries(
    NOTIFICATION_GROUPS.map((group) => {
      const definition = NOTIFICATION_GROUP_DEFINITIONS[group];
      return [group, { inApp: definition.inApp, email: definition.emailByDefault }];
    }),
  ) as NotificationPrefs;
}

/**
 * Preferências efetivas do usuário: o padrão do catálogo, sobrescrito pelo que está gravado.
 * Canal fora do formato guardado (não deveria acontecer) volta ao padrão, e os canais que a
 * regra trava são normalizados (`account` sem plataforma, obrigatórios com e-mail ligado).
 */
export async function getNotificationPrefs(
  db: Database,
  userId: string,
): Promise<NotificationPrefs> {
  const rows = await db
    .selectFrom('notificationPrefs')
    .select(['group', 'inApp', 'email'])
    .where('userId', '=', userId)
    .execute();
  return applyStoredPrefs(rows);
}

function applyStoredPrefs(
  rows: readonly { group: string; inApp: boolean; email: boolean }[],
): NotificationPrefs {
  const prefs = defaultNotificationPrefs();
  for (const row of rows) {
    if (!isNotificationGroup(row.group)) {
      continue;
    }
    prefs[row.group] = {
      inApp: notificationGroupHasInApp(row.group) ? row.inApp : false,
      email: isNotificationEmailRequired(row.group) ? true : row.email,
    };
  }
  return prefs;
}

/**
 * Grava as mudanças de preferência e devolve o resultado efetivo. Recusa, com
 * `400 validation_failed`, grupo desconhecido, canal que não é booleano, canal plataforma no
 * grupo `account` e e-mail desligado em grupo obrigatório (RF-04). Só os canais enviados mudam;
 * grupo sem linha ganha o padrão e depois a mudança. Aceita transação; sem ela, abre uma.
 */
export async function setNotificationPrefs(
  db: Database,
  userId: string,
  update: NotificationPrefsUpdate,
): Promise<NotificationPrefs> {
  const changes = resolvePrefsUpdate(update);
  const run = async (trx: Database): Promise<NotificationPrefs> => {
    const current = await getNotificationPrefs(trx, userId);
    for (const [group, change] of changes) {
      const merged = { ...current[group], ...change };
      await trx
        .insertInto('notificationPrefs')
        .values({ userId, group, inApp: merged.inApp, email: merged.email })
        .onConflict((oc) =>
          oc.columns(['userId', 'group']).doUpdateSet({ inApp: merged.inApp, email: merged.email }),
        )
        .execute();
      current[group] = merged;
    }
    return current;
  };
  return db.isTransaction ? run(db) : db.transaction().execute(run);
}

/** Mudanças já validadas: grupo → canais presentes no pedido. */
function resolvePrefsUpdate(
  update: NotificationPrefsUpdate,
): Map<NotificationGroup, Partial<NotificationGroupPrefs>> {
  const errors: FieldError[] = [];
  const changes = new Map<NotificationGroup, Partial<NotificationGroupPrefs>>();
  if (typeof update !== 'object' || update === null || Array.isArray(update)) {
    throw validationFailed([{ path: 'body.prefs', message: 'Envie um objeto por grupo.' }]);
  }
  for (const [group, change] of Object.entries(update)) {
    const path = `body.prefs.${group}`;
    if (!isNotificationGroup(group)) {
      errors.push({ path, message: 'Grupo de notificação desconhecido.' });
      continue;
    }
    if (typeof change !== 'object' || change === null || Array.isArray(change)) {
      errors.push({ path, message: 'Envie os canais do grupo.' });
      continue;
    }
    const resolved: Partial<NotificationGroupPrefs> = {};
    for (const [channel, value] of Object.entries(change)) {
      if (channel !== 'inApp' && channel !== 'email') {
        errors.push({ path: `${path}.${channel}`, message: 'Canal desconhecido.' });
        continue;
      }
      if (typeof value !== 'boolean') {
        errors.push({ path: `${path}.${channel}`, message: 'Use true ou false.' });
        continue;
      }
      resolved[channel] = value;
    }
    if (resolved.inApp === true && !notificationGroupHasInApp(group)) {
      errors.push({
        path: `${path}.inApp`,
        message: 'O grupo account não tem canal plataforma.',
      });
    }
    if (resolved.email === false && isNotificationEmailRequired(group)) {
      errors.push({
        path: `${path}.email`,
        message: 'Este grupo tem e-mail obrigatório e não pode ser desligado.',
      });
    }
    if (errors.length === 0) {
      changes.set(group, resolved);
    }
  }
  if (errors.length > 0) {
    throw validationFailed(errors, 'Preferências de notificação inválidas.');
  }
  return changes;
}
