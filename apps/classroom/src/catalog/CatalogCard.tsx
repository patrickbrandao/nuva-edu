import { ProductCard } from '@nuva-edu/ui';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accessValidity, isFree, productPath, productTotals } from './format';
import type { CatalogItem } from './queries';

interface CatalogCardProps {
  item: CatalogItem;
  formatPrice: (cents: number) => string | undefined;
}

/**
 * Um produto da vitrine. Na Fase 2 o produto `paid` mostra o preço e o bloqueio ("Acesso liberado
 * pela escola"), sem botão de compra nem cesta (spec 009, "Fora de escopo"; decisão P6).
 */
export function CatalogCard({ item, formatPrice }: CatalogCardProps) {
  const { t } = useTranslation();
  const free = isFree(item);
  const locked = item.accessMode === 'paid';
  return (
    <ProductCard
      title={item.title}
      href={productPath(item.type, item.slug)}
      coverUrl={item.cover?.url}
      summary={item.summary}
      level={item.level ? t(`product.levels.${item.level}`) : undefined}
      totals={productTotals(t, item)}
      free={free}
      freeLabel={t('product.free')}
      price={item.priceCents === null ? undefined : formatPrice(item.priceCents)}
      badge={t(`product.types.${item.type}`)}
      meta={
        locked ? (
          <>
            <Lock size={12} aria-hidden="true" /> {t('product.locked')}
            {' · '}
            {accessValidity(t, item.accessDays)}
          </>
        ) : undefined
      }
    />
  );
}
