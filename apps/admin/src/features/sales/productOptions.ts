import { useTranslation } from 'react-i18next';
import { useCoursesList } from '../../api/courses';
import { useProductsList } from '../../api/products';
import { useCan } from '../../session/session';
import type { ProductType } from './queries';

/*
 * Produtos para os filtros de vendas e para a restrição de cupom (spec 011). O contrato filtra
 * um produto por vez (`productType` + `productId`) e não tem busca de produto unificada: a lista
 * vem dos três catálogos já existentes, ordenados por título, na primeira página. Produto fora
 * dessa página continua valendo no endereço quando veio de um link.
 */
export interface ProductOption {
  /** `tipo:id`, o valor do filtro no endereço. */
  id: string;
  productType: ProductType;
  productId: string;
  title: string;
}

const optionId = (productType: ProductType, productId: string) => `${productType}:${productId}`;

export function useProductOptions(): ProductOption[] {
  const { t } = useTranslation();
  const can = useCan();
  const canCourses = can('course.edit');
  const canProducts = can('ebook_bundle.manage');
  const courses = useCoursesList({ sort: 'title' });
  const ebooks = useProductsList('ebook', { sort: 'title' }, canProducts);
  const bundles = useProductsList('bundle', { sort: 'title' }, canProducts);

  const title = (productType: ProductType, value: string) =>
    t('sales.filters.productOption', {
      type: t(`sales.productType.${productType}`),
      title: value,
    });

  return [
    ...(canCourses
      ? (courses.data?.pages.flatMap((page) => page.items) ?? []).map((course) => ({
          id: optionId('course', course.id),
          productType: 'course' as const,
          productId: course.id,
          title: title('course', course.title),
        }))
      : []),
    ...(ebooks.data?.pages.flatMap((page) => page.items) ?? []).map((ebook) => ({
      id: optionId('ebook', ebook.id),
      productType: 'ebook' as const,
      productId: ebook.id,
      title: title('ebook', ebook.title),
    })),
    ...(bundles.data?.pages.flatMap((page) => page.items) ?? []).map((bundle) => ({
      id: optionId('bundle', bundle.id),
      productType: 'bundle' as const,
      productId: bundle.id,
      title: title('bundle', bundle.title),
    })),
  ];
}
