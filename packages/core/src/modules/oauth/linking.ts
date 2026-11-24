import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { type AccountSite, auditContextFor, type RequestContext } from '../accounts/context.ts';
import { accountSuspended, staffOnly } from '../accounts/errors.ts';
import type { AuthProvider } from '../accounts/identities.ts';
import { lockEmail } from '../accounts/registration.ts';
import { revokeUserSessions } from '../accounts/sessions.ts';
import { recordAudit } from '../audit/record.ts';
import { isStaffRole, type Role } from '../permissions/roles.ts';
import type { OAuthIntent } from './cookie.ts';
import { identityInUse, providerAlreadyLinked } from './errors.ts';
import type { ProviderIdentity } from './provider.ts';

// Tabela de vínculo do login social (spec 007, "Login social e vínculo"). Dono de
// `oauth_identities`: classroom-api; a admin-api só grava no vínculo por e-mail do login.

const IDENTITY_IN_USE_INDEX = 'oauth_identities_provider_user_unique';
const PROVIDER_LINKED_INDEX = 'oauth_identities_user_provider_unique';

/** Como o vínculo nasceu, gravado em `auth.provider_link` (`details.via`). */
export type ProviderLinkVia = 'email' | 'manual' | 'signup';

export interface InsertIdentityInput {
  userId: string;
  identity: Pick<ProviderIdentity, 'provider' | 'providerUserId' | 'email' | 'emailVerified'>;
  via: ProviderLinkVia;
  site: AccountSite;
  context: RequestContext;
  /** Quem agiu: o próprio usuário (vínculo e cadastro). */
  actor: { id: string; role: Role };
}

/**
 * Grava o vínculo e `auth.provider_link`. Os dois índices únicos do banco decidem a corrida:
 * `(provider, provider_user_id)` vira `identity_in_use` e `(user_id, provider)`,
 * `provider_already_linked`. Exige transação.
 */
export async function insertIdentity(trx: Database, input: InsertIdentityInput): Promise<void> {
  if (!trx.isTransaction) {
    throw new TypeError('insertIdentity exige uma transação aberta (db.transaction()).');
  }
  try {
    await trx
      .insertInto('oauthIdentities')
      .values({
        userId: input.userId,
        provider: input.identity.provider,
        providerUserId: input.identity.providerUserId,
        email: input.identity.email,
        emailVerified: input.identity.emailVerified,
      })
      .execute();
  } catch (error) {
    throw translateUniqueViolation(error);
  }
  await recordAudit(trx, {
    context: auditContextFor(input.site, input.context, input.actor),
    action: 'auth.provider_link',
    targetType: 'user',
    targetId: input.userId,
    details: { provider: input.identity.provider, via: input.via },
  });
}

/** Violação de um dos índices únicos de `oauth_identities` vira o erro da spec. */
export function translateUniqueViolation(error: unknown): unknown {
  const pg = error as { code?: unknown; constraint?: unknown };
  if (pg?.code === '23505' && pg.constraint === IDENTITY_IN_USE_INDEX) {
    return identityInUse();
  }
  if (pg?.code === '23505' && pg.constraint === PROVIDER_LINKED_INDEX) {
    return providerAlreadyLinked();
  }
  return error;
}

interface LinkedUser {
  id: string;
  role: Role;
  suspendedKind: string | null;
  deletedAt: Date | null;
}

async function findLinkedUser(
  trx: Database,
  provider: AuthProvider,
  providerUserId: string,
): Promise<LinkedUser | undefined> {
  const row = await trx
    .selectFrom('oauthIdentities')
    .innerJoin('users', 'users.id', 'oauthIdentities.userId')
    .select(['users.id', 'users.role', 'users.suspendedKind', 'users.deletedAt'])
    .where('oauthIdentities.provider', '=', provider)
    .where('oauthIdentities.providerUserId', '=', providerUserId)
    .executeTakeFirst();
  return row && { ...row, role: row.role as Role };
}

async function hasProvider(trx: Database, userId: string, provider: AuthProvider) {
  const row = await trx
    .selectFrom('oauthIdentities')
    .select('id')
    .where('userId', '=', userId)
    .where('provider', '=', provider)
    .executeTakeFirst();
  return row !== undefined;
}

