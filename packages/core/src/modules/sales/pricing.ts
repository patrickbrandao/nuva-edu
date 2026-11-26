import type { CouponKind, SalesProductRef, SalesProductType } from './types.ts';

// Rateio do cupom entre os itens elegíveis (spec 011, "Cupons"):
// - `percent`: aplicado item a item, arredondando cada item para baixo ao centavo;
// - `fixed`: rateado na proporção do preço; o resto do arredondamento fica no último item e o
//   desconto nunca passa do subtotal elegível. Usamos a soma acumulada dos pisos, que garante ao
//   mesmo tempo a soma exata do valor, o resto no fim e nenhum item com desconto acima do preço
//   (restrição `order_items_discount_range`).

/** Regra do cupom que o rateio precisa; `products` vazio vale para todos os itens. */
export interface CouponDiscountRule {
  kind: CouponKind;
  percentOff: number | null;
  amountOffCents: number | null;
  products: readonly SalesProductRef[];
}

export interface DiscountableLine {
  id: string;
  productType: SalesProductType;
  productId: string;
  unitPriceCents: number;
}

/** O cupom com restrição de produtos vale só para os itens listados. */
export function isCouponProductEligible(
  coupon: Pick<CouponDiscountRule, 'products'>,
  productType: SalesProductType,
  productId: string,
): boolean {
  if (coupon.products.length === 0) return true;
  return coupon.products.some(
    (product) => product.productType === productType && product.productId === productId,
  );
}

/**
 * Desconto de cada item elegível, em centavos. Itens inelegíveis ficam fora do mapa (o chamador
 * lê com `?? 0`). Percentual de 100% deixa cada item com o preço cheio de desconto; cupom fixo
 * maior que o subtotal elegível é limitado ao subtotal.
 */
export function allocateCouponDiscount(
  coupon: CouponDiscountRule,
  lines: readonly DiscountableLine[],
): Map<string, number> {
  const allocation = new Map<string, number>();
  const eligible = lines.filter(
    (line) =>
      line.unitPriceCents > 0 && isCouponProductEligible(coupon, line.productType, line.productId),
  );
  if (eligible.length === 0) return allocation;
  if (coupon.kind === 'percent') {
    const percent = coupon.percentOff ?? 0;
    for (const line of eligible) {
      allocation.set(line.id, Math.floor((line.unitPriceCents * percent) / 100));
    }
    return allocation;
  }
  const amount = Math.min(coupon.amountOffCents ?? 0, sumPrices(eligible));
  if (amount <= 0) return allocation;
  const eligibleTotal = sumPrices(eligible);
  let cumulativePrice = 0;
  let previous = 0;
  for (const line of eligible) {
    cumulativePrice += line.unitPriceCents;
    const cumulativeDiscount = Math.floor((amount * cumulativePrice) / eligibleTotal);
    allocation.set(line.id, cumulativeDiscount - previous);
    previous = cumulativeDiscount;
  }
  return allocation;
}

export function sumPrices(lines: readonly DiscountableLine[]): number {
  let total = 0;
  for (const line of lines) total += line.unitPriceCents;
  return total;
}

export function sumDiscount(allocation: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const value of allocation.values()) total += value;
  return total;
}
