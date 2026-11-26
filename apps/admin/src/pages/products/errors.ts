import { isApiError } from '@nuva-edu/api-client/admin';
import { useTranslation } from 'react-i18next';
import { useCourseError } from '../courses/errors';

/**
 * Códigos do catálogo (spec 009, "Casos de erro") com texto próprio para ebook e pacote. Os
 * demais (capa, URL, validação, genéricos) saem pelo texto do editor de curso.
 */
const KNOWN = [
  'slug_taken',
  'price_required',
  'price_not_allowed',
  'product_archived',
  'product_has_links',
  'ebook_file_required',
  'bundle_has_no_items',
  'catalog_item_not_found',
  'catalog_limit_exceeded',
  'version_conflict',
  'not_found',
] as const;
type Known = (typeof KNOWN)[number];

function isKnown(code: string): code is Known {
  return (KNOWN as readonly string[]).includes(code);
}

/** Texto de uma recusa da API numa ação de ebook, pacote ou vínculo. */
export function useProductError() {
  const { t } = useTranslation();
  const fallback = useCourseError();
  return (error: unknown): string => {
    if (isApiError(error) && error.code === 'catalog_limit_exceeded') {
      const max: unknown = error.problem.max;
      if (typeof max === 'number') return t('products.errors.catalog_limit_exceededMax', { max });
    }
    if (isApiError(error) && isKnown(error.code)) return t(`products.errors.${error.code}`);
    return fallback(error);
  };
}

/** Campo a que a recusa se refere quando a resposta não lista os campos. */
const CODE_FIELD: Record<string, string> = {
  slug_taken: 'slug',
  price_required: 'priceCents',
  price_not_allowed: 'priceCents',
  content_url_invalid: 'fileUrl',
};

/**
 * Recusa da API por campo, como a do editor de curso (`useFieldRefusal`), com os textos de
 * ebook e pacote e a URL de conteúdo apontando para o arquivo do ebook.
 */
export function useProductRefusal(error: unknown) {
  const { t } = useTranslation();
  const message = useProductError();
  const fields = new Set<string>();
  if (isApiError(error)) {
    for (const field of error.fieldErrors) fields.add(field.path.replace(/^body\./, ''));
    const byCode = CODE_FIELD[error.code];
    if (fields.size === 0 && byCode) fields.add(byCode);
  }
  return {
    fields,
    /** Há recusa e ela não coube em nenhum campo: vai para o aviso do formulário. */
    general: (known: readonly string[]): boolean =>
      Boolean(error) && !known.some((field) => fields.has(field)),
    of: (field: string): string | undefined => {
      if (!fields.has(field)) return undefined;
      return isApiError(error) && error.code !== 'validation_failed'
        ? message(error)
        : t('forms.invalid');
    },
  };
}
