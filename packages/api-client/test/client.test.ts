import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type AdminSchemas,
  ApiError,
  ApiNetworkError,
  type ClassroomSchemas,
  createAdminClient,
  createApiClient,
  createClassroomClient,
  isApiError,
} from '../src/index';

const BASE_URL = 'http://api.test';

const META = {
  schoolName: 'Escola Teste',
  version: '0.1.0',
  currency: 'BRL',
  locale: 'pt-BR',
  authProviders: ['google'],
  logoUrl: '/api/v1/images/0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70/256.webp',
  accentColor: null,
  sourceCodeUrl: 'https://github.com/patrickbrandao/nuva-edu',
} satisfies AdminSchemas['Meta'];

function fakeFetch(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetch = async (request: Request) => {
    requests.push(request);
    return respond(request);
  };
  return { fetch, requests };
}

function problemResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/problem+json', ...headers },
  });
}

describe('clientes gerados', () => {
  it('admin: GET /api/v1/meta devolve o corpo tipado e envia o cookie de sessão', async () => {
    const { fetch, requests } = fakeFetch(() => Response.json(META));
    const api = createAdminClient({ baseUrl: BASE_URL, fetch });

    const { data } = await api.GET('/api/v1/meta');

    expectTypeOf(data).toEqualTypeOf<AdminSchemas['Meta'] | undefined>();
    expectTypeOf<AdminSchemas['Meta']['logoUrl']>().toEqualTypeOf<string | null>();
    expectTypeOf<AdminSchemas['Meta']['accentColor']>().toEqualTypeOf<string | null>();
    expectTypeOf<AdminSchemas['Meta']['sourceCodeUrl']>().toEqualTypeOf<string>();
    expectTypeOf<ClassroomSchemas['Meta']>().toEqualTypeOf<AdminSchemas['Meta']>();
    expect(data).toEqual(META);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('http://api.test/api/v1/meta');
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.credentials).toBe('include');
  });

  it('classroom: GET /healthz usa o caminho completo do contrato', async () => {
    const { fetch, requests } = fakeFetch(() => Response.json({ status: 'ok' }));
    const api = createClassroomClient({ baseUrl: BASE_URL, fetch });

    const { data } = await api.GET('/healthz');

    expectTypeOf(data).toEqualTypeOf<ClassroomSchemas['Health'] | undefined>();
    expect(data).toEqual({ status: 'ok' });
    expect(requests[0]?.url).toBe('http://api.test/healthz');
  });

  it('recusa em tipo um caminho que não está no contrato', () => {
    const api = createAdminClient({ baseUrl: BASE_URL });
    // @ts-expect-error caminho fora do contrato (o fluxo SSE agora existe nas duas APIs)
    const call = () => api.GET('/api/v1/not-a-contract-path');
    expect(call).toBeTypeOf('function');
  });
});

