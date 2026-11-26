import { isApiError } from '@nuva-edu/api-client/admin';
import { formatMoney } from '@nuva-edu/ui';
import type { TFunction } from 'i18next';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../../api/meta';
import { useProblemText } from '../../api/problems';
import type {
  Coupon,
  CouponAppliesTo,
  CouponKind,
  OrderStatus,
  Payment,
  PaymentMethod,
  PaymentProviderName,
  RefundStatus,
} from './queries';

/*
 * Textos e formatos das telas de vendas (spec 011). O que a API manda como código — estado do
 * pedido, meio de pagamento, provedor, estado do reembolso, tipo de cupom — vira frase pelas
 * traduções do site. Nenhum valor do pedido é calculado aqui: a tela mostra o que veio.
 */

/** Moeda da instalação (`GET /api/v1/meta`, spec 006): centavos → "R$ 97,00". */
export function useSalesMoney() {
  const meta = useMeta();
  const currency = meta.data?.currency;
  const locale = meta.data?.locale;
  return useCallback(
    (cents: number | null | undefined) => formatMoney(cents, { currency, locale }),
    [currency, locale],
  );
}

/** Moeda e idioma para os componentes de venda que formatam sozinhos (`OrderTotals`). */
export function useSalesMoneyOptions(): {
  currency: string | undefined;
  locale: string | undefined;
} {
  const meta = useMeta();
  return { currency: meta.data?.currency, locale: meta.data?.locale };
}

export function orderStatusLabel(t: TFunction, status: OrderStatus): string {
  return t(`sales.status.${status}`);
}

export function paymentMethodLabel(t: TFunction, method: PaymentMethod | null): string {
  return method === null ? t('sales.payments.method.none') : t(`sales.payments.method.${method}`);
}

export function paymentProviderLabel(t: TFunction, provider: PaymentProviderName): string {
  return t(`sales.payments.provider.${provider}`);
}

export function paymentStatusLabel(t: TFunction, payment: Payment): string {
  return t(`sales.payments.status.${payment.status}`);
}

export function refundStatusLabel(t: TFunction, status: RefundStatus): string {
  return t(`sales.refunds.status.${status}`);
}

export function couponKindLabel(t: TFunction, kind: CouponKind): string {
  return t(`sales.coupons.kind.${kind}`);
}

export function couponAppliesToLabel(t: TFunction, appliesTo: CouponAppliesTo): string {
  return t(`sales.coupons.appliesTo.${appliesTo}`);
}

/** Desconto do cupom em uma frase: "20%" ou o valor fixo. */
export function couponDiscountLabel(
  t: TFunction,
  coupon: Coupon,
  money: (cents: number) => string,
) {
  return coupon.kind === 'percent'
    ? t('sales.coupons.discountPercent', { percent: coupon.percentOff ?? 0 })
    : t('sales.coupons.discountFixed', { amount: money(coupon.amountOffCents ?? 0) });
}

/** Usos do cupom: "12 de 100" ou "12 (ilimitado)". */
export function couponUsesLabel(t: TFunction, coupon: Coupon): string {
  return coupon.maxUses === null
    ? t('sales.coupons.usesUnlimited', { count: coupon.usesCount })
    : t('sales.coupons.usesLimited', { count: coupon.usesCount, max: coupon.maxUses });
}

/** Limite de usos por pessoa. */
export function couponPerUserLabel(t: TFunction, coupon: Coupon): string {
  return t('sales.coupons.perUser', { count: coupon.maxUsesPerUser });
}

/*
 * Valores em centavos nos formulários. O campo aceita "12,34", "12.34" e "1.234,56"; o que não
 * couber em duas casas decimais é recusado antes de qualquer chamada à API.
 */
export function parseAmountCents(text: string): number | null {
  const value = text.trim();
  if (value === '') return null;
  const normalized = value.includes(',') ? value.replace(/\./g, '').replace(',', '.') : value;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(Number(normalized) * 100);
}

/** Texto do campo a partir de centavos: 1234 → "12,34". */
export function amountInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

/** Data e hora no formato do `<input type="datetime-local">`, no fuso do navegador. */
export function toDateTimeInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** Instante em ISO 8601 UTC a partir do campo local; vazio vira `null`. */
export function fromDateTimeInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Códigos das operações de vendas (contrato) com texto próprio. */
const KNOWN_ERRORS = [
  'order_not_refundable',
  'refund_exceeds_paid',
  'refund_not_retryable',
  'coupon_code_taken',
  'coupon_invalid',
  'not_found',
  'validation_failed',
] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

function isKnownError(code: string): code is KnownError {
  return (KNOWN_ERRORS as readonly string[]).includes(code);
}

/** Texto de uma recusa da API numa ação de vendas; a genérica leva o código da requisição. */
export function useSalesError() {
  const { t } = useTranslation();
  const describe = useProblemText();
  return (error: unknown): string => {
    if (isApiError(error) && isKnownError(error.code)) return t(`sales.errors.${error.code}`);
    const { text, detail } = describe(error);
    return detail ? `${text} ${detail}` : text;
  };
}

/** Campos recusados na validação (`body.code` → `code`). */
export function refusedFields(error: unknown): Set<string> {
  if (!isApiError(error)) return new Set();
  return new Set(error.fieldErrors.map((field) => field.path.replace(/^body\./, '')));
}
