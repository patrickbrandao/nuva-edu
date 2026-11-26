import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  closeDatabase,
  createDatabase,
  createImageProcessingLimiter,
  type Database,
  DomainError,
  deleteOrphanImages,
  deleteUnreferencedImage,
  findOrphanImageIds,
  getImageVariant,
  getImageVariantInfo,
  type ImageUploader,
  imageDeliveryHeaders,
  imageEtagMatches,
  listImageVariants,
  uploadImage,
} from '../src/index.ts';

let db: Database;
const LIMITS = { maxUploadMb: 5, uploadsPerHour: 30 };

beforeAll(() => {
  db = createDatabase({ connectionString: inject('databaseUrl'), maxConnections: 4 });
});

afterAll(async () => {
  await closeDatabase(db);
});

// Só as linhas deste arquivo: outros testes podem usar as mesmas tabelas no mesmo banco.
const MINE = sql`(SELECT id FROM users WHERE email LIKE 'img-%@exemplo.test')`;

beforeEach(async () => {
  await sql`UPDATE profiles SET avatar_image_id = NULL WHERE user_id IN ${MINE}`.execute(db);
  await sql`DELETE FROM images WHERE owner_user_id IN ${MINE}`.execute(db);
});

async function countMine(): Promise<{ images: number; variants: number }> {
  const result = await sql<{ images: number; variants: number }>`
    SELECT (SELECT count(*)::int FROM images WHERE owner_user_id IN ${MINE}) AS images,
           (SELECT count(*)::int FROM image_variants v JOIN images i ON i.id = v.image_id
             WHERE i.owner_user_id IN ${MINE}) AS variants`.execute(db);
  return result.rows[0] ?? { images: -1, variants: -1 };
}

async function createUser(role = 'student'): Promise<ImageUploader> {
  const row = await sql<{ id: string }>`
    INSERT INTO users (email, name, role)
    VALUES (${`img-${randomUUID()}@exemplo.test`}, 'Pessoa de teste', ${role})
    RETURNING id`.execute(db);
  const id = row.rows[0]?.id;
  if (!id) throw new Error('usuário não criado');
  await sql`INSERT INTO profiles (user_id) VALUES (${id})`.execute(db);
  return { id, role };
}

async function png(width = 300, height = 200): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#22aa66' } })
    .png()
    .toBuffer();
}

