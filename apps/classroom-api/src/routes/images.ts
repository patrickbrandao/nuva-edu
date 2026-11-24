import type { FastifyInstance, MultipartBody } from '@nuva-edu/api-kit';
import { UploadedFile } from '@nuva-edu/api-kit';
import {
  deleteUnreferencedImage,
  getImageVariant,
  getImageVariantInfo,
  type ImageProcessingLimiter,
  imageDeliveryHeaders,
  imageEtagMatches,
  imageUploadMaxBytes,
  isDomainError,
  notFound,
  uploadImage,
  validationFailed,
} from '@nuva-edu/core';
import { SITE } from '../session.ts';
import { paramsOf, type RouteContext, requireSession } from './context.ts';

/**
 * Folga do corpo multipart além do arquivo (delimitadores, cabeçalhos das partes, `purpose`).
 * O tamanho do arquivo em si é conferido pelo núcleo, com o mesmo `413`.
 */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export interface ImageRouteOptions {
  /** Limitador de processamentos; padrão, o do processo. */
  limiter?: ImageProcessingLimiter;
}

/** Envio, entrega e exclusão de imagens (spec 029). No classroom, só a finalidade `avatar`. */
export function registerImageRoutes(
  app: FastifyInstance,
  ctx: RouteContext,
  options: ImageRouteOptions = {},
): void {
  const { config, db } = ctx;

  // `POST /images`: `purpose` e depois `file`; responde `201` com as variantes.
  app.operation(
    'uploadImage',
    async (request, reply) => {
      const current = requireSession(request);
      const body = request.body as MultipartBody;
      const file = body.file;
      if (!(file instanceof UploadedFile) || typeof body.purpose !== 'string') {
        throw validationFailed([{ path: 'body.file', message: 'Envie o arquivo da imagem.' }]);
      }
      const image = await uploadImage(
        db,
        {
          uploader: { id: current.user.id, role: current.user.role },
          site: SITE,
          purpose: body.purpose,
          data: file.data,
        },
        {
          limits: {
            maxUploadMb: config.images.maxUploadMb,
            uploadsPerHour: config.images.uploadsPerHour,
          },
          ...(options.limiter ? { limiter: options.limiter } : {}),
        },
      );
      reply.status(201);
      return image;
    },
    { bodyLimit: imageUploadMaxBytes(config.images.maxUploadMb) + MULTIPART_OVERHEAD_BYTES },
  );

  // `DELETE /images/{imageId}`: só a própria e sem uso. Em uso também é `404`, como no contrato.
  app.operation('deleteImage', async (request, reply) => {
    const current = requireSession(request);
    const { imageId } = paramsOf<{ imageId: string }>(request);
    try {
      await deleteUnreferencedImage(db, { imageId, userId: current.user.id });
    } catch (error) {
      if (isDomainError(error) && error.code === 'image_in_use') {
        throw notFound('Imagem não encontrada.');
      }
      throw error;
    }
    reply.status(204);
  });

  // `GET /images/{imageId}/{variant}.webp`: público, com `ETag` e cache longo.
  app.operation('getImageVariant', async (request, reply) => {
    const { imageId, variant } = paramsOf<{ imageId: string; variant: string | number }>(request);
    const ifNoneMatch = request.headers['if-none-match'];
    const info = await getImageVariantInfo(db, imageId, variant);
    if (imageEtagMatches(typeof ifNoneMatch === 'string' ? ifNoneMatch : undefined, info.etag)) {
      const headers = imageDeliveryHeaders(info);
      reply.status(304).headers({ ETag: headers.ETag, 'Cache-Control': headers['Cache-Control'] });
      return undefined;
    }
    const file = await getImageVariant(db, imageId, variant);
    reply.headers(imageDeliveryHeaders(file));
    return file.data;
  });
}
