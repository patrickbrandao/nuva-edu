import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  closeDatabase,
  createDatabase,
  type Database,
  defaultNotificationPrefs,
  filterNotificationRecipients,
  getNotificationPrefs,
  isDomainError,
  NOTIFICATION_GROUPS,
  notificationRecipientSkipReason,
  setNotificationPrefs,
} from '../../../src/index.ts';
import { createUser, inRollback, newId } from './helpers.ts';

let db: Database;

beforeAll(() => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 3 });
});

afterAll(async () => {
  await closeDatabase(db);
});

function validationPaths(error: unknown): string[] {
  if (!isDomainError(error) || error.code !== 'validation_failed') {
    throw error;
  }
  return (error.errors ?? []).map((field) => field.path);
}

describe('preferências por grupo (spec 024, RF-03 e RF-04)', () => {
  it('sem linha gravada vale o padrão da tabela da spec', () => {
    const defaults = defaultNotificationPrefs();
    expect(defaults.account).toEqual({ inApp: false, email: true });
    expect(defaults.purchase).toEqual({ inApp: true, email: true });
    expect(defaults.messages).toEqual({ inApp: true, email: false });
    expect(defaults.community).toEqual({ inApp: true, email: false });
    expect(defaults.announcements).toEqual({ inApp: true, email: false });
    expect(defaults.forum).toEqual({ inApp: true, email: true });
    expect(defaults.staff).toEqual({ inApp: true, email: true });
    expect(Object.keys(defaults)).toEqual([...NOTIFICATION_GROUPS]);
  });

  it('grava só o que mudou e devolve o efetivo', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      expect(await getNotificationPrefs(trx, userId)).toEqual(defaultNotificationPrefs());
      const result = await setNotificationPrefs(trx, userId, {
        forum: { email: false },
        messages: { email: true },
        events: { inApp: false },
      });
      expect(result.forum).toEqual({ inApp: true, email: false });
      expect(result.messages).toEqual({ inApp: true, email: true });
      expect(result.events).toEqual({ inApp: false, email: true });
      expect(result.courses).toEqual(defaultNotificationPrefs().courses);
      // O que não foi enviado continua como estava.
      await setNotificationPrefs(trx, userId, { forum: { inApp: false } });
      const stored = await getNotificationPrefs(trx, userId);
      expect(stored.forum).toEqual({ inApp: false, email: false });
      const rows = await trx
        .selectFrom('notificationPrefs')
        .select(['group', 'inApp', 'email'])
        .where('userId', '=', userId)
        .orderBy('group')
        .execute();
      expect(rows).toHaveLength(3);
    });
  });

  it('recusa grupo, canal e valor inválidos antes de gravar', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      expect(
        validationPaths(
          await setNotificationPrefs(trx, userId, {
            unknown: { email: false },
          } as never).catch((error) => error),
        ),
      ).toContain('body.prefs.unknown');
      expect(
        validationPaths(
          await setNotificationPrefs(trx, userId, {
            forum: { push: true },
          } as never).catch((error) => error),
        ),
      ).toContain('body.prefs.forum.push');
      expect(
        validationPaths(
          await setNotificationPrefs(trx, userId, {
            forum: { email: 'não' },
          } as never).catch((error) => error),
        ),
      ).toContain('body.prefs.forum.email');
      expect(
        validationPaths(await setNotificationPrefs(trx, userId, null as never).catch((e) => e)),
      ).toContain('body.prefs');
      expect(
        validationPaths(
          await setNotificationPrefs(trx, userId, { forum: null } as never).catch((error) => error),
        ),
      ).toContain('body.prefs.forum');
    });
  });

  it('não deixa desligar canal travado pela regra', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      expect(
        validationPaths(
          await setNotificationPrefs(trx, userId, { purchase: { email: false } }).catch(
            (error) => error,
          ),
        ),
      ).toContain('body.prefs.purchase.email');
      expect(
        validationPaths(
          await setNotificationPrefs(trx, userId, { account: { inApp: true } }).catch(
            (error) => error,
          ),
        ),
      ).toContain('body.prefs.account.inApp');
      // Desligar o que já é obrigatório continua aceito no e-mail e no `account` sem plataforma.
      const result = await setNotificationPrefs(trx, userId, {
        account: { email: true, inApp: false },
        support: { email: true },
      });
      expect(result.account).toEqual({ inApp: false, email: true });
      expect(result.support.email).toBe(true);
    });
  });

  it('normaliza a linha gravada e completa os grupos ausentes', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      await trx
        .insertInto('notificationPrefs')
        .values({ userId, group: 'courses', inApp: false, email: false })
        .execute();
      const prefs = await getNotificationPrefs(trx, userId);
      expect(prefs.courses).toEqual({ inApp: false, email: false });
      expect(prefs.account).toEqual({ inApp: false, email: true });
      expect(Object.keys(prefs)).toHaveLength(NOTIFICATION_GROUPS.length);
    });
  });
});

