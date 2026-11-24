import { isIP } from 'node:net';
import type { AuditContext, AuditOrigin } from '../audit/record.ts';
import type { Role } from '../permissions/roles.ts';

// O que as APIs informam sobre a requisição, e a tradução para a auditoria.

export const ACCOUNT_SITES = ['classroom', 'admin'] as const;
/** Site de uma sessão ou tentativa de login (`sessions.site`, `login_attempts.site`). */
export type AccountSite = (typeof ACCOUNT_SITES)[number];

export function isAccountSite(value: unknown): value is AccountSite {
  return value === 'classroom' || value === 'admin';
}

/** Dados da requisição que as regras de conta usam. */
export interface RequestContext {
  /** IP real do cliente, já resolvido conforme `TRUSTED_PROXIES`. */
  ip: string;
  userAgent?: string | null;
  /** O `X-Request-Id`, para a auditoria. */
  requestId?: string | null;
}

/** Quem agiu, para a auditoria. */
export interface AccountActor {
  id: string;
  role: Role;
}

/** Origem da auditoria por site: `classroom` ou `admin_panel`. */
export function auditOriginFor(site: AccountSite): AuditOrigin {
  return site === 'admin' ? 'admin_panel' : 'classroom';
}

export function auditContextFor(
  site: AccountSite,
  context: RequestContext,
  actor: AccountActor | null,
): AuditContext {
  return {
    origin: auditOriginFor(site),
    actorUserId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    requestId: context.requestId ?? null,
    ip: context.ip,
    userAgent: context.userAgent ?? null,
  };
}

/**
 * IP para `login_attempts` e `sessions` (colunas `inet NOT NULL`). Sem IP válido é erro de
 * programação da API, não do cliente.
 */
export function requireIp(ip: string): string {
  const trimmed = ip.trim();
  if (isIP(trimmed) === 0) {
    throw new TypeError('RequestContext.ip precisa ser um IP (TRUSTED_PROXIES já resolvido).');
  }
  return trimmed;
}
