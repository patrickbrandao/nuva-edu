import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  createUser,
  type Database,
  getUser,
  listUserSessions,
  listUsers,
  reactivateUser,
  revealUserPassword,
  revokeAllUserSessions,
  type SessionInfo,
  setUserPassword,
  setUserRole,
  suspendUser,
  type UserDetail,
  type UserSummary,
  updateUser,
} from '@nuva-edu/core';
import { managementRequest } from '../session.ts';

// Gestão de usuários pela equipe (spec 007, "Equipe criada pelo admin" e "Exibição da senha";
// spec 008, "Mudança de papel" e "Suspensão"). O tratador de `sessionCookie` confere a ação de
// `x-permission`; o que depende do alvo (conta de equipe exige `staff.manage`, a regra de si
// mesmo, o alcance de `users.list`) fica nas regras do núcleo, que também gravam a negação e a
// auditoria de cada escrita (spec 028). Nenhuma resposta daqui tem campo de senha, exceto a de
// `revealUserPassword` (ADR 0002).

export interface UserRoutesOptions {
  db: Database;
}

const iso = (value: Date): string => value.toISOString();
const isoOrNull = (value: Date | null): string | null => (value === null ? null : iso(value));

/** `UserSummary` do contrato, com as datas em ISO 8601. */
export function userSummaryBody(user: UserSummary) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.role,
    avatarUrl: user.avatarUrl,
    status: user.status,
    createdAt: iso(user.createdAt),
    lastLoginAt: isoOrNull(user.lastLoginAt),
  };
}

/** `UserDetail` do contrato. Montado campo a campo: nada além do esquema sai na resposta. */
export function userDetailBody(user: UserDetail) {
  return {
    ...userSummaryBody(user),
    fullName: user.fullName,
    hasPassword: user.hasPassword,
    identities: user.identities.map((identity) => ({
      provider: identity.provider,
      email: identity.email,
      createdAt: iso(identity.createdAt),
    })),
    suspension:
      user.suspension === null
        ? null
        : {
            kind: user.suspension.kind,
            reason: user.suspension.reason,
            startsAt: iso(user.suspension.startsAt),
            endsAt: isoOrNull(user.suspension.endsAt),
            createdBy: user.suspension.createdBy,
          },
    version: user.version,
  };
}

/** `SessionInfo` do contrato. */
export function sessionInfoBody(session: SessionInfo) {
  return {
    id: session.id,
    site: session.site,
    ip: session.ip,
    browser: session.browser,
    os: session.os,
    createdAt: iso(session.createdAt),
    lastUsedAt: iso(session.lastUsedAt),
    current: session.current,
  };
}

type IdParams = { id: string };

export function registerUserRoutes(app: FastifyInstance, options: UserRoutesOptions): void {
  const { db } = options;

  // `GET /api/v1/users`: busca, filtros e cursor; `instructor` recebe `403` do núcleo.
  app.operation('listUsers', async (request) => {
    const query = request.query as {
      q?: string;
      role?: string;
      status?: string;
      sort?: string;
      limit?: number;
      cursor?: string;
    };
    const page = await listUsers(db, managementRequest(request), {
      q: query.q,
      role: query.role,
      status: query.status,
      sort: query.sort,
      limit: query.limit,
      cursor: query.cursor,
    });
    return { items: page.items.map(userSummaryBody), nextCursor: page.nextCursor };
  });

  // `POST /api/v1/users`: só `admin`; a senha vai ao núcleo e nunca volta na resposta.
  app.operation('createUser', async (request, reply) => {
    const body = request.body as { name: string; email: string; role: string; password: string };
    const user = await createUser(db, managementRequest(request), {
      name: body.name,
      email: body.email,
      role: body.role,
      password: body.password,
    });
    return reply.status(201).send(userDetailBody(user));
  });

  app.operation('getUser', async (request) => {
    const { id } = request.params as IdParams;
    return userDetailBody(await getUser(db, managementRequest(request), id));
  });

  // `PATCH /api/v1/users/{id}`: campo omitido não muda; `fullName: null` apaga.
  app.operation('updateUser', async (request) => {
    const { id } = request.params as IdParams;
    const body = request.body as {
      name?: string;
      fullName?: string | null;
      email?: string;
      version: number;
    };
    const input: Parameters<typeof updateUser>[3] = { version: body.version };
    if ('name' in body) {
      input.name = body.name;
    }
    if ('fullName' in body) {
      input.fullName = body.fullName;
    }
    if ('email' in body) {
      input.email = body.email;
    }
    return userDetailBody(await updateUser(db, managementRequest(request), id, input));
  });

  app.operation('setUserRole', async (request) => {
    const { id } = request.params as IdParams;
    const { role } = request.body as { role: string };
    return userDetailBody(await setUserRole(db, managementRequest(request), id, role));
  });

  app.operation('suspendUser', async (request) => {
    const { id } = request.params as IdParams;
    const body = request.body as { kind: string; reason: string; durationDays: number | null };
    const user = await suspendUser(db, managementRequest(request), id, {
      kind: body.kind,
      reason: body.reason,
      durationDays: body.durationDays,
    });
    return userDetailBody(user);
  });

  app.operation('reactivateUser', async (request) => {
    const { id } = request.params as IdParams;
    return userDetailBody(await reactivateUser(db, managementRequest(request), id));
  });

  // `POST /api/v1/users/{id}/password/reveal`: a única resposta com o campo de senha (ADR
  // 0002). `no-store` também nas respostas de erro; a senha não vai para log nem auditoria.
  app.operation(
    'revealUserPassword',
    async (request) => {
      const { id } = request.params as IdParams;
      const { adminPassword } = request.body as { adminPassword: string };
      const revealed = await revealUserPassword(db, managementRequest(request), id, {
        adminPassword,
      });
      return { password: revealed.password };
    },
    { noStore: true },
  );

  // `PUT /api/v1/users/{id}/password`: encerra as sessões do usuário (a admin-api não tem
  // fluxo SSE aberto; o da classroom-api cai com a sessão).
  app.operation('setUserPassword', async (request, reply) => {
    const { id } = request.params as IdParams;
    const { password } = request.body as { password: string };
    await setUserPassword(db, managementRequest(request), id, { password });
    return reply.status(204).send();
  });

  app.operation('listUserSessions', async (request) => {
    const { id } = request.params as IdParams;
    const sessions = await listUserSessions(db, managementRequest(request), id);
    return { items: sessions.items.map(sessionInfoBody) };
  });

  app.operation('revokeUserSessions', async (request, reply) => {
    const { id } = request.params as IdParams;
    await revokeAllUserSessions(db, managementRequest(request), id);
    return reply.status(204).send();
  });
}
