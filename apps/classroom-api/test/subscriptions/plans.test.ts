import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser, isolatedDatabase, TEST_PASSWORD } from '../accounts.ts';
import { createTestApp, type TestApp } from '../helpers.ts';

// Vitrine de planos (spec 012, "Planos"; tarefa 554). Banco só deste arquivo: a vitrine lista
// todos os planos ativos. Planos e itens são gravados direto nas tabelas (a escrita é da
// admin-api); aqui se confere só o que a classroom-api publica.

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let test: TestApp;

const PREFIX = `plano-${randomUUID().slice(0, 8)}`;
const GROUP_A = `${PREFIX}-essencial`;
const GROUP_B = `${PREFIX}-completo`;

function slug(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 13)}`;
}

interface Product {
  id: string;
  title: string;
}

async function makeCourse(
  mode: 'open' | 'paid' | 'private',
  title: string,
  options: { published?: boolean; archived?: boolean } = {},
): Promise<Product> {
  const published = options.published ?? true;
  return test.db
    .insertInto('courses')
    .values({
      slug: slug('curso'),
      title,
      summary: `Resumo de ${title}`,
      accessMode: mode,
      priceCents: mode === 'open' ? null : 9900,
      status: published ? 'published' : 'draft',
      publishedAt: published ? new Date() : null,
      archivedAt: options.archived === true ? new Date() : null,
      level: 'beginner',
    })
    .returning(['id', 'title'])
    .executeTakeFirstOrThrow();
}

async function makeEbook(title: string, published = true): Promise<Product> {
  return test.db
    .insertInto('ebooks')
    .values({
      slug: slug('ebook'),
      title,
      summary: `Resumo de ${title}`,
      accessMode: 'paid',
      priceCents: 4900,
      status: published ? 'published' : 'draft',
      publishedAt: published ? new Date() : null,
      fileUrl: 'https://arquivos.exemplo.test/segredo-vitrine.pdf',
      pages: 80,
    })
    .returning(['id', 'title'])
    .executeTakeFirstOrThrow();
}

async function makeBundle(title: string): Promise<Product> {
  return test.db
    .insertInto('bundles')
    .values({
      slug: slug('pacote'),
      title,
      summary: `Resumo de ${title}`,
      accessMode: 'paid',
      priceCents: 19900,
      status: 'published',
      publishedAt: new Date(),
    })
    .returning(['id', 'title'])
    .executeTakeFirstOrThrow();
}

interface PlanSeed {
  groupKey: string;
  interval: 'month' | 'year';
  title: string;
  priceCents: number;
  position: number;
  active?: boolean;
  includesAll?: boolean;
  includesPrivate?: boolean;
  description?: string | null;
}

async function makePlan(input: PlanSeed): Promise<string> {
  const row = await test.db
    .insertInto('plans')
    .values({
      slug: slug(input.groupKey),
      groupKey: input.groupKey,
      title: input.title,
      description: input.description ?? null,
      interval: input.interval,
      priceCents: input.priceCents,
      includesAll: input.includesAll ?? false,
      includesPrivate: input.includesPrivate ?? false,
      active: input.active ?? true,
      position: input.position,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function addItems(
  planId: string,
  items: readonly { productType: 'course' | 'bundle' | 'ebook'; productId: string }[],
): Promise<void> {
  await test.db
    .insertInto('planItems')
    .values(items.map((item) => ({ planId, ...item })))
    .execute();
}

let coursePaid: Product;
let coursePrivate: Product;
let courseArchived: Product;
let ebookDraft: Product;
let bundle: Product;
let monthId: string;
let yearId: string;
let allId: string;
let inactiveId: string;

beforeAll(async () => {
  database = await isolatedDatabase();
  test = createTestApp({ DATABASE_URL: database.url });

  coursePaid = await makeCourse('paid', 'Curso essencial');
  coursePrivate = await makeCourse('private', 'Curso privado');
  courseArchived = await makeCourse('paid', 'Curso arquivado', { archived: true });
  ebookDraft = await makeEbook('Ebook em rascunho', false);
  bundle = await makeBundle('Pacote essencial');

  monthId = await makePlan({
    groupKey: GROUP_A,
    interval: 'month',
    title: 'Essencial mensal',
    description: 'Tudo do essencial, todo mês',
    priceCents: 9900,
    position: 10,
  });
  yearId = await makePlan({
    groupKey: GROUP_A,
    interval: 'year',
    title: 'Essencial anual',
    priceCents: 99000,
    position: 11,
  });
  await addItems(monthId, [
    { productType: 'course', productId: coursePaid.id },
    { productType: 'course', productId: coursePrivate.id },
    { productType: 'course', productId: courseArchived.id },
    { productType: 'ebook', productId: ebookDraft.id },
    { productType: 'bundle', productId: bundle.id },
  ]);

  allId = await makePlan({
    groupKey: GROUP_B,
    interval: 'year',
    title: 'Completo anual',
    priceCents: 199000,
    position: 12,
    includesAll: true,
    includesPrivate: true,
  });

  // Inativo sai da vitrine; as assinaturas existentes continuam (spec 012).
  inactiveId = await makePlan({
    groupKey: `${PREFIX}-inativo`,
    interval: 'month',
    title: 'Plano desativado',
    priceCents: 4900,
    position: 1,
    active: false,
  });
});

afterAll(async () => {
  expect(test.logText()).not.toContain(TEST_PASSWORD);
  await test.close();
  await database.drop();
});

describe('GET /plans (spec 012, "Planos")', () => {
  it('responde sem login e agrupa as periodicidades, com moeda da instalação', async () => {
    const reply = await new Browser(test.app).request('GET', '/api/v1/plans');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('public, no-cache');
    const catalog = reply.json();
    expect(catalog.currency).toBe('BRL');
    expect(catalog.groups.map((group: { groupKey: string }) => group.groupKey)).toEqual([
      GROUP_A,
      GROUP_B,
    ]);
  });

  it('dentro do grupo vem month e depois year, do grupo da menor position para a maior', async () => {
    const reply = await new Browser(test.app).request('GET', '/api/v1/plans');
    const catalog = reply.json();
    const group = catalog.groups[0];
    expect(group.plans.map((plan: { id: string }) => plan.id)).toEqual([monthId, yearId]);
    expect(group.plans.map((plan: { interval: string }) => plan.interval)).toEqual([
      'month',
      'year',
    ]);
    expect(group.plans[0]).toMatchObject({
      title: 'Essencial mensal',
      description: 'Tudo do essencial, todo mês',
      priceCents: 9900,
      includesAll: false,
      position: 10,
    });
    expect(group.plans[1]).toMatchObject({ priceCents: 99000, description: null });
  });

  it('omite item não publicado, privado e arquivado da lista do plano', async () => {
    const reply = await new Browser(test.app).request('GET', '/api/v1/plans');
    const group = reply.json().groups[0];
    const items = group.plans[0].items;
    expect(items).toHaveLength(2);
    expect(items).toEqual(
      expect.arrayContaining([
        { productType: 'course', productId: coursePaid.id, title: 'Curso essencial' },
        { productType: 'bundle', productId: bundle.id, title: 'Pacote essencial' },
      ]),
    );
    const ids = items.map((item: { productId: string }) => item.productId);
    expect(ids).not.toContain(coursePrivate.id);
    expect(ids).not.toContain(courseArchived.id);
    expect(ids).not.toContain(ebookDraft.id);
  });

  it('plano "tudo" não anuncia itens nem que inclui os privados', async () => {
    const reply = await new Browser(test.app).request('GET', '/api/v1/plans');
    const group = reply.json().groups[1];
    expect(group.plans).toHaveLength(1);
    const plan = group.plans[0];
    expect(plan).toMatchObject({
      id: allId,
      interval: 'year',
      includesAll: true,
      items: [],
    });
    expect('includesPrivate' in plan).toBe(false);
  });

  it('plano inativo não aparece na vitrine', async () => {
    const reply = await new Browser(test.app).request('GET', '/api/v1/plans');
    expect(reply.body).not.toContain(inactiveId);
  });
});
