// Vendas e checkout (spec 011): cesta, produtos, cupons, dados do comprador, fechamento do
// pedido, consultas do aluno e do admin, cancelamento e vencimento. A confirmação de pagamento
// fica em `payments/order-transitions.ts` e a concessão em `entitlements/order.ts`.

export {
  type BillingRecord,
  getMyBilling,
  loadBilling,
  requireBilling,
  type SaveBillingInput,
  saveMyBilling,
} from './billing.ts';
export {
  type AddCartItemInput,
  addCartItem,
  assertCartSellable,
  assertPurchaseAllowed,
  type BuiltCart,
  buildCart,
  readCart,
  readCartForCheckout,
  removeCartCoupon,
  removeCartItem,
  setCartCoupon,
} from './cart.ts';
export {
  type CreateOrderInput,
  createOrder,
  isProviderUnavailable,
} from './checkout.ts';
export {
  type CouponInput,
  type CouponProductView,
  type CouponQuery,
  type CouponUpdateInput,
  type CouponView,
  type CouponWithProducts,
  couponFromRow,
  couponInvalidReason,
  createCoupon,
  findCouponByCode,
  findCouponById,
  getCoupon,
  incrementCouponUse,
  listCoupons,
  updateCoupon,
} from './coupons.ts';
export {
  cartEmpty,
  cartFull,
  cartInvalid,
  couponCodeTaken,
  couponInvalid,
  couponNotFound,
  couponRule,
  orderNotCancelable,
  orderNotRefundable,
  orderPendingLimit,
  productAlreadyInCart,
  productAlreadyOwned,
  productNotSellable,
  refundExceedsPaid,
  refundNotRetryable,
  salesPermissionDenied,
  taxIdInvalid,
} from './errors.ts';
export {
  type AdminOrderPage,
  type AdminOrdersQuery,
  cancelMyOrder,
  expirePendingOrders,
  getAdminOrder,
  getMyOrder,
  listAdminOrders,
  listMyOrders,
  type MyOrdersQuery,
} from './orders.ts';
export {
  allocateCouponDiscount,
  type CouponDiscountRule,
  type DiscountableLine,
  isCouponProductEligible,
  sumDiscount,
  sumPrices,
} from './pricing.ts';
export {
  bundleChildKeys,
  isSellable,
  loadCartUnlocks,
  loadProductTitles,
  loadSalesProduct,
  loadSalesProducts,
  type SalesProduct,
  salesProductKey,
  unsellableReason,
} from './products.ts';
export {
  isValidCnpj,
  isValidCpf,
  normalizeTaxId,
  validateTaxId,
} from './tax-id.ts';
export * from './types.ts';
