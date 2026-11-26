import type { Database } from '../../../src/index.ts';

// Apoio dos testes da central: transação desfeita no fim (o banco é compartilhado entre os
// arquivos) e usuários descartáveis.

class Rollback extends Error {}

/** Roda `fn` numa transação e a desfaz, devolvendo o que `fn` devolveu. */
export async function inRollback<T>(db: Database, fn: (trx: Database) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await db.transaction().execute(async (trx) => {
      result = await fn(trx);
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) {
      throw error;
    }
  }
  return result as T;
}

export interface TestUserOptions {
  role?: 'student' | 'instructor' | 'manager' | 'admin';
  deletedAt?: Date;
  suspendedKind?: 'posting' | 'full';
  name?: string;
}

/** Usuário de teste; devolve o id. */
export async function createUser(trx: Database, options: TestUserOptions = {}): Promise<string> {
  const row = await trx
    .insertInto('users')
    .values({
      email: `central-${crypto.randomUUID()}@example.com`,
      name: options.name ?? 'Aluno',
      ...(options.role === undefined ? {} : { role: options.role }),
      ...(options.deletedAt === undefined ? {} : { deletedAt: options.deletedAt }),
      ...(options.suspendedKind === undefined
        ? {}
        : { suspendedAt: new Date(), suspendedKind: options.suspendedKind }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Um UUID novo, para alvos e ids que não precisam existir. */
export function newId(): string {
  return crypto.randomUUID();
}
