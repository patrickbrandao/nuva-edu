import type { AdminSchemas } from '@nuva-edu/api-client/admin';
import { apiRoutes, defaultRoutes, problem, type Routes, type StaffRole } from './api';
import { jsonResponse } from './render';

type CourseDetail = AdminSchemas['CourseDetail'];
type CourseSummary = AdminSchemas['CourseSummary'];
type CourseModule = AdminSchemas['CourseModule'];
type LessonDetail = AdminSchemas['LessonDetail'];
type LessonSummary = AdminSchemas['LessonSummary'];
type EbookDetail = AdminSchemas['EbookDetail'];
type BundleDetail = AdminSchemas['BundleDetail'];
type BundleItem = AdminSchemas['BundleItem'];
type EbookTarget = AdminSchemas['EbookTarget'];

export const COURSE_ID = '0193a5b2-0000-7000-8000-0000000000c1';
export const EBOOK_ID = '0193a5b2-0000-7000-8000-0000000000b1';
export const BUNDLE_ID = '0193a5b2-0000-7000-8000-0000000000a9';
export const INSTRUCTOR = { id: '0193a5b2-0000-7000-8000-0000000000d1', name: 'Ivo Instrutor' };
const NOW = '2026-11-20T12:00:00Z';

/** Curso `CourseDetail` em rascunho, privado e sem módulos, como a API devolve. */
export function courseDetail(overrides: Partial<CourseDetail> = {}): CourseDetail {
  return {
    id: COURSE_ID,
    slug: 'curso-de-python',
    title: 'Curso de Python',
    summary: 'Do zero ao primeiro programa.',
    cover: null,
    accessMode: 'private',
    priceCents: null,
    accessDays: null,
    status: 'draft',
    level: null,
    owner: INSTRUCTOR,
    reviewRequestedAt: null,
    moduleCount: 0,
    lessonCount: 0,
    durationSeconds: 0,
    publishedAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    description: null,
    certificateEnabled: false,
    certificateHours: null,
    studentCount: 0,
    modules: [],
    ...overrides,
  };
}

/** Item `CourseSummary` da lista. */
export function courseSummary(overrides: Partial<CourseSummary> = {}): CourseSummary {
  const { description, certificateEnabled, certificateHours, studentCount, modules, ...summary } =
    courseDetail();
  void [description, certificateEnabled, certificateHours, studentCount, modules];
  return { ...summary, ...overrides };
}

export function lessonSummary(overrides: Partial<LessonSummary> = {}): LessonSummary {
  return {
    id: '0193a5b2-0000-7000-8000-0000000000f1',
    moduleId: '0193a5b2-0000-7000-8000-0000000000e1',
    title: 'Aula 1',
    status: 'draft',
    isSample: false,
    durationSeconds: null,
    videoProvider: null,
    position: 0,
    ...overrides,
  };
}

