import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type AdminSchemas,
  type AdminSession,
  adminOAuthStartUrl,
  buildOAuthStartUrl,
  type ClassroomOperations,
  type ClassroomSchemas,
  type ClassroomSession,
  classroomOAuthStartUrl,
  createAdminClient,
  createClassroomClient,
  isApiError,
  uploadImage,
} from '../src/index';

const BASE_URL = 'http://api.test';

function fakeFetch(respond: (request: Request) => Response | Promise<Response>) {
  const requests: Request[] = [];
  const fetch = async (request: Request) => {
    requests.push(request);
    return respond(request);
  };
  return { fetch, requests };
}

const IMAGE = {
  id: '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70',
  purpose: 'avatar',
  width: 512,
  height: 512,
  variants: [],
} satisfies ClassroomSchemas['Image'];

describe('tipos da Fase 1', () => {
  it('Session tem conteúdo próprio em cada API', () => {
    expectTypeOf<AdminSession>().toEqualTypeOf<AdminSchemas['Session']>();
    expectTypeOf<ClassroomSession>().toEqualTypeOf<ClassroomSchemas['Session']>();
    expectTypeOf<AdminSession>().not.toEqualTypeOf<ClassroomSession>();
    expectTypeOf<AdminSession['csrfToken']>().toEqualTypeOf<string>();
  });

  it('nulo por `type: [x, "null"]` e por `oneOf` com `type: "null"` viram `T | null`', () => {
    // `type: [string, "null"]`
    expectTypeOf<ClassroomSchemas['SessionInfo']['ip']>().toEqualTypeOf<string | null>();
    // `oneOf: [$ref Cursor, type: "null"]`
    expectTypeOf<ClassroomSchemas['Page']['nextCursor']>().toEqualTypeOf<
      ClassroomSchemas['Cursor'] | null
    >();
    // `oneOf: [$ref Uuid, type: "null"]` no corpo de `setAvatar`
    type SetAvatarBody =
      ClassroomOperations['setAvatar']['requestBody']['content']['application/json'];
    expectTypeOf<SetAvatarBody['imageId']>().toEqualTypeOf<ClassroomSchemas['Uuid'] | null>();
  });

  it('expõe os esquemas usados pelos sites', () => {
    expectTypeOf<AdminSchemas['UserDetail']>().toBeObject();
    expectTypeOf<AdminSchemas['AuditEntry']>().toBeObject();
    expectTypeOf<AdminSchemas['TermsVersionEntry']>().toBeObject();
    expectTypeOf<ClassroomSchemas['TermsVersion']>().toBeObject();
    expectTypeOf<ClassroomSchemas['Problem']>().toEqualTypeOf<AdminSchemas['Problem']>();
  });
});

describe('URL de startOAuth', () => {
  it('monta o caminho relativo com intent e returnTo', () => {
    expect(classroomOAuthStartUrl('google', { intent: 'link', returnTo: '/conta/acesso' })).toBe(
      '/api/v1/auth/google/start?intent=link&returnTo=%2Fconta%2Facesso',
    );
    expect(adminOAuthStartUrl('apple')).toBe('/api/v1/auth/apple/start');
    expect(buildOAuthStartUrl('facebook', { returnTo: '/' }, 'http://api.test/')).toBe(
      'http://api.test/api/v1/auth/facebook/start?returnTo=%2F',
    );
  });

  it('recusa em tipo provedor desconhecido e intent no admin', () => {
    // @ts-expect-error provedor fora de AuthProvider
    const unknownProvider = () => classroomOAuthStartUrl('github');
    // @ts-expect-error o startOAuth do admin não tem intent
    const adminIntent = () => adminOAuthStartUrl('google', { intent: 'link' });
    expect(unknownProvider).toBeTypeOf('function');
    expect(adminIntent).toBeTypeOf('function');
  });
});

describe('uploadImage (multipart/form-data)', () => {
  it('envia purpose e o arquivo, com o tipo do arquivo e o boundary do FormData', async () => {
    const { fetch, requests } = fakeFetch(() => Response.json(IMAGE, { status: 201 }));
    const api = createClassroomClient({ baseUrl: BASE_URL, fetch, csrfToken: () => 'tok' });
    const file = new File([new Uint8Array([0x52, 0x49, 0x46, 0x46])], 'foto.webp', {
      type: 'image/webp',
    });

    const { data } = await uploadImage(api, file, 'avatar');

    expectTypeOf(data).toEqualTypeOf<ClassroomSchemas['Image'] | undefined>();
    expect(data).toEqual(IMAGE);
    const request = requests[0];
    if (!request) throw new Error('sem requisição');
    expect(request.method).toBe('POST');
    expect(request.url).toBe('http://api.test/api/v1/images');
    expect(request.headers.get('X-CSRF-Token')).toBe('tok');
    expect(request.headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/);
    const form = await request.formData();
    expect(form.get('purpose')).toBe('avatar');
    const sent = form.get('file');
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).type).toBe('image/webp');
    expect((sent as File).name).toBe('foto.webp');
    expect(new Uint8Array(await (sent as File).arrayBuffer())).toEqual(
      new Uint8Array([0x52, 0x49, 0x46, 0x46]),
    );
  });

  it('aceita Blob sem nome e lança ApiError com Retry-After no 503', async () => {
    const { fetch, requests } = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            type: 'about:blank',
            title: 'Ocupado',
            status: 503,
            code: 'image_processing_busy',
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/problem+json', 'Retry-After': '5' },
          },
        ),
    );
    const api = createClassroomClient({ baseUrl: BASE_URL, fetch });

    const error = await uploadImage(api, new Blob(['x'], { type: 'image/png' }), 'avatar').catch(
      (thrown: unknown) => thrown,
    );

    if (!isApiError(error)) throw new Error('esperado ApiError');
    expect(error.code).toBe('image_processing_busy');
    expect(error.retryAfter).toBe(5);
    const sent = (await requests[0]?.formData())?.get('file');
    expect((sent as File).type).toBe('image/png');
  });

  it('recusa em tipo purpose fora do contrato', () => {
    const api = createClassroomClient({ baseUrl: BASE_URL });
    // @ts-expect-error purpose fora de ImagePurpose
    const call = () => uploadImage(api, new Blob(), 'logo');
    expect(call).toBeTypeOf('function');
  });
});

describe('respostas sem corpo', () => {
  it('204 devolve data undefined', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 204 }));
    const api = createClassroomClient({ baseUrl: BASE_URL, fetch });

    const result = await api.POST('/api/v1/auth/logout');

    expect(result.data).toBeUndefined();
    expect(result.response.status).toBe(204);
  });

  it('304 de getImageVariant não é erro', async () => {
    const { fetch, requests } = fakeFetch(
      () => new Response(null, { status: 304, headers: { ETag: '"v1"' } }),
    );
    const api = createAdminClient({ baseUrl: BASE_URL, fetch });

    const result = await api.GET('/api/v1/images/{imageId}/{variant}.webp', {
      params: { path: { imageId: IMAGE.id, variant: 256 }, header: { 'If-None-Match': '"v1"' } },
      parseAs: 'blob',
    });

    expect(result.response.status).toBe(304);
    expect(requests[0]?.headers.get('If-None-Match')).toBe('"v1"');
    expect(requests[0]?.url).toBe(`http://api.test/api/v1/images/${IMAGE.id}/256.webp`);
  });
});
