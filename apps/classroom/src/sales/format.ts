import type { TFunction } from 'i18next';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CartApiItem,
  CartCoupon,
  CartItemUnsellableReason,
  CartItemWarning,
  OrderStatus,
  PaymentMethod,
  PaymentProviderName,
} from './queries';

/*
 * Textos derivados dos dados de vendas (spec 011). O que a API manda como código — avisos da
 * cesta, motivo do item indisponível, estado do pedido, meio de pagamento e provedor — vira
 * frase aqui, pelas traduções do site. Nenhum valor fiscal ou dado do comprador é montado nesta
 * camada.
 */

/** Avisos que não bloqueiam a compra (contrato, `CartItem.warnings`). */
export function cartNotices(t: TFunction, item: CartApiItem): string[] {
  const notices = item.warnings.map((warning: CartItemWarning) =>
    t(`sales.cart.notice.${warning}`),
  );
  if (item.unitPriceCents === null && item.sellable) {
    notices.push(t('sales.cart.notice.noPrice'));
  }
  return notices;
}

/** Motivo do item que não pode ser comprado agora, ou `null` quando está vendável. */
export function unsellableNotice(
  t: TFunction,
  reason: CartItemUnsellableReason | null,
): string | null {
  return reason === null ? null : t(`sales.cart.unsellable.${reason}`);
}

/**
 * O que a compra libera além do próprio item: o título, e de onde vem quando é filho de um curso
 * de pacote (`via`). A ordem é a do algoritmo de concessão, como a API devolveu.
 */
export function cartUnlocks(t: TFunction, item: CartApiItem): string[] {
  return item.unlocks.map((unlock) =>
    unlock.via === null
      ? unlock.title
      : t('sales.cart.unlock.via', { title: unlock.title, via: unlock.via.title }),
  );
}

/** Motivo do cupom que deixou de valer (contrato, `CartCoupon.invalidReason`). */
export function couponInvalidReason(t: TFunction, coupon: CartCoupon): string | null {
  if (coupon.valid || coupon.invalidReason === null) return null;
  return t(`sales.cart.coupon.invalidReason.${coupon.invalidReason}`);
}

export function orderStatusLabel(t: TFunction, status: OrderStatus): string {
  return t(`sales.orders.status.${status}`);
}

export function paymentMethodLabel(t: TFunction, method: PaymentMethod): string {
  return t(`sales.orders.payment.method.${method}`);
}

export function providerLabel(t: TFunction, provider: PaymentProviderName): string {
  return t(`sales.orders.payment.provider.${provider}`);
}

/** Data e hora curtas no idioma da interface (prazo de pagamento, data do pedido). */
export function useDateTimeFormatter(): (iso: string) => string {
  const { i18n } = useTranslation();
  return useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(iso),
      ),
    [i18n.language],
  );
}
