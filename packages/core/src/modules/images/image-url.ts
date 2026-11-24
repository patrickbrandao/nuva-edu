// Endereço de entrega das imagens (spec 029, "Entrega"). Só a montagem do caminho: a tabela
// `images` e o restante do módulo chegam com a tarefa que implementa a spec 029.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Verdadeiro para um UUID em texto, em qualquer caixa. */
export function isImageId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Larguras em que o logotipo da escola é gerado (finalidade `school_logo`). */
export const SCHOOL_LOGO_VARIANTS = [64, 256, 512] as const;
export type SchoolLogoVariant = (typeof SCHOOL_LOGO_VARIANTS)[number];

/** Variante usada no `logoUrl` do `/meta` quando quem chama não escolhe outra. */
export const SCHOOL_LOGO_DEFAULT_VARIANT: SchoolLogoVariant = 256;

/**
 * Caminho da rota de entrega, na própria API: `/api/v1/images/{image_id}/{variant}.webp`, em
 * que `variant` é a largura. Função pura: não confere se a imagem existe. Lança `TypeError`
 * para identificador que não é UUID ou largura que não é inteiro positivo (erro de quem chama).
 */
export function imagePath(imageId: string, variant: number): string {
  if (!isImageId(imageId)) {
    throw new TypeError('imagePath: imageId precisa ser um UUID.');
  }
  if (!Number.isSafeInteger(variant) || variant <= 0) {
    throw new TypeError('imagePath: variant precisa ser a largura, um inteiro positivo.');
  }
  return `/api/v1/images/${imageId.toLowerCase()}/${variant}.webp`;
}

/**
 * `logoUrl` do `/meta` (spec 003) a partir de `school.logo_image_id`: o caminho da imagem, ou
 * `null` quando a escola não tem logotipo.
 */
export function schoolLogoUrl(
  imageId: string | null,
  variant: SchoolLogoVariant = SCHOOL_LOGO_DEFAULT_VARIANT,
): string | null {
  return imageId === null ? null : imagePath(imageId, variant);
}
