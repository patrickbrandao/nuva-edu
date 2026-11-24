// Regras das imagens enviadas (spec 029): finalidades, variantes, limites, quem envia o quê e
// os erros próprios de "Detalhes do envio". Sem acesso a banco nem a `sharp`.

import { DomainError, permissionDenied } from '../../errors/domain-error.ts';

/** Finalidades aceitas pela tabela `images` (restrição `images_purpose_valid`). */
export const IMAGE_PURPOSES = [
  'avatar',
  'profile_cover',
  'product_cover',
  'event_cover',
  'case_image',
  'content_image',
  'school_logo',
] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

/** Larguras que o banco aceita como nome de variante (`image_variants_width_valid`). */
export const IMAGE_VARIANT_WIDTHS = [64, 256, 480, 512, 1280, 1600] as const;

/** Como uma finalidade gera as variantes. */
export interface ImageVariantSpec {
  /** Larguras geradas, que são também o nome da variante na URL. */
  widths: readonly number[];
  /** Proporção largura/altura do corte central (a imagem é cortada e redimensionada). */
  aspect: number;
}

/**
 * Finalidades implementadas e as variantes de cada uma (spec 029, "Finalidades e variantes").
 * Na Fase 1 só existe `avatar`; as demais entram com os recursos que as usam (e, nas de
 * proporção original, depois que o `arquiteto` fixar a regra em aberto na spec).
 */
export const IMAGE_VARIANT_SPECS: Readonly<Partial<Record<ImagePurpose, ImageVariantSpec>>> = {
  avatar: { widths: [64, 256], aspect: 1 },
};

/** Site que recebe o envio: cada um aceita só as finalidades dele. */
export type ImageUploadSite = 'classroom' | 'admin';

/**
 * Finalidades aceitas por site e os papéis que podem enviá-las. Fase 1: o classroom aceita
 * `avatar` de qualquer usuário; o admin só entrega imagens.
 */
const UPLOAD_RULES: Readonly<Record<ImageUploadSite, Partial<Record<ImagePurpose, 'any'>>>> = {
  classroom: { avatar: 'any' },
  admin: {},
};

/** RNF-02: maior lado aceito na entrada. */
export const IMAGE_MAX_INPUT_SIDE = 8000;
/** RNF-02: megapixels aceitos na entrada. */
export const IMAGE_MAX_INPUT_PIXELS = 40_000_000;
/** RNF-03: maior lado de uma variante gravada. */
export const IMAGE_MAX_VARIANT_SIDE = 1600;
/** RNF-03: tamanho máximo de uma variante gravada (400 KB). */
export const IMAGE_MAX_VARIANT_BYTES = 400 * 1024;
/** Qualidade WebP inicial e os passos de 10 até 50 quando a variante passa de 400 KB. */
export const IMAGE_WEBP_QUALITIES = [80, 70, 60, 50] as const;
/** Papéis da equipe, que não têm o limite de envios por hora (RNF-05). */
export const IMAGE_RATE_LIMIT_EXEMPT_ROLES = ['instructor', 'manager', 'admin'] as const;

export function isImagePurpose(value: unknown): value is ImagePurpose {
  return typeof value === 'string' && (IMAGE_PURPOSES as readonly string[]).includes(value);
}

/** Bytes aceitos no envio, a partir de `NUVA_IMAGE_MAX_UPLOAD_MB` (`config.images.maxUploadMb`). */
export function imageUploadMaxBytes(maxUploadMb: number): number {
  return maxUploadMb * 1024 * 1024;
}

/** Verdadeiro quando o papel pode enviar a finalidade pelo site. */
export function canUploadImagePurpose(
  site: ImageUploadSite,
  role: string,
  purpose: string,
): boolean {
  if (!isImagePurpose(purpose) || IMAGE_VARIANT_SPECS[purpose] === undefined) {
    return false;
  }
  const rule = UPLOAD_RULES[site][purpose];
  return rule === 'any' && role.length > 0;
}

/** `403` `permission_denied` quando o site não aceita a finalidade ou o papel não pode enviá-la. */
export function assertCanUploadImagePurpose(
  site: ImageUploadSite,
  role: string,
  purpose: string,
): asserts purpose is ImagePurpose {
  if (!canUploadImagePurpose(site, role, purpose)) {
    throw permissionDenied('Este site não aceita imagens desta finalidade para o seu papel.');
  }
}

/** Verdadeiro quando o papel está sujeito ao limite de envios por hora. */
export function isImageRateLimited(role: string): boolean {
  return !(IMAGE_RATE_LIMIT_EXEMPT_ROLES as readonly string[]).includes(role);
}

/**
 * Largura da variante pedida na URL (`256` ou `"256"`), se a finalidade a gera; senão `null`
 * (a entrega devolve 404).
 */
export function parseImageVariant(purpose: string, variant: string | number): number | null {
  const text = typeof variant === 'number' ? String(variant) : variant;
  if (!/^[1-9][0-9]{0,4}$/.test(text)) {
    return null;
  }
  const width = Number(text);
  const spec = isImagePurpose(purpose) ? IMAGE_VARIANT_SPECS[purpose] : undefined;
  return spec?.widths.includes(width) ? width : null;
}

// Erros próprios (spec 029, "Detalhes do envio").

/** 413: envio acima de `NUVA_IMAGE_MAX_UPLOAD_MB`. */
export function imagePayloadTooLarge(maxUploadMb: number): DomainError {
  return new DomainError({
    code: 'payload_too_large',
    status: 413,
    title: 'Arquivo grande demais',
    detail: `O arquivo passa de ${maxUploadMb} MB.`,
    extras: { maxBytes: imageUploadMaxBytes(maxUploadMb) },
  });
}

/** 415: o conteúdo não é JPEG, PNG nem WebP estático. */
export function imageTypeUnsupported(
  detail = 'Envie uma imagem JPEG, PNG ou WebP.',
  cause?: unknown,
): DomainError {
  return new DomainError({
    code: 'image_type_unsupported',
    status: 415,
    title: 'Tipo de imagem não aceito',
    detail,
    cause,
  });
}

/** 422: imagem acima de 8000 px no maior lado ou de 40 megapixels. */
export function imageDimensionsExceeded(): DomainError {
  return new DomainError({
    code: 'image_dimensions_exceeded',
    status: 422,
    title: 'Imagem grande demais',
    detail: `A imagem passa de ${IMAGE_MAX_INPUT_SIDE} px no maior lado ou de ${IMAGE_MAX_INPUT_PIXELS / 1_000_000} megapixels.`,
  });
}

/** 422: uma variante passa de 400 KB mesmo na qualidade 50. */
export function imageTooHeavy(): DomainError {
  return new DomainError({
    code: 'image_too_heavy',
    status: 422,
    title: 'Imagem pesada demais',
    detail:
      'A imagem continua acima de 400 KB depois de comprimida; envie uma imagem mais simples.',
  });
}

/** 503 com `Retry-After`: a fila interna de processamento está cheia. */
export function imageProcessingBusy(retryAfterSeconds: number): DomainError {
  return new DomainError({
    code: 'image_processing_busy',
    status: 503,
    title: 'Serviço indisponível',
    detail: 'Muitas imagens sendo processadas agora; tente de novo em instantes.',
    extras: { retryAfterSeconds },
  });
}

/** 409: a imagem tem referência (é o avatar de alguém) e não pode ser apagada. */
export function imageInUse(): DomainError {
  return new DomainError({
    code: 'image_in_use',
    status: 409,
    title: 'Conflito de estado',
    detail: 'A imagem está em uso e não pode ser apagada.',
  });
}
