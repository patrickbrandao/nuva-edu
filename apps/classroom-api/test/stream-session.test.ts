import { afterAll, describe, expect, it } from 'vitest';
import { userEventStream } from '../src/app.ts';
import { Browser, COOKIE, createUser } from './accounts.ts';
import { createTestApp } from './helpers.ts';
import { openSse, type SseConnection } from './sse-client.ts';

// O fluxo SSE com a sessão real (spec 004, "Casos de erro"): sessão encerrada fecha a conexão.
const test = createTestApp();
const connections: SseConnection[] = [];
let url = '';

afterAll(async () => {
  for (const connection of connections) {
    connection.close();
  }
  await test.close();
});

async function connect(browser: Browser): Promise<SseConnection> {
  if (url === '') {
    const address = await test.app.listen({ port: 0, host: '127.0.0.1' });
    await userEventStream(test.app).whenListening();
    url = `${address}/api/v1/stream`;
  }
  const connection = await openSse(url, { cookie: `${COOKIE}=${browser.cookie}` });
  connections.push(connection);
  return connection;
}

async function signedIn(): Promise<Browser> {
  const user = await createUser(test.db);
  const browser = new Browser(test.app);
  expect((await browser.login(user.email)).statusCode).toBe(200);
  return browser;
}

describe('GET /api/v1/stream com a sessão do cookie', () => {
  it('abre com a sessão válida e fecha quando ela sai (logout)', async () => {
    const browser = await signedIn();
    const stream = await connect(browser);
    expect(stream.status).toBe(200);
    expect(userEventStream(test.app).hub.connectionCount()).toBe(1);
    expect((await browser.request('POST', '/api/v1/auth/logout')).statusCode).toBe(204);
    await stream.ended();
    expect(userEventStream(test.app).hub.connectionCount()).toBe(0);
  });

  it('sessão encerrada por outro processo: a conferência periódica fecha o fluxo', async () => {
    const browser = await signedIn();
    const other = await signedIn();
    const stream = await connect(browser);
    const kept = await connect(other);
    // Como faria a admin-api ao suspender: apaga as sessões direto no banco.
    const session = (await browser.request('GET', '/api/v1/session')).json();
    await test.db.deleteFrom('sessions').where('userId', '=', session.user.id).execute();
    await userEventStream(test.app).checkSessions();
    await stream.ended();
    expect(userEventStream(test.app).hub.connectionCount()).toBe(1);
    kept.close();
  });

  it('sem cookie válido: 401', async () => {
    const anonymous = new Browser(test.app);
    anonymous.cookie = 'A'.repeat(43);
    const reply = await fetch(url, { headers: { cookie: `${COOKIE}=${anonymous.cookie}` } });
    expect(reply.status).toBe(401);
    expect(reply.headers.get('set-cookie')).toContain(`${COOKIE}=;`);
    await reply.body?.cancel();
  });
});
