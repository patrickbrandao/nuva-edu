import type { Database } from '../../db/database.ts';
import type { JsonValue } from '../../db/generated/database.ts';
import { idempotencyKeyReuse } from './errors.ts';
import { normalizeIdempotencyKey } from './key.ts';

// Execução idempotente das ações financeiras (spec 003, "Idempotência"; migration 0021). A
// reserva e o efeito vivem na mesma transação: a linha nasce com `response_status` nulo, o efeito
// roda com o mesmo `trx` e a resposta é gravada antes do commit. Assim, ou o efeito e a resposta
// entram juntos, ou nenhum dos dois fica — não existe reembolso sem resposta gravada.
//
// Concorrência: o `INSERT ... ON CONFLICT DO NOTHING` espera a transação concorrente terminar. Se
// ela commitou, a segunda requisição encontra a resposta e reproduz; se ela desfez, a segunda
// assume a chave e executa. Não há janela entre "vi que não existe" e "reservei".

/** Janela em que a repetição devolve a primeira resposta (spec 003). */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface IdempotentRequest<T> {
  /** Operação dona da chave (`IDEMPOTENCY_SCOPES`). */
  scope: string;
  /** Usuário da sessão (aluno ou membro da equipe): parte da chave primária. */
  userId: string;
  /** `Idempotency-Key` do cliente; ausente mantém o comportamento sem idempotência. */
  key: string | null | undefined;
  /** `requestFingerprint(scope, alvo, corpo)` da requisição. */
  requestHash: string;
  /** Status HTTP da resposta que fica gravada e volta na repetição. */
  status: number;
  /** Instante da execução; padrão: agora. Define também o início da retenção de 24 h. */
  now?: Date;
  /**
   * Erro que fecha a transação com o efeito já gravado e a chave livre. É o caso do provedor
   * fora no fechamento da cesta: o pedido `draft` fica (como antes da chave) e o aluno repete
   * com a mesma `Idempotency-Key`. Sem esta opção, erro desfaz transação e reserva.
   */
  releaseOn?: (error: unknown) => boolean;
  /** Executa o efeito com o `trx` da reserva e devolve o corpo da resposta. */
  execute: (trx: Database) => Promise<T>;
}

export interface IdempotentOutcome<T> {
  body: T;
  status: number;
  /** `true` quando a resposta veio da chave gravada, sem executar o efeito. */
  replayed: boolean;
}

type Step<T> = { done: true; outcome: IdempotentOutcome<T> } | { done: false; error: unknown };

/**
 * Executa `execute` uma única vez por (`scope`, `userId`, `key`) e guarda a resposta por 24 h.
 * Sem chave, executa dentro de uma transação e não grava nada. Repetição com o mesmo hash
 * devolve o corpo gravado (`replayed: true`); com hash diferente, `422 idempotency_key_reuse`.
 * Chave com mais de 24 h ou reserva sem resposta (efeito que não chegou a completar) é tratada
 * como expirada: a linha é reescrita com a requisição nova e o efeito roda de novo.
 */
export async function runIdempotent<T>(
  db: Database,
  request: IdempotentRequest<T>,
): Promise<IdempotentOutcome<T>> {
  const key = normalizeIdempotencyKey(request.key);
  const now = request.now ?? new Date();
  const { scope, userId, requestHash, status } = request;

  const step = await db.transaction().execute(async (trx): Promise<Step<T>> => {
    if (key !== null) {
      const inserted = await trx
        .insertInto('idempotencyKeys')
        .values({ key, scope, userId, requestHash, createdAt: now })
        .onConflict((conflict) => conflict.columns(['scope', 'userId', 'key']).doNothing())
        .returning('key')
        .executeTakeFirst();

      if (!inserted) {
        const stored = await trx
          .selectFrom('idempotencyKeys')
          .selectAll()
          .where('scope', '=', scope)
          .where('userId', '=', userId)
          .where('key', '=', key)
          .forUpdate()
          .executeTakeFirstOrThrow();

        const expired = stored.createdAt.getTime() <= now.getTime() - IDEMPOTENCY_RETENTION_MS;
        // Reserva nula só chega aqui commitada: a transação que a criou já terminou sem gravar
        // resposta (versão anterior, processo interrompido entre commit e escrita). Não há
        // requisição em andamento para esperar, então a chave está livre.
        if (!expired && stored.responseStatus !== null) {
          if (stored.requestHash !== requestHash) throw idempotencyKeyReuse();
          return {
            done: true,
            outcome: {
              body: reviveTimestamps(stored.responseBody ?? null) as T,
              status: stored.responseStatus,
              replayed: true,
            },
          };
        }
        await trx
          .updateTable('idempotencyKeys')
          .set({
            requestHash,
            responseStatus: null,
            responseBody: null,
            createdAt: now,
            completedAt: null,
          })
          .where('scope', '=', scope)
          .where('userId', '=', userId)
          .where('key', '=', key)
          .execute();
      }
    }

    let body: T;
    try {
      body = await request.execute(trx);
    } catch (error) {
      if (request.releaseOn?.(error)) {
        // Fecha com o efeito parcial (pedido draft) e libera a chave para a próxima tentativa.
        if (key !== null) {
          await trx
            .deleteFrom('idempotencyKeys')
            .where('scope', '=', scope)
            .where('userId', '=', userId)
            .where('key', '=', key)
            .execute();
        }
        return { done: false, error };
      }
      throw error;
    }

    if (key !== null) {
      await trx
        .updateTable('idempotencyKeys')
        .set({
          responseStatus: status,
          // `jsonb` recebe o texto do JSON; o driver não serializa objeto por conta própria.
          responseBody: JSON.stringify(body),
          completedAt: now,
        })
        .where('scope', '=', scope)
        .where('userId', '=', userId)
        .where('key', '=', key)
        .execute();
    }
    return { done: true, outcome: { body, status, replayed: false } };
  });

  if (!step.done) throw step.error;
  return step.outcome;
}

// Campos de data das respostas financeiras gravadas em `jsonb` (ISO 8601). A leitura devolve
// `Date` de novo para o corpo repetido ser igual ao da primeira resposta; as rotas formatam com
// `toISOString()`. Outros textos com cara de data (título, motivo, URL) não são tocados: só os
// nomes de campo abaixo.
const TIMESTAMP_FIELDS = new Set(['createdAt', 'doneAt', 'expiresAt', 'paidAt']);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Devolve o JSON gravado com os campos de data de `TIMESTAMP_FIELDS` como `Date`. */
export function reviveTimestamps(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((entry) => reviveTimestamps(entry));
  if (value === null || typeof value !== 'object') return value;
  const revived: Record<string, JsonValue> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    revived[name] =
      TIMESTAMP_FIELDS.has(name) && typeof entry === 'string' && ISO_TIMESTAMP.test(entry)
        ? (new Date(entry) as unknown as JsonValue)
        : reviveTimestamps(entry);
  }
  return revived;
}