/** Imagem gravada direto no banco, com idade escolhida (para limite por hora e expurgo). */
async function insertImage(ownerId: string, ageHours: number): Promise<string> {
  const row = await sql<{ id: string }>`
    INSERT INTO images (owner_user_id, purpose, original_width, original_height, created_at)
    VALUES (${ownerId}, 'avatar', 10, 10, now() - make_interval(secs => ${ageHours * 3600}))
    RETURNING id`.execute(db);
  const id = row.rows[0]?.id;
  if (!id) throw new Error('imagem não criada');
  return id;
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

describe('envio', () => {
  it('grava a imagem e as variantes numa transação e responde no formato do 201', async () => {
    const user = await createUser();
    const result = await uploadImage(
      db,
      { uploader: user, site: 'classroom', purpose: 'avatar', data: await png() },
      { limits: LIMITS },
    );
    expect(result).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      purpose: 'avatar',
      width: 300,
      height: 200,
      variants: [
        { width: 64, height: 64, url: `/api/v1/images/${result.id}/64.webp` },
        { width: 256, height: 256, url: `/api/v1/images/${result.id}/256.webp` },
      ],
    });
    const stored = await sql<{
      ownerUserId: string;
      originalWidth: number;
      n: number;
    }>`SELECT i.owner_user_id, i.original_width, (SELECT count(*)::int FROM image_variants v WHERE v.image_id = i.id) AS n
       FROM images i WHERE i.id = ${result.id}`.execute(db);
    expect(stored.rows[0]).toEqual({ ownerUserId: user.id, originalWidth: 300, n: 2 });
  });

  it('nenhuma variante gravada passa de 1600 px nem de 400 KB', async () => {
    const user = await createUser();
    await uploadImage(
      db,
      { uploader: user, site: 'classroom', purpose: 'avatar', data: await png(1800, 1200) },
      { limits: LIMITS },
    );
    const rows = await sql<{
      maxSide: number;
      maxBytes: number;
    }>`SELECT max(greatest(width, height))::int AS max_side, max(bytes)::int AS max_bytes
       FROM image_variants v JOIN images i ON i.id = v.image_id
       WHERE i.owner_user_id = ${user.id}`.execute(db);
    expect(rows.rows[0]?.maxSide).toBeLessThanOrEqual(1600);
    expect(rows.rows[0]?.maxBytes).toBeLessThanOrEqual(400 * 1024);
  });

  it('recusa finalidade que o site não aceita com 403, antes de processar', async () => {
    const admin = await createUser('admin');
    const data = await png();
    await expectDomainError(
      uploadImage(
        db,
        { uploader: admin, site: 'admin', purpose: 'avatar', data },
        { limits: LIMITS },
      ),
      403,
      'permission_denied',
    );
    await expectDomainError(
      uploadImage(
        db,
        { uploader: admin, site: 'classroom', purpose: 'school_logo', data },
        { limits: LIMITS },
      ),
      403,
      'permission_denied',
    );
  });

  it('logotipo retrato 500×5000 grava 64, 256 e 512 com o maior lado no nome', async () => {
    const admin = await createUser('admin');
    const result = await uploadImage(
      db,
      { uploader: admin, site: 'admin', purpose: 'school_logo', data: await png(500, 5000) },
      { limits: LIMITS },
    );
    expect(result).toMatchObject({ purpose: 'school_logo', width: 500, height: 5000 });
    expect(result.variants).toEqual([
      { width: 64, height: 64, url: `/api/v1/images/${result.id}/64.webp` },
      { width: 256, height: 256, url: `/api/v1/images/${result.id}/256.webp` },
      { width: 512, height: 512, url: `/api/v1/images/${result.id}/512.webp` },
    ]);

    const rows = await sql<{ width: number; height: number; data: Buffer }>`
      SELECT width, height, data FROM image_variants
      WHERE image_id = ${result.id} ORDER BY width`.execute(db);
    expect(rows.rows.map((row) => [row.width, row.height])).toEqual([
      [64, 64],
      [256, 256],
      [512, 512],
    ]);
    // A largura real da variante retrato não é gravada: sai da proporção do original.
    const real = await Promise.all(
      rows.rows.map(async (row) => {
        const meta = await sharp(row.data).metadata();
        return [meta.width, meta.height];
      }),
    );
    expect(real).toEqual([
      [6, 64],
      [26, 256],
      [51, 512],
    ]);

    const largest = await getImageVariant(db, result.id, '512');
    expect([largest.width, largest.height]).toEqual([512, 512]);
    await expectDomainError(getImageVariant(db, result.id, '480'), 404, 'not_found');
  });

  it('school_logo por manager ou instructor é 403 permission_denied, sem gravar', async () => {
    for (const role of ['manager', 'instructor']) {
      const user = await createUser(role);
      await expectDomainError(
        uploadImage(
          db,
          { uploader: user, site: 'admin', purpose: 'school_logo', data: await png() },
          { limits: LIMITS },
        ),
        403,
        'permission_denied',
      );
    }
    expect((await countMine()).images).toBe(0);
  });

  it('product_cover continua cortado em 16:9 com 480 e 1280', async () => {
    const instructor = await createUser('instructor');
    const result = await uploadImage(
      db,
      {
        uploader: instructor,
        site: 'admin',
        purpose: 'product_cover',
        data: await png(2000, 2000),
      },
      { limits: LIMITS },
    );
    expect(result.variants.map((variant) => [variant.width, variant.height])).toEqual([
      [480, 270],
      [1280, 720],
    ]);
    const rows = await sql<{ width: number; height: number }>`
      SELECT width, height FROM image_variants
      WHERE image_id = ${result.id} ORDER BY width`.execute(db);
    expect(rows.rows.map((row) => [row.width, row.height])).toEqual([
      [480, 270],
      [1280, 720],
    ]);
  });

  it('recusa tamanho acima do limite com 413 e tipo errado com 415, sem gravar', async () => {
    const user = await createUser();
    await expectDomainError(
      uploadImage(
        db,
        {
          uploader: user,
          site: 'classroom',
          purpose: 'avatar',
          data: Buffer.alloc(2 * 1024 * 1024),
        },
        { limits: { maxUploadMb: 1, uploadsPerHour: 30 } },
      ),
      413,
      'payload_too_large',
    );
    await expectDomainError(
      uploadImage(
        db,
        { uploader: user, site: 'classroom', purpose: 'avatar', data: Buffer.from('<svg/>') },
        { limits: LIMITS },
      ),
      415,
      'image_type_unsupported',
    );
    expect((await countMine()).images).toBe(0);
  });

  it('o 31º envio na mesma hora devolve 429 com Retry-After; envio de mais de 1 h não conta', async () => {
    const user = await createUser();
    await insertImage(user.id, 2);
    await insertImage(user.id, 0.75);
    for (let i = 0; i < 29; i += 1) {
      await insertImage(user.id, 0.1);
    }
    const error = await expectDomainError(
      uploadImage(
        db,
        { uploader: user, site: 'classroom', purpose: 'avatar', data: await png() },
        { limits: LIMITS },
      ),
      429,
      'rate_limited',
    );
    const retryAfter = error.extras?.retryAfterSeconds as number;
    expect(retryAfter).toBeGreaterThan(800);
    expect(retryAfter).toBeLessThanOrEqual(900);
  });

  it('a equipe não tem limite por hora', async () => {
    const manager = await createUser('manager');
    for (let i = 0; i < 30; i += 1) {
      await insertImage(manager.id, 0.1);
    }
    const result = await uploadImage(
      db,
      { uploader: manager, site: 'classroom', purpose: 'avatar', data: await png() },
      { limits: LIMITS },
    );
    expect(result.variants).toHaveLength(2);
  });

  it('fila de processamento cheia devolve 503 image_processing_busy', async () => {
    const user = await createUser();
    const limiter = createImageProcessingLimiter({ concurrency: 1, maxQueue: 0 });
    let release: () => void = () => {};
    const blocker = limiter.run(() => new Promise<void>((resolve) => (release = resolve)));
    await expectDomainError(
      uploadImage(
        db,
        { uploader: user, site: 'classroom', purpose: 'avatar', data: await png() },
        { limits: LIMITS, limiter },
      ),
      503,
      'image_processing_busy',
    );
    release();
    await blocker;
  });

  it('variante pesada demais mesmo na qualidade 50 devolve 422 e não grava', async () => {
    const user = await createUser();
    await expectDomainError(
      uploadImage(
        db,
        { uploader: user, site: 'classroom', purpose: 'avatar', data: await png() },
        { limits: LIMITS, maxVariantBytes: 10 },
      ),
      422,
      'image_too_heavy',
    );
  });
});

