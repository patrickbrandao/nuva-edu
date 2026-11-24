import type { Database } from '../../db/database.ts';
import { imagePath } from '../images/image-url.ts';
import type { PermissionAction } from '../permissions/actions.ts';
import { permissionsFor } from '../permissions/matrix.ts';
import type { Role } from '../permissions/roles.ts';
import { pendingTermsFor } from '../privacy/terms-acceptance.ts';
import type { TermsVersion } from '../privacy/terms-versions.ts';
import { emailNotVerified, termsAcceptancePending } from './errors.ts';
import type { AuthenticatedSession } from './sessions.ts';

// `Session` do contrato (spec 007, "Esquemas comuns") e a trava dos termos pendentes.

/** Largura do avatar em `avatarUrl` (spec 007, "Avatar"). */
export const AVATAR_URL_VARIANT = 256;

/** `avatarUrl`: a variante de 256 px na própria API, ou `null` sem avatar. */
export function avatarUrlFor(avatarImageId: string | null): string | null {
  return avatarImageId === null ? null : imagePath(avatarImageId, AVATAR_URL_VARIANT);
}

export interface SessionViewUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  role: Role;
  avatarUrl: string | null;
  hasPassword: boolean;
}

/** Corpo de `GET /session` e do login. `termsPending` só no classroom. */
export interface SessionView {
  user: SessionViewUser;
  csrfToken: string;
  permissions: PermissionAction[];
  expiresAt: Date;
  termsPending?: TermsVersion[];
}

/**
 * Monta a `Session` de uma sessão autenticada: as ações que o papel permite na matriz do site
 * (spec 008) e, no classroom, os termos pendentes (spec 030). No admin não há `termsPending`.
 */
export async function buildSessionView(
  db: Database,
  session: AuthenticatedSession,
): Promise<SessionView> {
  const { user } = session;
  const view: SessionView = {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
      avatarUrl: avatarUrlFor(user.avatarImageId),
      hasPassword: user.hasPassword,
    },
    csrfToken: session.csrfToken,
    permissions: permissionsFor(user.role, session.site === 'admin' ? 'admin' : 'classroom'),
    expiresAt: session.expiresAt,
  };
  if (session.site === 'classroom') {
    view.termsPending = await pendingTermsFor(db, user.id);
  }
  return view;
}

const LEGAL_WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Escritas do classroom liberadas com termos pendentes (spec 007, "Termos no cadastro e aceite
 * pendente"): `POST /me/terms-acceptance`, `POST /auth/logout` e as de `/account/sessions`.
 * `path` é o caminho da requisição, sem a consulta.
 */
export function isTermsGateExempt(method: string, path: string): boolean {
  const verb = method.toUpperCase();
  if (!LEGAL_WRITE_METHODS.has(verb)) {
    return true;
  }
  const clean = path.replace(/\?.*$/, '').replace(/\/+$/, '');
  if (
    verb === 'POST' &&
    (clean === '/api/v1/me/terms-acceptance' || clean === '/api/v1/auth/logout')
  ) {
    return true;
  }
  return clean === '/api/v1/account/sessions' || clean.startsWith('/api/v1/account/sessions/');
}

/**
 * Trava dos termos no classroom: escrita (fora das exceções) de quem tem termos pendentes
 * responde `403 terms_acceptance_pending`. No site admin não há trava.
 */
export async function assertTermsGate(
  db: Database,
  session: Pick<AuthenticatedSession, 'site' | 'user'>,
  request: { method: string; path: string },
): Promise<void> {
  if (session.site !== 'classroom' || isTermsGateExempt(request.method, request.path)) {
    return;
  }
  const pending = await pendingTermsFor(db, session.user.id);
  if (pending.length > 0) {
    throw termsAcceptancePending();
  }
}

/** `403 email_not_verified` para comprar, publicar e enviar mensagem (fases seguintes). */
export function assertEmailVerified(user: Pick<SessionViewUser, 'emailVerified'>): void {
  if (!user.emailVerified) {
    throw emailNotVerified();
  }
}
