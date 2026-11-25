import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { DomainError } from '../../errors/domain-error.ts';
import type { EmailTokenPurpose } from './email-types.ts';

// Tokens dos links de e-mail (spec 007, "Tokens de e-mail"). O banco guarda só o SHA-256; o
// token em claro existe só no e-mail enviado. Quem cria é a tarefa `email.send` do worker, ao
// montar o e-mail; quem consome são as rotas de confirmação e de redefinição.

/** Validade do link (spec 024): 24 h. */
export const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
/** 32 bytes em base64url, sem preenchimento: 43 caracteres. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface IssuedEmailToken {
  /** Em claro: vai só no corpo do e-mail. Nunca em log, `jobs` ou `email_outbox`. */
  token: string;
  expiresAt: Date;
}

/** `410 token_expired`: link vencido, já usado ou desconhecido (spec 007). */
export function tokenExpired(): DomainError {
  return new DomainError({
    code: 'token_expired',
    status: 410,
    title: 'Link expirado',
    detail: 'O link venceu, já foi usado ou não existe. Peça um novo.',
  });
}

/** SHA-256 em hexadecimal minúsculo, como `email_tokens.token_hash`. */
export function hashEmailToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Trava consultiva do par usuário-propósito (`email_tokens:<userId>:<purpose>`), válida até o
 * fim da transação. É a que `issueEmailToken` e `invalidateEmailTokens` tomam; quem precisa
 * serializar com elas (o worker, antes de decidir se um e-mail com link ainda vale) usa esta
 * função, nunca uma cópia da chave. Reentrante: a mesma transação a toma de novo sem esperar.
 */
export async function lockEmailTokens(
  trx: Database,
  userId: string,
  purpose: EmailTokenPurpose,
): Promise<void> {
  if (!trx.isTransaction) {
    throw new TypeError('lockEmailTokens exige uma transação aberta (db.transaction()).');
  }
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`email_tokens:${userId}:${purpose}`}, 0))`.execute(
    trx,
  );
}

/**
 * Cria o token do link e invalida os anteriores não usados do mesmo usuário e propósito: vale
 * o último link enviado (spec 007). Exige transação: a trava do par usuário-propósito vale até
 * o fim dela, então duas emissões simultâneas não deixam dois links válidos.
 */
export async function issueEmailToken(
  trx: Database,
  userId: string,
  purpose: EmailTokenPurpose,
): Promise<IssuedEmailToken> {
  if (!trx.isTransaction) {
    throw new TypeError('issueEmailToken exige uma transação aberta (db.transaction()).');
  }
  await lockEmailTokens(trx, userId, purpose);
  await trx
    .updateTable('emailTokens')
    .set({ usedAt: sql<Date>`now()` })
    .where('userId', '=', userId)
    .where('purpose', '=', purpose)
    .where('usedAt', 'is', null)
    .execute();
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS);
  await trx
    .insertInto('emailTokens')
    .values({ tokenHash: hashEmailToken(token), userId, purpose, expiresAt })
    .execute();
  return { token, expiresAt };
}

/** Ordem fixa das travas ao tomar mais de um propósito: evita impasse entre duas trocas. */
const INVALIDATION_ORDER: readonly EmailTokenPurpose[] = ['verify', 'reset'];

/**
 * Invalida (`used_at = now()`) todos os tokens não usados da conta, dos propósitos `verify` e
 * `reset`: a troca de e-mail pela equipe (spec 007, "Tokens de e-mail"). Exige transação e toma
 * a mesma trava de `issueEmailToken` para cada propósito, em ordem fixa: token emitido antes da
 * troca morre nela; a emissão que chega depois espera a troca terminar. Devolve quantos tokens
 * foram invalidados.
 */
export async function invalidateEmailTokens(trx: Database, userId: string): Promise<number> {
  if (!trx.isTransaction) {
    throw new TypeError('invalidateEmailTokens exige uma transação aberta (db.transaction()).');
  }
  for (const purpose of INVALIDATION_ORDER) {
    await lockEmailTokens(trx, userId, purpose);
  }
  const result = await trx
    .updateTable('emailTokens')
    .set({ usedAt: sql<Date>`now()` })
    .where('userId', '=', userId)
    .where('purpose', 'in', INVALIDATION_ORDER)
    .where('usedAt', 'is', null)
    .executeTakeFirst();
  return Number(result.numUpdatedRows);
}

/**
 * Usa o token: uma vez só, dentro da validade e do propósito pedido. Devolve o dono. Vencido,
 * já usado, de outro propósito, malformado ou desconhecido: lança `410 token_expired`, sem
 * dizer qual dos casos foi.
 *
 * Tempo constante: a busca é pelo SHA-256 do token, nunca pelo valor recebido, então o tempo
 * da consulta não revela prefixo do token; a conferência final compara os hashes com
 * `timingSafeEqual`. A marcação de uso é um `UPDATE` condicional: duas chamadas simultâneas com
 * o mesmo token não passam ambas.
 */
export async function consumeEmailToken(
  trx: Database,
  token: string,
  purpose: EmailTokenPurpose,
): Promise<{ userId: string }> {
  const expected = hashEmailToken(token);
  const row = await trx
    .updateTable('emailTokens')
    .set({ usedAt: sql<Date>`now()` })
    .where('tokenHash', '=', expected)
    .where('purpose', '=', purpose)
    .where('usedAt', 'is', null)
    .where('expiresAt', '>', sql<Date>`now()`)
    .returning(['userId', 'tokenHash'])
    .executeTakeFirst();
  const valid =
    row !== undefined &&
    TOKEN_PATTERN.test(token) &&
    timingSafeEqual(Buffer.from(row.tokenHash, 'utf8'), Buffer.from(expected, 'utf8'));
  if (!row || !valid) {
    throw tokenExpired();
  }
  return { userId: row.userId };
}
