import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  type Database,
  type EntitlementProductType,
  type EntitlementState,
  type EntitlementView,
  grantManualEntitlement,
  listProductEntitlements,
  listUserEntitlements,
  type ProductEntitlementItem,
  revokeManualEntitlement,
} from '@nuva-edu/core';
import { managementRequest } from '../session.ts';
import { type IdParams, iso, isoOrNull } from './catalog-common.ts';

// Direitos de acesso pela equipe (spec 010, "Concessão manual"): árvore do usuário, concessão,
// revogação e quem tem acesso a um produto. O tratador de `sessionCookie` confere
// `entitlement.manage` de `x-permission` (instrutor: `403`, com a negação na auditoria); as
// regras do núcleo conferem de novo, gravam `entitlement.grant` e `entitlement.revoke` na
// transação da ação e enfileiram o e-mail `access.granted`. Aqui só transporte.

export interface EntitlementRoutesOptions {
  db: Database;
}

/** `EntitlementNode` do contrato, com os derivados. */
function nodeBody(node: EntitlementView): Record<string, unknown> {
  return {
    id: node.id,
    product: { type: node.product.type, id: node.product.id, title: node.product.title },
    source: node.source,
    sourceId: node.sourceId,
    parentEntitlementId: node.parentEntitlementId,
    state: node.state,
    startsAt: iso(node.startsAt),
    expiresAt: isoOrNull(node.expiresAt),
    revokedAt: isoOrNull(node.revokedAt),
    revokeReason: node.revokeReason,
    grantedReason: node.grantedReason,
    grantedBy:
      node.grantedBy === null ? null : { id: node.grantedBy.id, name: node.grantedBy.name },
    createdAt: iso(node.createdAt),
    children: node.children.map(nodeBody),
  };
}

/** `ProductEntitlement` do contrato. */
function productEntitlementBody(item: ProductEntitlementItem) {
  return {
    id: item.id,
    user: { id: item.user.id, name: item.user.name, avatarUrl: item.user.avatarUrl },
    source: item.source,
    via: item.via === null ? null : { type: item.via.type, id: item.via.id, title: item.via.title },
    state: item.state,
    startsAt: iso(item.startsAt),
    expiresAt: isoOrNull(item.expiresAt),
    revokedAt: isoOrNull(item.revokedAt),
  };
}

export function registerEntitlementRoutes(
  app: FastifyInstance,
  options: EntitlementRoutesOptions,
): void {
  const { db } = options;

  // `GET /api/v1/users/{id}/entitlements`: as raízes com a cascata, inclusive vencidos e revogados.
  app.operation('listUserEntitlements', async (request) => {
    const { id } = request.params as IdParams;
    const tree = await listUserEntitlements(db, managementRequest(request), id);
    return { items: tree.items.map(nodeBody) };
  });

  // `POST /api/v1/users/{id}/entitlements`: `201` ao criar; `200` quando a mesma concessão
  // (usuário, quem concede, produto) já estava ativa e nada foi gravado.
  app.operation('grantEntitlement', async (request, reply) => {
    const { id } = request.params as IdParams;
    const body = request.body as {
      productType: EntitlementProductType;
      productId: string;
      expiresAt?: string | null;
      reason: string;
    };
    const result = await grantManualEntitlement(db, managementRequest(request), id, {
      productType: body.productType,
      productId: body.productId,
      // O contrato já conferiu o formato `date-time`.
      expiresAt:
        body.expiresAt === undefined || body.expiresAt === null ? null : new Date(body.expiresAt),
      reason: body.reason,
    });
    return reply.status(result.created ? 201 : 200).send(nodeBody(result.entitlement));
  });

  // `POST /api/v1/entitlements/{id}/revoke`: só a raiz `grant`; o resto é `409` do núcleo.
  app.operation('revokeEntitlement', async (request) => {
    const { id } = request.params as IdParams;
    const { reason } = request.body as { reason: string };
    return nodeBody(await revokeManualEntitlement(db, managementRequest(request), id, { reason }));
  });

  // `GET /api/v1/products/{type}/{id}/entitlements`: sem `state`, só os ativos.
  app.operation('listProductEntitlements', async (request) => {
    const { type, id } = request.params as { type: EntitlementProductType; id: string };
    const query = request.query as { state?: EntitlementState; limit?: number; cursor?: string };
    const page = await listProductEntitlements(db, managementRequest(request), {
      productType: type,
      productId: id,
      ...(query.state === undefined ? {} : { state: query.state }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    return { items: page.items.map(productEntitlementBody), nextCursor: page.nextCursor };
  });
}
