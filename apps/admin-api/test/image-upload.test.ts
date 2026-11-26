import { randomUUID } from 'node:crypto';
import { createImageProcessingLimiter } from '@nuva-edu/core';
import { afterAll, describe, expect, it } from 'vitest';
import { type Actor, callAs, createActor } from './actors.ts';
import { createTestApp, type TestApp } from './helpers.ts';
import { MULTIPART, multipart, png, type UploadOptions, uploadImage } from './image-fixtures.ts';

const test: TestApp = createTestApp();
afterAll(() => test.close());

function upload(as: Actor, options: UploadOptions = {}) {
  return uploadImage(test, as, options);
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

describe('POST /api/v1/images (school_logo)', () => {
  it('admin envia o logotipo retrato: 201 com as três variantes e a entrega de 256', async () => {
    const admin = await createActor(test, 'admin');
    const sent = await upload(admin, { purpose: 'school_logo', file: png(500, 5000) });
    expect(sent.statusCode).toBe(201);
    const image = sent.json();
    expect(image).toMatchObject({ purpose: 'school_logo', width: 500, height: 5000 });
    // Proporção original: o nome é o maior lado; em retrato, a altura é o nome.
    expect(image.variants).toEqual([
      { width: 64, height: 64, url: `/api/v1/images/${image.id}/64.webp` },
      { width: 256, height: 256, url: `/api/v1/images/${image.id}/256.webp` },
      { width: 512, height: 512, url: `/api/v1/images/${image.id}/512.webp` },
    ]);

    const delivered = await test.app.inject({ method: 'GET', url: image.variants[1].url });
    expect(delivered.statusCode).toBe(200);
    expect(delivered.headers['content-type']).toBe('image/webp');

    // Variante de outra finalidade não existe para esta imagem.
    const otherSize = await test.app.inject({
      method: 'GET',
      url: `/api/v1/images/${image.id}/480.webp`,
    });
    expect(otherSize.statusCode).toBe(404);
  });

  it('logotipo paisagem guarda a altura real em `height` (a largura é o nome)', async () => {
    const admin = await createActor(test, 'admin');
    const sent = await upload(admin, { purpose: 'school_logo', file: png(1000, 100) });
    expect(sent.statusCode).toBe(201);
    const image = sent.json();
    expect(image).toMatchObject({ purpose: 'school_logo', width: 1000, height: 100 });
    expect(image.variants).toEqual([
      { width: 64, height: 6, url: `/api/v1/images/${image.id}/64.webp` },
      { width: 256, height: 26, url: `/api/v1/images/${image.id}/256.webp` },
      { width: 512, height: 51, url: `/api/v1/images/${image.id}/512.webp` },
    ]);
  });

  it('manager e instructor recebem 403 permission_denied, sem gravar', async () => {
    for (const role of ['manager', 'instructor'] as const) {
      const actor = await createActor(test, role);
      const denied = await upload(actor, { purpose: 'school_logo' });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({ code: 'permission_denied' });

      const stored = await test.db
        .selectFrom('images')
        .select('id')
        .where('ownerUserId', '=', actor.id)
        .execute();
      expect(stored).toHaveLength(0);
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
