import { AdminButton, AdminField, AdminMenu, AdminSearch } from '@nuva-edu/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCan } from '../../session/session';
import { ALL, hasSalesFilters, type SalesFilters } from './filters';
import { couponAppliesToLabel, orderStatusLabel } from './format';
import { useProductOptions } from './productOptions';
import { ORDER_STATUSES, type OrderStatus, useCouponsList } from './queries';

interface Props {
  filters: SalesFilters;
  /** Grava (ou apaga, com `undefined`) um parâmetro do endereço. */
  onChange: (key: string, value: string | undefined) => void;
  /** Apaga todos os filtros. */
  onClear: () => void;
}

/**
 * Barra de filtros de pedidos e da exportação (spec 011, "Consulta e exportação"): período,
 * estado, produto e comprador; o cupom só para quem pode listar cupons (`coupon.manage`).
 */
export function SalesFiltersBar({ filters, onChange, onClear }: Props) {
  const { t } = useTranslation();
  const can = useCan();
  const canCoupons = can('coupon.manage');
  const [search, setSearch] = useState(filters.q ?? '');
  useEffect(() => setSearch(filters.q ?? ''), [filters.q]);

  const products = useProductOptions();
  const coupons = useCouponsList({}, canCoupons);
  const couponItems = coupons.data?.pages.flatMap((page) => page.items) ?? [];

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    onChange('q', search.trim() || undefined);
  };

  const statusOptions = [
    { id: ALL, label: t('sales.filters.allStatuses') },
    ...ORDER_STATUSES.map((id: OrderStatus) => ({ id, label: orderStatusLabel(t, id) })),
  ];
  const statusValue = filters.status ?? ALL;
  const statusLabel = statusOptions.find((option) => option.id === statusValue)?.label ?? '';

  const productOptions = [
    { id: ALL, label: t('sales.filters.allProducts') },
    ...products.map((product) => ({ id: product.id, label: product.title })),
  ];
  const productValue =
    filters.productType && filters.productId ? `${filters.productType}:${filters.productId}` : ALL;
  const productLabel =
    productOptions.find((option) => option.id === productValue)?.label ??
    t('sales.filters.allProducts');

  const couponOptions = [
    { id: ALL, label: t('sales.filters.allCoupons') },
    ...couponItems.map((coupon) => ({
      id: coupon.id,
      label: `${coupon.code} · ${couponAppliesToLabel(t, coupon.appliesTo)}`,
    })),
  ];
  const couponValue = filters.couponId ?? ALL;
  const couponLabel =
    couponOptions.find((option) => option.id === couponValue)?.label ??
    t('sales.filters.allCoupons');

  const pickProduct = (id: string) => {
    if (id === ALL) {
      onChange('productType', undefined);
      onChange('productId', undefined);
      return;
    }
    const chosen = products.find((product) => product.id === id);
    if (!chosen) return;
    onChange('productType', chosen.productType);
    onChange('productId', chosen.productId);
  };

  return (
    <div className="mb-4 flex flex-wrap items-end gap-2">
      <form className="flex items-center gap-2" onSubmit={onSearch}>
        <AdminSearch
          value={search}
          onChange={setSearch}
          label={t('sales.filters.search')}
          placeholder={t('sales.filters.searchPlaceholder')}
          maxLength={200}
        />
        <AdminButton type="submit">{t('sales.filters.searchButton')}</AdminButton>
      </form>
      <AdminField
        type="date"
        label={t('sales.filters.from')}
        value={filters.from ?? ''}
        max={filters.to}
        onChange={(value: string) => onChange('from', value || undefined)}
      />
      <AdminField
        type="date"
        label={t('sales.filters.to')}
        value={filters.to ?? ''}
        min={filters.from}
        onChange={(value: string) => onChange('to', value || undefined)}
      />
      <AdminMenu
        options={statusOptions}
        value={statusValue}
        onChange={(id: string) => onChange('status', id === ALL ? undefined : id)}
        aria-label={t('sales.filters.statusLabel', { value: statusLabel })}
      />
      <AdminMenu
        options={productOptions}
        value={productValue}
        onChange={pickProduct}
        aria-label={t('sales.filters.productLabel', { value: productLabel })}
      />
      {canCoupons ? (
        <AdminMenu
          options={couponOptions}
          value={couponValue}
          onChange={(id: string) => onChange('couponId', id === ALL ? undefined : id)}
          aria-label={t('sales.filters.couponLabel', { value: couponLabel })}
        />
      ) : null}
      {hasSalesFilters(filters) ? (
        <AdminButton onClick={onClear}>{t('sales.filters.clear')}</AdminButton>
      ) : null}
    </div>
  );
}
