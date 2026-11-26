import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  type Database,
  type FieldError,
  getNotificationBranding,
  getSettings,
  isDomainError,
  managementAuditContext,
  recordAudit,
  type SettingsReader,
  setNotificationBranding,
  setSetting,
  validationFailed,
} from '@nuva-edu/core';
import { managementRequest } from '../session.ts';

// Identidade da escola nos e-mails de notificação (spec 024, "E-mail"; spec 031,
// "Configurações da escola"): só `admin` (`settings.manage`, conferida pelo tratador de
// `sessionCookie`). Nome, logotipo, cor e rodapé são gravados juntos; cada chave alterada gera
// `settings.update` na mesma transação, como o signatário do certificado.

export interface BrandingRoutesOptions {
  db: Database;
  /** Leitor de configurações do processo: descartado depois de gravar a identidade. */
  settings: SettingsReader;
}

/** `SchoolBranding` do contrato. */
function brandingBody(branding: Awaited<ReturnType<typeof getNotificationBranding>>) {
  return {
    schoolName: branding.schoolName,
    logoUrl: branding.logoUrl,
    accentColor: branding.accentColor,
    footer: branding.footer,
  };
}

/** Os três campos de `school` gravados por `setSetting`, com o nome que o contrato usa. */
const BRANDING_SETTINGS = [
  { field: 'schoolName', key: 'school.name' },
  { field: 'logoImageId', key: 'school.logo_image_id' },
  { field: 'accentColor', key: 'school.accent_color' },
] as const;

export function registerBrandingRoutes(app: FastifyInstance, options: BrandingRoutesOptions): void {
  const { db, settings } = options;

  app.operation('getBranding', async () => {
    return brandingBody(await getNotificationBranding(db));
  });

  app.operation('saveBranding', async (request) => {
    const body = request.body as {
      schoolName: string;
      logoImageId: string | null;
      accentColor: string | null;
      footer: string | null;
    };
    const context = managementAuditContext(managementRequest(request));
    const saved = await db.transaction().execute(async (trx) => {
      const beforeSettings = await getSettings(trx);
      const beforeBranding = await getNotificationBranding(trx);

      // `setSetting` recusa com `body.value`; aqui o `errors[]` aponta o campo do contrato. A
      // gravação é desfeita junto se qualquer um dos três (ou o rodapé) for inválido.
      const errors: FieldError[] = [];
      for (const setting of BRANDING_SETTINGS) {
        try {
          await setSetting(trx, setting.key, body[setting.field]);
        } catch (error) {
          if (!isDomainError(error) || error.code !== 'validation_failed') {
            throw error;
          }
          errors.push({
            path: `body.${setting.field}`,
            message: error.errors?.[0]?.message ?? 'Valor inválido.',
          });
        }
      }
      if (errors.length > 0) {
        throw validationFailed(errors);
      }

      const after = await setNotificationBranding(trx, body);
      const afterLogoId = body.logoImageId === null ? null : body.logoImageId.toLowerCase();
      const changes = [
        { key: 'school.name', before: beforeSettings['school.name'], after: after.schoolName },
        {
          key: 'school.logo_image_id',
          before: beforeSettings['school.logo_image_id'],
          after: afterLogoId,
        },
        {
          key: 'school.accent_color',
          before: beforeSettings['school.accent_color'],
          after: after.accentColor,
        },
        { key: 'school.email_footer', before: beforeBranding.footer, after: after.footer },
      ] as const;
      for (const change of changes) {
        if (change.before === change.after) {
          continue;
        }
        await recordAudit(trx, {
          context,
          action: 'settings.update',
          targetType: 'setting',
          targetId: change.key,
          details: { before: change.before, after: change.after },
        });
      }
      return after;
    });
    // Depois de confirmada a transação: a próxima leitura do processo vai ao banco.
    settings.invalidate();
    return brandingBody(saved);
  });
}
