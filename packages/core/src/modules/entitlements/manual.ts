import type { Database } from '../../db/database.ts';
import {
  businessRule,
  conflict,
  type FieldError,
  notFound,
  permissionDenied,
  validationFailed,
} from '../../errors/domain-error.ts';
import {
  loadTarget,
  type ManagementRequest,
  managementAuditContext,
  requirePermission,
} from '../accounts/management/common.ts';
import { recordAudit, recordDenied } from '../audit/record.ts';
import { can } from '../permissions/matrix.ts';
import { findEntitlementProduct, grantEntitlement, revokeEntitlementTree } from './grant.ts';
import {
  ENTITLEMENT_FIELDS,
  ENTITLEMENT_REASON_MAX_LENGTH,
  type EntitlementProductType,
  entitlementStateSql,
  isEntitlementProductType,
  isUuid,
} from './types.ts';
import { type EntitlementView, loadEntitlementTrees } from './views.ts';

// Concessão e revogação manual pela equipe (spec 010, "Concessão manual"): `entitlement.manage`
// (gerente e admin; instrutor recebe 403), motivo obrigatório, validade opcional, auditoria
// `entitlement.grant` e `entitlement.revoke` na transação da ação e e-mail `access.granted`.
// Dono da escrita: admin-api (e MCP, Fase 5, pela mesma função com `mcpKeyId`).

export interface ManualGrantInput {
  productType: EntitlementProductType;
  productId: string;
  /** Fim do acesso; `null` ou ausente é vitalício. No passado: `422 expires_at_in_past`. */
  expiresAt?: Date | null;
  /** Motivo, 1 a 500 caracteres (espaços nas pontas são removidos). */
  reason: string;
}

export interface ManualGrantResult {
  /** `false`: a mesma concessão (usuário, quem concede, produto) já estava ativa; a API responde 200. */
  created: boolean;
  entitlement: EntitlementView;
}

function validReason(value: unknown, path: string, errors: FieldError[]): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason === '' || reason.length > ENTITLEMENT_REASON_MAX_LENGTH) {
    errors.push({
      path,
      message: `Informe o motivo, com até ${ENTITLEMENT_REASON_MAX_LENGTH} caracteres.`,
    });
  }
  return reason;
}

/**
 * `POST /users/{id}/entitlements`: cria a raiz `grant` (com `source_id` = quem concede) e a
 * cascata, grava `entitlement.grant` e enfileira `access.granted`, tudo numa transação.
 *
 * - Sem `entitlement.manage`: a negação vai à auditoria e lança `403 permission_denied`.
 * - Usuário inexistente ou excluído, ou produto inexistente: `404 not_found`.
 * - A mesma concessão ainda ativa: devolve a existente com `created = false`, sem auditoria nem
 *   e-mail (nada mudou).
 * - A mesma concessão já vencida (ela ainda ocupa o índice de idempotência): é revogada com
 *   `manual` e uma raiz nova é criada; a auditoria leva `replacedEntitlementId`.
 */