describe('destinatários elegíveis (spec 024)', () => {
  it('remove repetidos e aplica cada regra', async () => {
    await inRollback(db, async (trx) => {
      const actor = await createUser(trx);
      const ok = await createUser(trx);
      const deleted = await createUser(trx, { deletedAt: new Date() });
      const suspended = await createUser(trx, { suspendedKind: 'full' });
      const staff = await createUser(trx, { role: 'instructor' });
      const student = await createUser(trx);
      const missing = newId();
      const result = await filterNotificationRecipients(
        trx,
        'forum.reply',
        [ok, ok.toUpperCase(), actor, deleted, suspended, missing, 'não-é-uuid'],
        { actorId: actor },
      ).catch((error) => error);
      // O id fora do formato é erro de programação, antes de qualquer consulta.
      expect(result).toBeInstanceOf(TypeError);
      const valid = await filterNotificationRecipients(
        trx,
        'forum.reply',
        [ok, ok.toUpperCase(), actor, deleted, suspended, missing],
        { actorId: actor },
      );
      expect(valid.eligible).toEqual([ok]);
      expect(valid.skipped).toEqual([
        { userId: actor, reason: 'actor_self' },
        { userId: deleted, reason: 'recipient_deleted' },
        { userId: suspended, reason: 'recipient_suspended' },
        { userId: missing, reason: 'recipient_not_found' },
      ]);

      const staffResult = await filterNotificationRecipients(trx, 'ticket.opened', [
        staff,
        student,
      ]);
      expect(staffResult.eligible).toEqual([staff]);
      expect(staffResult.skipped).toEqual([{ userId: student, reason: 'not_staff' }]);
    });
  });

  it('deixa a conta suspensa receber só `moderation.suspended`', async () => {
    await inRollback(db, async (trx) => {
      const suspended = await createUser(trx, { suspendedKind: 'posting' });
      const { eligible } = await filterNotificationRecipients(trx, 'moderation.suspended', [
        suspended,
      ]);
      expect(eligible).toEqual([suspended]);
      expect(
        await notificationRecipientSkipReason(trx, {
          userId: suspended,
          type: 'moderation.warning',
        }),
      ).toBe('recipient_suspended');
      expect(
        await notificationRecipientSkipReason(trx, {
          userId: suspended,
          type: 'moderation.suspended',
        }),
      ).toBeNull();
    });
  });

  it('lista vazia não consulta o banco', async () => {
    const result = await filterNotificationRecipients(db, 'forum.reply', []);
    expect(result).toEqual({ eligible: [], skipped: [] });
  });

  it('motivo de um só destinatário', async () => {
    await inRollback(db, async (trx) => {
      const actor = await createUser(trx);
      expect(
        await notificationRecipientSkipReason(trx, {
          userId: actor,
          type: 'forum.reply',
          actorId: actor,
        }),
      ).toBe('actor_self');
      expect(
        await notificationRecipientSkipReason(trx, {
          userId: newId(),
          type: 'forum.reply',
        }),
      ).toBe('recipient_not_found');
    });
  });
});
