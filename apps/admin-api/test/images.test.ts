import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser } from './helpers.ts';

const test = createTestApp();
afterAll(() => test.close());

/** Avatar gravado direto no banco, com as variantes 64 e 256 (spec 029). */
async function storeAvatar(options: { hidden?: boolean } = {}) {
  const owner = await createUser(test.db, { role: 'student' });
  const image = await test.db
    .insertInto('images')
    .values({
      ownerUserId: owner.id,
      purpose: 'avatar',
      originalWidth: 300,
      originalHeight: 300,
      hiddenAt: options.hidden ? new Date() : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const data = Buffer.from(`RIFF-webp-de-teste-${randomUUID()}`);
  const sha256 = createHash('sha256').update(data).digest('hex');
  for (const width of [64, 256]) {
    await test.db
      .insertInto('imageVariants')
      .values({ imageId: image.id, width, height: width, bytes: data.length, sha256, data })
      .execute();
  }
  return { id: image.id, data, etag: `"${sha256}"` };
}

describe('GET /api/v1/images/{imageId}/{variant}.webp', () => {
  it('entrega a variante sem sessão, com os cabeçalhos da spec 029', async () => {
    const avatar = await storeAvatar();
    const response = await test.app.inject({
      method: 'GET',
      url: `/api/v1/images/${avatar.id}/256.webp`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(avatar.data)).toBe(true);
    expect(response.headers).toMatchObject({
      'content-type': 'image/webp',
      'cache-control': 'public, max-age=31536000, immutable',
      etag: avatar.etag,
      'x-content-type-options': 'nosniff',
      'content-length': String(avatar.data.length),
    });
  });

  it('If-None-Match igual ao ETag: 304 sem corpo', async () => {
    const avatar = await storeAvatar();
    const response = await test.app.inject({
      method: 'GET',
      url: `/api/v1/images/${avatar.id}/64.webp`,
      headers: { 'if-none-match': avatar.etag },
    });
    expect(response.statusCode).toBe(304);
    expect(response.body).toBe('');
    expect(response.headers.etag).toBe(avatar.etag);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('largura que a finalidade não tem, imagem oculta ou inexistente: 404', async () => {
    const avatar = await storeAvatar();
    const hidden = await storeAvatar({ hidden: true });
    for (const url of [
      `/api/v1/images/${avatar.id}/1280.webp`,
      `/api/v1/images/${hidden.id}/256.webp`,
      `/api/v1/images/${randomUUID()}/256.webp`,
    ]) {
      const response = await test.app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'not_found' });
    }
  });

  it('largura fora da lista do contrato: 400 validation_failed', async () => {
    const avatar = await storeAvatar();
    const response = await test.app.inject({
      method: 'GET',
      url: `/api/v1/images/${avatar.id}/100.webp`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_failed' });
  });
});
