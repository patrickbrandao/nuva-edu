import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  type Database,
  getImageVariant,
  getImageVariantInfo,
  imageDeliveryHeaders,
  imageEtagMatches,
} from '@nuva-edu/core';

// Entrega pública das variantes (spec 029, "Entrega"). O admin só entrega; o envio do admin
// entra com as finalidades dele (logotipo, capas), nas fases seguintes.

export function registerImageRoutes(app: FastifyInstance, options: { db: Database }): void {
  const { db } = options;

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