describe('entrega', () => {
  it('devolve a variante com ETag do sha256; If-None-Match igual casa (304)', async () => {
    const user = await createUser();
    const { id } = await uploadImage(
      db,
      { uploader: user, site: 'classroom', purpose: 'avatar', data: await png() },
      { limits: LIMITS },
    );
    const file = await getImageVariant(db, id.toUpperCase(), '256');
    expect([file.width, file.height]).toEqual([256, 256]);
    expect(file.bytes).toBe(file.data.length);
    expect(file.sha256).toBe(createHash('sha256').update(file.data).digest('hex'));
    expect(file.etag).toBe(`"${file.sha256}"`);
    expect((await sharp(file.data).metadata()).format).toBe('webp');

    const info = await getImageVariantInfo(db, id, 256);
    expect(info).not.toHaveProperty('data');
    expect(info.etag).toBe(file.etag);
    expect(imageEtagMatches(info.etag, file.etag)).toBe(true);
    expect(imageDeliveryHeaders(info)).toEqual({
      'Content-Type': 'image/webp',
      'Content-Length': String(file.bytes),
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: file.etag,
      'X-Content-Type-Options': 'nosniff',
    });

    const list = await listImageVariants(db, id);
    expect(list.map((v) => v.width)).toEqual([64, 256]);
    for (const variant of list) {
      expect(variant).not.toHaveProperty('data');
    }
  });

  it('largura que a finalidade não gera, id inválido, inexistente ou imagem oculta: 404', async () => {
    const user = await createUser();
    const { id } = await uploadImage(
      db,
      { uploader: user, site: 'classroom', purpose: 'avatar', data: await png() },
      { limits: LIMITS },
    );
    await expectDomainError(getImageVariant(db, id, '480'), 404, 'not_found');
    await expectDomainError(getImageVariant(db, id, 'abc'), 404, 'not_found');
    await expectDomainError(getImageVariant(db, 'nao-e-uuid', '256'), 404, 'not_found');
    await expectDomainError(getImageVariantInfo(db, randomUUID(), '256'), 404, 'not_found');

    // Variante prevista pela finalidade, mas ausente no banco.
    await sql`DELETE FROM image_variants WHERE image_id = ${id} AND width = 64`.execute(db);
    await expectDomainError(getImageVariant(db, id, '64'), 404, 'not_found');
    await expectDomainError(getImageVariantInfo(db, id, '64'), 404, 'not_found');

    await sql`UPDATE images SET hidden_at = now() WHERE id = ${id}`.execute(db);
    await expectDomainError(getImageVariant(db, id, '256'), 404, 'not_found');
    await expectDomainError(getImageVariantInfo(db, id, '256'), 404, 'not_found');
    expect(await listImageVariants(db, id)).toEqual([]);
  });
});

