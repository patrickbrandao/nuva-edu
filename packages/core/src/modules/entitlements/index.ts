// Direitos de acesso (spec 010): concessão, revogação, cascata, recálculo e verificação. Tarefa 412.

export {
  ACCESS_DENIAL_REASONS,
  type AccessBasis,
  type AccessDecision,
  type AccessDenialReason,
  type AccessFacts,
  type AccessTarget,
  type AccessTargetType,
  type AccessUser,
  canAccess,
  decideAccess,
  type EntitlementStatus,
  type EntitlementStatusQuery,
  getEntitlementStatuses,
  hasActiveAccess,
} from './access.ts';
export { type CascadeNode, expandCascade } from './cascade.ts';
export {
  type EntitlementProduct,
  findEntitlementProduct,
  type GrantEntitlementInput,
  type GrantEntitlementResult,
  grantEntitlement,
  revokeEntitlementTree,
} from './grant.ts';
export {
  grantManualEntitlement,
  listUserEntitlements,
  type ManualGrantInput,
  type ManualGrantResult,
  revokeManualEntitlement,
} from './manual.ts';
export {
  listMyEntitlements,
  listProductEntitlements,
  type MyEntitlement,
  type ProductEntitlementItem,
  type ProductEntitlementPage,
  type ProductEntitlementQuery,
} from './queries.ts';
export {
  type RecalculateEntitlementsInput,
  type RecalculateEntitlementsResult,
  recalculateEntitlements,
} from './recalculate.ts';
export {
  ENTITLEMENT_MAX_DEPTH,
  ENTITLEMENT_PAGE_DEFAULT_LIMIT,
  ENTITLEMENT_PAGE_MAX_LIMIT,
  ENTITLEMENT_PRODUCT_TYPES,
  ENTITLEMENT_REASON_MAX_LENGTH,
  ENTITLEMENT_RECALCULATION_BATCH_SIZE,
  ENTITLEMENT_REVOKE_REASONS,
  ENTITLEMENT_ROOT_SOURCES,
  ENTITLEMENT_SOURCES,
  ENTITLEMENT_STATES,
  type Entitlement,
  type EntitlementProductRef,
  type EntitlementProductType,
  type EntitlementRevokeReason,
  type EntitlementRootSource,
  type EntitlementSource,
  type EntitlementState,
} from './types.ts';
export type { EntitlementView } from './views.ts';
