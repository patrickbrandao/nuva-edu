import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  createAccount,
  type Database,
  grantEntitlement,
  type ManagementRequest,
  type Role,
} from '../../src/index.ts';

// Peças comuns dos testes de vendas (spec 011): conta, dados do comprador, produtos do catálogo e
// requisição da equipe. Tudo gravado direto nas tabelas da 0009 e da 0014, como nos outros testes
// do núcleo que não são donos das funções de escrita correspondentes.

export interface TestUser {
  id: string;
  role: Role;
  email: string;
}

export interface MakeUserOptions {
  emailVerified?: boolean;
  /** Dados de comprador exigidos pela finalização (spec 011). */
  billing?: { fullName?: string; taxIdType: 'cpf' | 'cnpj'; taxId: string };
}

export async function makeUser(
  db: Database,
  role: Role = 'student',
  options: MakeUserOptions = {},
): Promise<TestUser> {
  const email = `${role}-${randomUUID()}@exemplo.test`;
  const id = await db.transaction().execute((trx) =>
    createAccount(trx, {
      email,
      name: `Pessoa ${role}`,
      password: null,
      role,
      emailVerified: options.emailVerified ?? true,
    }),
  );
  if (options.billing) {
    await db
      .updateTable('users')
      .set({
        fullName: options.billing.fullName ?? 'Compradora de Teste',
        taxIdType: options.billing.taxIdType,
        taxId: options.billing.taxId,
      })
      .where('id', '=', id)
      .execute();
  }
  return { id, role, email };
}

export function adminRequest(actor: { id: string; role: Role }): ManagementRequest {
  return {
    actor: { id: actor.id, role: actor.role },
    context: { ip: '127.0.0.1', requestId: 'req-vendas' },
  };
}

function slug(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 13)}`;
}

export interface MakeCourseOptions {
  /** `null` vira curso aberto, que não é vendável (spec 011). */
  priceCents?: number | null;
  published?: boolean;
  archived?: boolean;
  accessDays?: number | null;
}

export async function makeCourse(db: Database, options: MakeCourseOptions = {}): Promise<string> {
  const priceCents = options.priceCents === undefined ? 9_900 : options.priceCents;
  const published = options.published ?? true;
  const row = await db
    .insertInto('courses')
    .values({
      slug: slug('curso'),
      title: `Curso ${randomUUID().slice(0, 6)}`,
      accessMode: priceCents === null ? 'open' : 'paid',
      priceCents,
      accessDays: options.accessDays ?? null,
      status: published ? 'published' : 'draft',
      publishedAt: published ? new Date() : null,
      archivedAt: options.archived ? new Date() : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function makeEbook(
  db: Database,
  options: { priceCents?: number; published?: boolean; accessDays?: number | null } = {},
): Promise<string> {
  const published = options.published ?? true;
  const row = await db
    .insertInto('ebooks')
    .values({
      slug: slug('ebook'),
      title: `Ebook ${randomUUID().slice(0, 6)}`,
      accessMode: 'paid',
      priceCents: options.priceCents ?? 1_900,
      accessDays: options.accessDays ?? null,
      fileUrl: 'https://arquivos.example.com/ebook.pdf',
      status: published ? 'published' : 'draft',
      publishedAt: published ? new Date() : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export async function makeBundle(
  db: Database,
  items: { type: 'course' | 'ebook'; id: string }[],
  options: { priceCents?: number; published?: boolean } = {},
): Promise<string> {
  const published = options.published ?? true;
  const row = await db
    .insertInto('bundles')
    .values({
      slug: slug('pacote'),
      title: `Pacote ${randomUUID().slice(0, 6)}`,
      accessMode: 'paid',
      priceCents: options.priceCents ?? 19_900,
      status: published ? 'published' : 'draft',
      publishedAt: published ? new Date() : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  if (items.length > 0) {
    await db
      .insertInto('bundleItems')
      .values(
        items.map((item, position) => ({
          bundleId: row.id,
          productType: item.type,
          productId: item.id,
          position,
        })),
      )
      .execute();
  }
  return row.id;
}

/** Concede acesso vitalício direto: o aluno já tem o produto, como numa concessão manual. */
export async function grantLifetime(
  db: Database,
  userId: string,
  productType: 'course' | 'bundle' | 'ebook',
  productId: string,
): Promise<void> {
  await db.transaction().execute((trx) =>
    grantEntitlement(trx, {
      userId,
      productType,
      productId,
      source: 'grant',
      sourceId: userId,
      grantedReason: 'teste',
      notify: false,
    }),
  );
}

/** Primeiro item, falhando o teste de forma explícita quando a lista vier vazia. */
export function first<T>(list: readonly T[]): T {
  const value = list[0];
  if (value === undefined) throw new Error('Lista vazia no teste.');
  return value;
}

/** Erro de domínio com `code`/`status` esperados. Devolve o erro para inspeção. */
export async function expectError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toMatchObject({ status, code });
  return error as { status: number; code: string };
}
