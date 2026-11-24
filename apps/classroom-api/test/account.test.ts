import { randomUUID } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { createImageProcessingLimiter, hashSessionToken, openLoginSession } from '@nuva-edu/core';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Browser,
  createUser,
  OTHER_PASSWORD,
  type Reply,
  TEST_PASSWORD,
  uniqueEmail,
} from './accounts.ts';
import { createTestApp, type TestApp } from './helpers.ts';

const opened: TestApp[] = [];
function open(...args: Parameters<typeof createTestApp>): TestApp {
  const test = createTestApp(...args);
  opened.push(test);
  return test;
}

// Google e Facebook configurados: só provedor configurado pode ser desvinculado.
const test = open({
  GOOGLE_CLIENT_ID: 'id-do-google',
  GOOGLE_CLIENT_SECRET: 'segredo-do-google',
  FACEBOOK_APP_ID: 'id-do-facebook',
  FACEBOOK_APP_SECRET: 'segredo-do-facebook',
});
const { db } = test;

function scan(reply: Reply): void {
  const seen = JSON.stringify(reply.headers) + reply.body;
  expect(seen).not.toContain(TEST_PASSWORD);
  expect(seen).not.toContain(OTHER_PASSWORD);
}

afterAll(async () => {
  for (const app of opened) {
    expect(app.logText()).not.toContain(TEST_PASSWORD);
    expect(app.logText()).not.toContain(OTHER_PASSWORD);
  }
  await Promise.all(opened.map((app) => app.close()));
});

/** Um usuário novo, já com sessão aberta no navegador devolvido. */
async function signedIn(app: TestApp = test, options: Parameters<typeof createUser>[1] = {}) {
  const user = await createUser(app.db, options);
  const browser = new Browser(app.app, scan);
  if (options.password === null) {
    throw new Error('Conta sem senha não entra por senha.');
  }
  expect((await browser.login(user.email, options.password ?? TEST_PASSWORD)).statusCode).toBe(200);
  return { user, browser };
}

function link(userId: string, provider: string) {
  return db
    .insertInto('oauthIdentities')
    .values({ userId, provider, providerUserId: randomUUID(), email: uniqueEmail(provider) })
    .execute();
}

