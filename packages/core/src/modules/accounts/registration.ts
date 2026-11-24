import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { type FieldError, validationFailed } from '../../errors/domain-error.ts';
import { enqueueEmail } from '../notifications/outbox.ts';
import type { Role } from '../permissions/roles.ts';
import { acceptTerms, assertTermsAccepted } from '../privacy/terms-acceptance.ts';
import type { RequestContext } from './context.ts';
import { assertValidPassword, isValidEmail, normalizeEmail } from './credentials.ts';

// Cadastro por e-mail e senha (spec 007, "Cadastro por e-mail e senha") e a criação de conta
// comum a todos os caminhos (cadastro, provedor, equipe, admin inicial).

export const NAME_MAX_LENGTH = 80;

export interface CreateAccountInput {
  /** Já normalizado e conferido. */
  email: string;
  name: string;
  /** Texto legível (ADR 0002), já conferido por `assertValidPassword`; `null` sem senha. */
  password: string | null;
  role?: Role;
  emailVerified?: boolean;
}

/**
 * Insere a conta e a linha de `profiles` (criada junto com a conta, spec 007 "Avatar"). Não
 * confere se o e-mail já existe: quem chama trava e confere antes (`lockEmail`). Exige transação.
 */
export async function createAccount(trx: Database, input: CreateAccountInput): Promise<string> {
  if (!trx.isTransaction) {
    throw new TypeError('createAccount exige uma transação aberta (db.transaction()).');
  }
  const row = await trx
    .insertInto('users')
    .values({
      email: input.email,
      name: input.name,
      password: input.password,
      role: input.role ?? 'student',
      emailVerifiedAt: input.emailVerified ? sql<Date>`now()` : null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await trx.insertInto('profiles').values({ userId: row.id }).execute();
  return row.id;
}

/**
 * Trava o e-mail até o fim da transação: dois cadastros simultâneos do mesmo e-mail não criam
 * duas contas nem respondem diferente.
 */
export async function lockEmail(trx: Database, email: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`users:email:${email}`}, 0))`.execute(
    trx,
  );
}

/** Conta não excluída com o e-mail (normalizado), ou `undefined`. */
export async function findUserIdByEmail(db: Database, email: string): Promise<string | undefined> {
  const row = await db
    .selectFrom('users')
    .select('id')
    .where('email', '=', normalizeEmail(email))
    .where('deletedAt', 'is', null)
    .executeTakeFirst();
  return row?.id;
}

/** Nome de exibição: sem espaços nas pontas, de 1 a 80 caracteres. */
export function normalizeName(name: unknown): string | null {
  if (typeof name !== 'string') {
    return null;
  }
  const trimmed = name.trim();
  const length = [...trimmed].length;
  return length >= 1 && length <= NAME_MAX_LENGTH ? trimmed : null;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: unknown;
  acceptedTerms: readonly string[];
  context: RequestContext;
}

/**
 * `POST /auth/register` (responde `204` nos dois casos, sem sessão). Ordem da spec:
 *
 * 1. Formato: nome e e-mail (`400 validation_failed`), senha (`400 password_invalid`).
 * 2. Aceite das vigentes, quando há versão publicada (`422 terms_acceptance_required`).
 * 3. Só então o e-mail: já existe conta (não excluída), enfileira `account.exists` ao dono e
 *    não altera nada; senão cria a conta `student` não confirmada, grava os aceites e enfileira
 *    `account.verify_email`, tudo numa transação.
 *
 * O retorno não diz qual dos casos foi: a resposta é a mesma.
 */
export async function registerWithPassword(db: Database, input: RegisterInput): Promise<void> {
  const errors: FieldError[] = [];
  const name = normalizeName(input.name);
  if (name === null) {
    errors.push({
      path: 'body.name',
      message: `Informe o nome, até ${NAME_MAX_LENGTH} caracteres.`,
    });
  }
  const email = normalizeEmail(typeof input.email === 'string' ? input.email : '');
  if (!isValidEmail(email)) {
    errors.push({ path: 'body.email', message: 'Informe um e-mail válido.' });
  }
  if (errors.length > 0) {
    throw validationFailed(errors);
  }
  assertValidPassword(input.password);
  const password = input.password;
  const accepted = await assertTermsAccepted(db, input.acceptedTerms);

  await db.transaction().execute(async (trx) => {
    await lockEmail(trx, email);
    const existing = await findUserIdByEmail(trx, email);
    if (existing !== undefined) {
      await enqueueEmail(trx, { userId: existing, type: 'account.exists', data: {} });
      return;
    }
    const userId = await createAccount(trx, { email, name: name as string, password });
    await acceptTerms(
      trx,
      userId,
      accepted.map((version) => version.id),
      input.context.ip,
      input.context.userAgent ?? null,
    );
    await enqueueEmail(trx, { userId, type: 'account.verify_email', data: {} });
  });
}
