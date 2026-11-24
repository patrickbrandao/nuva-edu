import { createHash, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, nextIp, sessionCookieOf } from './helpers.ts';

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

describe('limite de taxa da entrega (spec 029)', () => {
  it('com sessão, 100 entregas no minuto não consomem os 300 da sessão', async () => {
    const manager = await createUser(test.db, { role: 'manager' });
    const login = await test.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      remoteAddress: nextIp(),
      payload: { email: manager.email, password: manager.password },
    });
    expect(login.statusCode).toBe(200);
    const cookies = { nuva_admin_session: sessionCookieOf(login.headers['set-cookie']) as string };
    const ip = nextIp();
    const avatar = await storeAvatar();
    for (let i = 0; i < 100; i += 1) {
      const response = await test.app.inject({
        method: 'GET',
        url: `/api/v1/images/${avatar.id}/64.webp`,
        remoteAddress: ip,
        cookies,
      });
      expect(response.statusCode).toBe(200);
    }
    // Os 300 da sessão continuam inteiros; a 301ª passa do limite.
    for (let i = 0; i < 300; i += 1) {
      const response = await test.app.inject({
        method: 'GET',
        url: '/api/v1/session',
        remoteAddress: ip,
        cookies,
      });
      expect(response.statusCode).toBe(200);
    }
    const limited = await test.app.inject({
      method: 'GET',
      url: '/api/v1/session',
      remoteAddress: ip,
      cookies,
    });
    expect(limited.statusCode).toBe(429);
  });

  it('a 601ª entrega no mesmo minuto e IP responde 429 com Retry-After; 304 conta', async () => {
    const avatar = await storeAvatar();
    const ip = nextIp();
    for (let i = 0; i < 600; i += 1) {
      const revalidate = i % 2 === 0;
      const response = await test.app.inject({
        method: 'GET',
        url: `/api/v1/images/${avatar.id}/256.webp`,
        remoteAddress: ip,
        headers: revalidate ? { 'if-none-match': avatar.etag } : {},
      });
      expect(response.statusCode).toBe(revalidate ? 304 : 200);
    }
    const limited = await test.app.inject({
      method: 'GET',
      url: `/api/v1/images/${avatar.id}/256.webp`,
      remoteAddress: ip,
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ code: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Outro IP segue livre.
    const other = await test.app.inject({
      method: 'GET',
      url: `/api/v1/images/${avatar.id}/256.webp`,
      remoteAddress: nextIp(),
    });
    expect(other.statusCode).toBe(200);
  });
});