describe('PUT /api/v1/account/password', () => {
  it('troca com a senha atual: outras sessões encerradas, a atual continua', async () => {
    const { user, browser } = await signedIn();
    const other = new Browser(test.app, scan);
    await other.login(user.email);
    const reply = await browser.request('PUT', '/api/v1/account/password', {
      payload: { currentPassword: TEST_PASSWORD, newPassword: OTHER_PASSWORD },
    });
    expect(reply.statusCode).toBe(204);
    expect((await browser.request('GET', '/api/v1/session')).statusCode).toBe(200);
    expect((await other.request('GET', '/api/v1/session')).statusCode).toBe(401);
    expect((await new Browser(test.app, scan).login(user.email, OTHER_PASSWORD)).statusCode).toBe(
      200,
    );
  });

  it('senha atual errada: 422 current_password_invalid; ausente também', async () => {
    const { browser } = await signedIn();
    const wrong = await browser.request('PUT', '/api/v1/account/password', {
      payload: { currentPassword: OTHER_PASSWORD, newPassword: OTHER_PASSWORD },
    });
    expect(wrong.statusCode).toBe(422);
    expect(wrong.json()).toMatchObject({ code: 'current_password_invalid' });
    const missing = await browser.request('PUT', '/api/v1/account/password', {
      payload: { newPassword: OTHER_PASSWORD },
    });
    expect(missing.json()).toMatchObject({ code: 'current_password_invalid' });
  });

  it('nova senha fora de 8 a 128: 400 password_invalid', async () => {
    const { browser } = await signedIn();
    const reply = await browser.request('PUT', '/api/v1/account/password', {
      payload: { currentPassword: TEST_PASSWORD, newPassword: 'curta' },
    });
    expect(reply.statusCode).toBe(400);
    expect(reply.json()).toMatchObject({ code: 'password_invalid' });
  });

  it('5 senhas atuais erradas bloqueiam: 429 too_many_attempts', async () => {
    const { browser } = await signedIn();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reply = await browser.request('PUT', '/api/v1/account/password', {
        payload: { currentPassword: `errada-${attempt}`, newPassword: OTHER_PASSWORD },
      });
      expect(reply.statusCode).toBe(422);
    }
    const locked = await browser.request('PUT', '/api/v1/account/password', {
      payload: { currentPassword: TEST_PASSWORD, newPassword: OTHER_PASSWORD },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ code: 'too_many_attempts' });
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('sem sessão: 401; sem CSRF: 403', async () => {
    const anonymous = await new Browser(test.app, scan).request('PUT', '/api/v1/account/password', {
      payload: { newPassword: OTHER_PASSWORD },
    });
    expect(anonymous.statusCode).toBe(401);
    const { browser } = await signedIn();
    const noCsrf = await browser.request('PUT', '/api/v1/account/password', {
      payload: { currentPassword: TEST_PASSWORD, newPassword: OTHER_PASSWORD },
      csrf: false,
    });
    expect(noCsrf.json()).toMatchObject({ code: 'csrf_token_invalid' });
  });
});

describe('métodos de acesso', () => {
  it('GET /account/identities lista a senha e os provedores vinculados', async () => {
    const { user, browser } = await signedIn();
    await link(user.id, 'google');
    const reply = await browser.request('GET', '/api/v1/account/identities');
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({
      hasPassword: true,
      items: [{ provider: 'google', email: expect.stringContaining('google-') }],
    });
    expect(
      (await new Browser(test.app).request('GET', '/api/v1/account/identities')).statusCode,
    ).toBe(401);
  });

  it('DELETE /account/identities/{provider}: remove; não vinculado 404; último método 422', async () => {
    const { user, browser } = await signedIn();
    await link(user.id, 'google');
    const removed = await browser.request('DELETE', '/api/v1/account/identities/google');
    expect(removed.statusCode).toBe(204);
    const again = await browser.request('DELETE', '/api/v1/account/identities/google');
    expect(again.statusCode).toBe(404);
    // Provedor sem as variáveis nesta instalação: 404 mesmo vinculado.
    await link(user.id, 'apple');
    expect((await browser.request('DELETE', '/api/v1/account/identities/apple')).statusCode).toBe(
      404,
    );
    const unknown = await browser.request('DELETE', '/api/v1/account/identities/github');
    expect(unknown.statusCode).toBe(400);

    // Conta só com o Facebook: não pode ficar sem método de acesso.
    const lonely = await createUser(db, { password: null });
    await link(lonely.id, 'facebook');
    const lonelyBrowser = new Browser(test.app, scan);
    // Sem senha não há login por senha: a sessão é aberta como o login social a abre.
    const created = await db.transaction().execute((trx) =>
      openLoginSession(trx, {
        user: { id: lonely.id, role: 'student' },
        site: 'classroom',
        context: { ip: lonelyBrowser.ip },
        method: 'facebook',
      }),
    );
    lonelyBrowser.cookie = created.token;
    lonelyBrowser.csrfToken = created.csrfToken;
    const last = await lonelyBrowser.request('DELETE', '/api/v1/account/identities/facebook');
    expect(last.statusCode).toBe(422);
    expect(last.json()).toMatchObject({ code: 'last_login_method' });
  });
});

describe('sessões da conta', () => {
  it('GET /account/sessions lista as dos dois sites, a atual marcada, com navegador e sistema', async () => {
    const { user, browser } = await signedIn();
    await new Browser(test.app, scan).login(user.email);
    const reply = await browser.request('GET', '/api/v1/account/sessions');
    expect(reply.statusCode).toBe(200);
    const items = reply.json().items;
    expect(items).toHaveLength(2);
    expect(items.filter((item: { current: boolean }) => item.current)).toHaveLength(1);
    expect(items[0]).toMatchObject({ site: 'classroom', browser: 'Chrome', os: 'macOS' });
  });

  it('DELETE /account/sessions/{id}: encerra outra; alheia ou inexistente, 404', async () => {
    const { user, browser } = await signedIn();
    const other = new Browser(test.app, scan);
    await other.login(user.email);
    const list = (await browser.request('GET', '/api/v1/account/sessions')).json().items;
    const target = list.find((item: { current: boolean }) => !item.current);
    expect(
      (await browser.request('DELETE', `/api/v1/account/sessions/${target.id}`)).statusCode,
    ).toBe(204);
    expect((await other.request('GET', '/api/v1/session')).statusCode).toBe(401);

    const stranger = await signedIn();
    const strangerSessions = (
      await stranger.browser.request('GET', '/api/v1/account/sessions')
    ).json().items;
    const foreign = await browser.request(
      'DELETE',
      `/api/v1/account/sessions/${strangerSessions[0].id}`,
    );
    expect(foreign.statusCode).toBe(404);
    expect(
      (await browser.request('DELETE', `/api/v1/account/sessions/${randomUUID()}`)).statusCode,
    ).toBe(404);
  });

  it('DELETE /account/sessions/{id} da própria sessão apaga o cookie', async () => {
    const { browser } = await signedIn();
    const [mine] = (await browser.request('GET', '/api/v1/account/sessions')).json().items;
    const reply = await browser.request('DELETE', `/api/v1/account/sessions/${mine.id}`);
    expect(reply.statusCode).toBe(204);
    expect(reply.cookies[0]).toMatchObject({ value: '' });
  });

  it('DELETE /account/sessions encerra todas as outras, nos dois sites', async () => {
    const { user, browser } = await signedIn();
    const other = new Browser(test.app, scan);
    await other.login(user.email);
    await db
      .updateTable('sessions')
      .set({ site: 'admin' })
      .where('userId', '=', user.id)
      .where('idHash', '!=', hashSessionToken(browser.cookie ?? ''))
      .execute();
    const reply = await browser.request('DELETE', '/api/v1/account/sessions');
    expect(reply.statusCode).toBe(204);
    const left = await db
      .selectFrom('sessions')
      .select('site')
      .where('userId', '=', user.id)
      .execute();
    expect(left).toEqual([{ site: 'classroom' }]);
  });
});

// 1×1 px em PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const BOUNDARY = 'nuvaBoundaryClassroom7MA4';

/** PNG de `width` × 1 px em tons de cinza, todo preto. */
function widePng(width: number): Buffer {
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
  ihdr.writeUInt32BE(1, 4);
  ihdr.writeUInt8(8, 8); // 8 bits por amostra
  ihdr.writeUInt8(0, 9); // tons de cinza
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    // Uma linha: o byte do filtro e um byte por pixel.
    chunk('IDAT', deflateSync(Buffer.alloc(width + 1))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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
const MULTIPART = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };

function upload(browser: Browser, file: Buffer = PNG, purpose = 'avatar') {
  return browser.request('POST', '/api/v1/images', {
    payload: multipart([
      { name: 'purpose', value: purpose },
      { name: 'file', value: file, filename: 'foto.png' },
    ]),
    headers: MULTIPART,
  });
}

describe('imagens e avatar', () => {
  it('envia o avatar, associa ao perfil e a sessão passa a mostrar o avatarUrl', async () => {
    const { browser } = await signedIn();
    const sent = await upload(browser);
    expect(sent.statusCode).toBe(201);
    const image = sent.json();
    expect(image).toMatchObject({ purpose: 'avatar', width: 1, height: 1 });
    expect(image.variants.map((variant: { width: number }) => variant.width)).toEqual([64, 256]);

    const set = await browser.request('PUT', '/api/v1/me/profile/avatar', {
      payload: { imageId: image.id },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ avatarUrl: `/api/v1/images/${image.id}/256.webp` });
    expect((await browser.request('GET', '/api/v1/session')).json().user.avatarUrl).toBe(
      `/api/v1/images/${image.id}/256.webp`,
    );

    // Em uso: não se apaga (404, como no contrato).
    expect((await browser.request('DELETE', `/api/v1/images/${image.id}`)).statusCode).toBe(404);

    const removed = await browser.request('PUT', '/api/v1/me/profile/avatar', {
      payload: { imageId: null },
    });
    expect(removed.json()).toEqual({ avatarUrl: null });
    expect((await browser.request('DELETE', `/api/v1/images/${image.id}`)).statusCode).toBe(204);
  });

  it('entrega pública com ETag, cache longo, nosniff e 304 no If-None-Match', async () => {
    const { browser } = await signedIn();
    const image = (await upload(browser)).json();
    const visitor = new Browser(test.app, scan);
    const reply = await visitor.request('GET', `/api/v1/images/${image.id}/64.webp`);
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['content-type']).toBe('image/webp');
    expect(reply.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(reply.headers['x-content-type-options']).toBe('nosniff');
    const etag = String(reply.headers.etag);
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(reply.body.length).toBeGreaterThan(0);

    const cached = await visitor.request('GET', `/api/v1/images/${image.id}/64.webp`, {
      headers: { 'if-none-match': etag },
    });
    expect(cached.statusCode).toBe(304);
    expect(cached.body).toBe('');
    expect(cached.headers.etag).toBe(etag);
    expect(cached.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    // Largura que a finalidade não tem, ou imagem inexistente: 404.
    expect((await visitor.request('GET', `/api/v1/images/${image.id}/512.webp`)).statusCode).toBe(
      404,
    );
    expect(
      (await visitor.request('GET', `/api/v1/images/${randomUUID()}/64.webp`)).statusCode,
    ).toBe(404);
    expect((await visitor.request('GET', `/api/v1/images/${image.id}/65.webp`)).statusCode).toBe(
      400,
    );
  });

  it('avatar de outro usuário ou inexistente: 404; de outra finalidade: 422 image_purpose_mismatch', async () => {
    const owner = await signedIn();
    const image = (await upload(owner.browser)).json();
    const { browser } = await signedIn();
    const foreign = await browser.request('PUT', '/api/v1/me/profile/avatar', {
      payload: { imageId: image.id },
    });
    expect(foreign.statusCode).toBe(404);
    expect((await browser.request('DELETE', `/api/v1/images/${image.id}`)).statusCode).toBe(404);

    const mine = (await upload(browser)).json();
    await db
      .updateTable('images')
      .set({ purpose: 'case_image' })
      .where('id', '=', mine.id)
      .execute();
    const mismatch = await browser.request('PUT', '/api/v1/me/profile/avatar', {
      payload: { imageId: mine.id },
    });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json()).toMatchObject({ code: 'image_purpose_mismatch' });
  });

  it('recusas do envio: finalidade, tipo, tamanho, campos e falta de sessão', async () => {
    const { browser } = await signedIn();
    const purpose = await upload(browser, PNG, 'school_logo');
    expect(purpose.statusCode).toBe(400);

    const text = await upload(browser, Buffer.from('não sou uma imagem'));
    expect(text.statusCode).toBe(415);
    expect(text.json()).toMatchObject({ code: 'image_type_unsupported' });

    const huge = await upload(browser, widePng(9000));
    expect(huge.statusCode).toBe(422);
    expect(huge.json()).toMatchObject({ code: 'image_dimensions_exceeded' });

    const big = await upload(browser, Buffer.alloc(6 * 1024 * 1024, 1));
    expect(big.statusCode).toBe(413);
    expect(big.json()).toMatchObject({ code: 'payload_too_large' });

    const noFile = await browser.request('POST', '/api/v1/images', {
      payload: multipart([{ name: 'purpose', value: 'avatar' }]),
      headers: MULTIPART,
    });
    expect(noFile.statusCode).toBe(400);
    expect(noFile.json()).toMatchObject({ code: 'validation_failed' });

    const json = await browser.request('POST', '/api/v1/images', {
      payload: { purpose: 'avatar' },
    });
    expect(json.statusCode).toBe(415);
    expect(json.json()).toMatchObject({ code: 'unsupported_media_type' });

    const anonymous = await upload(new Browser(test.app, scan));
    expect(anonymous.statusCode).toBe(401);
  });

  it('limite de envios por hora: 429 rate_limited', async () => {
    const limited = open({ NUVA_IMAGE_UPLOADS_PER_HOUR: '2' });
    const { browser } = await signedIn(limited);
    expect((await upload(browser)).statusCode).toBe(201);
    expect((await upload(browser)).statusCode).toBe(201);
    const refused = await upload(browser);
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: 'rate_limited' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('processamento sobrecarregado: 503 image_processing_busy com Retry-After', async () => {
    const limiter = createImageProcessingLimiter({
      concurrency: 1,
      maxQueue: 0,
      retryAfterSeconds: 7,
    });
    const busy = open({}, { imageLimiter: limiter });
    const { browser } = await signedIn(busy);
    let release: () => void = () => {};
    const holding = limiter.run(() => new Promise<void>((resolve) => (release = resolve)));
    try {
      const refused = await upload(browser);
      expect(refused.statusCode).toBe(503);
      expect(refused.json()).toMatchObject({ code: 'image_processing_busy' });
      expect(refused.headers['retry-after']).toBe('7');
    } finally {
      release();
      await holding;
    }
  });
});
