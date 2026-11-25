import type { FastifyInstance, MultipartBody } from '@nuva-edu/api-kit';
import { UploadedFile } from '@nuva-edu/api-kit';
import {
  type Config,
  type Database,
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
import { requireSession, SITE } from '../session.ts';

// Imagens no admin (spec 029): entrega pública das variantes e, desde a Fase 2, envio e
// exclusão da capa de produto (`product_cover`, de `instructor`, `manager` e `admin`). Quem
// decide a finalidade aceita pelo site e pelo papel é o núcleo (`uploadImage`).

/**
 * Folga do corpo multipart além do arquivo (delimitadores, cabeçalhos das partes, `purpose`).
 * O tamanho do arquivo em si é conferido pelo núcleo, com o mesmo `413`.
 */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export interface ImageRoutesOptions {
  db: Database;
  config: Config;
  /** Limitador de processamentos; padrão, o do processo. */
  limiter?: ImageProcessingLimiter;
}

export function registerImageRoutes(app: FastifyInstance, options: ImageRoutesOptions): void {
  const { db, config } = options;

  // `POST /api/v1/images`: `purpose` e depois `file`; responde `201` com as variantes.
  app.operation(
    'uploadImage',
    async (request, reply) => {
      const { user } = requireSession(request);
      const body = request.body as MultipartBody;
      const file = body.file;
      if (!(file instanceof UploadedFile) || typeof body.purpose !== 'string') {
        throw validationFailed([{ path: 'body.file', message: 'Envie o arquivo da imagem.' }]);
      }
      const image = await uploadImage(
        db,
        {
          uploader: { id: user.id, role: user.role },
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
      return reply.status(201).send({
        id: image.id,
        purpose: image.purpose,
        width: image.width,
        height: image.height,
        variants: image.variants.map((variant) => ({
          width: variant.width,
          height: variant.height,
          url: variant.url,
        })),
      });
    },
    { bodyLimit: imageUploadMaxBytes(config.images.maxUploadMb) + MULTIPART_OVERHEAD_BYTES },
  );

  // `DELETE /api/v1/images/{imageId}`: só a própria e sem uso. Em uso também é `404`, como no
  // contrato.
  app.operation('deleteImage', async (request, reply) => {
    const { user } = requireSession(request);
    const { imageId } = request.params as { imageId: string };
    try {
      await deleteUnreferencedImage(db, { imageId, userId: user.id });
    } catch (error) {
      if (isDomainError(error) && error.code === 'image_in_use') {
        throw notFound('Imagem não encontrada.');
      }
      throw error;
    }
    return reply.status(204).send();
  });

  app.operation('getImageVariant', async (request, reply) => {
    const { imageId, variant } = request.params as { imageId: string; variant: number };
    // Sem os bytes primeiro: o `304` não precisa trazê-los do banco.
    const info = await getImageVariantInfo(db, imageId, variant);
    const headers = imageDeliveryHeaders(info);
    const ifNoneMatch = request.headers['if-none-match'];
    if (imageEtagMatches(typeof ifNoneMatch === 'string' ? ifNoneMatch : undefined, info.etag)) {
      return reply
        .status(304)
        .header('ETag', headers.ETag)
        .header('Cache-Control', headers['Cache-Control'])
        .send();
    }
    const file = await getImageVariant(db, imageId, variant);
    return reply.status(200).headers(imageDeliveryHeaders(file)).send(file.data);
  });
}
