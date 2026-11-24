import { createHash, randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  assertCanUploadImagePurpose,
  canUploadImagePurpose,
  createImageProcessingLimiter,
  DomainError,
  detectImageFormat,
  IMAGE_MAX_VARIANT_BYTES,
  IMAGE_VARIANT_SPECS,
  imageDimensionsExceeded,
  imageEtagMatches,
  imageUploadMaxBytes,
  isImagePurpose,
  isImageRateLimited,
  parseImageVariant,
  processImage,
} from '../src/index.ts';

async function solid(
  width: number,
  height: number,
  format: 'png' | 'jpeg' | 'webp' | 'gif',
): Promise<Buffer> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } },
  });
  return image.toFormat(format).toBuffer();
}

async function noise(width: number, height: number): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function expectDomainError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<DomainError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  const domain = error as DomainError;
  expect({ status: domain.status, code: domain.code }).toEqual({ status, code });
  return domain;
}

describe('detecção do tipo pelo conteúdo', () => {
  it('reconhece JPEG, PNG e WebP pela assinatura', async () => {
    expect(detectImageFormat(await solid(4, 4, 'jpeg'))).toBe('jpeg');
    expect(detectImageFormat(await solid(4, 4, 'png'))).toBe('png');
    expect(detectImageFormat(await solid(4, 4, 'webp'))).toBe('webp');
  });

  it('não reconhece GIF, SVG, executável nem arquivo curto', async () => {
    expect(detectImageFormat(await solid(4, 4, 'gif'))).toBeNull();
    expect(detectImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageFormat(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]))).toBeNull();
    expect(detectImageFormat(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageFormat(Buffer.from('RIFF0000WAVEfmt '))).toBeNull();
  });
});

describe('recusas do processamento (spec 029)', () => {
  it('arquivo .png com conteúdo SVG é recusado com 415', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/></svg>',
    );
    await expectDomainError(processImage(svg, 'avatar'), 415, 'image_type_unsupported');
  });

  it('executável e GIF são recusados com 415', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), randomBytes(512)]);
    await expectDomainError(processImage(exe, 'avatar'), 415, 'image_type_unsupported');
    const gif = await solid(16, 16, 'gif');
    await expectDomainError(processImage(gif, 'avatar'), 415, 'image_type_unsupported');
  });

  it('assinatura PNG com conteúdo inválido ou JPEG truncado são recusados com 415', async () => {
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      randomBytes(200),
    ]);
    await expectDomainError(processImage(fake, 'avatar'), 415, 'image_type_unsupported');
    const jpeg = await noise(300, 300);
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length / 2));
    await expectDomainError(processImage(truncated, 'avatar'), 415, 'image_type_unsupported');
  });

  it('WebP animado é recusado com 415', async () => {
    const frames = await Promise.all(
      ['#ff0000', '#0000ff'].map((background) =>
        sharp({ create: { width: 16, height: 16, channels: 3, background } })
          .png()
          .toBuffer(),
      ),
    );
    const animated = await sharp(frames, { join: { animated: true } })
      .webp({ loop: 0 })
      .toBuffer();
    expect(animated.includes(Buffer.from('ANIM'))).toBe(true);
    await expectDomainError(processImage(animated, 'avatar'), 415, 'image_type_unsupported');
  });

  it('envio de 6 MB é recusado com 413 antes de decodificar', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 0);
    big.set([0xff, 0xd8, 0xff]);
    const error = await expectDomainError(processImage(big, 'avatar'), 413, 'payload_too_large');
    expect(error.extras).toEqual({ maxBytes: 5 * 1024 * 1024 });
    await expectDomainError(
      processImage(Buffer.alloc(2 * 1024 * 1024, 0), 'avatar', { maxUploadMb: 1 }),
      413,
      'payload_too_large',
    );
  });

  it('imagem de 9000 px é recusada com 422', async () => {
    const wide = await solid(9000, 10, 'png');
    await expectDomainError(processImage(wide, 'avatar'), 422, 'image_dimensions_exceeded');
  });

  it('imagem acima de 40 megapixels é recusada com 422', async () => {
    const huge = await solid(6400, 6400, 'png');
    await expectDomainError(processImage(huge, 'avatar'), 422, 'image_dimensions_exceeded');
  });

  it('finalidade ainda não implementada é erro de quem chama', async () => {
    await expect(processImage(await solid(8, 8, 'png'), 'profile_cover')).rejects.toThrow(
      TypeError,
    );
  });
});

