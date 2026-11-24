import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { enqueueEmail } from '../notifications/outbox.ts';
import { type AccountSite, type RequestContext, requireIp } from './context.ts';
import { deviceKeyFor, parseUserAgent } from './user-agent.ts';

// Dispositivos (spec 007, "Bloqueio e dispositivo novo"). Dono de `user_devices`: a API do
// respectivo site, por esta função, no login por qualquer método.

export interface LoginDeviceInput {
  userId: string;
  site: AccountSite;
  context: RequestContext;
}

export interface LoginDeviceResult {
  deviceKey: string;
  /** O dispositivo ainda não tinha registro na conta. */
  isNew: boolean;
  /** `account.new_login` enfileirado (dispositivo novo, e não o primeiro login da conta). */
  notified: boolean;
}

/**
 * Confere o dispositivo do login: sem registro na conta, registra e enfileira `account.new_login`
 * (data, IP, navegador, sistema), exceto no primeiro login da conta; conhecido, só atualiza
 * `last_seen_at`. Rode na transação do login (exige transação, por causa do e-mail).
 */
export async function registerLoginDevice(
  trx: Database,
  input: LoginDeviceInput,
): Promise<LoginDeviceResult> {
  const deviceKey = deviceKeyFor(input.context.userAgent);
  const before = await trx
    .selectFrom('userDevices')
    .select(sql<number>`count(*)::int`.as('count'))
    .where('userId', '=', input.userId)
    .executeTakeFirstOrThrow();
  const row = await trx
    .insertInto('userDevices')
    .values({ userId: input.userId, deviceKey })
    .onConflict((oc) =>
      oc.columns(['userId', 'deviceKey']).doUpdateSet({ lastSeenAt: sql<Date>`now()` }),
    )
    .returning(sql<boolean>`(xmax = 0)`.as('inserted'))
    .executeTakeFirstOrThrow();
  const isNew = row.inserted;
  let notified = false;
  if (isNew && before.count > 0) {
    const { browser, os } = parseUserAgent(input.context.userAgent);
    const email = await enqueueEmail(trx, {
      userId: input.userId,
      type: 'account.new_login',
      data: { at: new Date(), ip: requireIp(input.context.ip), browser, os, site: input.site },
    });
    notified = email !== null;
  }
  return { deviceKey, isNew, notified };
}
