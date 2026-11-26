import { createSession } from '@nuva-edu/core';
import { createUser, nextIp, type TestApp } from './helpers.ts';

// Ator com sessão do admin aberta direto no banco e a chamada autenticada, para os testes das
// rotas de equipe (catálogo, imagens).

export type Role = 'student' | 'instructor' | 'manager' | 'admin';

export interface Actor {
  id: string;
  role: Role;
  cookie: string;
  csrf: string;
}

export async function createActor(test: TestApp, role: Role): Promise<Actor> {
  const user = await createUser(test.db, { role });
  const session = await test.db.transaction().execute((trx) =>
    createSession(trx, {
      userId: user.id,
      site: 'admin',
      context: { ip: nextIp(), userAgent: null },
    }),
  );
  return { id: user.id, role, cookie: session.token, csrf: session.csrfToken };
}

export interface CallOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  as: Actor;
  payload?: object | Buffer;
  headers?: Record<string, string>;
  /** `null` omite o `X-CSRF-Token`. */
  csrf?: string | null;
}

export function callAs(test: TestApp, options: CallOptions) {
  const headers: Record<string, string> = { ...options.headers };
  const csrf = options.csrf === undefined ? options.as.csrf : options.csrf;
  if (options.method !== 'GET' && csrf !== null) {
    headers['x-csrf-token'] = csrf;
  }
  return test.app.inject({
    method: options.method,
    url: options.url,
    headers,
    remoteAddress: '203.0.113.21',
    cookies: { nuva_admin_session: options.as.cookie },
    ...(options.payload === undefined ? {} : { payload: options.payload }),
  });
}

/** Negações gravadas na auditoria para o ator. */
export function deniedBy(test: TestApp, actorId: string) {
  return test.db
    .selectFrom('auditLog')
    .selectAll()
    .where('actorUserId', '=', actorId)
    .where('outcome', '=', 'denied')
    .execute();
}

/** Registros de sucesso de uma ação sobre um alvo. */
export function auditOf(test: TestApp, targetId: string, action: string) {
  return test.db
    .selectFrom('auditLog')
    .selectAll()
    .where('targetId', '=', targetId)
    .where('action', '=', action)
    .execute();
}

const CATALOG_TABLES = ['courses', 'modules', 'lessons', 'ebooks', 'bundles'] as const;
type CatalogTable = (typeof CATALOG_TABLES)[number];

/**
 * `version` gravada do item do catálogo de `/api/v1/{tabela}/{id}`, lida do banco; item
 * inexistente, `1`. É a que o site traria da última resposta.
 */
export async function catalogVersion(test: TestApp, url: string): Promise<number> {
  const [, , , table, id] = url.split('/');
  if (!CATALOG_TABLES.includes(table as CatalogTable) || id === undefined) {
    throw new Error(`URL fora do catálogo: ${url}`);
  }
  const row = await test.db
    .selectFrom(table as CatalogTable)
    .select('version')
    .where('id', '=', id)
    .executeTakeFirst();
  return row?.version ?? 1;
}

/** `PATCH` de edição do catálogo com a `version` atual do item no corpo. */
export async function editAs(test: TestApp, options: CallOptions & { payload: object }) {
  const version = await catalogVersion(test, options.url);
  return callAs(test, { ...options, method: 'PATCH', payload: { ...options.payload, version } });
}
