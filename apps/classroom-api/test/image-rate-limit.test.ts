import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { CLASSROOM_RATE_LIMITS } from '../src/rate-limits.ts';
import { Browser, createUser } from './accounts.ts';
import { createTestApp, type TestApp } from './helpers.ts';

// Sem limites: prepara a imagem. Com limites: as entregas contadas. Mesmo banco.
const plain = createTestApp();
const limited = createTestApp({}, { rateLimits: CLASSROOM_RATE_LIMITS });
const opened: TestApp[] = [plain, limited];

afterAll(async () => {
  await Promise.all(opened.map((app) => app.close()));
});

/** PNG de 1 × 1 px em tons de cinza. */
function png(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(0, 9);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(2))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BOUNDARY = 'nuva-limite-imagem';

/** Envia um avatar pela API sem limites e devolve o caminho da variante de 64 px. */
async function uploadedVariant(): Promise<string> {
  const user = await createUser(plain.db);
  const owner = new Browser(plain.app);
  expect((await owner.login(user.email)).statusCode).toBe(200);
  const payload = Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\navatar\r\n` +
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="foto.png"\r\n` +
        'Content-Type: image/png\r\n\r\n',
    ),
    png(),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
  const sent = await owner.request('POST', '/api/v1/images', {
    payload,
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  });
  expect(sent.statusCode).toBe(201);
  return `/api/v1/images/${sent.json().id}/64.webp`;
}

describe('limite de taxa da entrega de imagens (spec 029; spec 004, RNF-04)', () => {
  it('visitante: 100 entregas no minuto não consomem os 60 de visitante', async () => {
    const variant = await uploadedVariant();
    const visitor = new Browser(limited.app);
    const first = await visitor.request('GET', variant);
    expect(first.statusCode).toBe(200);
    const etag = String(first.headers.etag);
    for (let call = 1; call < 100; call += 1) {
      // Metade com If-None-Match (304), metade de imagem inexistente (404): tudo é entrega.
      const reply =
        call % 2 === 0
          ? await visitor.request('GET', variant, { headers: { 'if-none-match': etag } })
          : await visitor.request('GET', `/api/v1/images/${randomUUID()}/64.webp`);
      expect(reply.statusCode).toBe(call % 2 === 0 ? 304 : 404);
    }
    for (let call = 0; call < 60; call += 1) {
      expect((await visitor.request('GET', '/api/v1/meta')).statusCode).toBe(200);
    }
    const refused = await visitor.request('GET', '/api/v1/meta');
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: 'rate_limited' });
  });

  it('com sessão: as entregas não consomem os 120 da sessão', async () => {
    const variant = await uploadedVariant();
    const user = await createUser(limited.db);
    const member = new Browser(limited.app);
    expect((await member.login(user.email)).statusCode).toBe(200);
    for (let call = 0; call < 150; call += 1) {
      expect((await member.request('GET', variant)).statusCode).toBe(200);
    }
    for (let call = 0; call < 120; call += 1) {
      expect((await member.request('GET', '/api/v1/session')).statusCode).toBe(200);
    }
    expect((await member.request('GET', '/api/v1/session')).statusCode).toBe(429);
  });

  it('a 601ª entrega no mesmo minuto e IP responde 429 com Retry-After, com ou sem sessão', async () => {
    const variant = await uploadedVariant();
    const visitor = new Browser(limited.app);
    const first = await visitor.request('GET', variant);
    expect(first.statusCode).toBe(200);
    const etag = String(first.headers.etag);
    for (let call = 1; call < 600; call += 1) {
      // `304` conta como qualquer outra resposta.
      const reply = await visitor.request('GET', variant, { headers: { 'if-none-match': etag } });
      expect(reply.statusCode).toBe(304);
    }
    const refused = await visitor.request('GET', variant);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: 'rate_limited' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    // O limite da entrega não vale para as outras operações.
    expect((await visitor.request('GET', '/api/v1/meta')).statusCode).toBe(200);

    // A sessão não abre conta nova: o IP é o mesmo.
    const user = await createUser(limited.db);
    const member = new Browser(limited.app);
    Object.assign(member, { ip: visitor.ip }); // `ip` é só leitura: o mesmo IP do visitante.
    expect((await member.login(user.email)).statusCode).toBe(200);
    expect((await member.request('GET', variant)).statusCode).toBe(429);
  });
});