export function courseModule(overrides: Partial<CourseModule> = {}): CourseModule {
  return {
    id: '0193a5b2-0000-7000-8000-0000000000e1',
    courseId: COURSE_ID,
    title: 'Módulo 1',
    position: 0,
    lessons: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Ebook `EbookDetail` em rascunho, privado, sem arquivo e sem vínculos. */
export function ebookDetail(overrides: Partial<EbookDetail> = {}): EbookDetail {
  return {
    id: EBOOK_ID,
    slug: 'guia-de-python',
    title: 'Guia de Python',
    summary: 'Referência rápida da linguagem.',
    cover: null,
    accessMode: 'private',
    priceCents: null,
    accessDays: null,
    status: 'draft',
    authorName: null,
    pages: null,
    publishedAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    description: null,
    fileUrl: null,
    targets: [],
    studentCount: 0,
    ...overrides,
  };
}

/** Pacote `BundleDetail` em rascunho, privado e sem itens. */
export function bundleDetail(overrides: Partial<BundleDetail> = {}): BundleDetail {
  return {
    id: BUNDLE_ID,
    slug: 'trilha-python',
    title: 'Trilha Python',
    summary: 'Curso e guia juntos.',
    cover: null,
    accessMode: 'private',
    priceCents: null,
    accessDays: null,
    status: 'draft',
    itemCount: 0,
    publishedAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    description: null,
    items: [],
    itemsPriceCents: 0,
    studentCount: 0,
    ...overrides,
  };
}

export interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

interface Options {
  role?: StaffRole;
  courses?: CourseDetail[];
  /** Aulas completas (vídeo, links) das aulas que já existem nos cursos. */
  lessons?: LessonDetail[];
  ebooks?: EbookDetail[];
  bundles?: BundleDetail[];
  /** Respostas no lugar das do catálogo simulado, por `MÉTODO /caminho` (ex.: uma recusa). */
  overrides?: Routes;
}

const created = (body: object) => jsonResponse(body, 201);
const noContent = () => new Response(null, { status: 204 });

/**
 * Catálogo simulado, com estado: responde as operações de curso, módulo, aula, ebook, pacote e
 * capa do contrato
 * da admin-api como a API responderia, e guarda cada requisição. Serve para os testes que criam
 * e reordenam, em que a tela lê de volta o que gravou.
 */
export function fakeCatalog({
  role = 'admin',
  courses = [],
  lessons = [],
  ebooks = [],
  bundles = [],
  overrides = {},
}: Options = {}) {
  const ebookStore = new Map(ebooks.map((ebook) => [ebook.id, structuredClone(ebook)]));
  const bundleStore = new Map(bundles.map((bundle) => [bundle.id, structuredClone(bundle)]));
  const store = new Map(courses.map((course) => [course.id, structuredClone(course)]));
  const details = new Map(lessons.map((lesson) => [lesson.id, structuredClone(lesson)]));
  const requests: Recorded[] = [];
  let sequence = 0;
  const newId = (kind: string) => {
    sequence += 1;
    return `0193a5b2-0000-7000-8000-${kind}${String(sequence).padStart(11, '0')}`;
  };

  const base = apiRoutes({ ...defaultRoutes(role), ...overrides });
  const courseOfModule = (moduleId: string) =>
    [...store.values()].find((course) => course.modules.some((item) => item.id === moduleId));
  const moduleOfLesson = (lessonId: string) =>
    [...store.values()]
      .flatMap((course) => course.modules)
      .find((item) => item.lessons.some((lesson) => lesson.id === lessonId));
  const recount = (course: CourseDetail) => {
    course.modules.forEach((item, index) => {
      item.position = index;
      item.lessons.forEach((lesson, position) => {
        lesson.position = position;
        lesson.moduleId = item.id;
      });
    });
    const all = course.modules.flatMap((item) => item.lessons);
    course.moduleCount = course.modules.length;
    course.lessonCount = all.filter((lesson) => lesson.status === 'published').length;
  };
  const detailOf = (summary: LessonSummary, courseId: string): LessonDetail => {
    const known = details.get(summary.id);
    const detail: LessonDetail = {
      courseId,
      description: null,
      type: 'video',
      videoUrl: null,
      links: [],
      ebooks: [],
      createdAt: NOW,
      updatedAt: NOW,
      ...known,
      ...summary,
    };
    details.set(summary.id, detail);
    return detail;
  };

  const cover = (coverImageId: unknown) =>
    coverImageId === null
      ? null
      : {
          imageId: String(coverImageId),
          url: `/api/v1/images/${String(coverImageId)}/480.webp`,
          largeUrl: `/api/v1/images/${String(coverImageId)}/1280.webp`,
        };
  const matches = (product: { title: string; summary: string | null }, q: string | null) =>
    !q || `${product.title} ${product.summary ?? ''}`.toLowerCase().includes(q.toLowerCase());
  let lastQuery = new URLSearchParams();

  /** Vínculo `EbookTarget` de um curso ou de uma aula do catálogo; `undefined` se não existe. */
  const targetOf = (targetType: string, targetId: string): EbookTarget | undefined => {
    if (targetType === 'course') {
      const course = store.get(targetId);
      return course && { targetType: 'course', targetId, title: course.title, course: null };
    }
    const owner = moduleOfLesson(targetId);
    const lesson = owner?.lessons.find((item) => item.id === targetId);
    const course = owner ? store.get(owner.courseId) : undefined;
    if (!lesson || !course) return undefined;
    return {
      targetType: 'lesson',
      targetId,
      title: lesson.title,
      course: { type: 'course', id: course.id, title: course.title },
    };
  };

  /** Ebooks e pacotes: lista, criação, edição, publicação, vínculos e itens. */
  const handleProducts = (
    method: string,
    path: string,
    input: Record<string, unknown>,
  ): Response | undefined => {
    const match = path.match(/^\/api\/v1\/(ebooks|bundles)(?:\/([^/]+))?(?:\/([a-z]+))?$/);
    if (!match) return undefined;
    const isEbook = match[1] === 'ebooks';
    const all: Map<string, EbookDetail | BundleDetail> = isEbook ? ebookStore : bundleStore;
    const [, , id, action] = match;

    if (!id) {
      if (method === 'GET') {
        const items = [...all.values()]
          .filter((product) => matches(product, lastQuery.get('q')))
          .map((product) => {
            const { description, studentCount, ...summary } = product;
            void [description, studentCount];
            const rest = summary as Record<string, unknown>;
            delete rest.fileUrl;
            delete rest.targets;
            delete rest.items;
            delete rest.itemsPriceCents;
            return rest;
          });
        return jsonResponse({ items, nextCursor: null });
      }
      if (method === 'POST') {
        const fields = { id: newId(isEbook ? 'b' : 'd'), summary: null, ...input };
        const product = isEbook
          ? ebookDetail({ slug: 'ebook-novo', ...(fields as Partial<EbookDetail>) })
          : bundleDetail({ slug: 'pacote-novo', ...(fields as Partial<BundleDetail>) });
        all.set(product.id, product);
        return created(product);
      }
      return undefined;
    }

    const product = all.get(id);
    if (!product) return problem(404, 'not_found');
    if (!action) {
      if (method === 'GET') return jsonResponse(product);
      if (method === 'DELETE') {
        if (product.studentCount > 0) return problem(409, 'product_has_links');
        all.delete(id);
        return noContent();
      }
      if (method === 'PATCH') {
        const { coverImageId, ...fields } = input;
        Object.assign(product, fields);
        if (coverImageId !== undefined) product.cover = cover(coverImageId);
        return jsonResponse(product);
      }
      return undefined;
    }

    if (action === 'targets' && method === 'PUT' && 'targets' in product) {
      const wanted = input.targets as { targetType: string; targetId: string }[];
      const next = wanted.map((item) => targetOf(item.targetType, item.targetId));
      if (next.some((item) => item === undefined)) {
        return problem(422, 'catalog_item_not_found');
      }
      product.targets = [
        ...(next as EbookTarget[]),
        ...product.targets.filter((item) => item.targetType === 'bundle'),
      ];
      return jsonResponse(product);
    }
    if (action === 'items' && method === 'PUT' && 'items' in product) {
      const wanted = input.items as { productType: 'course' | 'ebook'; productId: string }[];
      const next: BundleItem[] = [];
      for (const [position, item] of wanted.entries()) {
        const source =
          item.productType === 'course'
            ? store.get(item.productId)
            : ebookStore.get(item.productId);
        if (!source) return problem(422, 'catalog_item_not_found');
        next.push({
          productType: item.productType,
          productId: item.productId,
          title: source.title,
          accessMode: source.accessMode,
          priceCents: source.priceCents,
          status: source.status,
          archived: source.archivedAt !== null,
          position,
        });
      }
      product.items = next;
      product.itemCount = next.length;
      product.itemsPriceCents = next.reduce(
        (sum, item) => sum + (item.accessMode === 'paid' ? (item.priceCents ?? 0) : 0),
        0,
      );
      return jsonResponse(product);
    }
    if (method === 'POST') {
      if (action === 'publish') {
        if ('targets' in product && !product.fileUrl) return problem(422, 'ebook_file_required');
        if ('items' in product && product.items.length === 0) {
          return problem(422, 'bundle_has_no_items');
        }
        Object.assign(product, { status: 'published', publishedAt: NOW });
      }
      if (action === 'unpublish') product.status = 'draft';
      if (action === 'archive') Object.assign(product, { status: 'draft', archivedAt: NOW });
      if (action === 'unarchive') product.archivedAt = null;
      return jsonResponse(product);
    }
    return undefined;
  };

  const handle = (method: string, path: string, body: unknown): Response | undefined => {
    const input = (body ?? {}) as Record<string, unknown>;
    let match: RegExpMatchArray | null;

    if (path === '/api/v1/courses' && method === 'GET') {
      const items = [...store.values()].map(({ modules, ...course }) => {
        void modules;
        return courseSummary(course as Partial<CourseSummary>);
      });
      return jsonResponse({ items, nextCursor: null });
    }
    if (path === '/api/v1/courses' && method === 'POST') {
      const course = courseDetail({
        id: newId('c'),
        slug: 'curso-novo',
        owner: role === 'instructor' ? INSTRUCTOR : null,
        summary: null,
        ...(input as Partial<CourseDetail>),
      });
      store.set(course.id, course);
      return created(course);
    }
    if (path === '/api/v1/images' && method === 'POST') {
      return created({
        id: newId('a'),
        purpose: 'product_cover',
        width: 1600,
        height: 900,
        variants: [{ width: 480, height: 270, url: '/api/v1/images/capa/480.webp' }],
      });
    }

    const products = handleProducts(method, path, input);
    if (products) return products;

    match = path.match(/^\/api\/v1\/courses\/([^/]+)$/);
    if (match) {
      const course = store.get(match[1] ?? '');
      if (!course) return problem(404, 'not_found');
      if (method === 'GET') return jsonResponse(course);
      if (method === 'DELETE') {
        store.delete(course.id);
        return noContent();
      }
      if (method === 'PATCH') {
        const { coverImageId, ...fields } = input;
        Object.assign(course, fields);
        if (coverImageId !== undefined) {
          course.cover =
            coverImageId === null
              ? null
              : {
                  imageId: String(coverImageId),
                  url: `/api/v1/images/${String(coverImageId)}/480.webp`,
                  largeUrl: `/api/v1/images/${String(coverImageId)}/1280.webp`,
                };
        }
        return jsonResponse(course);
      }
    }

    match = path.match(/^\/api\/v1\/courses\/([^/]+)\/(publish|unpublish|archive|unarchive)$/);
    if (match && method === 'POST') {
      const course = store.get(match[1] ?? '');
      if (!course) return problem(404, 'not_found');
      const action = match[2];
      if (action === 'publish') Object.assign(course, { status: 'published', publishedAt: NOW });
      if (action === 'unpublish') course.status = 'draft';
      if (action === 'archive') Object.assign(course, { status: 'draft', archivedAt: NOW });
      if (action === 'unarchive') course.archivedAt = null;
      if (action === 'publish') course.reviewRequestedAt = null;
      return jsonResponse(course);
    }

    match = path.match(/^\/api\/v1\/courses\/([^/]+)\/request-review$/);
    if (match) {
      const course = store.get(match[1] ?? '');
      if (!course) return problem(404, 'not_found');
      course.reviewRequestedAt = method === 'POST' ? NOW : null;
      return jsonResponse(course);
    }

    match = path.match(/^\/api\/v1\/courses\/([^/]+)\/modules$/);
    if (match && method === 'POST') {
      const course = store.get(match[1] ?? '');
      if (!course) return problem(404, 'not_found');
      const item = courseModule({
        id: newId('e'),
        courseId: course.id,
        title: String(input.title),
        position: course.modules.length,
      });
      course.modules.push(item);
      recount(course);
      return created(item);
    }

    match = path.match(/^\/api\/v1\/courses\/([^/]+)\/modules\/order$/);
    if (match && method === 'PUT') {
      const course = store.get(match[1] ?? '');
      if (!course) return problem(404, 'not_found');
      const ids = input.moduleIds as string[];
      course.modules = ids
        .map((id) => course.modules.find((item) => item.id === id))
        .filter((item): item is CourseModule => item !== undefined);
      recount(course);
      return jsonResponse({ items: course.modules });
    }

    match = path.match(/^\/api\/v1\/modules\/([^/]+)$/);
    if (match) {
      const course = courseOfModule(match[1] ?? '');
      const item = course?.modules.find((candidate) => candidate.id === match?.[1]);
      if (!course || !item) return problem(404, 'not_found');
      if (method === 'PATCH') {
        item.title = String(input.title);
        return jsonResponse(item);
      }
      if (method === 'DELETE') {
        if (item.lessons.length > 0) return problem(409, 'module_not_empty');
        course.modules = course.modules.filter((candidate) => candidate.id !== item.id);
        recount(course);
        return noContent();
      }
    }

    match = path.match(/^\/api\/v1\/modules\/([^/]+)\/lessons$/);
    if (match && method === 'POST') {
      const course = courseOfModule(match[1] ?? '');
      const item = course?.modules.find((candidate) => candidate.id === match?.[1]);
      if (!course || !item) return problem(404, 'not_found');
      const summary = lessonSummary({
        id: newId('f'),
        moduleId: item.id,
        title: String(input.title),
        isSample: input.isSample === true,
        durationSeconds: (input.durationSeconds as number | null | undefined) ?? null,
        videoProvider: input.videoUrl ? 'link' : null,
        position: item.lessons.length,
      });
      item.lessons.push(summary);
      recount(course);
      const detail = detailOf(summary, course.id);
      detail.description = (input.description as string | null | undefined) ?? null;
      detail.videoUrl = (input.videoUrl as string | null | undefined) ?? null;
      return created(detail);
    }

    match = path.match(/^\/api\/v1\/modules\/([^/]+)\/lessons\/order$/);
    if (match && method === 'PUT') {
      const course = courseOfModule(match[1] ?? '');
      const item = course?.modules.find((candidate) => candidate.id === match?.[1]);
      if (!course || !item) return problem(404, 'not_found');
      const ids = input.lessonIds as string[];
      item.lessons = ids
        .map((id) => item.lessons.find((lesson) => lesson.id === id))
        .filter((lesson): lesson is LessonSummary => lesson !== undefined);
      recount(course);
      return jsonResponse(item);
    }

    match = path.match(/^\/api\/v1\/lessons\/([^/]+)(\/links)?$/);
    if (match) {
      const item = moduleOfLesson(match[1] ?? '');
      const summary = item?.lessons.find((lesson) => lesson.id === match?.[1]);
      const course = item ? store.get(item.courseId) : undefined;
      if (!item || !summary || !course) return problem(404, 'not_found');
      const detail = detailOf(summary, course.id);
      if (match[2]) {
        const links = input.links as { label: string; url: string; kind: 'file' | 'page' }[];
        detail.links = links.map((link, position) => ({ id: newId('b'), ...link, position }));
        return jsonResponse(detail);
      }
      if (method === 'GET') return jsonResponse(detail);
      if (method === 'DELETE') {
        item.lessons = item.lessons.filter((lesson) => lesson.id !== summary.id);
        recount(course);
        return noContent();
      }
      if (method === 'PATCH') {
        const { description, videoUrl, ...fields } = input;
        Object.assign(summary, fields);
        Object.assign(detail, input);
        void [description, videoUrl];
        recount(course);
        return jsonResponse(detail);
      }
    }
    return undefined;
  };

  const respond = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const type = request.headers.get('Content-Type') ?? '';
    let body: unknown;
    if (type.includes('application/json')) body = await request.clone().json();
    // o corpo multipart vai como texto: o `formData()` do Node não lê o `File` do jsdom
    else if (type.includes('multipart/form-data')) body = await request.clone().text();
    requests.push({ method: request.method, path: url.pathname, query: url.searchParams, body });
    lastQuery = url.searchParams;
    if (overrides[`${request.method} ${url.pathname}`] !== undefined) return base(request);
    return handle(request.method, url.pathname, body) ?? base(request);
  };

  return {
    respond,
    requests,
    /** O curso como está gravado no catálogo simulado. */
    course: (id: string) => store.get(id),
    /** O ebook e o pacote como estão gravados. */
    ebook: (id: string) => ebookStore.get(id),
    bundle: (id: string) => bundleStore.get(id),
    /** O primeiro curso, para os testes que criam um. */
    first: () => [...store.values()][0],
    /** Corpos enviados a uma rota (`MÉTODO /caminho`), na ordem. */
    bodies: (key: string) =>
      requests.filter((item) => `${item.method} ${item.path}` === key).map((item) => item.body),
    /** Chamadas de escrita, como `MÉTODO /caminho`, na ordem. */
    writes: () =>
      requests.filter((item) => item.method !== 'GET').map((item) => `${item.method} ${item.path}`),
  };
}

/**
 * O jsdom não calcula layout: sem isto o arrasto por teclado não acha a posição vizinha. Cada
 * linha de uma lista reordenável ocupa 40 px, uma embaixo da outra. Devolve como desfazer.
 */
export function stubSortableLayout(): () => void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const row = this.closest('[data-sortable-id]');
    const index = row?.parentElement ? [...row.parentElement.children].indexOf(row) : 0;
    const top = index * 50;
    return {
      x: 0,
      y: top,
      top,
      left: 0,
      width: 300,
      height: 40,
      right: 300,
      bottom: top + 40,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}