describe('exclusão e expurgo', () => {
  it('quem enviou apaga a imagem sem referência; de outro usuário é 404; em uso é 409', async () => {
    const owner = await createUser();
    const other = await createUser();
    const free = await uploadImage(
      db,
      { uploader: owner, site: 'classroom', purpose: 'avatar', data: await png() },
      { limits: LIMITS },
    );
    const used = await uploadImage(
      db,
      { uploader: owner, site: 'classroom', purpose: 'avatar', data: await png(64, 64) },
      { limits: LIMITS },
    );
    await sql`UPDATE profiles SET avatar_image_id = ${used.id} WHERE user_id = ${owner.id}`.execute(
      db,
    );

    await expectDomainError(
      deleteUnreferencedImage(db, { imageId: free.id, userId: other.id }),
      404,
      'not_found',
    );
    await expectDomainError(
      deleteUnreferencedImage(db, { imageId: 'x', userId: owner.id }),
      404,
      'not_found',
    );
    await expectDomainError(
      deleteUnreferencedImage(db, { imageId: used.id, userId: owner.id }),
      409,
      'image_in_use',
    );

    await deleteUnreferencedImage(db, { imageId: free.id.toUpperCase(), userId: owner.id });
    expect(await countMine()).toEqual({ images: 1, variants: 2 });
  });

  it('imagem não usada some após o expurgo; imagem em uso e imagem recente permanecem', async () => {
    const user = await createUser();
    const orphan = await insertImage(user.id, 30);
    const older = await insertImage(user.id, 48);
    const inUse = await insertImage(user.id, 30);
    const recent = await insertImage(user.id, 2);
    await sql`UPDATE profiles SET avatar_image_id = ${inUse} WHERE user_id = ${user.id}`.execute(
      db,
    );

    const mine = new Set([orphan, older, inUse, recent]);
    const only = (ids: string[]) => ids.filter((id) => mine.has(id));

    expect(only(await findOrphanImageIds(db))).toEqual([older, orphan]);
    expect(only(await findOrphanImageIds(db, { olderThanHours: 1 }))).toEqual([
      older,
      orphan,
      recent,
    ]);
    expect(await findOrphanImageIds(db, { limit: 1 })).toHaveLength(1);

    expect(await deleteOrphanImages(db, { limit: 10_000 })).toBeGreaterThanOrEqual(2);
    expect(await deleteOrphanImages(db, { limit: 10_000 })).toBe(0);
    const left = await sql<{ id: string }>`
      SELECT id FROM images WHERE owner_user_id = ${user.id}`.execute(db);
    expect(left.rows.map((row) => row.id).sort()).toEqual([inUse, recent].sort());
  });
});
