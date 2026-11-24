import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { UploadedFile } from '../src/index.ts';
import {
  authHeaders,
  buildPhase1App,
  endlessUpload,
  MULTIPART_HEADERS,
  multipart,
} from './phase1-helpers.ts';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const MB = 1024 * 1024;

function imageApp(bodyLimit = 5 * MB, seen: unknown[] = []) {
  const built = buildPhase1App(
    {},
    {
      uploadImage: () => (request, reply) => {
        seen.push(request.body);
        const body = request.body as Record<string, unknown>;
        reply.status(201);
        return { purpose: String(body.purpose), size: (body.file as UploadedFile).size };
      },
    },
    { uploadImage: { bodyLimit } },
  );
  apps.push(built.app);
  return built;
}

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe('application/x-www-form-urlencoded (retorno da Apple)', () => {
  it('lê o formulário e valida pelo contrato', async () => {
    let body: unknown;
    const { app } = buildPhase1App(
      {},
      {
        oauthCallbackForm: () => (request, reply) => {
          body = { ...(request.body as object) };
          return reply.redirect('/', 302);
        },
      },
    );
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/apple/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'code=c1&state=42&id_token=t.t.t&user=%7B%22name%22%3A%7B%7D%7D',
    });
    expect(response.statusCode).toBe(302);
    expect(body).toEqual({ code: 'c1', state: '42', id_token: 't.t.t', user: '{"name":{}}' });
  });

  it('campo a mais ou faltando: 400 validation_failed', async () => {
    const { app } = buildPhase1App();
    apps.push(app);
    const extra = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/apple/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'state=s&extra=1',
    });
    expect(extra.statusCode).toBe(400);
    expect(extra.json()).toMatchObject({
      code: 'validation_failed',
      errors: [{ path: 'body.extra' }],
    });
    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/apple/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'code=c',
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().errors).toEqual([{ path: 'body.state', message: 'Campo obrigatório.' }]);
  });

  it('campo repetido vira lista e é recusado pelo esquema de texto', async () => {
    const { app } = buildPhase1App();
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/apple/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'state=a&state=b',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errors[0].path).toBe('body.state');
  });

  it('JSON onde o contrato só aceita formulário: 415', async () => {
    const { app } = buildPhase1App();
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/apple/callback',
      payload: { state: 's' },
    });
    expect(response.statusCode).toBe(415);
    expect(response.json().code).toBe('unsupported_media_type');
  });

  it('formulário onde o contrato só aceita JSON: 415, sem chamar a rota', async () => {
    let called = false;
    const { app } = buildPhase1App(
      {},
      {
        login: () => (_request, reply) => {
          called = true;
          return reply.status(204).send();
        },
      },
    );
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'email=a@b.c',
    });
    expect(response.statusCode).toBe(415);
    expect(response.json().detail).toContain('application/json');
    expect(called).toBe(false);
  });

  it('respeita o limite do corpo do serviço', async () => {
    const { app } = buildPhase1App({ bodyLimit: 64 });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/apple/callback',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: `state=${'s'.repeat(100)}`,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe('payload_too_large');
  });
});

