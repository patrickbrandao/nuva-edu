import { useCoursesList } from '../../api/courses';
import { useProductsList } from '../../api/products';
import { useSession } from '../../session/session';
import { type PlanItem, type ProductType, planItemOptionId } from './queries';

/*
 * Produtos que um plano pode liberar (spec 012, "Planos"): cursos, ebooks e pacotes. O contrato
 * não tem busca unificada de produto; a lista vem dos três catálogos já existentes, por título,
 * na primeira página. Os itens que o plano já tem entram mesmo fora dessa página, pelo título
 * que o detalhe do plano devolve — nenhum item salvo some do formulário.
 */
export interface PlanProductOption {
  /** `tipo:id`, o valor marcado no formulário. */
  id: string;
  productType: ProductType;
  productId: string;
  title: string;
}

export function usePlanProductOptions(selected: readonly PlanItem[] = []): PlanProductOption[] {
  const session = useSession();
  const role = session.user.role;
  // Admin tem os dois catálogos; o instrutor não abre esta tela, mas a consulta não pode quebrar.
  const canCourses = role === 'admin' || role === 'instructor';
  const canProducts = role === 'admin' || role === 'manager';
  const courses = useCoursesList({ sort: 'title' });
  const ebooks = useProductsList('ebook', { sort: 'title' }, canProducts);
  const bundles = useProductsList('bundle', { sort: 'title' }, canProducts);

  const known = new Map<string, PlanProductOption>();
  const push = (option: PlanProductOption) => {
    if (!known.has(option.id)) known.set(option.id, option);
  };

  if (canCourses) {
    for (const course of courses.data?.pages.flatMap((page) => page.items) ?? []) {
      push({
        id: planItemOptionId({ productType: 'course', productId: course.id }),
        productType: 'course',
        productId: course.id,
        title: course.title,
      });
    }
  }
  for (const ebook of ebooks.data?.pages.flatMap((page) => page.items) ?? []) {
    push({
      id: planItemOptionId({ productType: 'ebook', productId: ebook.id }),
      productType: 'ebook',
      productId: ebook.id,
      title: ebook.title,
    });
  }
  for (const bundle of bundles.data?.pages.flatMap((page) => page.items) ?? []) {
    push({
      id: planItemOptionId({ productType: 'bundle', productId: bundle.id }),
      productType: 'bundle',
      productId: bundle.id,
      title: bundle.title,
    });
  }
  for (const item of selected) push({ ...item, id: planItemOptionId(item) });

  return [...known.values()];
}