/** O que a tabela decidiu. */
export type SocialDecision =
  | { kind: 'login'; user: { id: string; role: Role } }
  | { kind: 'linked' }
  | { kind: 'pending' };

export interface ResolveSocialInput {
  site: AccountSite;
  intent: OAuthIntent;
  identity: ProviderIdentity;
  /** `intent=link`: o dono da sessão. */
  linkUser: { id: string; role: Role } | null;
  context: RequestContext;
}

function assertCanEnter(site: AccountSite, user: { role: Role; suspendedKind: string | null }) {
  if (user.suspendedKind === 'full') {
    throw accountSuspended();
  }
  if (site === 'admin' && !isStaffRole(user.role)) {
    throw staffOnly();
  }
}

/**
 * Aplica a tabela de vínculo. Erros da regra (`account_suspended`, `staff_only`,
 * `identity_in_use`, `provider_already_linked`) saem como `DomainError` e desfazem a transação.
 * Exige transação.
 *
 * Login:
 * - identidade vinculada: entra (suspensão `full` e, no admin, papel `student` recusam);
 * - e-mail verificado com conta: vincula e entra; conta sem e-mail confirmado passa a ter, perde
 *   a senha definida antes da confirmação e todas as sessões (quem "reservou" o e-mail sai);
 * - nos demais casos: cadastro pendente no classroom, `staff_only` no admin.
 *
 * Vínculo (`intent=link`, só classroom): a mesma identidade já na conta conta como feito; em
 * outra conta, `identity_in_use`; a conta já ter o provedor, `provider_already_linked`.
 */
export async function resolveSocialIdentity(
  trx: Database,
  input: ResolveSocialInput,
): Promise<SocialDecision> {
  const { identity, site } = input;
  const linked = await findLinkedUser(trx, identity.provider, identity.providerUserId);

  if (input.intent === 'link') {
    const user = input.linkUser;
    if (user === null) {
      throw new TypeError('intent=link exige o dono da sessão.');
    }
    if (linked !== undefined) {
      if (linked.id === user.id) {
        return { kind: 'linked' };
      }
      throw identityInUse();
    }
    if (await hasProvider(trx, user.id, identity.provider)) {
      throw providerAlreadyLinked();
    }
    await insertIdentity(trx, {
      userId: user.id,
      identity,
      via: 'manual',
      site,
      context: input.context,
      actor: user,
    });
    return { kind: 'linked' };
  }

  if (linked !== undefined) {
    if (linked.deletedAt !== null) {
      // A exclusão apaga os vínculos; uma linha órfã não autentica ninguém.
      throw identityInUse();
    }
    assertCanEnter(site, linked);
    await trx
      .updateTable('oauthIdentities')
      .set({ email: identity.email, emailVerified: identity.emailVerified })
      .where('provider', '=', identity.provider)
      .where('providerUserId', '=', identity.providerUserId)
      .execute();
    return { kind: 'login', user: { id: linked.id, role: linked.role } };
  }

  if (identity.email !== null && identity.emailVerified) {
    await lockEmail(trx, identity.email);
    const owner = await trx
      .selectFrom('users')
      .select(['id', 'role', 'suspendedKind', 'emailVerifiedAt'])
      .where('email', '=', identity.email)
      .where('deletedAt', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (owner !== undefined) {
      const user = { id: owner.id, role: owner.role as Role };
      assertCanEnter(site, { role: user.role, suspendedKind: owner.suspendedKind });
      if (await hasProvider(trx, user.id, identity.provider)) {
        throw providerAlreadyLinked();
      }
      await insertIdentity(trx, {
        userId: user.id,
        identity,
        via: 'email',
        site,
        context: input.context,
        actor: user,
      });
      if (owner.emailVerifiedAt === null) {
        await trx
          .updateTable('users')
          .set({
            emailVerifiedAt: sql<Date>`now()`,
            password: null,
            version: sql<number>`version + 1`,
            updatedAt: sql<Date>`now()`,
          })
          .where('id', '=', user.id)
          .execute();
        await revokeUserSessions(trx, user.id);
      }
      return { kind: 'login', user };
    }
  }

  if (site === 'admin') {
    throw staffOnly();
  }
  return { kind: 'pending' };
}
