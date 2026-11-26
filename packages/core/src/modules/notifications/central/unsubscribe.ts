import { randomBytes } from 'node:crypto';
import type { Database } from '../../../db/database.ts';
import { getNotificationPrefs, type NotificationGroupPrefs } from './prefs.ts';
import {
  isNotificationEmailRequired,
  isNotificationGroup,
  type NotificationGroup,
} from './types.ts';

// Descadastro de um clique (spec 024, "Links com token" e RF-07): o token identifica usuário e
// grupo, não expira e vale para todos os e-mails seguintes do grupo. Dono dos dados: o worker
// gera o token ao montar o e-mail; a classroom-api consome na rota pública, sem login.

/** 32 bytes em hexadecimal minúsculo (restrição `notification_unsubscribe_tokens_token_format`). */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Token do grupo, criado na primeira vez e reaproveitado depois. Só grupos com e-mail
 * desligável têm descadastro; para os obrigatórios (`account`, `purchase`, `support`,
 * `moderation`) não existe link e a função lança `TypeError`. Exige transação aberta: o token
 * nasce junto do e-mail.
 */
export async function getOrCreateUnsubscribeToken(
  trx: Database,
  input: { userId: string; group: NotificationGroup },
): Promise<string> {
  if (!trx.isTransaction) {
    throw new TypeError(
      'getOrCreateUnsubscribeToken exige uma transação aberta (db.transaction()).',
    );
  }
  if (!isNotificationGroup(input.group)) {
    throw new TypeError(`Grupo de notificação desconhecido: ${String(input.group)}.`);
  }
  if (isNotificationEmailRequired(input.group)) {
    throw new TypeError(
      `O grupo "${input.group}" tem e-mail obrigatório e não gera link de descadastro.`,
    );
  }
  const token = randomToken();
  await trx
    .insertInto('notificationUnsubscribeTokens')
    .values({ token, userId: input.userId, group: input.group })
    .onConflict((oc) => oc.columns(['userId', 'group']).doNothing())
    .execute();
  const row = await trx
    .selectFrom('notificationUnsubscribeTokens')
    .select('token')
    .where('userId', '=', input.userId)
    .where('group', '=', input.group)
    .executeTakeFirstOrThrow();
  return row.token;
}

export interface UnsubscribedGroup {
  userId: string;
  group: NotificationGroup;
  /** Preferências efetivas depois do descadastro. */
  prefs: NotificationGroupPrefs;
}

/**
 * Consome o link de descadastro: desliga o e-mail **só do grupo do token** e mantém o canal
 * plataforma como estava. Não exige sessão. Token fora do formato ou desconhecido devolve
 * `null` (a API responde `404`); token de grupo obrigatório não existe, mas se houver, também
 * devolve `null`. Idempotente: repetir o clique mantém a preferência.
 */
export async function unsubscribeByToken(
  db: Database,
  token: string,
): Promise<UnsubscribedGroup | null> {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
    return null;
  }
  const run = async (trx: Database): Promise<UnsubscribedGroup | null> => {
    const row = await trx
      .selectFrom('notificationUnsubscribeTokens')
      .select(['userId', 'group'])
      .where('token', '=', token)
      .executeTakeFirst();
    if (!row) {
      return null;
    }
    const { userId } = row;
    const group = row.group;
    if (!isNotificationGroup(group) || isNotificationEmailRequired(group)) {
      return null;
    }
    const current = await getNotificationPrefs(trx, userId);
    const updated: NotificationGroupPrefs = { ...current[group], email: false };
    await trx
      .insertInto('notificationPrefs')
      .values({
        userId,
        group,
        inApp: updated.inApp,
        email: false,
      })
      .onConflict((oc) =>
        oc.columns(['userId', 'group']).doUpdateSet({
          inApp: updated.inApp,
          email: false,
        }),
      )
      .execute();
    return { userId, group, prefs: updated };
  };
  return db.isTransaction ? run(db) : db.transaction().execute(run);
}

/** Token novo: 32 bytes aleatórios (64 caracteres hex), nunca reaproveitado entre usuários. */
function randomToken(): string {
  return randomBytes(32).toString('hex');
}

/** Valida o formato do token antes de ir ao banco. Exportado para os testes da rota. */
export function isUnsubscribeToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}