describe('variantes do avatar', () => {
  it('gera 64 e 256 quadradas em WebP, com sha256 e bytes do conteúdo', async () => {
    const result = await processImage(await solid(800, 600, 'png'), 'avatar');
    expect(result.format).toBe('png');
    expect([result.originalWidth, result.originalHeight]).toEqual([800, 600]);
    expect(result.variants.map((v) => [v.width, v.height, v.quality])).toEqual([
      [64, 64, 80],
      [256, 256, 80],
    ]);
    for (const variant of result.variants) {
      expect(detectImageFormat(variant.data)).toBe('webp');
      const meta = await sharp(variant.data).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual([
        'webp',
        variant.width,
        variant.height,
      ]);
      expect(variant.bytes).toBe(variant.data.length);
      expect(variant.sha256).toBe(createHash('sha256').update(variant.data).digest('hex'));
      expect(variant.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('amplia quando o original é menor que a variante', async () => {
    const result = await processImage(await solid(40, 30, 'webp'), 'avatar');
    expect(result.format).toBe('webp');
    const big = result.variants.find((v) => v.width === 256);
    const meta = await sharp(big?.data).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
  });

  it('JPEG com EXIF de GPS resulta em variantes sem nenhum metadado', async () => {
    const jpeg = await sharp({
      create: { width: 640, height: 480, channels: 3, background: '#3366aa' },
    })
      .withExif({
        IFD0: { Copyright: 'Escola de teste', Make: 'Camera' },
        IFD3: {
          GPSLatitudeRef: 'S',
          GPSLatitude: '23/1 33/1 0/1',
          GPSLongitudeRef: 'W',
          GPSLongitude: '46/1 38/1 0/1',
        },
      })
      .jpeg()
      .toBuffer();
    const input = await sharp(jpeg).metadata();
    // A entrada tem EXIF com GPS (IFD de GPS, tag 0x8825) e o texto do Copyright.
    expect(input.exif?.includes(Buffer.from('Escola de teste'))).toBe(true);
    expect(
      input.exif?.includes(Buffer.from([0x88, 0x25])) ||
        input.exif?.includes(Buffer.from([0x25, 0x88])),
    ).toBe(true);

    const result = await processImage(jpeg, 'avatar');
    for (const variant of result.variants) {
      const meta = await sharp(variant.data).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.iptc).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      for (const chunk of ['EXIF', 'XMP ', 'ICCP']) {
        expect(variant.data.includes(Buffer.from(chunk))).toBe(false);
      }
      expect(variant.data.includes(Buffer.from('Escola de teste'))).toBe(false);
    }
  });

  it('aplica a orientação do EXIF nas dimensões originais', async () => {
    const rotated = await sharp(await solid(400, 200, 'jpeg'))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const result = await processImage(rotated, 'avatar');
    expect([result.originalWidth, result.originalHeight]).toEqual([200, 400]);
  });

  it('nenhuma variante passa de 1600 px nem de 400 KB, mesmo com ruído', async () => {
    const result = await processImage(await noise(1200, 900), 'avatar');
    for (const variant of result.variants) {
      expect(Math.max(variant.width, variant.height)).toBeLessThanOrEqual(1600);
      expect(variant.bytes).toBeLessThanOrEqual(IMAGE_MAX_VARIANT_BYTES);
    }
  });

  it('acima do teto, a qualidade cai de 10 em 10; na 50 ainda acima, 422 image_too_heavy', async () => {
    const input = await noise(600, 600);
    const first = await processImage(input, 'avatar');
    const largest = first.variants.find((v) => v.width === 256);
    if (!largest) throw new Error('sem variante 256');
    expect(largest.quality).toBe(80);

    const capped = await processImage(input, 'avatar', { maxVariantBytes: largest.bytes - 1 });
    const reduced = capped.variants.find((v) => v.width === 256);
    expect(reduced?.quality).toBeLessThan(80);
    expect([70, 60, 50]).toContain(reduced?.quality);
    expect(reduced?.bytes).toBeLessThan(largest.bytes);

    await expectDomainError(
      processImage(input, 'avatar', { maxVariantBytes: 100 }),
      422,
      'image_too_heavy',
    );
  });
});

describe('regras de envio e entrega', () => {
  it('na Fase 1 o classroom aceita avatar de qualquer papel e o admin não aceita envio', () => {
    for (const role of ['student', 'instructor', 'manager', 'admin']) {
      expect(canUploadImagePurpose('classroom', role, 'avatar')).toBe(true);
      expect(canUploadImagePurpose('admin', role, 'avatar')).toBe(false);
    }
    expect(canUploadImagePurpose('classroom', 'student', 'profile_cover')).toBe(false);
    expect(canUploadImagePurpose('classroom', 'student', 'banana')).toBe(false);
    expect(canUploadImagePurpose('classroom', '', 'avatar')).toBe(false);
    expect(() => assertCanUploadImagePurpose('admin', 'admin', 'avatar')).toThrow(DomainError);
    expect(Object.keys(IMAGE_VARIANT_SPECS)).toEqual(['avatar']);
  });

  it('finalidades, larguras de variante e limites', () => {
    expect(isImagePurpose('school_logo')).toBe(true);
    expect(isImagePurpose('logo')).toBe(false);
    expect(isImagePurpose(3)).toBe(false);
    expect(parseImageVariant('avatar', '256')).toBe(256);
    expect(parseImageVariant('avatar', 64)).toBe(64);
    expect(parseImageVariant('avatar', '480')).toBeNull();
    expect(parseImageVariant('avatar', '0256')).toBeNull();
    expect(parseImageVariant('avatar', '256.webp')).toBeNull();
    expect(parseImageVariant('school_logo', '256')).toBeNull();
    expect(parseImageVariant('banana', '256')).toBeNull();
    expect(imageUploadMaxBytes(5)).toBe(5_242_880);
    expect(isImageRateLimited('student')).toBe(true);
    expect(isImageRateLimited('instructor')).toBe(false);
    expect(isImageRateLimited('manager')).toBe(false);
    expect(isImageRateLimited('admin')).toBe(false);
    expect(imageDimensionsExceeded().status).toBe(422);
  });

  it('If-None-Match casa com o ETag, com lista e com W/', () => {
    const etag = `"${'a'.repeat(64)}"`;
    expect(imageEtagMatches(undefined, etag)).toBe(false);
    expect(imageEtagMatches(etag, etag)).toBe(true);
    expect(imageEtagMatches(`"x", W/${etag}`, etag)).toBe(true);
    expect(imageEtagMatches('*', etag)).toBe(true);
    expect(imageEtagMatches('"outro"', etag)).toBe(false);
  });
});

describe('limitador de processamentos', () => {
  it('roda 2 ao mesmo tempo, enfileira 10 e recusa o 13º com 503 e Retry-After', async () => {
    const limiter = createImageProcessingLimiter({ retryAfterSeconds: 7 });
    let running = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const task = () =>
      new Promise<number>((resolve) => {
        running += 1;
        peak = Math.max(peak, running);
        gates.push(() => {
          running -= 1;
          resolve(running);
        });
      });
    const accepted = Array.from({ length: 12 }, () => limiter.run(task));
    await Promise.resolve();
    expect([limiter.active, limiter.queued]).toEqual([2, 10]);

    const error = await expectDomainError(limiter.run(task), 503, 'image_processing_busy');
    expect(error.extras).toEqual({ retryAfterSeconds: 7 });

    while (gates.length > 0 || limiter.active > 0) {
      gates.shift()?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(accepted);
    expect(peak).toBe(2);
    expect([limiter.active, limiter.queued]).toEqual([0, 0]);
  });

  it('libera a vaga quando a tarefa falha', async () => {
    const limiter = createImageProcessingLimiter({ concurrency: 1, maxQueue: 0 });
    await expect(limiter.run(() => Promise.reject(new Error('falhou')))).rejects.toThrow('falhou');
    expect(await limiter.run(() => Promise.resolve(42))).toBe(42);
    expect(limiter.active).toBe(0);
  });

  it('recusa configuração inválida', () => {
    expect(() => createImageProcessingLimiter({ concurrency: 0 })).toThrow(TypeError);
    expect(() => createImageProcessingLimiter({ maxQueue: -1 })).toThrow(TypeError);
  });
});
