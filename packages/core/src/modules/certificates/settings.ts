// Configurações do certificado (spec 015, `GET|PUT /settings/certificates`; spec 031,
// "Configurações da escola"): signatário e cargo, e o nome da escola só para leitura. Valem para
// os certificados emitidos depois; os emitidos têm os dados congelados. Dono da escrita:
// admin-api (`settings.manage`).

import type { Database } from '../../db/database.ts';
import { type FieldError, isDomainError, validationFailed } from '../../errors/domain-error.ts';
import { managementAuditContext } from '../accounts/management/common.ts';
import { recordAudit } from '../audit/record.ts';
import { CERTIFICATE_SIGNER_MAX_LENGTH, getSettings, setSetting } from '../settings/settings.ts';
import { type CertificateRequest, requireCertificateAction } from './common.ts';

/** `CertificateSettings` do contrato. */
export interface CertificateSettings {
  signerName: string | null;
  signerRole: string | null;
  /** `school.name`, só leitura aqui. */
  schoolName: string;
}

async function readCertificateSettings(db: Database): Promise<CertificateSettings> {
  const settings = await getSettings(db);
  return {
    signerName: settings['certificate.signer_name'],
    signerRole: settings['certificate.signer_role'],
    schoolName: settings['school.name'],
  };
}

/** `GET /settings/certificates` (`settings.manage`). */
export async function getCertificateSettings(
  db: Database,
  request: CertificateRequest,
): Promise<CertificateSettings> {
  await requireCertificateAction(db, request, 'settings.manage');
  return readCertificateSettings(db);
}

const FIELDS = [
  { input: 'signerName', key: 'certificate.signer_name' },
  { input: 'signerRole', key: 'certificate.signer_role' },
] as const;

/**
 * `PUT /settings/certificates` (`settings.manage`): grava os dois campos (`null` omite a
 * assinatura), de 1 a 120 caracteres sem os espaços das pontas. Fora disso: `400` com o campo.
 * Uma auditoria `settings.update` por chave alterada, com o antes e o depois. Depois de
 * confirmar, quem chama descarta o cache do leitor de configurações do processo.
 */
export async function updateCertificateSettings(
  db: Database,
  request: CertificateRequest,
  input: { signerName: unknown; signerRole: unknown },
): Promise<CertificateSettings> {
  await requireCertificateAction(db, request, 'settings.manage', { action: 'settings.update' });
  return db.transaction().execute(async (trx) => {
    const before = await getSettings(trx);
    const errors: FieldError[] = [];
    const changes: {
      key: (typeof FIELDS)[number]['key'];
      before: string | null;
      after: string | null;
    }[] = [];
    for (const field of FIELDS) {
      const value = input[field.input];
      try {
        if (value !== null && typeof value !== 'string') throw validationFailed([]);
        const after = await setSetting(trx, field.key, value);
        if (after !== before[field.key]) {
          changes.push({ key: field.key, before: before[field.key], after });
        }
      } catch (error) {
        if (!isDomainError(error) || error.code !== 'validation_failed') throw error;
        errors.push({
          path: `body.${field.input}`,
          message: `Use de 1 a ${CERTIFICATE_SIGNER_MAX_LENGTH} caracteres, ou null.`,
        });
      }
    }
    if (errors.length > 0) throw validationFailed(errors);
    for (const change of changes) {
      await recordAudit(trx, {
        context: managementAuditContext(request),
        action: 'settings.update',
        targetType: 'setting',
        targetId: change.key,
        details: { before: change.before, after: change.after },
      });
    }
    return readCertificateSettings(trx);
  });
}
