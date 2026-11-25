import { isApiError } from '@nuva-edu/api-client/admin';
import { useTranslation } from 'react-i18next';
import { useProblemText } from '../../api/problems';

/** Códigos do catálogo (spec 009 e contrato) e do envio de capa (spec 029) com texto próprio. */
const KNOWN = [
  'slug_taken',
  'price_required',
  'cover_image_invalid',
  'owner_invalid',
  'course_has_no_published_lesson',
  'product_archived',
  'product_has_links',
  'module_not_empty',
  'catalog_limit_exceeded',
  'price_not_allowed',
  'content_url_invalid',
  'order_mismatch',
  'payload_too_large',
  'image_type_unsupported',
  'image_dimensions_exceeded',
  'image_too_heavy',
  'image_processing_busy',
  'not_found',
  'validation_failed',
] as const;
type Known = (typeof KNOWN)[number];

function isKnown(code: string): code is Known {
  return (KNOWN as readonly string[]).includes(code);
}

/** Texto de uma recusa da API numa ação do catálogo; a genérica leva o código da requisição. */
export function useCourseError() {
  const { t } = useTranslation();
  const describe = useProblemText();
  return (error: unknown): string => {
    if (isApiError(error) && error.code === 'catalog_limit_exceeded') {
      // o corpo traz qual limite (`limit`) e o teto (`max`)
      const max: unknown = error.problem.max;
      if (typeof max === 'number') return t('courses.errors.catalog_limit_exceededMax', { max });
    }
    if (isApiError(error) && isKnown(error.code)) return t(`courses.errors.${error.code}`);
    const { text, detail } = describe(error);
    return detail ? `${text} ${detail}` : text;
  };
}

/** Campo a que a recusa se refere quando a resposta não lista os campos. */
const CODE_FIELD: Record<string, string> = {
  slug_taken: 'slug',
  price_required: 'priceCents',
  price_not_allowed: 'priceCents',
  content_url_invalid: 'videoUrl',
};

/**
 * Campos recusados num `400` ou `422`, pelo caminho sem o `body.` (`body.links.0.url` →
 * `links.0.url`). Sem a lista de campos, o código aponta o campo (`slug_taken` → `slug`).
 */
export function refusedFields(error: unknown): Set<string> {
  if (!isApiError(error)) return new Set();
  const fields = new Set(error.fieldErrors.map((field) => field.path.replace(/^body\./, '')));
  const byCode = CODE_FIELD[error.code];
  if (fields.size === 0 && byCode) fields.add(byCode);
  return fields;
}

/**
 * Mensagem de um campo recusado pela API: o texto do código quando ele tem um, senão o
 * genérico. `undefined` quando o campo não foi recusado.
 */
export function useFieldRefusal(error: unknown) {
  const { t } = useTranslation();
  const fields = refusedFields(error);
  const code = isApiError(error) ? error.code : undefined;
  return {
    fields,
    /** Há recusa e ela não coube em nenhum campo: vai para o aviso do formulário. */
    general: (known: readonly string[]): boolean =>
      Boolean(error) && !known.some((field) => fields.has(field)),
    of: (field: string): string | undefined => {
      if (!fields.has(field)) return undefined;
      return code && isKnown(code) && code !== 'validation_failed'
        ? t(`courses.errors.${code}`)
        : t('forms.invalid');
    },
  };
}
