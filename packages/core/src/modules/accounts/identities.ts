import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { notFound } from '../../errors/domain-error.ts';
import { recordAudit } from '../audit/record.ts';
import type { Role } from '../permissions/roles.ts';
import { type AccountSite, auditContextFor, type RequestContext } from './context.ts';
import { lastLoginMethod } from './errors.ts';

// Provedores vinculados (spec 007, "Login social e vínculo", vínculo manual). O vínculo em si
// (`auth.provider_link`) é do módulo `oauth` (tarefa 148). Dono de `oauth_identities`:
// classroom-api.

export const AUTH_PROVIDERS = ['google', 'facebook', 'apple'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export function isAuthProvider(value: unknown): value is AuthProvider {
  return typeof value === 'string' && (AUTH_PROVIDERS as readonly string[]).includes(value);
}

export interface Identity {
  provider: AuthProvider;
  email: string | null;
  createdAt: Date;
}

export interface IdentityList {
  hasPassword: boolean;
  items: Identity[];
}

/** `GET /account/identities` (e `identities` do `UserDetail`). */
export async function listIdentities(db: Database, userId: string): Promise<IdentityList> {
  const user = await db
    .selectFrom('users')
    .select(sql<boolean>`password IS NOT NULL`.as('hasPassword'))
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  const rows = await db
    .selectFrom('oauthIdentities')
    .select(['provider', 'email', 'createdAt'])
    .where('userId', '=', userId)
    .orderBy('createdAt', 'asc')
    .execute();
  return {
    hasPassword: user.hasPassword,
    items: rows.map((row) => ({
      provider: row.provider as AuthProvider,
      email: row.email,
      createdAt: row.createdAt,
    })),
  };
}

export interface RemoveIdentityInput {
  user: { id: string; role: Role };
  provider: string;
  site: AccountSite;
  context: RequestContext;
}

/**
 * `DELETE /account/identities/{provider}`: remove o vínculo e grava `auth.provider_unlink`.
 * Provedor não vinculado: `404`. Último método de acesso (sem senha e sem outro provedor):
 * `422 last_login_method`. A linha do usuário fica travada durante a conferência.
 */
export async function removeIdentity(db: Database, input: RemoveIdentityInput): Promise<void> {
  if (!isAuthProvider(input.provider)) {
    throw notFound('Provedor não vinculado.');
  }
  const provider = input.provider;
  await db.transaction().execute(async (trx) => {
    const user = await trx
      .selectFrom('users')
      .select(sql<boolean>`password IS NOT NULL`.as('hasPassword'))
      .where('id', '=', input.user.id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const identities = await trx
      .selectFrom('oauthIdentities')
      .select(['id', 'provider'])
      .where('userId', '=', input.user.id)
      .execute();
    const target = identities.find((identity) => identity.provider === provider);
    if (!target) {
      throw notFound('Provedor não vinculado.');
    }
    if (!user.hasPassword && identities.length <= 1) {
      throw lastLoginMethod();
    }
    await trx.deleteFrom('oauthIdentities').where('id', '=', target.id).execute();
    await recordAudit(trx, {
      context: auditContextFor(input.site, input.context, input.user),
      action: 'auth.provider_unlink',
      targetType: 'user',
      targetId: input.user.id,
      details: { provider },
    });
  });
}
