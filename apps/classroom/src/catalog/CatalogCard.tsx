import { ProductCard } from '@nuva-edu/ui';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AddToCart } from '../sales/AddToCart';
import { useSession } from '../session/session';
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
 * Um produto da vitrine. Produto `paid` mostra preço, bloqueio e validade; a quem está logado,
 * também a ação de pôr na cesta (spec 011, Fase 3). Visitante segue para a página do produto, de
 * onde a compra pede o login.
 */
export function CatalogCard({ item, formatPrice, coverPriority = false }: CatalogCardProps) {
  const { t } = useTranslation();
  const { session } = useSession();
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
      action={
        locked && session ? (
          <AddToCart
            productType={item.type}
            productId={item.id}
            title={item.title}
            size="sm"
            variant="default"
          />
        ) : undefined
      }
    />
  );
}