describe('erro problem+json', () => {
  it('lança ApiError com code, status, X-Request-Id e Retry-After', async () => {
    const problem = {
      type: 'about:blank',
      title: 'Muitas requisições',
      status: 429,
      detail: 'Tente de novo em instantes.',
      code: 'rate_limited',
      retryAfterSeconds: 45,
      limit: 60,
    };
    const { fetch } = fakeFetch(() =>
      problemResponse(429, problem, { 'X-Request-Id': 'req-123', 'Retry-After': '30' }),
    );
    const api = createAdminClient({ baseUrl: BASE_URL, fetch });

    const error = await api.GET('/api/v1/meta').catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    if (!isApiError(error)) throw new Error('esperado ApiError');
    expect(error.status).toBe(429);
    expect(error.code).toBe('rate_limited');
    expect(error.message).toBe('Tente de novo em instantes.');
    expect(error.requestId).toBe('req-123');
    expect(error.retryAfter).toBe(30);
    expect(error.problem).toEqual(problem);
    expect(error.problem.limit).toBe(60);
    expect(error.fieldErrors).toEqual([]);
  });

  it('usa retryAfterSeconds do corpo quando falta o cabeçalho Retry-After', async () => {
    const body = {
      type: 'about:blank',
      title: 'Muitas requisições',
      status: 429,
      code: 'rate_limited',
    };
    const responses = [
      problemResponse(429, { ...body, retryAfterSeconds: 12 }),
      problemResponse(429, { ...body, retryAfterSeconds: 12 }, { 'Retry-After': 'amanhã' }),
      problemResponse(429, { ...body, retryAfterSeconds: '12' }),
      problemResponse(429, { ...body, retryAfterSeconds: -1 }),
    ];
    const { fetch } = fakeFetch(() => responses.shift() ?? Response.error());
    const api = createAdminClient({ baseUrl: BASE_URL, fetch });

    const seen: unknown[] = [];
    for (let index = 0; index < 4; index += 1) {
      const error = await api.GET('/api/v1/meta').catch((thrown: unknown) => thrown);
      if (!isApiError(error)) throw new Error('esperado ApiError');
      expectTypeOf(error.problem.retryAfterSeconds).toEqualTypeOf<number | undefined>();
      seen.push(error.retryAfter);
    }

    expect(seen).toEqual([12, 12, undefined, undefined]);
  });

  it('expõe os campos recusados na validação', async () => {
    const errors = [{ path: 'body.email', message: 'e-mail inválido' }];
    const { fetch } = fakeFetch(() =>
      problemResponse(400, {
        type: 'about:blank',
        title: 'Requisição inválida',
        status: 400,
        code: 'validation_failed',
        errors,
      }),
    );
    const api = createClassroomClient({ baseUrl: BASE_URL, fetch });

    const error = await api.GET('/api/v1/meta').catch((thrown: unknown) => thrown);

    if (!isApiError(error)) throw new Error('esperado ApiError');
    expect(error.message).toBe('Requisição inválida');
    expect(error.fieldErrors).toEqual(errors);
    expect(error.requestId).toBeUndefined();
    expect(error.retryAfter).toBeUndefined();
  });

  it('sintetiza o problema quando o erro não vem em problem+json', async () => {
    const { fetch } = fakeFetch(
      () => new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    const api = createAdminClient({ baseUrl: BASE_URL, fetch });

    const error = await api.GET('/api/v1/meta').catch((thrown: unknown) => thrown);

    if (!isApiError(error)) throw new Error('esperado ApiError');
    expect(error.status).toBe(502);
    expect(error.code).toBe('unknown_error');
    expect(error.problem).toEqual({
      type: 'about:blank',
      title: 'Bad Gateway',
      status: 502,
      code: 'unknown_error',
    });
  });

  it('lança ApiNetworkError quando não há resposta', async () => {
    const cause = new TypeError('fetch failed');
    const { fetch } = fakeFetch(() => {
      throw cause;
    });
    const api = createAdminClient({ baseUrl: BASE_URL, fetch });

    const error = await api.GET('/api/v1/meta').catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiNetworkError);
    expect((error as ApiNetworkError).cause).toBe(cause);
    expect((error as ApiNetworkError).message).toBe(
      'sem resposta de GET http://api.test/api/v1/meta',
    );
  });
});

describe('cabeçalho CSRF', () => {
  // Os contratos ainda não têm operação de escrita; este `paths` mínimo imita uma. O CSRF é
  // esquema de segurança (`csrfToken`), não parâmetro: a operação gerada não declara o cabeçalho.
  type WritePaths = {
    '/api/v1/things': {
      get: { responses: { 200: { content: { 'application/json': { ok: boolean } } } } };
      post: {
        requestBody: { content: { 'application/json': { name: string } } };
        responses: { 201: { content: { 'application/json': { ok: boolean } } } };
      };
    };
  };

  it('preenche X-CSRF-Token em escrita quando a chamada não informa', async () => {
    const { fetch, requests } = fakeFetch(() => Response.json({ ok: true }, { status: 201 }));
    const api = createApiClient<WritePaths>({
      baseUrl: BASE_URL,
      fetch,
      csrfToken: () => 'token-da-sessao',
    });

    await api.POST('/api/v1/things', { body: { name: 'a' } });

    expect(requests[0]?.headers.get('X-CSRF-Token')).toBe('token-da-sessao');
  });

  it('respeita o token informado na chamada e não envia em leitura', async () => {
    const { fetch, requests } = fakeFetch((request) =>
      Response.json({ ok: true }, { status: request.method === 'POST' ? 201 : 200 }),
    );
    const api = createApiClient<WritePaths>({
      baseUrl: BASE_URL,
      fetch,
      csrfToken: () => 'token-da-sessao',
    });

    await api.POST('/api/v1/things', {
      headers: { 'X-CSRF-Token': 'explicito' },
      body: { name: 'a' },
    });
    await api.GET('/api/v1/things');

    expect(requests[0]?.headers.get('X-CSRF-Token')).toBe('explicito');
    expect(requests[1]?.headers.has('X-CSRF-Token')).toBe(false);
  });

  it('não envia o cabeçalho quando não há token', async () => {
    const { fetch, requests } = fakeFetch(() => Response.json({ ok: true }, { status: 201 }));
    const api = createApiClient<WritePaths>({ baseUrl: BASE_URL, fetch });

    await api.POST('/api/v1/things', { body: { name: 'a' } });

    expect(requests[0]?.headers.has('X-CSRF-Token')).toBe(false);
  });
});
