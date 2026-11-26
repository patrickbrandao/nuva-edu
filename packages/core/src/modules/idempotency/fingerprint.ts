import { createHash } from 'node:crypto';

// Impressão digital da requisição que acompanha a `Idempotency-Key` (spec 003, "Idempotência";
// migration 0021). A repetição compara o hash: igual devolve a primeira resposta, diferente é
// `idempotency_key_reuse`. O JSON canônico não depende da ordem das propriedades, para o mesmo
// corpo montado em outra ordem continuar sendo a mesma requisição.

/**
 * JSON com as propriedades de cada objeto em ordem alfabética. `undefined` desaparece (como em
 * `JSON.stringify`); datas viram ISO 8601 pelo próprio `toJSON`. Serve só para o hash: não é
 * formato de armazenamento.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([name, entry]) => `${JSON.stringify(name)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

/**
 * SHA-256 de escopo + alvo + corpo da requisição, em JSON canônico. O alvo é o recurso da
 * operação (o pedido, a cobrança) e o corpo, os campos que mudam o efeito (motivo, itens,
 * valor). O usuário não entra: a chave primária da tabela já separa as chaves por usuário.
 */
export function requestFingerprint(scope: string, target: string, body: unknown = null): string {
  const canonical = canonicalJson({ body, scope, target });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