export async function grantManualEntitlement(
  db: Database,
  request: ManagementRequest,
  userId: string,
  input: ManualGrantInput,
): Promise<ManualGrantResult> {
  await requirePermission(db, request, 'entitlement.manage', {
    action: 'entitlement.grant',
    targetId: isUuid(userId) ? userId : null,
  });
  const errors: FieldError[] = [];
  if (!isEntitlementProductType(input.productType)) {
    errors.push({ path: 'body.productType', message: 'Use course, bundle ou ebook.' });
  }
  if (!isUuid(input.productId)) {
    errors.push({ path: 'body.productId', message: 'Identificador inválido.' });
  }
  const reason = validReason(input.reason, 'body.reason', errors);
  const expiresAt = input.expiresAt ?? null;
  if (expiresAt !== null && (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.getTime()))) {
    errors.push({ path: 'body.expiresAt', message: 'Data inválida.' });
  }
  if (errors.length > 0) throw validationFailed(errors);
  if (expiresAt !== null && expiresAt.getTime() <= Date.now()) {
    throw businessRule('expires_at_in_past', 'A validade precisa ser uma data futura.');
  }

  return db.transaction().execute(async (trx) => {
    const target = await loadTarget(trx, userId);
    const product = await findEntitlementProduct(trx, input.productType, input.productId);
    if (!product) throw notFound('Produto não encontrado.');

    const previous = await trx
      .selectFrom('entitlements')
      .select(['id', entitlementStateSql().as('state')])
      .where('userId', '=', target.id)
      .where('source', '=', 'grant')
      .where('sourceId', '=', request.actor.id)
      .where('productType', '=', product.type)
      .where('productId', '=', product.id)
      .where('parentEntitlementId', 'is', null)
      .where('revokedAt', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (previous && previous.state !== 'expired') {
      const [view] = await loadEntitlementTrees(trx, { rootIds: [previous.id] });
      return { created: false, entitlement: view as EntitlementView };
    }
    if (previous) {
      await revokeEntitlementTree(trx, previous.id, 'manual');
    }

    const granted = await grantEntitlement(trx, {
      userId: target.id,
      productType: product.type,
      productId: product.id,
      source: 'grant',
      sourceId: request.actor.id,
      expiresAt,
      grantedReason: reason,
    });
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'entitlement.grant',
      targetType: 'user',
      targetId: target.id,
      details: {
        entitlementId: granted.entitlement.id,
        productType: product.type,
        productId: product.id,
        expiresAt: expiresAt?.toISOString() ?? null,
        reason,
        cascadeCount: granted.cascadeCount,
        ...(previous ? { replacedEntitlementId: previous.id } : {}),
      },
    });
    const [view] = await loadEntitlementTrees(trx, { rootIds: [granted.entitlement.id] });
    return { created: true, entitlement: view as EntitlementView };
  });
}

/**
 * `POST /entitlements/{id}/revoke`: revoga a raiz `grant` e toda a cascata com `manual` e grava
 * `entitlement.revoke` (com o motivo informado), numa transação.
 *
 * - Sem `entitlement.manage`: negação na auditoria e `403 permission_denied`.
 * - Direito inexistente: `404`. Raiz `order` ou `subscription`, ou derivado: `409
 *   entitlement_not_revocable`. Já revogado: `409 entitlement_already_revoked`.
 */
export async function revokeManualEntitlement(
  db: Database,
  request: ManagementRequest,
  entitlementId: string,
  input: { reason: string },
): Promise<EntitlementView> {
  if (!can(request.actor, 'entitlement.manage')) {
    await recordDenied(db, {
      context: managementAuditContext(request),
      permission: 'entitlement.manage',
      action: 'entitlement.revoke',
      targetType: isUuid(entitlementId) ? 'entitlement' : null,
      targetId: isUuid(entitlementId) ? entitlementId : null,
    });
    throw permissionDenied();
  }
  const errors: FieldError[] = [];
  const reason = validReason(input.reason, 'body.reason', errors);
  if (errors.length > 0) throw validationFailed(errors);
  if (!isUuid(entitlementId)) throw notFound('Direito não encontrado.');

  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('entitlements')
      .select(ENTITLEMENT_FIELDS)
      .where('id', '=', entitlementId.toLowerCase())
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw notFound('Direito não encontrado.');
    if (row.source !== 'grant') {
      throw conflict(
        'entitlement_not_revocable',
        'Só a concessão manual é revogada aqui; pedido e assinatura seguem o próprio ciclo.',
      );
    }
    if (row.revokedAt !== null) {
      throw conflict('entitlement_already_revoked', 'O direito já está revogado.');
    }
    const revokedCount = await revokeEntitlementTree(trx, row.id, 'manual');
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'entitlement.revoke',
      targetType: 'user',
      targetId: row.userId,
      details: {
        entitlementId: row.id,
        productType: row.productType,
        productId: row.productId,
        reason,
        revokedCount,
      },
    });
    const [view] = await loadEntitlementTrees(trx, { rootIds: [row.id] });
    return view as EntitlementView;
  });
}

/**
 * `GET /users/{id}/entitlements`: as raízes do usuário (mais recentes primeiro) com os
 * derivados em `children`, inclusive vencidos e revogados. Exige `entitlement.manage`
 * (negação na auditoria); usuário inexistente ou excluído: `404`.
 */
export async function listUserEntitlements(
  db: Database,
  request: ManagementRequest,
  userId: string,
): Promise<{ items: EntitlementView[] }> {
  await requirePermission(db, request, 'entitlement.manage', {
    action: 'entitlement.list',
    targetId: isUuid(userId) ? userId : null,
  });
  const target = await loadTarget(db, userId);
  return { items: await loadEntitlementTrees(db, { userId: target.id }) };
}
