import { afterAll, describe, expect, it } from 'vitest';
import { userEventStream } from '../../src/app.ts';
import { callAs, createActor } from '../actors.ts';
import { createTestApp } from '../helpers.ts';
import { openSse, type SseConnection } from './sse-client.ts';

// O fluxo SSE com a sessão real do admin (spec 003, "Fluxo SSE da equipe"; spec 004, "Casos de
// erro"): saída, sessão encerrada por outro processo e suspensão `full` fecham a conexão.
const test = createTestApp();
const connections: SseConnection[] = [];
let url = '';

afterAll(async () => {
  for (const connection of connections) {
    connection.close();
  }
  await test.close();
});

async function connect(cookie: string): Promise<SseConnection> {
  if (url === '') {
    const address = await test.app.listen({ port: 0, host: '127.0.0.1' });
    await userEventStream(test.app).whenListening();
    url = `${address}/api/v1/stream`;
  }
  const connection = await openSse(url, { cookie: `nuva_admin_session=${cookie}` });
  connections.push(connection);
  return connection;
}

describe('GET /api/v1/stream com a sessão do cookie', () => {
  it('abre com a sessão válida e fecha quando ela sai (logout)', async () => {
    const actor = await createActor(test, 'manager');
    const stream = await connect(actor.cookie);
    expect(stream.status).toBe(200);
    expect(userEventStream(test.app).hub.connectionCount()).toBe(1);
    expect(
      (await callAs(test, { method: 'POST', url: '/api/v1/auth/logout', as: actor })).statusCode,
    ).toBe(204);
    await stream.ended();
    expect(userEventStream(test.app).hub.connectionCount()).toBe(0);
  });

  it('sessão encerrada por outro processo: a conferência periódica fecha o fluxo', async () => {
    const actor = await createActor(test, 'manager');
    const kept = await createActor(test, 'instructor');
    const stream = await connect(actor.cookie);
    const other = await connect(kept.cookie);
    // Como faria outro processo ao encerrar as sessões do usuário.
    await test.db.deleteFrom('sessions').where('userId', '=', actor.id).execute();
    await userEventStream(test.app).checkSessions();
    await stream.ended();
    expect(userEventStream(test.app).hub.connectionCount()).toBe(1);
    other.close();
  });

  it('suspensão full encerra as sessões e fecha o fluxo', async () => {
    const target = await createActor(test, 'manager');
    const admin = await createActor(test, 'admin');
    const stream = await connect(target.cookie);
    const response = await callAs(test, {
      method: 'POST',
      url: `/api/v1/users/${target.id}/suspend`,
      as: admin,
      payload: { kind: 'full', reason: 'motivo interno do teste', durationDays: 1 },
    });
    expect(response.statusCode).toBe(200);
    await userEventStream(test.app).checkSessions();
    await stream.ended();
    expect(userEventStream(test.app).hub.connectionCount()).toBe(0);
  });

  it('sem cookie válido: 401', async () => {
    const reply = await fetch(url, {
      headers: { cookie: 'nuva_admin_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(reply.status).toBe(401);
    expect(reply.headers.get('set-cookie')).toContain('nuva_admin_session=;');
    await reply.body?.cancel();
  });
});
