import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  changePassword,
  isAuthProvider,
  listIdentities,
  listSessions,
  notFound,
  removeIdentity,
  revokeOtherSessions,
  revokeSession,
  setAvatar,
} from '@nuva-edu/core';
import { toWire } from '../json.ts';
import { clearSessionCookie, requestContext, SITE } from '../session.ts';
import { bodyOf, paramsOf, type RouteContext, requireSession } from './context.ts';

/** Senha, métodos de acesso, sessões e avatar do próprio usuário (spec 007). */
export function registerAccountRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { config, db, hub } = ctx;

  // `PUT /account/password`: define ou troca; as outras sessões são encerradas.
  app.operation('setAccountPassword', async (request, reply) => {
    const current = requireSession(request);
    const body = bodyOf<{ newPassword: string; currentPassword?: string }>(request);
    await changePassword(db, {
      session: current,
      newPassword: body.newPassword,
      ...(body.currentPassword === undefined ? {} : { currentPassword: body.currentPassword }),
      context: requestContext(request),
    });
    hub.retainSessions(current.user.id, new Set([current.id]));
    reply.status(204);
  });

  app.operation('listAccountIdentities', async (request) =>
    toWire(await listIdentities(db, requireSession(request).user.id)),
  );

  // `DELETE /account/identities/{provider}`: provedor desligado nesta instalação é `404`.
  app.operation('unlinkAccountIdentity', async (request, reply) => {
    const current = requireSession(request);
    const { provider } = paramsOf<{ provider: string }>(request);
    if (!isAuthProvider(provider) || config.authProviders[provider] === null) {
      throw notFound('Provedor não vinculado.');
    }
    await removeIdentity(db, {
      user: current.user,
      provider,
      site: SITE,
      context: requestContext(request),
    });
    reply.status(204);
  });

  app.operation('listAccountSessions', async (request) => {
    const current = requireSession(request);
    return toWire({ items: await listSessions(db, current.user.id, current.id) });
  });

  // `DELETE /account/sessions`: encerra todas as outras, nos dois sites.
  app.operation('revokeOtherAccountSessions', async (request, reply) => {
    const current = requireSession(request);
    await revokeOtherSessions(db, current);
    hub.retainSessions(current.user.id, new Set([current.id]));
    reply.status(204);
  });

  // `DELETE /account/sessions/{id}`: a própria sessão também pode ser encerrada (vale sair).
  app.operation('revokeAccountSession', async (request, reply) => {
    const current = requireSession(request);
    const { id } = paramsOf<{ id: string }>(request);
    await revokeSession(db, { userId: current.user.id, sessionId: id });
    hub.disconnectSession(id.toLowerCase());
    if (id.toLowerCase() === current.id) {
      clearSessionCookie(reply);
    }
    reply.status(204);
  });

  // `PUT /me/profile/avatar`: associa uma imagem `avatar` do próprio usuário, ou remove.
  app.operation('setAvatar', async (request) => {
    const current = requireSession(request);
    const { imageId } = bodyOf<{ imageId: string | null }>(request);
    return setAvatar(db, { userId: current.user.id, imageId });
  });
}
