// Gravação, entrega, exclusão e expurgo das imagens (spec 029). Escrita em `images` e
// `image_variants`: o envio e a exclusão são da API que recebeu o envio; o expurgo das órfãs é
// do worker (`image.cleanup`).

import { type Expression, type SqlBool, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { notFound, rateLimited } from '../../errors/domain-error.ts';
import { imagePath, isImageId } from './image-url.ts';
import { type ImageProcessingLimiter, imageProcessingLimiter } from './limiter.ts';
import { processImage } from './processing.ts';
import {
  assertCanUploadImagePurpose,
  type ImagePurpose,
  type ImageUploadSite,
  imageInUse,
  imagePayloadTooLarge,
  imageUploadMaxBytes,
  isImageRateLimited,
  parseImageVariant,
} from './rules.ts';

/** Quem envia: a conta da sessão. */
export interface ImageUploader {
  id: string;
  role: string;
}

export interface UploadImageInput {
  uploader: ImageUploader;
  /** Site cuja API recebeu o envio (cada um aceita só as finalidades dele). */
  site: ImageUploadSite;
  /** Campo `purpose` do formulário, ainda não validado. */
  purpose: string;
  /** Conteúdo do campo `file`. */
  data: Uint8Array;
}

export interface UploadImageOptions {
  /** `config.images`: `maxUploadMb` e `uploadsPerHour`. */
  limits: { maxUploadMb: number; uploadsPerHour: number };
  /** Limitador de processamentos; padrão, o do processo. */
  limiter?: ImageProcessingLimiter;
  /** Teto de cada variante (só para teste). */
  maxVariantBytes?: number;
}

/** Resposta `201` do `POST /api/v1/images`. */
export interface UploadedImage {
  id: string;
  purpose: ImagePurpose;
  width: number;
  height: number;
  variants: Array<{ width: number; height: number; url: string }>;
}

/** Bytes de uma variante para a rota de entrega. */
export interface ImageVariantFile {
  imageId: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  /** Valor do cabeçalho `ETag`: o sha256 entre aspas. */
  etag: string;
  data: Buffer;
}

/** Variante sem os bytes (listagens nunca selecionam `data`). */
export type ImageVariantInfo = Omit<ImageVariantFile, 'data'>;

const ONE_HOUR_SECONDS = 3600;

/**
 * `429` `rate_limited` quando o usuário já fez `uploadsPerHour` envios na última hora (a equipe
 * não tem limite). Conta as linhas de `images` do usuário criadas na última hora.
 */
export async function assertImageUploadAllowed(
  db: Database,
  uploader: ImageUploader,
  uploadsPerHour: number,
): Promise<void> {
  if (!isImageRateLimited(uploader.role)) {
    return;
  }
  const row = await db
    .selectFrom('images')
    .select([
      sql<number>`count(*)::int`.as('count'),
      sql<
        number | null
      >`ceil(extract(epoch FROM min(created_at) + interval '1 hour' - now()))::int`.as(
        'retryAfter',
      ),
    ])
    .where('ownerUserId', '=', uploader.id)
    .where(sql<SqlBool>`created_at > now() - interval '1 hour'`)
    .executeTakeFirstOrThrow();
  if (row.count >= uploadsPerHour) {
    const retryAfter = Math.min(ONE_HOUR_SECONDS, Math.max(1, row.retryAfter ?? ONE_HOUR_SECONDS));
    throw rateLimited(retryAfter, `Limite de ${uploadsPerHour} imagens por hora atingido.`);
  }
}

/**
 * Envio completo (spec 029, "Fluxo de envio", passos 2 a 4): confere finalidade e papel,
 * tamanho e limite por hora; processa dentro do limitador; grava `images` e as variantes numa
 * transação (o limite por hora é conferido de novo ali, com trava por usuário).
 */
export async function uploadImage(
  db: Database,
  input: UploadImageInput,
  options: UploadImageOptions,
): Promise<UploadedImage> {
  const { uploader, data } = input;
  const purpose = input.purpose;
  assertCanUploadImagePurpose(input.site, uploader.role, purpose);
  if (data.length > imageUploadMaxBytes(options.limits.maxUploadMb)) {
    throw imagePayloadTooLarge(options.limits.maxUploadMb);
  }
  await assertImageUploadAllowed(db, uploader, options.limits.uploadsPerHour);

  const limiter = options.limiter ?? imageProcessingLimiter;
  const processed = await limiter.run(() =>
    processImage(data, purpose, {
      maxUploadMb: options.limits.maxUploadMb,
      ...(options.maxVariantBytes === undefined
        ? {}
        : { maxVariantBytes: options.maxVariantBytes }),
    }),
  );

  const id = await db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext('images.upload:' || ${uploader.id}))`.execute(
      trx,
    );
    await assertImageUploadAllowed(trx, uploader, options.limits.uploadsPerHour);
    const image = await trx
      .insertInto('images')
      .values({
        ownerUserId: uploader.id,
        purpose,
        originalWidth: processed.originalWidth,
        originalHeight: processed.originalHeight,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('imageVariants')
      .values(
        processed.variants.map((variant) => ({
          imageId: image.id,
          width: variant.width,
          height: variant.height,
          bytes: variant.bytes,
          sha256: variant.sha256,
          data: variant.data,
        })),
      )
      .execute();
    return image.id;
  });

  return {
    id,
    purpose,
    width: processed.originalWidth,
    height: processed.originalHeight,
    variants: processed.variants.map((variant) => ({
      width: variant.width,
      height: variant.height,
      url: imagePath(id, variant.width),
    })),
  };
}

async function findVisibleImage(
  db: Database,
  imageId: string,
): Promise<{ id: string; purpose: string } | undefined> {
  if (!isImageId(imageId)) {
    return undefined;
  }
  return db
    .selectFrom('images')
    .select(['id', 'purpose'])
    .where('id', '=', imageId.toLowerCase())
    .where('hiddenAt', 'is', null)
    .executeTakeFirst();
}

function withEtag<T extends { sha256: string }>(row: T): T & { etag: string } {
  return { ...row, etag: `"${row.sha256}"` };
}

/**
 * Metadados de uma variante, sem ler `data` (para responder `304` sem trazer os bytes).
 * Inexistente, oculta pela moderação, ou largura que a finalidade não gera: `404`.
 */
export async function getImageVariantInfo(
  db: Database,
  imageId: string,
  variant: string | number,
): Promise<ImageVariantInfo> {
  const image = await findVisibleImage(db, imageId);
  const width = image ? parseImageVariant(image.purpose, variant) : null;
  if (!image || width === null) {
    throw notFound('Imagem não encontrada.');
  }
  const row = await db
    .selectFrom('imageVariants')
    .select(['imageId', 'width', 'height', 'bytes', 'sha256'])
    .where('imageId', '=', image.id)
    .where('width', '=', width)
    .executeTakeFirst();
  if (!row) {
    throw notFound('Imagem não encontrada.');
  }
  return withEtag(row);
}

/** Variante com os bytes, para a rota de entrega. Mesmas regras de `getImageVariantInfo`. */
export async function getImageVariant(
  db: Database,
  imageId: string,
  variant: string | number,
): Promise<ImageVariantFile> {
  const image = await findVisibleImage(db, imageId);
  const width = image ? parseImageVariant(image.purpose, variant) : null;
  if (!image || width === null) {
    throw notFound('Imagem não encontrada.');
  }
  const row = await db
    .selectFrom('imageVariants')
    .select(['imageId', 'width', 'height', 'bytes', 'sha256', 'data'])
    .where('imageId', '=', image.id)
    .where('width', '=', width)
    .executeTakeFirst();
  if (!row) {
    throw notFound('Imagem não encontrada.');
  }
  return withEtag(row);
}

/** Variantes de uma imagem, sem `data`, da menor para a maior. Imagem oculta: lista vazia. */
export async function listImageVariants(
  db: Database,
  imageId: string,
): Promise<ImageVariantInfo[]> {
  const image = await findVisibleImage(db, imageId);
  if (!image) {
    return [];
  }
  const rows = await db
    .selectFrom('imageVariants')
    .select(['imageId', 'width', 'height', 'bytes', 'sha256'])
    .where('imageId', '=', image.id)
    .orderBy('width')
    .execute();
  return rows.map(withEtag);
}

/** Cabeçalhos da resposta de entrega (spec 029, "Entrega"). */
export function imageDeliveryHeaders(
  variant: Pick<ImageVariantInfo, 'etag' | 'bytes'>,
): Record<string, string> {
  return {
    'Content-Type': 'image/webp',
    'Content-Length': String(variant.bytes),
    'Cache-Control': 'public, max-age=31536000, immutable',
    ETag: variant.etag,
    'X-Content-Type-Options': 'nosniff',
  };
}

/** Verdadeiro quando o `If-None-Match` casa com o `ETag` (a entrega devolve `304`). */
export function imageEtagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (ifNoneMatch === undefined) {
    return false;
  }
  return ifNoneMatch
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
    .some((value) => value === '*' || value === etag);
}

/**
 * Condição "a imagem tem referência" (spec 029, "Expurgo"): `profiles.avatar_image_id` e, na
 * Fase 2, a capa de `courses`, `ebooks` e `bundles`. As finalidades novas acrescentam aqui as
 * colunas das tabelas donas.
 */
function isReferenced(imageIdColumn: Expression<string>): Expression<SqlBool> {
  return sql<SqlBool>`(
    EXISTS (SELECT 1 FROM profiles WHERE profiles.avatar_image_id = ${imageIdColumn})
    OR EXISTS (SELECT 1 FROM courses WHERE courses.cover_image_id = ${imageIdColumn})
    OR EXISTS (SELECT 1 FROM ebooks WHERE ebooks.cover_image_id = ${imageIdColumn})
    OR EXISTS (SELECT 1 FROM bundles WHERE bundles.cover_image_id = ${imageIdColumn})
  )`;
}

/**
 * `DELETE /api/v1/images/{image_id}`: só quem enviou e só sem referência. De outro usuário ou
 * inexistente: `404`; em uso: `409` `image_in_use`.
 */
export async function deleteUnreferencedImage(
  db: Database,
  input: { imageId: string; userId: string },
): Promise<void> {
  if (!isImageId(input.imageId)) {
    throw notFound('Imagem não encontrada.');
  }
  const imageId = input.imageId.toLowerCase();
  await db.transaction().execute(async (trx) => {
    // FOR UPDATE espera quem esteja gravando uma referência (a chave estrangeira trava a linha).
    const image = await trx
      .selectFrom('images')
      .select('id')
      .where('id', '=', imageId)
      .where('ownerUserId', '=', input.userId)
      .forUpdate()
      .executeTakeFirst();
    if (!image) {
      throw notFound('Imagem não encontrada.');
    }
    const used = await sql<{
      used: boolean;
    }>`SELECT ${isReferenced(sql.val(imageId))} AS used`.execute(trx);
    if (used.rows[0]?.used) {
      throw imageInUse();
    }
    await trx.deleteFrom('images').where('id', '=', imageId).execute();
  });
}

export interface OrphanImageOptions {
  /** Idade mínima, em horas. Padrão: 24. */
  olderThanHours?: number;
  /** Máximo por chamada. Padrão: 500. */
  limit?: number;
}

/** Imagens sem referência criadas há mais de 24 h (para o `image.cleanup`), mais antigas antes. */
export async function findOrphanImageIds(
  db: Database,
  options: OrphanImageOptions = {},
): Promise<string[]> {
  const hours = options.olderThanHours ?? 24;
  const rows = await db
    .selectFrom('images')
    .select('id')
    .where(sql<SqlBool>`created_at < now() - make_interval(hours => ${hours})`)
    .where((eb) => eb.not(isReferenced(eb.ref('images.id'))))
    .orderBy('createdAt')
    .limit(options.limit ?? 500)
    .execute();
  return rows.map((row) => row.id);
}

/**
 * Expurgo das órfãs (worker, `image.cleanup`): apaga até `limit` imagens sem referência há mais
 * de 24 h, com as variantes (cascata). A condição é refeita no `DELETE`, então uma imagem que
 * ganhou referência entre a busca e a exclusão fica. Devolve quantas apagou.
 */
export async function deleteOrphanImages(
  db: Database,
  options: OrphanImageOptions = {},
): Promise<number> {
  const ids = await findOrphanImageIds(db, options);
  if (ids.length === 0) {
    return 0;
  }
  const hours = options.olderThanHours ?? 24;
  const result = await db
    .deleteFrom('images')
    .where('id', 'in', ids)
    .where(sql<SqlBool>`created_at < now() - make_interval(hours => ${hours})`)
    .where((eb) => eb.not(isReferenced(eb.ref('images.id'))))
    .executeTakeFirst();
  return Number(result.numDeletedRows);
}
