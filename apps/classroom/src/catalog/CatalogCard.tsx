import { ProductCard } from '@nuva-edu/ui';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accessValidity, isFree, productPath, productTotals } from './format';
import type { CatalogItem } from './queries';

/**
 * Cartões da vitrine cuja capa é pedida já, com prioridade alta: a primeira fileira da grade no
 * maior número de colunas (4). É ali que está o elemento do LCP (spec 006, RNF-04); marcar mais
 * do que isso tiraria o efeito da prioridade.
 */
export const PRIORITY_COVERS = 4;

interface CatalogCardProps {
  item: CatalogItem;
  formatPrice: (cents: number) => string | undefined;
  /** Capa acima da dobra: `loading="eager"` e `fetchpriority="high"` no lugar de `lazy`. */
  coverPriority?: boolean;
}

/**
 * Um produto da vitrine. Na Fase 2 o produto `paid` mostra o preço e o bloqueio ("Acesso liberado
 * pela escola"), sem botão de compra nem cesta (spec 009, "Fora de escopo"; decisão P6).
 */
export function CatalogCard({ item, formatPrice, coverPriority = false }: CatalogCardProps) {
  const { t } = useTranslation();
  const free = isFree(item);
  const locked = item.accessMode === 'paid';
  return (
    <ProductCard
      title={item.title}
      href={productPath(item.type, item.slug)}
      coverUrl={item.cover?.url}
      coverPriority={coverPriority}
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
