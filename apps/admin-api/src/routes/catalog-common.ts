import type { FastifyRequest } from '@nuva-edu/api-kit';
import { type CatalogCover, type CatalogRequest, isDomainError } from '@nuva-edu/core';
import { managementRequest } from '../session.ts';

// O que as rotas do catálogo (spec 009) compartilham: quem pede, datas, capa, o slug gerado do
// título e a `version` da edição.

export const iso = (value: Date): string => value.toISOString();
export const isoOrNull = (value: Date | null): string | null =>
  value === null ? null : iso(value);

export type IdParams = { id: string };

/** Quem pede, para as regras do catálogo (`CatalogRequest` tem a forma de `ManagementRequest`). */
export function catalogRequest(request: FastifyRequest): CatalogRequest {
  return managementRequest(request);
}

/** `ProductCover` do contrato. */
export function coverBody(cover: CatalogCover | null) {
  return cover === null
    ? null
    : { imageId: cover.imageId, url: cover.url, largeUrl: cover.largeUrl };
}

/** Só as chaves presentes no corpo: campo omitido não muda (o corpo já passou pelo contrato). */
export function pick<K extends string>(
  body: Record<string, unknown>,
  keys: readonly K[],
): Partial<Record<K, unknown>> {
  const out: Partial<Record<K, unknown>> = {};
  for (const key of keys) {
    if (key in body) {
      out[key] = body[key];
    }
  }
  return out;
}

const SLUG_MAX_LENGTH = 160;

/**
 * Slug gerado do título quando o corpo não traz `slug` (contrato, `POST /courses`): sem acentos,
 * minúsculas, o resto vira hífen, até 160 caracteres. Título sem letra nem número vira `item`.
 * Slug repetido continua sendo `409` `slug_taken`, do núcleo.
 */
export function slugFromTitle(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '');
  return slug === '' ? 'item' : slug;
}

const VERSION_ATTEMPTS = 3;

/**
 * Edição cujo corpo, no contrato, não traz `version`: a rota lê a versão atual e a entrega ao
 * núcleo, que a exige. Vale a última gravação; se outra gravação entrar entre a leitura e a
 * escrita (`409` `version_conflict`), lê de novo e repete, até três vezes.
 */
export async function withCurrentVersion<T>(
  readVersion: () => Promise<number>,
  write: (version: number) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const version = await readVersion();
    try {
      return await write(version);
    } catch (error) {
      const conflict = isDomainError(error) && error.code === 'version_conflict';
      if (!conflict || attempt >= VERSION_ATTEMPTS) {
        throw error;
      }
    }
  }
}
