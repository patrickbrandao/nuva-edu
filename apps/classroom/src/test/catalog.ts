import type { ClassroomSchemas } from '@nuva-edu/api-client/classroom';

type CatalogItem = ClassroomSchemas['CatalogItem'];

/** Curso pago da vitrine, no formato do contrato (esquema `CatalogItem`). */
export const COURSE_ITEM: CatalogItem = {
  type: 'course',
  id: '0193a5b2-0000-7000-8000-0000000000c1',
  slug: 'react-do-zero',
  title: 'React do zero',
  summary: 'Componentes, estado e rotas na prática.',
  cover: {
    imageId: '0193a5b2-0000-7000-8000-0000000000f1',
    url: '/api/v1/images/0193a5b2-0000-7000-8000-0000000000f1/480.webp',
    largeUrl: '/api/v1/images/0193a5b2-0000-7000-8000-0000000000f1/1280.webp',
  },
  level: 'beginner',
  accessMode: 'paid',
  priceCents: 19700,
  accessDays: 365,
  moduleCount: 2,
  lessonCount: 3,
  durationSeconds: 12000,
  itemCount: null,
  pages: null,
  publishedAt: '2026-11-20T12:00:00Z',
  updatedAt: '2026-11-22T12:00:00Z',
};

/** Ebook aberto (gratuito), sem capa. */
export const EBOOK_ITEM: CatalogItem = {
  type: 'ebook',
  id: '0193a5b2-0000-7000-8000-0000000000e1',
  slug: 'guia-de-git',
  title: 'Guia de Git',
  summary: null,
  cover: null,
  level: null,
  accessMode: 'open',
  priceCents: null,
  accessDays: null,
  moduleCount: null,
  lessonCount: null,
  durationSeconds: null,
  itemCount: null,
  pages: 48,
  publishedAt: '2026-11-18T12:00:00Z',
  updatedAt: '2026-11-18T12:00:00Z',
};

/** Pacote pago, com acesso vitalício. */
export const BUNDLE_ITEM: CatalogItem = {
  type: 'bundle',
  id: '0193a5b2-0000-7000-8000-0000000000b1',
  slug: 'trilha-front-end',
  title: 'Trilha front-end',
  summary: 'Tudo para começar no front-end.',
  cover: null,
  level: null,
  accessMode: 'paid',
  priceCents: 29700,
  accessDays: null,
  moduleCount: null,
  lessonCount: null,
  durationSeconds: null,
  itemCount: 2,
  pages: null,
  publishedAt: '2026-11-19T12:00:00Z',
  updatedAt: '2026-11-19T12:00:00Z',
};

/** Página de curso pago com programa (esquema `CatalogCourse`). */
export const COURSE: ClassroomSchemas['CatalogCourse'] = {
  type: 'course',
  id: COURSE_ITEM.id,
  slug: COURSE_ITEM.slug,
  title: COURSE_ITEM.title,
  summary: COURSE_ITEM.summary,
  description: 'Aprenda **React** do começo.\n\n<script>alert(1)</script>',
  cover: COURSE_ITEM.cover,
  level: 'beginner',
  accessMode: 'paid',
  priceCents: 19700,
  accessDays: 365,
  moduleCount: 2,
  lessonCount: 3,
  durationSeconds: 12000,
  instructorName: 'Bruno Lima',
  program: [
    {
      id: '0193a5b2-0000-7000-8000-0000000000a2',
      title: 'Estado e efeitos',
      position: 1,
      lessonCount: 1,
      durationSeconds: 6000,
      lessons: [
        {
          id: '0193a5b2-0000-7000-8000-000000000013',
          title: 'useState na prática',
          durationSeconds: 6000,
          isSample: false,
          position: 0,
        },
      ],
    },
    {
      id: '0193a5b2-0000-7000-8000-0000000000a1',
      title: 'Primeiros passos',
      position: 0,
      lessonCount: 2,
      durationSeconds: 6000,
      lessons: [
        {
          id: '0193a5b2-0000-7000-8000-000000000012',
          title: 'Seu primeiro componente',
          durationSeconds: 5400,
          isSample: false,
          position: 1,
        },
        {
          id: '0193a5b2-0000-7000-8000-000000000011',
          title: 'Boas-vindas ao curso',
          durationSeconds: 600,
          isSample: true,
          position: 0,
        },
      ],
    },
  ],
  publishedAt: COURSE_ITEM.publishedAt,
  updatedAt: COURSE_ITEM.updatedAt,
};

/** Página de pacote com um item visível e um privado (esquema `CatalogBundle`). */
export const BUNDLE: ClassroomSchemas['CatalogBundle'] = {
  type: 'bundle',
  id: BUNDLE_ITEM.id,
  slug: BUNDLE_ITEM.slug,
  title: BUNDLE_ITEM.title,
  summary: BUNDLE_ITEM.summary,
  description: null,
  cover: null,
  accessMode: 'paid',
  priceCents: 29700,
  accessDays: null,
  items: [
    {
      type: 'course',
      id: COURSE_ITEM.id,
      slug: COURSE_ITEM.slug,
      title: COURSE_ITEM.title,
      summary: COURSE_ITEM.summary,
      cover: null,
      accessMode: 'paid',
      priceCents: 19700,
      visible: true,
    },
    {
      type: 'ebook',
      id: '0193a5b2-0000-7000-8000-0000000000e2',
      slug: 'apostila-interna',
      title: 'Apostila interna',
      summary: null,
      cover: null,
      accessMode: 'private',
      priceCents: null,
      visible: false,
    },
  ],
  itemsPriceCents: 39400,
  publishedAt: BUNDLE_ITEM.publishedAt,
  updatedAt: BUNDLE_ITEM.updatedAt,
};

/** Página de ebook aberto (esquema `CatalogEbook`). */
export const EBOOK: ClassroomSchemas['CatalogEbook'] = {
  type: 'ebook',
  id: EBOOK_ITEM.id,
  slug: EBOOK_ITEM.slug,
  title: EBOOK_ITEM.title,
  summary: null,
  description: 'Comandos do dia a dia.',
  cover: null,
  accessMode: 'open',
  priceCents: null,
  accessDays: null,
  authorName: 'Carla Dias',
  pages: 48,
  publishedAt: EBOOK_ITEM.publishedAt,
  updatedAt: EBOOK_ITEM.updatedAt,
};
