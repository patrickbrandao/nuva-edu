import {
  EXPORT_PATH,
  type ExportOrdersQuery,
  type OrderStatus,
  PRODUCT_TYPES,
  type ProductType,
} from './queries';

/*
 * Filtros da lista de pedidos e da exportação, guardados no endereço (spec 006, RF-07): período,
 * estado, produto, cupom e comprador, como no contrato. O que o endereço traz fora do contrato é
 * ignorado — a tela nunca manda à API um filtro que ela não oferece.
 */
export const ALL = 'all';

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface SalesFilters {
  q?: string;
  /** `YYYY-MM-DD`, do endereço; vira o começo do dia local na consulta. */
  from?: string;
  /** `YYYY-MM-DD`, do endereço; vira o começo do dia seguinte (fim exclusivo). */
  to?: string;
  status?: OrderStatus;
  productType?: ProductType;
  productId?: string;
  couponId?: string;
}

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function isDate(value: string): boolean {
  return DATE.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

/** Conserta o valor de um filtro com escolha: fora das opções, o filtro não existe. */
function pick<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

/** Filtros a partir do endereço da tela. */
export function readSalesFilters(
  params: URLSearchParams,
  statuses: readonly OrderStatus[],
): SalesFilters {
  const q = params.get('q')?.trim() || undefined;
  const from = params.get('from');
  const to = params.get('to');
  const status = pick(params.get('status'), statuses);
  const productType = pick(params.get('productType'), PRODUCT_TYPES);
  const productId = params.get('productId');
  const couponId = params.get('couponId');
  return {
    ...(q ? { q } : {}),
    ...(from && isDate(from) ? { from } : {}),
    ...(to && isDate(to) ? { to } : {}),
    ...(status ? { status } : {}),
    ...(productType && productId && isUuid(productId) ? { productType, productId } : {}),
    ...(couponId && isUuid(couponId) ? { couponId } : {}),
  };
}

/** Começo do dia local do `YYYY-MM-DD`, em ISO 8601 UTC. */
export function dateStartIso(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}

/** Começo do dia seguinte ao `YYYY-MM-DD` (fim exclusivo do período), em ISO 8601 UTC. */
export function dateEndIso(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

/** Consulta da lista e da exportação: os filtros do endereço no formato do contrato. */
export function salesQuery(filters: SalesFilters): ExportOrdersQuery {
  return {
    ...(filters.from ? { from: dateStartIso(filters.from) } : {}),
    ...(filters.to ? { to: dateEndIso(filters.to) } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.productType ? { productType: filters.productType } : {}),
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.couponId ? { couponId: filters.couponId } : {}),
    ...(filters.q ? { q: filters.q } : {}),
  };
}

/** Há algum filtro escolhido; o estado vazio fala de "nenhum resultado" quando há. */
export function hasSalesFilters(filters: SalesFilters): boolean {
  return Boolean(
    filters.q ||
      filters.from ||
      filters.to ||
      filters.status ||
      filters.productId ||
      filters.couponId,
  );
}

/** Endereço da lista de pedidos com os filtros atuais, para a tela de exportação já filtrada. */
export function exportHref(filters: SalesFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `${EXPORT_PATH}?${query}` : EXPORT_PATH;
}
