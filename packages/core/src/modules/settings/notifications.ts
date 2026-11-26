import type { Database } from '../../db/database.ts';
import { validationFailed } from '../../errors/domain-error.ts';
import { schoolLogoUrl } from '../images/image-url.ts';
import { assertSchoolLogoImage } from '../images/store.ts';
import { getSettings, type SettingsReadOptions, setSetting } from './settings.ts';

// Identidade da escola nos e-mails de notificação (spec 024, "E-mail"): o admin edita nome,
// logotipo, cor de destaque e rodapé; o worker lê no momento do envio. Nome, logotipo e cor são
// as chaves de `school` do registro de `settings.ts`; o rodapé é a chave própria
// `school.email_footer`, lida e gravada só aqui.

/** Chave do rodapé dos e-mails de notificação. */
export const NOTIFICATION_EMAIL_FOOTER_KEY = 'school.email_footer';
/** Limite do rodapé, em caracteres (texto livre, com quebras de linha). */
export const NOTIFICATION_EMAIL_FOOTER_MAX_LENGTH = 500;

export interface NotificationBranding {
  schoolName: string;
  /** Caminho da imagem na API, ou URL absoluta quando `baseUrl` é informado. */
  logoUrl: string | null;
  accentColor: string | null;
  /** Texto do rodapé, ou `null` quando a escola não definiu. */
  footer: string | null;
}

export interface NotificationBrandingOptions extends SettingsReadOptions {
  /** Origem para o `logoUrl` absoluto (o e-mail não resolve caminho relativo). */
  baseUrl?: string;
}

/** O que a tela de marca envia; todos os campos são gravados juntos. */
export interface NotificationBrandingInput {
  schoolName: string;
  logoImageId: string | null;
  accentColor: string | null;
  footer: string | null;
}

/**
 * Marca usada nos e-mails de notificação. Lê as chaves de `school` por `getSettings` (que aplica
 * o padrão e avisa de valor inválido) e o rodapé. Com `baseUrl`, o logotipo vira URL absoluta,
 * como o cliente de e-mail precisa.
 */
export async function getNotificationBranding(
  db: Database,
  options: NotificationBrandingOptions = {},
): Promise<NotificationBranding> {
  const settings = await getSettings(db, options);
  const logoPath = schoolLogoUrl(settings['school.logo_image_id']);
  return {
    schoolName: settings['school.name'],
    logoUrl:
      logoPath === null || options.baseUrl === undefined
        ? logoPath
        : `${options.baseUrl.replace(/\/+$/, '')}${logoPath}`,
    accentColor: settings['school.accent_color'],
    footer: await getEmailFooter(db, options),
  };
}

/**
 * Grava a marca da escola e devolve o resultado. Nome, logotipo e cor passam por `setSetting`
 * (mesmas validações do `/meta`); o rodapé é conferido aqui. Valor inválido lança
 * `400 validation_failed` com o campo correspondente. O logotipo, quando informado, precisa ser
 * uma imagem existente, não oculta e de finalidade `school_logo`: outro valor é
 * `422 image_purpose_mismatch` e nada é gravado (spec 029; spec 024, "E-mail"). Aceita
 * transação; sem ela, abre uma. Depois de confirmar, invalide o leitor com cache do processo
 * (`SettingsReader.invalidate`).
 */
export async function setNotificationBranding(
  db: Database,
  input: NotificationBrandingInput,
): Promise<NotificationBranding> {
  const footer = normalizeFooter(input.footer);
  const run = async (trx: Database): Promise<NotificationBranding> => {
    // Antes de qualquer gravação: logotipo inválido derruba a transação sem deixar nada.
    const logoImageId =
      input.logoImageId === null ? null : await assertSchoolLogoImage(trx, input.logoImageId);
    await setSetting(trx, 'school.name', input.schoolName);
    await setSetting(trx, 'school.logo_image_id', logoImageId);
    await setSetting(trx, 'school.accent_color', input.accentColor);
    if (footer === null) {
      await trx.deleteFrom('settings').where('key', '=', NOTIFICATION_EMAIL_FOOTER_KEY).execute();
    } else {
      const value = JSON.stringify(footer);
      await trx
        .insertInto('settings')
        .values({ key: NOTIFICATION_EMAIL_FOOTER_KEY, value })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value }))
        .execute();
    }
    return getNotificationBranding(trx);
  };
  return db.isTransaction ? run(db) : db.transaction().execute(run);
}

async function getEmailFooter(db: Database, options: SettingsReadOptions): Promise<string | null> {
  const row = await db
    .selectFrom('settings')
    .select('value')
    .where('key', '=', NOTIFICATION_EMAIL_FOOTER_KEY)
    .executeTakeFirst();
  if (row === undefined) {
    return null;
  }
  const parsed = normalizeFooter(row.value, true);
  if (parsed === undefined) {
    options.logger?.warn(
      { setting_key: NOTIFICATION_EMAIL_FOOTER_KEY },
      'Configuração com valor inválido no banco; ignorando o rodapé',
    );
    return null;
  }
  return parsed;
}

/**
 * Confere o rodapé: texto de até `NOTIFICATION_EMAIL_FOOTER_MAX_LENGTH` caracteres, sem espaços
 * nas pontas, ou nulo. Vazio vira nulo. Com `lenient`, valor inválido devolve `undefined` (a
 * leitura segue sem rodapé) em vez de lançar.
 */
function normalizeFooter(value: unknown, lenient?: true): string | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }
  const text = typeof value === 'string' ? value.trim() : '';
  if (typeof value !== 'string' || text.length > NOTIFICATION_EMAIL_FOOTER_MAX_LENGTH) {
    if (lenient) {
      return undefined;
    }
    throw validationFailed(
      [
        {
          path: 'body.footer',
          message: `Informe o rodapé com até ${NOTIFICATION_EMAIL_FOOTER_MAX_LENGTH} caracteres, ou nulo.`,
        },
      ],
      `Valor inválido para a configuração "${NOTIFICATION_EMAIL_FOOTER_KEY}".`,
    );
  }
  return text === '' ? null : text;
}
