import type { FastifyRequest } from 'fastify';
import type { ContractOperation } from './contract.ts';

/**
 * Uma regra de limite de taxa (spec 003, RNF-03; spec 004, RNF-04): no máximo `limit`
 * requisições por `windowSeconds` para cada chave. A chave diz a quem a conta pertence (a
 * sessão, o IP, o usuário); `null` quer dizer que a regra não vale para esta requisição (por
 * exemplo, a regra "por sessão" numa requisição sem sessão).
 */
export interface RateLimitRule {
  /** Nome curto e único; separa as contas de cada regra (`session`, `auth-ip`...). */
  name: string;
  limit: number;
  windowSeconds: number;
  /**
   * De quem é a conta. Roda depois dos tratadores de segurança, então já enxerga o que eles
   * guardaram no `request` (a sessão). `rateLimitByIp` usa o IP real.
   */
  key: (request: FastifyRequest) => string | null;
  /**
   * Grupo de rotas: `operationId` das operações em que a regra vale (as de autenticação, o envio
   * de mensagem). Sem a lista, vale em todas as operações de `/api/v1`.
   */
  operations?: readonly string[];
}

/** Resultado da conferência de uma requisição. */
export type RateLimitDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** Regra que recusou (a de espera mais longa, quando mais de uma recusa). */
      rule: string;
      /** Segundos até a janela da regra virar: vai em `Retry-After` e em `retryAfterSeconds`. */
      retryAfterSeconds: number;
    };

export interface RateLimiter {
  /** Conta a requisição em cada regra que vale para ela e diz se passa. */
  check(request: FastifyRequest, operation: ContractOperation): RateLimitDecision;
  /** Quantas contas estão guardadas agora (para teste e diagnóstico). */
  size(): number;
  /** Apaga as contas de janelas que já viraram. */
  sweep(): void;
  /** Para a limpeza periódica. */
  stop(): void;
}

export interface RateLimiterOptions {
  /** Relógio em milissegundos; nos testes, um relógio falso. */
  now?: () => number;
  /** Intervalo da limpeza das contas vencidas, em ms. Padrão: 60 s; `0` desliga. */
  sweepIntervalMs?: number;
}

/** Chave por IP real do cliente (já resolvido conforme `TRUSTED_PROXIES`). */
export function rateLimitByIp(request: FastifyRequest): string {
  return request.client.ip;
}

const API_PREFIX = '/api/v1/';

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Limite de taxa em memória, por processo: cada instância da API conta as próprias
 * requisições (spec 003 e 004 não pedem conta compartilhada). Janela fixa por chave: a conta
 * começa na primeira requisição e zera ao fim da janela.
 */
export function createRateLimiter(
  rules: readonly RateLimitRule[],
  options: RateLimiterOptions = {},
): RateLimiter {
  const now = options.now ?? Date.now;
  const names = new Set<string>();
  for (const rule of rules) {
    if (names.has(rule.name)) {
      throw new TypeError(`Regra de limite de taxa repetida: "${rule.name}".`);
    }
    names.add(rule.name);
    if (!Number.isInteger(rule.limit) || rule.limit < 1) {
      throw new TypeError(`Regra "${rule.name}": limit deve ser um inteiro positivo.`);
    }
    if (!Number.isInteger(rule.windowSeconds) || rule.windowSeconds < 1) {
      throw new TypeError(`Regra "${rule.name}": windowSeconds deve ser um inteiro positivo.`);
    }
  }
  const groups = rules.map((rule) => (rule.operations ? new Set(rule.operations) : null));
  const windows = new Map<string, Window>();

  const sweep = () => {
    const at = now();
    for (const [key, window] of windows) {
      if (window.resetAt <= at) {
        windows.delete(key);
      }
    }
  };
  const interval = options.sweepIntervalMs ?? 60_000;
  const timer = interval > 0 ? setInterval(sweep, interval) : null;
  timer?.unref();

  return {
    check(request, operation) {
      const at = now();
      let refused: { rule: string; retryAfterSeconds: number } | null = null;
      for (const [index, rule] of rules.entries()) {
        const group = groups[index];
        const applies = group
          ? group.has(operation.operationId)
          : operation.path.startsWith(API_PREFIX);
        if (!applies) {
          continue;
        }
        const owner = rule.key(request);
        if (owner === null) {
          continue;
        }
        const key = `${rule.name}\u0000${owner}`;
        let window = windows.get(key);
        if (!window || window.resetAt <= at) {
          window = { count: 0, resetAt: at + rule.windowSeconds * 1000 };
          windows.set(key, window);
        }
        window.count += 1;
        if (window.count > rule.limit) {
          const retryAfterSeconds = Math.max(1, Math.ceil((window.resetAt - at) / 1000));
          if (!refused || retryAfterSeconds > refused.retryAfterSeconds) {
            refused = { rule: rule.name, retryAfterSeconds };
          }
        }
      }
      return refused ? { allowed: false, ...refused } : { allowed: true };
    },
    size: () => windows.size,
    sweep,
    stop() {
      if (timer) {
        clearInterval(timer);
      }
    },
  };
}
