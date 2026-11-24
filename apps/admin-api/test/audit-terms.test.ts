import { createSession, recordAudit } from '@nuva-edu/core';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestApp, createUser, nextIp, TEST_PASSWORD, type TestApp } from './helpers.ts';

const test: TestApp = createTestApp();
afterAll(() => test.close());

type Role = 'student' | 'instructor' | 'manager' | 'admin';

const bodies: string[] = [];

interface Actor {
  id: string;
  cookie: string;
  csrf: string;
}

async function actor(role: Role): Promise<Actor> {
  const user = await createUser(test.db, { role });
  const session = await test.db.transaction().execute((trx) =>
    createSession(trx, {
      userId: user.id,
      site: 'admin',
      context: { ip: nextIp(), userAgent: null },
    }),
  );
  return { id: user.id, cookie: session.token, csrf: session.csrfToken };
}

async function call(
  method: 'GET' | 'POST',
  url: string,
  as: Actor,
  payload?: object,
): Promise<Awaited<ReturnType<TestApp['app']['inject']>>> {
  const response = await test.app.inject({
    method,
    url,
    headers: method === 'GET' ? {} : { 'x-csrf-token': as.csrf },
    cookies: { nuva_admin_session: as.cookie },
    ...(payload === undefined ? {} : { payload }),
  });
  bodies.push(response.body);
  return response;
}

async function deniedBy(actorId: string) {
  return test.db
    .selectFrom('auditLog')
    .selectAll()
    .where('actorUserId', '=', actorId)
    .where('outcome', '=', 'denied')
    .execute();
}

describe('GET /api/v1/audit', () => {
  it('admin consulta por ator: registros sem details e audit.search gravado com os filtros', async () => {
    const admin = await actor('admin');
    const subject = await createUser(test.db, { role: 'student' });
    await recordAudit(test.db, {
      context: {
        origin: 'admin_panel',
        actorUserId: subject.id,
        actorRole: 'student',
        requestId: 'req-semente',
        ip: '203.0.113.5',
        userAgent: null,
      },
      action: 'user.update',
      targetType: 'user',
      targetId: subject.id,
      details: { name: { before: 'A', after: 'B' } },
    });
    const response = await call('GET', `/api/v1/audit?actorId=${subject.id}`, admin);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.nextCursor).toBeNull();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      action: 'user.update',
      actor: { id: subject.id, name: 'Pessoa de Teste' },
      targetName: 'Pessoa de Teste',
      outcome: 'ok',
    });
    expect(body.items[0]).not.toHaveProperty('details');

    const search = await test.db
      .selectFrom('auditLog')
      .selectAll()
      .where('actorUserId', '=', admin.id)
      .where('action', '=', 'audit.search')
      .execute();
    expect(search).toHaveLength(1);
    expect(search[0]?.details).toMatchObject({ filters: { actorId: subject.id } });

    const detail = await call('GET', `/api/v1/audit/${body.items[0].id}`, admin);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ details: { name: { before: 'A', after: 'B' } } });
    // Abrir um registro não grava audit.search.
    const after = await test.db
      .selectFrom('auditLog')
      .select('id')
      .where('actorUserId', '=', admin.id)
      .where('action', '=', 'audit.search')
      .execute();
    expect(after).toHaveLength(1);
  });

  it('janela acima de 366 dias: 400 validation_failed; registro inexistente: 404', async () => {
    const admin = await actor('admin');
    const wide = await call(
      'GET',
      '/api/v1/audit?from=2024-01-01T00:00:00Z&to=2025-06-01T00:00:00Z',
      admin,
    );
    expect(wide.statusCode).toBe(400);
    expect(wide.json()).toMatchObject({ code: 'validation_failed' });
    const missing = await call('GET', `/api/v1/audit/${crypto.randomUUID()}`, admin);
    expect(missing.statusCode).toBe(404);
  });

  it('manager: 403 na lista e no registro, com a negação gravada', async () => {
    const manager = await actor('manager');
    const list = await call('GET', '/api/v1/audit', manager);
    expect(list.statusCode).toBe(403);
    expect(list.json()).toMatchObject({ code: 'permission_denied' });
    const one = await call('GET', `/api/v1/audit/${crypto.randomUUID()}`, manager);
    expect(one.statusCode).toBe(403);
    const denied = await deniedBy(manager.id);
    expect(denied).toHaveLength(2);
    expect(denied.map((row) => row.action)).toEqual(['audit.view', 'audit.view']);
  });
});

describe('termos', () => {
  it('admin cria rascunho, lista e publica: terms.publish na auditoria; publicar de novo: 409', async () => {
    const admin = await actor('admin');
    const draft = await call('POST', '/api/v1/terms', admin, {
      document: 'privacy',
      bodyMd: '# Política\n\nTexto.',
      requiresReacceptance: true,
    });
    expect(draft.statusCode).toBe(201);
    const entry = draft.json();
    expect(entry).toMatchObject({
      document: 'privacy',
      status: 'draft',
      version: null,
      effectiveAt: null,
      publishedAt: null,
      requiresReacceptance: true,
    });
    expect(entry).not.toHaveProperty('bodyMd');

    const list = await call('GET', '/api/v1/terms?document=privacy', admin);
    expect(list.statusCode).toBe(200);
    expect(list.json().items.map((item: { id: string }) => item.id)).toContain(entry.id);

    const published = await call('POST', `/api/v1/terms/${entry.id}/publish`, admin);
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({
      id: entry.id,
      status: 'published',
      version: expect.any(Number),
      publishedAt: expect.any(String),
    });
    const audit = await test.db
      .selectFrom('auditLog')
      .selectAll()
      .where('action', '=', 'terms.publish')
      .where('targetId', '=', entry.id)
      .execute();
    expect(audit).toMatchObject([
      { actorUserId: admin.id, origin: 'admin_panel', targetType: 'terms_version', outcome: 'ok' },
    ]);

    const again = await call('POST', `/api/v1/terms/${entry.id}/publish`, admin);
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'terms_already_published' });
    const missing = await call('POST', `/api/v1/terms/${crypto.randomUUID()}/publish`, admin);
    expect(missing.statusCode).toBe(404);
  });

  it('manager: 403 em listar, criar e publicar, com a negação gravada', async () => {
    const manager = await actor('manager');
    const responses = [
      await call('GET', '/api/v1/terms?document=terms', manager),
      await call('POST', '/api/v1/terms', manager, {
        document: 'terms',
        bodyMd: 'x',
        requiresReacceptance: false,
      }),
      await call('POST', `/api/v1/terms/${crypto.randomUUID()}/publish`, manager),
    ];
    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403]);
    expect(await deniedBy(manager.id)).toHaveLength(3);
  });
});

describe('varredura da senha (ADR 0002, spec 007 RNF-05)', () => {
  it('a senha de teste não aparece em resposta nem no log', () => {
    for (const text of [...bodies, test.logText()]) {
      expect(text).not.toContain(TEST_PASSWORD);
    }
  });
});
