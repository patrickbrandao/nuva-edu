import { randomUUID } from 'node:crypto';
import {
  createAccount,
  createPlan,
  type Database,
  FakePaymentProvider,
  type ManagementRequest,
  type PlanInput,
  type Role,
} from '../../src/index.ts';
import { adminRequest, expectError, first, makeUser, type TestUser } from '../sales/fixtures.ts';

// Peças comuns dos testes de assinaturas (spec 012). Reaproveita os produtos e os usuários dos
// testes de vendas e acrescenta plano, requisição da equipe e o provedor fake com as três URLs de
// retorno do checkout.

export const CURRENCY = 'BRL';
export const RETURN_URLS = {
  success: 'https://classroom.example/assinaturas/sucesso',
  pending: 'https://classroom.example/assinaturas/pendente',
  failure: 'https://classroom.example/assinaturas/falha',
};

const BILLING = {
  fullName: 'Assinante de Teste',
  taxIdType: 'cpf' as const,
  taxId: '52998224725',
};

/** Aluno pronto para assinar: e-mail confirmado e dados de comprador. */
export function makeSubscriber(db: Database): Promise<TestUser> {
  return makeUser(db, 'student', { billing: BILLING });
}

export async function makeStaff(db: Database, role: Role): Promise<TestUser> {
  return makeUser(db, role);
}

export function staffRequest(actor: TestUser): ManagementRequest {
  return adminRequest(actor);
}

/** Plano de teste; `slug` é gerado quando ausente. Cria pelo dono da escrita (`createPlan`). */
export async function makePlan(
  db: Database,
  admin: TestUser,
  input: Partial<PlanInput> = {},
): Promise<{ id: string; slug: string }> {
  const plan = await createPlan(db, staffRequest(admin), {
    groupKey: input.groupKey ?? `grupo-${randomUUID().slice(0, 8)}`,
    title: input.title ?? `Plano ${randomUUID().slice(0, 6)}`,
    interval: input.interval ?? 'month',
    priceCents: input.priceCents ?? 9_900,
    description: input.description ?? null,
    includesAll: input.includesAll ?? false,
    includesPrivate: input.includesPrivate ?? false,
    active: input.active ?? true,
    position: input.position ?? 0,
    ...(input.slug === undefined ? {} : { slug: input.slug }),
    ...(input.items === undefined ? {} : { items: input.items }),
  });
  return { id: plan.id, slug: plan.slug };
}

export { expectError, first, makeUser, type TestUser };

/**
 * Provedor fake no modo de teste, com a moeda e o relógio dos testes. Um só por execução do
 * arquivo: o fake numera os planos a partir de zero em cada instância e o banco é o mesmo entre
 * os testes, então duas instâncias colidiriam em `plans_provider_plan_unique`. Em produção os
 * identificadores são únicos do provedor; aqui o "provedor da instalação" é um só.
 */
let sharedProvider: FakePaymentProvider | null = null;

export function makeProvider(now?: Date): FakePaymentProvider {
  sharedProvider ??= new FakePaymentProvider({ currency: CURRENCY });
  sharedProvider.setNow(now ?? '2026-01-01T00:00:00.000Z');
  return sharedProvider;
}

/** Conta sem dados de comprador, para os casos de `billing_required`. */
export function makeStudentWithoutBilling(db: Database): Promise<TestUser> {
  return makeUser(db, 'student');
}

/** Cria a conta do zero, sem e-mail confirmado, para os casos de `email_not_verified`. */
export async function makeUnverified(db: Database): Promise<TestUser> {
  const email = `aluno-${randomUUID()}@exemplo.test`;
  const id = await db.transaction().execute((trx) =>
    createAccount(trx, {
      email,
      name: 'Aluno sem confirmação',
      password: null,
      role: 'student',
      emailVerified: false,
    }),
  );
  return { id, role: 'student', email };
}