describe('multipart/form-data (envio de imagem, spec 029)', () => {
  it('purpose e um arquivo: a rota recebe o texto e o UploadedFile', async () => {
    const seen: unknown[] = [];
    imageApp(5 * MB, seen);
    const app = apps[0] as FastifyInstance;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/images',
      headers: authHeaders(MULTIPART_HEADERS),
      payload: multipart([
        { name: 'purpose', value: 'avatar' },
        { name: 'file', value: png, filename: 'a.png', contentType: 'image/png' },
      ]),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ purpose: 'avatar', size: png.length });
    const body = seen[0] as Record<string, unknown>;
    const file = body.file as UploadedFile;
    expect(file).toBeInstanceOf(UploadedFile);
    expect(file.filename).toBe('a.png');
    expect(file.mimeType).toBe('image/png');
    expect(file.field).toBe('file');
    expect(file.data.equals(png)).toBe(true);
  });

  it.each([
    [
      'purpose ausente',
      [{ name: 'file', value: png, filename: 'a.png' }],
      [{ path: 'body.purpose', message: 'Campo obrigatório.' }],
    ],
    [
      'purpose fora da lista',
      [
        { name: 'purpose', value: 'banner' },
        { name: 'file', value: png, filename: 'a.png' },
      ],
      [{ path: 'body.purpose', message: 'Deve ser um destes valores: avatar.' }],
    ],
    [
      'campo a mais',
      [
        { name: 'purpose', value: 'avatar' },
        { name: 'extra', value: 'x' },
        { name: 'file', value: png, filename: 'a.png' },
      ],
      [{ path: 'body.extra', message: 'Campo não aceito.' }],
    ],
    [
      'segundo arquivo',
      [
        { name: 'purpose', value: 'avatar' },
        { name: 'file', value: png, filename: 'a.png' },
        { name: 'file2', value: png, filename: 'b.png' },
      ],
      [{ path: 'body', message: 'Envie um arquivo só.' }],
    ],
    [
      'campo de texto depois do arquivo',
      [
        { name: 'file', value: png, filename: 'a.png' },
        { name: 'purpose', value: 'avatar' },
      ],
      [{ path: 'body.purpose', message: 'Os campos de texto vêm antes do arquivo.' }],
    ],
    [
      'campo repetido',
      [
        { name: 'purpose', value: 'avatar' },
        { name: 'purpose', value: 'avatar' },
        { name: 'file', value: png, filename: 'a.png' },
      ],
      [{ path: 'body.purpose', message: 'Campo repetido.' }],
    ],
    [
      'texto no lugar do arquivo',
      [
        { name: 'purpose', value: 'avatar' },
        { name: 'file', value: 'não sou arquivo' },
      ],
      [{ path: 'body.file', message: 'Deve ser um arquivo.' }],
    ],
    [
      'arquivo no lugar do texto',
      [{ name: 'purpose', value: png, filename: 'p.png' }],
      [
        { path: 'body.purpose', message: 'Deve ser texto, não arquivo.' },
        { path: 'body.file', message: 'Campo obrigatório.' },
        { path: 'body.purpose', message: 'Deve ser um destes valores: avatar.' },
      ],
    ],
  ])('%s: 400 validation_failed', async (_name, parts, errors) => {
    let called = false;
    const { app } = buildPhase1App(
      {},
      {
        uploadImage: () => () => {
          called = true;
          return {};
        },
      },
    );
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/images',
      headers: authHeaders(MULTIPART_HEADERS),
      payload: multipart(parts),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'validation_failed' });
    expect(response.json().errors).toEqual(errors);
    expect(called).toBe(false);
  });

  it('multipart malformado ou sem boundary: 400', async () => {
    imageApp();
    const app = apps[0] as FastifyInstance;
    const noBoundary = await app.inject({
      method: 'POST',
      url: '/api/v1/images',
      headers: authHeaders({ 'content-type': 'multipart/form-data' }),
      payload: 'x',
    });
    expect(noBoundary.statusCode).toBe(400);
    expect(noBoundary.json().code).toBe('validation_failed');
  });

  it('acima do limite pelo Content-Length: 413 sem ler o corpo', async () => {
    imageApp(5 * MB);
    const app = apps[0] as FastifyInstance;
    const { stream, pulled } = endlessUpload();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/images',
      headers: authHeaders({ ...MULTIPART_HEADERS, 'content-length': String(6 * MB) }),
      payload: stream,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      code: 'payload_too_large',
      detail: 'O corpo da requisição passa do limite de 5 MB.',
    });
    expect(response.headers.connection).toBe('close');
    // O corpo nunca acaba: a resposta só saiu porque a base não esperou por ele.
    expect(pulled()).toBeLessThan(MB);
  });

  it('sem Content-Length, acima do limite: 413 assim que a contagem passa', async () => {
    imageApp(5 * MB);
    const app = apps[0] as FastifyInstance;
    const { stream, pulled } = endlessUpload(64 * 1024);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/images',
      headers: authHeaders(MULTIPART_HEADERS),
      payload: stream,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe('payload_too_large');
    expect(pulled()).toBeLessThan(6 * MB);
  });

  it('envio de 6 MB com Content-Length certo: 413', async () => {
    imageApp(5 * MB);
    const app = apps[0] as FastifyInstance;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/images',
      headers: authHeaders(MULTIPART_HEADERS),
      payload: multipart([
        { name: 'purpose', value: 'avatar' },
        { name: 'file', value: Buffer.alloc(6 * MB, 1), filename: 'a.png' },
      ]),
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().code).toBe('payload_too_large');
  });

  it('o limite é o da operação: o padrão do serviço não vale para o envio', async () => {
    imageApp(5 * MB);
    const app = apps[0] as FastifyInstance;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/images',
      headers: authHeaders(MULTIPART_HEADERS),
      payload: multipart([
        { name: 'purpose', value: 'avatar' },
        { name: 'file', value: Buffer.alloc(2 * MB, 1), filename: 'a.png' },
      ]),
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().size).toBe(2 * MB);
  });

  it('sem sessão: 401 antes de ler o corpo', async () => {
    imageApp();
    const app = apps[0] as FastifyInstance;
    const { stream, pulled } = endlessUpload();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/images',
      headers: MULTIPART_HEADERS,
      payload: stream,
    });
    expect(response.statusCode).toBe(401);
    expect(pulled()).toBeLessThan(MB);
  });

  it('multipart numa operação só de JSON: 415 antes de ler o corpo', async () => {
    const { app } = buildPhase1App();
    apps.push(app);
    const { stream, pulled } = endlessUpload();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: MULTIPART_HEADERS,
      payload: stream,
    });
    expect(response.statusCode).toBe(415);
    expect(response.json().code).toBe('unsupported_media_type');
    expect(pulled()).toBeLessThan(MB);
  });

  it('tipo que o serviço não sabe ler: 415', async () => {
    imageApp();
    const app = apps[0] as FastifyInstance;
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/images',
      headers: authHeaders({ 'content-type': 'text/plain' }),
      payload: 'oi',
    });
    expect(response.statusCode).toBe(415);
  });
});
