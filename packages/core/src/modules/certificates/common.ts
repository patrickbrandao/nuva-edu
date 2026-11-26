// Base do módulo de certificados (spec 015; ADR 0026; tarefa 415): quem pede, os erros do
// contrato, o estado de um certificado, o nome que sai nele, o template efetivo de um curso e a
// conferência de permissão com a negação gravada na auditoria.

import type { Database } from '../../db/database.ts';
import {
  businessRule,
  conflict,
  type DomainError,
  notFound,
  permissionDenied,
} from '../../errors/domain-error.ts';
import { type ManagementRequest, managementAuditContext } from '../accounts/management/common.ts';
import { recordDenied } from '../audit/record.ts';
import { isUuid } from '../entitlements/types.ts';
import type { PermissionAction } from '../permissions/actions.ts';
import { type PermissionScope, permissionScope } from '../permissions/matrix.ts';
import { formatCertificateCode } from './template/values.ts';

/** Quem pede: a sessão do site admin ou, na Fase 5, uma chave MCP. */
export type CertificateRequest = ManagementRequest;

/** Um usuário citado (`UserRef` do contrato), com o nome atual. */
export interface CertificateUserRef {
  id: string;
  name: string;
}

/** Nome mostrado no lugar do de uma conta excluída (o mesmo dos direitos e da auditoria). */
export const CERTIFICATE_DELETED_USER_NAME = 'usuário removido';

export function certificateUserRef(
  id: string | null,
  name: string | null,
  deletedAt: Date | null,
): CertificateUserRef | null {
  if (id === null) return null;
  return {
    id,
    name: deletedAt === null && name !== null ? name : CERTIFICATE_DELETED_USER_NAME,
  };
}

export const CERTIFICATE_STATES = ['preparing', 'issued', 'revoked'] as const;
/** Estado de um certificado existente (`CertificateState` do contrato). */
export type CertificateState = (typeof CERTIFICATE_STATES)[number];

/**
 * `revoked` com revogação; `issued` com PDF; `preparing` enquanto o PDF não foi gerado.
 * Certificado de titular que excluiu a conta (sem nome e sem PDF, spec 030) continua `issued`:
 * ele não está "em preparação", e nenhum PDF será gerado.
 */
export function certificateStateOf(row: {
  revokedAt: Date | null;
  pdfRenderedAt: Date | null;
  studentName: string | null;
}): CertificateState {
  if (row.revokedAt !== null) return 'revoked';
  if (row.pdfRenderedAt !== null || row.studentName === null) return 'issued';
  return 'preparing';
}

/** O nome que sai no certificado: `users.full_name`; vazio, o nome de exibição (spec 015). */
export function certificateStudentName(user: { fullName: string | null; name: string }): string {
  const fullName = user.fullName?.trim() ?? '';
  return fullName === '' ? user.name : fullName;
}

/** Um PDF para entrega, com o nome de arquivo sugerido. */
export interface CertificatePdfFile {
  pdf: Buffer;
  filename: string;
}

/** `certificado-<código>.pdf`, com o código com hífens. */
export function certificatePdfFilename(code: string): string {
  return `certificado-${formatCertificateCode(code)}.pdf`;
}

/** Motivo de emissão manual e de revogação: 1 a 500 caracteres (migration 0012). */
export const CERTIFICATE_REASON_MAX_LENGTH = 500;

/** 422: o curso não tem template efetivo (nem próprio, nem o padrão da escola). */
export function certificateTemplateMissing(): DomainError {
  return businessRule(
    'certificate_template_missing',
    'O curso não tem template de certificado, nem há um padrão da escola.',
  );
}

/** 422: o curso está com o certificado desabilitado. */
export function certificateDisabled(): DomainError {
  return businessRule('certificate_disabled', 'O certificado está desabilitado neste curso.');
}

/** 409: o registro existe, mas o PDF ainda não foi gerado ("em preparação"). */
export function certificatePreparing(): DomainError {
  return conflict('certificate_preparing', 'O certificado está em preparação.');
}

/** O template efetivo de um curso: o dele; sem ele, o padrão da escola. */
export interface EffectiveCertificateTemplate {
  source: 'course' | 'school';
  versionId: string;
}

/** Curso → padrão da escola → `null` (o curso não emite certificado). Uma consulta. */
export async function findEffectiveCertificateTemplate(
  db: Database,
  courseId: string,
): Promise<EffectiveCertificateTemplate | null> {
  const rows = await db
    .selectFrom('certificateTemplates')
    .select(['courseId', 'versionId'])
    .where((eb) => eb.or([eb('courseId', '=', courseId), eb('courseId', 'is', null)]))
    .execute();
  const own = rows.find((row) => row.courseId !== null);
  if (own) return { source: 'course', versionId: own.versionId };
  const school = rows[0];
  return school ? { source: 'school', versionId: school.versionId } : null;
}

/**
 * Exige a ação e devolve o alcance (`own`: o instrutor, só nos próprios cursos). Sem a ação no
 * papel: a negação vai à auditoria (fora de transação) e a resposta é `403` `permission_denied`.
 */
export async function requireCertificateAction(
  db: Database,
  request: CertificateRequest,
  permission: PermissionAction,
  audit: { action?: string; targetType?: string | null; targetId?: string | null } = {},
): Promise<PermissionScope> {
  const scope = permissionScope(request.actor, permission);
  if (scope !== null) return scope;
  await recordDenied(db, {
    context: managementAuditContext(request),
    permission,
    ...(audit.action === undefined ? {} : { action: audit.action }),
    targetType: audit.targetId ? (audit.targetType ?? null) : null,
    targetId: audit.targetId ?? null,
  });
  throw permissionDenied();
}

/** O curso como as regras de certificado precisam dele. */
export interface CertificateCourse {
  id: string;
  title: string;
  ownerId: string | null;
  certificateEnabled: boolean;
  certificateHours: number | null;
}

/**
 * Lê o curso dentro do alcance: com `own`, só o do próprio instrutor. Inexistente ou alheio:
 * `404` (não revela a existência, spec 003).
 */
export async function loadCertificateCourse(
  db: Database,
  request: CertificateRequest,
  scope: PermissionScope,
  courseId: unknown,
): Promise<CertificateCourse> {
  if (!isUuid(courseId)) throw notFound('Curso não encontrado.');
  const row = await db
    .selectFrom('courses')
    .select(['id', 'title', 'ownerId', 'certificateEnabled', 'certificateHours'])
    .where('id', '=', courseId.toLowerCase())
    .executeTakeFirst();
  if (!row || (scope === 'own' && row.ownerId !== request.actor.id)) {
    throw notFound('Curso não encontrado.');
  }
  return row;
}
