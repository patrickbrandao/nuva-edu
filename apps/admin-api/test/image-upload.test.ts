import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { createImageProcessingLimiter } from '@nuva-edu/core';
import { afterAll, describe, expect, it } from 'vitest';
import { type Actor, callAs, createActor } from './actors.ts';
import { createTestApp, type TestApp } from './helpers.ts';

const test: TestApp = createTestApp();
afterAll(() => test.close());

/** PNG em tons de cinza, todo preto. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8 bits por amostra
  ihdr.writeUInt8(0, 9); // tons de cinza
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    // Cada linha: o byte do filtro e um byte por pixel.
    chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BOUNDARY = 'limite-de-teste';
const MULTIPART = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };

function multipart(parts: Array<{ name: string; value: string | Buffer; filename?: string }>) {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition =
      part.filename === undefined
        ? `form-data; name="${part.name}"`
        : `form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: image/png`;
    chunks.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: ${disposition}\r\n\r\n`));
    chunks.push(typeof part.value === 'string' ? Buffer.from(part.value) : part.value);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

function upload(
  as: Actor,
  options: { file?: Buffer; purpose?: string; app?: TestApp; csrf?: null } = {},
) {
  return callAs(options.app ?? test, {
    method: 'POST',
    url: '/api/v1/images',
    as,
    headers: MULTIPART,
    payload: multipart([
      { name: 'purpose', value: options.purpose ?? 'product_cover' },
      { name: 'file', value: options.file ?? png(32, 18), filename: 'capa.png' },
    ]),
    ...(options.csrf === null ? { csrf: null } : {}),
  });
}

describe('POST /api/v1/images (product_cover)', () => {
  it('instrutor envia a capa, usa no curso, e a entrega pública serve as variantes', async () => {
    const instructor = await createActor(test, 'instructor');
    const sent = await upload(instructor);
    expect(sent.statusCode).toBe(201);
    const image = sent.json();
    expect(image).toMatchObject({ purpose: 'product_cover', width: 32, height: 18 });
    expect(image.variants).toEqual([
      { width: 480, height: 270, url: `/api/v1/images/${image.id}/480.webp` },
      { width: 1280, height: 720, url: `/api/v1/images/${image.id}/1280.webp` },
    ]);

    const course = await callAs(test, {
      method: 'POST',
      url: '/api/v1/courses',
      as: instructor,
      payload: { title: `Curso com capa ${randomUUID()}`, coverImageId: image.id },
    });
    expect(course.statusCode).toBe(201);
    expect(course.json().cover).toEqual({
      imageId: image.id,
      url: `/api/v1/images/${image.id}/480.webp`,
      largeUrl: `/api/v1/images/${image.id}/1280.webp`,
    });

    const delivered = await test.app.inject({ method: 'GET', url: image.variants[0].url });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.headers['content-type']).toBe('image/webp');

    // Em uso: não se apaga (404, como no contrato).
    const inUse = await callAs(test, {
      method: 'DELETE',
      url: `/api/v1/images/${image.id}`,
      as: instructor,
    });
    expect(inUse.statusCode).toBe(404);

    // Sem a capa no curso, quem enviou apaga.
    const cleared = await callAs(test, {
      method: 'PATCH',
      url: `/api/v1/courses/${course.json().id}`,
      as: instructor,
      payload: { coverImageId: null, version: course.json().version },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().cover).toBeNull();
    const removed = await callAs(test, {
      method: 'DELETE',
      url: `/api/v1/images/${image.id}`,
      as: instructor,
    });
    expect(removed.statusCode).toBe(204);
    expect((await test.app.inject({ method: 'GET', url: image.variants[0].url })).statusCode).toBe(
      404,
    );
  });

  it('finalidade fora do admin, campo a mais ou sem arquivo: 400; sem CSRF: 403; aluno: 403', async () => {
    const manager = await createActor(test, 'manager');
    const avatar = await upload(manager, { purpose: 'avatar' });
    expect(avatar.statusCode).toBe(400);
    expect(avatar.json()).toMatchObject({ code: 'validation_failed' });

    const noFile = await callAs(test, {
      method: 'POST',
      url: '/api/v1/images',
      as: manager,
      headers: MULTIPART,
      payload: multipart([{ name: 'purpose', value: 'product_cover' }]),
    });
    expect(noFile.statusCode).toBe(400);

    const extra = await callAs(test, {
      method: 'POST',
      url: '/api/v1/images',
      as: manager,
      headers: MULTIPART,
      payload: multipart([
        { name: 'purpose', value: 'product_cover' },
        { name: 'file', value: png(32, 18), filename: 'capa.png' },
        { name: 'outro', value: 'x' },
      ]),
    });
    expect(extra.statusCode).toBe(400);

    expect((await upload(manager, { csrf: null })).statusCode).toBe(403);

    const student = await createActor(test, 'student');
    const denied = await upload(student);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: 'permission_denied' });
  });

  it('arquivo que não é imagem: 415; dimensão acima do limite: 422', async () => {
    const manager = await createActor(test, 'manager');
    const text = await upload(manager, { file: Buffer.from('isto não é uma imagem') });
    expect(text.statusCode).toBe(415);
    expect(text.json()).toMatchObject({ code: 'image_type_unsupported' });

    const huge = await upload(manager, { file: png(8001, 1) });
    expect(huge.statusCode).toBe(422);
    expect(huge.json()).toMatchObject({ code: 'image_dimensions_exceeded' });
  });

  it('processamento sobrecarregado: 503 image_processing_busy com Retry-After', async () => {
    const limiter = createImageProcessingLimiter({
      concurrency: 1,
      maxQueue: 0,
      retryAfterSeconds: 7,
    });
    const busy = createTestApp({}, { imageLimiter: limiter });
    try {
      const manager = await createActor(busy, 'manager');
      let release: () => void = () => {};
      const holding = limiter.run(() => new Promise<void>((resolve) => (release = resolve)));
      const response = await upload(manager, { app: busy });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: 'image_processing_busy' });
      expect(response.headers['retry-after']).toBe('7');
      release();
      await holding;
    } finally {
      await busy.close();
    }
  });
});

describe('DELETE /api/v1/images/{imageId}', () => {
  it('imagem de outro usuário ou inexistente: 404; a própria sem uso: 204', async () => {
    const manager = await createActor(test, 'manager');
    const other = await createActor(test, 'manager');
    const image = (await upload(manager)).json();

    const foreign = await callAs(test, {
      method: 'DELETE',
      url: `/api/v1/images/${image.id}`,
      as: other,
    });
    expect(foreign.statusCode).toBe(404);
    const missing = await callAs(test, {
      method: 'DELETE',
      url: `/api/v1/images/${randomUUID()}`,
      as: manager,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: 'not_found' });

    const own = await callAs(test, {
      method: 'DELETE',
      url: `/api/v1/images/${image.id}`,
      as: manager,
    });
    expect(own.statusCode).toBe(204);
    expect(own.body).toBe('');
  });
});
