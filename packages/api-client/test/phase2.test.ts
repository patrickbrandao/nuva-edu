import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type AdminImagePurpose,
  type AdminPaths,
  type AdminSchemas,
  type ClassroomPaths,
  type ClassroomSchemas,
  createAdminClient,
  type ImagePurpose,
  uploadAdminImage,
} from '../src/index';

const BASE_URL = 'http://api.test';

describe('tipos da Fase 2', () => {
  it('o admin tem finalidade de imagem própria, diferente da classroom', () => {
    expectTypeOf<AdminImagePurpose>().toEqualTypeOf<'product_cover'>();
    expectTypeOf<AdminImagePurpose>().not.toEqualTypeOf<ImagePurpose>();
  });

  it('o programa da vitrine não expõe URL de conteúdo', () => {
    type Lesson = ClassroomSchemas['ProgramLesson'];
    expectTypeOf<Lesson>().not.toHaveProperty('videoUrl');
    expectTypeOf<Lesson>().not.toHaveProperty('fileUrl');
  });

  it('o estado do certificado é obrigatório e anulável', () => {
    expectTypeOf<ClassroomSchemas['CourseView']['certificate']>().toEqualTypeOf<
      ClassroomSchemas['CourseCertificateState'] | null
    >();
  });

  it('as rotas novas estão nos dois clientes', () => {
    expectTypeOf<ClassroomPaths>().toHaveProperty('/api/v1/catalog');
    expectTypeOf<ClassroomPaths>().toHaveProperty('/api/v1/certificates/verify/{code}');
    expectTypeOf<ClassroomPaths>().toHaveProperty('/api/v1/lessons/{id}/progress');
    expectTypeOf<AdminPaths>().toHaveProperty('/api/v1/images');
    expectTypeOf<AdminSchemas['Image']>().toBeObject();
  });
});

describe('uploadAdminImage (multipart/form-data)', () => {
  it('envia purpose e o arquivo, com CSRF e o boundary do FormData', async () => {
    const image = {
      id: '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70',
      purpose: 'product_cover',
      width: 1200,
      height: 675,
      variants: [],
    } satisfies AdminSchemas['Image'];
    const requests: Request[] = [];
    const api = createAdminClient({
      baseUrl: BASE_URL,
      csrfToken: () => 'tok',
      fetch: async (request: Request) => {
        requests.push(request);
        return Response.json(image, { status: 201 });
      },
    });
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'capa.png', {
      type: 'image/png',
    });

    const { data } = await uploadAdminImage(api, file, 'product_cover');

    expectTypeOf(data).toEqualTypeOf<AdminSchemas['Image'] | undefined>();
    expect(data).toEqual(image);
    const request = requests[0];
    if (!request) throw new Error('sem requisição');
    expect(request.method).toBe('POST');
    expect(request.url).toBe('http://api.test/api/v1/images');
    expect(request.headers.get('X-CSRF-Token')).toBe('tok');
    expect(request.headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/);
    const form = await request.formData();
    expect(form.get('purpose')).toBe('product_cover');
    const sent = form.get('file') as File;
    expect(sent.name).toBe('capa.png');
    expect(sent.type).toBe('image/png');
  });

  it('recusa em tipo a finalidade da classroom', () => {
    const api = createAdminClient({ baseUrl: BASE_URL });
    // @ts-expect-error `avatar` é finalidade da classroom-api, não do admin.
    const call = () => uploadAdminImage(api, new Blob(), 'avatar');
    expect(call).toBeTypeOf('function');
  });
});
