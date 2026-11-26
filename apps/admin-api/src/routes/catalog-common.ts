import type { FastifyRequest } from '@nuva-edu/api-kit';
import type { CatalogCover, CatalogRequest } from '@nuva-edu/core';
import { managementRequest } from '../session.ts';

// O que as rotas do catálogo (spec 009) compartilham: quem pede, datas, capa e os campos do
// corpo.

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
