// Campos e limites do catálogo (spec 009, RNF-03 e "Dados"): conferência dos valores que chegam
// das rotas de escrita. Formato errado é `400` `validation_failed` com o campo; quantidade acima
// do limite é `422` `catalog_limit_exceeded`.

import {
  businessRule,
  DomainError,
  type FieldError,
  validationFailed,
} from '../../errors/domain-error.ts';

/** RNF-03 da 009. */
export const CATALOG_LIMITS = {
  titleMaxLength: 160,
  summaryMaxLength: 300,
  descriptionMaxLength: 20_000,
  modulesPerCourse: 100,
  lessonsPerCourse: 500,
  linksPerLesson: 20,
  urlMaxLength: 2000,
  /** Da migration 0009 (formato e tamanho do slug, rótulo do link, nome do autor). */
  slugMaxLength: 160,
  labelMaxLength: 160,
  authorNameMaxLength: 160,
  /** Decisão da tarefa 410: até 200 itens por pacote (o teto da vitrine da RNF-01). */
  itemsPerBundle: 200,
  /** Decisão da tarefa 410: até 500 vínculos por ebook. */
  targetsPerEbook: 500,
  /** Decisão da tarefa 410: duração informada de uma aula, até 24 horas. */
  lessonDurationMaxSeconds: 86_400,
  /** Decisão da tarefa 410: preço até R$ 10 milhões, em centavos. */
  priceMaxCents: 1_000_000_000,
  /** Decisão da tarefa 410: validade até 100 anos, carga horária até 10.000 horas. */
  accessDaysMax: 36_500,
  certificateHoursMax: 10_000,
  pagesMax: 100_000,
} as const;

export const ACCESS_MODES = ['open', 'paid', 'private'] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const COURSE_LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type CourseLevel = (typeof COURSE_LEVELS)[number];

export const PUBLICATION_STATUSES = ['draft', 'published'] as const;
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];

export const LESSON_LINK_KINDS = ['file', 'page'] as const;
export type LessonLinkKind = (typeof LESSON_LINK_KINDS)[number];

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCatalogId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** `422` `catalog_limit_exceeded`: quantidade acima da RNF-03 (ou dos tetos da tarefa 410). */
export function catalogLimitExceeded(limit: keyof typeof CATALOG_LIMITS, detail: string) {
  return new DomainError({
    code: 'catalog_limit_exceeded',
    status: 422,
    title: 'Limite do catálogo atingido',
    detail,
    extras: { limit, max: CATALOG_LIMITS[limit] },
  });
}

/** Junta os erros de campo de uma entrada e lança `400` uma vez só. */
export class FieldErrors {
  readonly list: FieldError[] = [];

  add(path: string, message: string): void {
    this.list.push({ path, message });
  }

  throwIfAny(): void {
    if (this.list.length > 0) throw validationFailed(this.list);
  }
}

function lengthOk(text: string, max: number): boolean {
  return [...text].length <= max;
}

/** Título obrigatório: aparado, não vazio, até `max`. */
export function readTitle(
  errors: FieldErrors,
  value: unknown,
  path: string,
  max: number = CATALOG_LIMITS.titleMaxLength,
): string {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text !== '' && lengthOk(text, max)) return text;
  }
  errors.add(path, `Informe o texto, até ${max} caracteres.`);
  return '';
}

/** Texto opcional: `null` ou vazio vira nulo; aparado no resumo, como veio na descrição. */
export function readOptionalText(
  errors: FieldErrors,
  value: unknown,
  path: string,
  max: number,
  options: { trim?: boolean } = {},
): string | null {
  if (value === null) return null;
  if (typeof value === 'string') {
    const text = options.trim === false ? value : value.trim();
    if (text.trim() === '') return null;
    if (lengthOk(text, max)) return text;
  }
  errors.add(path, `Use até ${max} caracteres.`);
  return null;
}

export function readSlug(errors: FieldErrors, value: unknown, path: string): string {
  if (
    typeof value === 'string' &&
    SLUG_PATTERN.test(value) &&
    value.length <= CATALOG_LIMITS.slugMaxLength
  ) {
    return value;
  }
  errors.add(
    path,
    `Use minúsculas, números e hífens, até ${CATALOG_LIMITS.slugMaxLength} caracteres.`,
  );
  return '';
}

export function readEnum<T extends string>(
  errors: FieldErrors,
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  errors.add(path, `Use um destes valores: ${allowed.join(', ')}.`);
  return allowed[0] as T;
}

export function readBoolean(errors: FieldErrors, value: unknown, path: string): boolean {
  if (typeof value === 'boolean') return value;
  errors.add(path, 'Use verdadeiro ou falso.');
  return false;
}

/** Inteiro entre `min` e `max`; `nullable` aceita `null`. */
export function readInteger(
  errors: FieldErrors,
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max) {
    return value;
  }
  errors.add(path, `Use um inteiro de ${min} a ${max}.`);
  return min;
}

export function readNullableInteger(
  errors: FieldErrors,
  value: unknown,
  path: string,
  min: number,
  max: number,
): number | null {
  return value === null ? null : readInteger(errors, value, path, min, max);
}

export function readId(errors: FieldErrors, value: unknown, path: string): string {
  if (isCatalogId(value)) return value.toLowerCase();
  errors.add(path, 'Identificador inválido.');
  return '';
}

export function readNullableId(errors: FieldErrors, value: unknown, path: string): string | null {
  return value === null ? null : readId(errors, value, path);
}

/** `version` da edição (spec 003, "Concorrência"). */
export function readVersion(value: unknown, path = 'body.version'): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value;
  throw validationFailed([{ path, message: 'Informe a versão lida, inteiro a partir de 1.' }]);
}

/** `version` opcional das trocas de lista inteira (ordem, itens, links, vínculos). */
export function readOptionalVersion(value: unknown, path = 'body.version'): number | undefined {
  return value === undefined ? undefined : readVersion(value, path);
}

/** Lista obrigatória; o que não é lista vira erro de campo e lista vazia. */
export function readArray(errors: FieldErrors, value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value;
  errors.add(path, 'Informe uma lista.');
  return [];
}

/** Objeto de um item de lista; o que não é objeto vira erro de campo. */
export function readObject(
  errors: FieldErrors,
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  errors.add(path, 'Informe um objeto.');
  return {};
}

/** `422` com código próprio, para as pré-condições de publicação e afins. */
export function catalogRule(code: string, detail: string): DomainError {
  return businessRule(code, detail);
}
