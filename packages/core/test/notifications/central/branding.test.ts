import { randomUUID } from 'node:crypto';
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
import { createUser, inRollback } from './helpers.ts';

let db: Database;
const warnings: string[] = [];

beforeAll(() => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 2 });
});

afterAll(async () => {
  await closeDatabase(db);
});

/** Imagem gravada na transação do teste, com a finalidade e a visibilidade escolhidas. */
async function createImage(
  trx: Database,
  options: { purpose?: string; hidden?: boolean } = {},
): Promise<string> {
  const ownerId = await createUser(trx, { role: 'admin' });
  const image = await trx
    .insertInto('images')
    .values({
      ownerUserId: ownerId,
      purpose: options.purpose ?? 'school_logo',
      originalWidth: 300,
      originalHeight: 200,
      ...(options.hidden === true ? { hiddenAt: new Date() } : {}),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return image.id;
}

describe('marca da escola nos e-mails (spec 024, "E-mail")', () => {
  it('grava nome, logotipo, cor e rodapé e devolve o resultado', async () => {
    await inRollback(db, async (trx) => {
      const logoId = await createImage(trx);
      const branding = await setNotificationBranding(trx, {
        schoolName: '  Escola do Zé  ',
        logoImageId: logoId.toUpperCase(),
        accentColor: '#1a2b3c',
        footer: '  Rua das Flores, 10\nBelo Horizonte  ',
      });
      expect(branding).toEqual({
        schoolName: 'Escola do Zé',
        logoUrl: `/api/v1/images/${logoId}/256.webp`,
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
        logoUrl: `https://escola.example/api/v1/images/${logoId}/256.webp`,
        accentColor: '#1a2b3c',
        footer: 'Rua das Flores, 10\nBelo Horizonte',
      });
    });
  });

  it('recusa logotipo inexistente, oculto ou de outra finalidade com 422, sem gravar nada', async () => {
    await inRollback(db, async (trx) => {
      const logoId = await createImage(trx);
      const avatarId = await createImage(trx, { purpose: 'avatar' });
      const hiddenId = await createImage(trx, { hidden: true });
      await setNotificationBranding(trx, {
        schoolName: 'Escola',
        logoImageId: logoId,
        accentColor: null,
        footer: null,
      });

      const invalid = [
        randomUUID(),
        avatarId,
        hiddenId,
        '019aa3f2-7b1c-7e55-9a10-5299822472aa',
        'não-é-uuid',
      ];
      for (const logoImageId of invalid) {
        const error = await setNotificationBranding(trx, {
          schoolName: 'Outra escola',
          logoImageId,
          accentColor: '#ffffff',
          footer: 'Outro rodapé',
        }).catch((caught: unknown) => caught);
        expect(error).toMatchObject({ code: 'image_purpose_mismatch', status: 422 });
      }

      // Nada foi gravado: a marca anterior continua inteira.
      expect(await getNotificationBranding(trx)).toEqual({
        schoolName: 'Escola',
        logoUrl: `/api/v1/images/${logoId}/256.webp`,
        accentColor: null,
        footer: null,
      });
    });
  });

  it('remover o logotipo (nulo) libera a imagem e some do logoUrl', async () => {
    await inRollback(db, async (trx) => {
      const logoId = await createImage(trx);
      await setNotificationBranding(trx, {
        schoolName: 'Escola',
        logoImageId: logoId,
        accentColor: null,
        footer: null,
      });
      const cleared = await setNotificationBranding(trx, {
        schoolName: 'Escola',
        logoImageId: null,
        accentColor: null,
        footer: null,
      });
      expect(cleared.logoUrl).toBeNull();
      const stored = await trx
        .selectFrom('settings')
        .select('value')
        .where('key', '=', 'school.logo_image_id')
        .executeTakeFirstOrThrow();
      expect(stored.value).toBeNull();
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
      expect(badLogo).toMatchObject({ code: 'image_purpose_mismatch', status: 422 });
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
