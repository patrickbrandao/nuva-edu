import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  closeDatabase,
  createDatabase,
  createLogger,
  type Database,
  getNotificationBranding,
  NOTIFICATION_EMAIL_FOOTER_KEY,
  NOTIFICATION_EMAIL_FOOTER_MAX_LENGTH,
  setNotificationBranding,
} from '../../../src/index.ts';
import { inRollback } from './helpers.ts';

let db: Database;
const warnings: string[] = [];

beforeAll(() => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 2 });
});

afterAll(async () => {
  await closeDatabase(db);
});

const LOGO_ID = '019aa3f2-7b1c-7e55-9a10-5299822472aa';

describe('marca da escola nos e-mails (spec 024, "E-mail")', () => {
  it('grava nome, logotipo, cor e rodapé e devolve o resultado', async () => {
    await inRollback(db, async (trx) => {
      const branding = await setNotificationBranding(trx, {
        schoolName: '  Escola do Zé  ',
        logoImageId: LOGO_ID.toUpperCase(),
        accentColor: '#1a2b3c',
        footer: '  Rua das Flores, 10\nBelo Horizonte  ',
      });
      expect(branding).toEqual({
        schoolName: 'Escola do Zé',
        logoUrl: `/api/v1/images/${LOGO_ID}/256.webp`,
        accentColor: '#1a2b3c',
        footer: 'Rua das Flores, 10\nBelo Horizonte',
      });
      const stored = await trx
        .selectFrom('settings')
        .select('value')
        .where('key', '=', NOTIFICATION_EMAIL_FOOTER_KEY)
        .executeTakeFirstOrThrow();
      expect(stored.value).toBe('Rua das Flores, 10\nBelo Horizonte');
      expect(await getNotificationBranding(trx, { baseUrl: 'https://escola.example/' })).toEqual({
        schoolName: 'Escola do Zé',
        logoUrl: `https://escola.example/api/v1/images/${LOGO_ID}/256.webp`,
        accentColor: '#1a2b3c',
        footer: 'Rua das Flores, 10\nBelo Horizonte',
      });
    });
  });

  it('rodapé vazio ou nulo apaga a configuração', async () => {
    await inRollback(db, async (trx) => {
      await setNotificationBranding(trx, {
        schoolName: 'Escola',
        logoImageId: null,
        accentColor: null,
        footer: 'Rodapé',
      });
      expect((await getNotificationBranding(trx)).footer).toBe('Rodapé');
      const cleared = await setNotificationBranding(trx, {
        schoolName: 'Escola',
        logoImageId: null,
        accentColor: null,
        footer: '   ',
      });
      expect(cleared.footer).toBeNull();
      expect(cleared.logoUrl).toBeNull();
      expect(cleared.accentColor).toBeNull();
      const row = await trx
        .selectFrom('settings')
        .select('key')
        .where('key', '=', NOTIFICATION_EMAIL_FOOTER_KEY)
        .executeTakeFirst();
      expect(row).toBeUndefined();
    });
  });

  it('ignora rodapé inválido gravado por fora, com aviso', async () => {
    await inRollback(db, async (trx) => {
      const logger = createLogger({
        service: 'admin-api',
        level: 'warn',
        write: (line) => warnings.push(line),
      });
      await trx
        .insertInto('settings')
        .values({ key: NOTIFICATION_EMAIL_FOOTER_KEY, value: JSON.stringify('x'.repeat(600)) })
        .execute();
      expect((await getNotificationBranding(trx, { logger })).footer).toBeNull();
      expect(warnings.some((line) => line.includes(NOTIFICATION_EMAIL_FOOTER_KEY))).toBe(true);

      await trx
        .updateTable('settings')
        .set({ value: JSON.stringify(5) })
        .where('key', '=', NOTIFICATION_EMAIL_FOOTER_KEY)
        .execute();
      expect((await getNotificationBranding(trx, { logger })).footer).toBeNull();
    });
  });

  it('recusa rodapé longo e os demais valores inválidos', async () => {
    await inRollback(db, async (trx) => {
      const tooLong = await setNotificationBranding(trx, {
        schoolName: 'Escola',
        logoImageId: null,
        accentColor: null,
        footer: 'x'.repeat(NOTIFICATION_EMAIL_FOOTER_MAX_LENGTH + 1),
      }).catch((error: unknown) => error);
      expect(tooLong).toMatchObject({
        code: 'validation_failed',
        errors: [{ path: 'body.footer' }],
      });
      const badLogo = await setNotificationBranding(trx, {
        schoolName: 'Escola',
        logoImageId: 'não-é-uuid',
        accentColor: null,
        footer: null,
      }).catch((error: unknown) => error);
      expect(badLogo).toMatchObject({
        code: 'validation_failed',
        errors: [{ path: 'body.value' }],
      });
      const emptyName = await setNotificationBranding(trx, {
        schoolName: '   ',
        logoImageId: null,
        accentColor: null,
        footer: null,
      }).catch((error: unknown) => error);
      expect(emptyName).toMatchObject({ code: 'validation_failed' });
    });
  });
});
