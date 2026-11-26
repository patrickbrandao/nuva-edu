import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  closeDatabase,
  createDatabase,
  type Database,
  defaultNotificationPrefs,
  getNotificationPrefs,
  getOrCreateUnsubscribeToken,
  isUnsubscribeToken,
  setNotificationPrefs,
  unsubscribeByToken,
} from '../../../src/index.ts';
import { createUser, inRollback, newId } from './helpers.ts';

let db: Database;

beforeAll(() => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 2 });
});

afterAll(async () => {
  await closeDatabase(db);
});

describe('token de descadastro (spec 024, RF-07)', () => {
  it('cria uma vez por usuário e grupo e reaproveita depois', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      const first = await getOrCreateUnsubscribeToken(trx, { userId, group: 'forum' });
      const second = await getOrCreateUnsubscribeToken(trx, { userId, group: 'forum' });
      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(second).toBe(first);
      expect(isUnsubscribeToken(first)).toBe(true);
      const other = await getOrCreateUnsubscribeToken(trx, { userId, group: 'courses' });
      expect(other).not.toBe(first);
    });
  });

  it('recusa grupo obrigatório, grupo desconhecido e transação ausente', async () => {
    const userId = newId();
    await expect(getOrCreateUnsubscribeToken(db, { userId, group: 'forum' })).rejects.toThrow(
      /transação/,
    );
    await inRollback(db, async (trx) => {
      for (const group of ['account', 'purchase', 'support', 'moderation'] as const) {
        await expect(getOrCreateUnsubscribeToken(trx, { userId, group })).rejects.toThrow(
          /obrigatório/,
        );
      }
      await expect(
        getOrCreateUnsubscribeToken(trx, { userId, group: 'other' as never }),
      ).rejects.toThrow(/desconhecido/);
    });
  });

  it('desliga só o e-mail do grupo do token, sem sessão', async () => {
    await inRollback(db, async (trx) => {
      const userId = await createUser(trx);
      await setNotificationPrefs(trx, userId, { forum: { inApp: false } });
      const token = await getOrCreateUnsubscribeToken(trx, { userId, group: 'forum' });
      const result = await unsubscribeByToken(trx, token);
      expect(result).toEqual({
        userId,
        group: 'forum',
        prefs: { inApp: false, email: false },
      });
      const prefs = await getNotificationPrefs(trx, userId);
      expect(prefs.forum).toEqual({ inApp: false, email: false });
      expect(prefs.messages).toEqual(defaultNotificationPrefs().messages);
      // Idempotente: repetir o clique mantém a preferência.
      expect((await unsubscribeByToken(trx, token))?.prefs).toEqual({
        inApp: false,
        email: false,
      });
    });
  });

  it('token desconhecido ou fora do formato devolve `null`', async () => {
    await inRollback(db, async (trx) => {
      expect(await unsubscribeByToken(trx, 'a'.repeat(64))).toBeNull();
      expect(await unsubscribeByToken(trx, 'curto')).toBeNull();
      expect(await unsubscribeByToken(trx, 'Z'.repeat(64))).toBeNull();
    });
  });

  it('valida o formato do token antes da consulta', () => {
    expect(isUnsubscribeToken('a'.repeat(64))).toBe(true);
    expect(isUnsubscribeToken('A'.repeat(64))).toBe(false);
    expect(isUnsubscribeToken('a'.repeat(63))).toBe(false);
    expect(isUnsubscribeToken(null)).toBe(false);
  });
});
