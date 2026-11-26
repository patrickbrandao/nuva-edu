import { randomUUID } from 'node:crypto';
import {
  createNotification,
  getOrCreateUnsubscribeToken,
  getUnreadNotificationCount,
  type JsonObject,
  type NotificationGroup,
  type NotificationType,
} from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Browser,
  COOKIE,
  createUser,
  isolatedDatabase,
  type Reply,
  TEST_PASSWORD,
  type TestUser,
} from '../accounts.ts';
import { createTestApp, type TestApp } from '../helpers.ts';
import { openSse, type SseConnection } from '../sse-client.ts';

// Central de notificações e preferências (spec 024; tarefa 585). Banco só deste arquivo: a
// central, o contador, a leitura e a limpeza dependem de linhas controladas, e as preferências
// gravadas por um teste não podem alcançar outro. Toda rota é chamada pelo HTTP, então a
// validação de resposta do contrato roda em cada uma, inclusive no problem+json.

/** Marca no conteúdo das notificações: não pode aparecer no log. */
const SECRET = 'segredo-da-central-585';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let test: TestApp;
let baseUrl: string;

function scan(reply: Reply): void {
  expect(JSON.stringify(reply.headers) + reply.body).not.toContain(TEST_PASSWORD);
}

async function loggedIn(user: TestUser): Promise<Browser> {
  const session = new Browser(test.app, scan);
  expect((await session.login(user.email)).statusCode).toBe(200);
  return session;
}

interface SeedNotification {
  userId: string;
  type: NotificationType;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  data?: JsonObject;
  count?: number;
  readAt?: Date;
  createdAt?: Date;
}

/** Linha da central gravada direto, para controlar instante, leitura e agrupamento. */
function seed(input: SeedNotification) {
  return test.db
    .insertInto('notifications')
    .values({
      userId: input.userId,
      type: input.type,
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      ...(input.targetType === undefined ? {} : { targetType: input.targetType }),
      ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
      ...(input.data === undefined ? {} : { data: JSON.stringify(input.data) }),
      ...(input.count === undefined ? {} : { count: input.count }),
      ...(input.readAt === undefined ? {} : { readAt: input.readAt }),
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

function tokenFor(userId: string, group: NotificationGroup): Promise<string> {
  return test.db
    .transaction()
    .execute((trx) => getOrCreateUnsubscribeToken(trx, { userId, group }));
}

function unread(session: Browser): Promise<Reply> {
  return session.request('GET', '/api/v1/notifications/unread-count');
}

let aluna: TestUser;
let outra: TestUser;
let autora: TestUser;
let forum: { id: string };
let certificado: { id: string };
let antiga: { id: string };
let daOutra: string;

beforeAll(async () => {
  database = await isolatedDatabase();
  test = createTestApp({ DATABASE_URL: database.url });
  // Os testes do sino usam o fluxo SSE de verdade: a API escuta numa porta, e o `inject`
  // continua valendo para o resto.
  baseUrl = await test.app.listen({ port: 0, host: '127.0.0.1' });

  aluna = await createUser(test.db, { name: 'Aluna da Central' });
  outra = await createUser(test.db, { name: 'Outra Aluna' });
  autora = await createUser(test.db, { name: 'Ana Autora' });

  // Três itens da aluna, do mais novo para o mais antigo; o último já lido.
  certificado = await seed({
    userId: aluna.id,
    type: 'certificate.issued',
    data: { courseTitle: `${SECRET} curso`, code: 'ABCD-EFGH-JKMN' },
    createdAt: new Date('2024-03-10T12:00:00.000Z'),
  });
  forum = await seed({
    userId: aluna.id,
    type: 'forum.reply',
    actorId: autora.id,
    targetType: 'topic',
    targetId: randomUUID(),
    data: { topicTitle: `${SECRET} tópico`, excerpt: `${SECRET} resposta` },
    createdAt: new Date('2024-03-10T12:01:00.000Z'),
  });
  antiga = await seed({
    userId: aluna.id,
    type: 'lesson.published',
    actorId: autora.id,
    targetType: 'course',
    targetId: randomUUID(),
    data: { courseTitle: `${SECRET} curso antigo` },
    createdAt: new Date('2024-03-10T11:00:00.000Z'),
    readAt: new Date('2024-03-10T11:05:00.000Z'),
  });
  daOutra = (
    await seed({
      userId: outra.id,
      type: 'forum.reply',
      actorId: autora.id,
      targetType: 'topic',
      targetId: randomUUID(),
      data: { topicTitle: `${SECRET} da outra` },
      createdAt: new Date('2024-03-10T12:02:00.000Z'),
    })
  ).id;
}, 120_000);

afterAll(async () => {
  // Nada de conteúdo da central nem token de descadastro no log (spec 024 e regra do papel).
  expect(test.logText()).not.toContain(SECRET);
  expect(test.logText()).not.toContain(TEST_PASSWORD);
  await test.close();
  await database.drop();
});

describe('sem sessão', () => {
  it('lista, contador, leitura, limpeza e preferências respondem 401', async () => {
    const visitor = new Browser(test.app, scan);
    for (const [method, url, payload] of [
      ['GET', '/api/v1/notifications'],
      ['GET', '/api/v1/notifications/unread-count'],
      ['GET', '/api/v1/me/notification-prefs'],
      ['POST', `/api/v1/notifications/${randomUUID()}/read`],
      ['POST', '/api/v1/notifications/read-all'],
      ['DELETE', '/api/v1/notifications'],
      ['PUT', '/api/v1/me/notification-prefs', { forum: { email: false } }],
    ] as const) {
      const reply = await visitor.request(method, url, payload ? { payload } : {});
      expect(reply.statusCode, `${method} ${url}`).toBe(401);
      expect(reply.json().code).toBe('unauthenticated');
    }
  });
});

describe('escritas exigem o X-CSRF-Token', () => {
  it('sem o cabeçalho da sessão: 403; o descadastro é a exceção', async () => {
    const session = await loggedIn(aluna);
    const off = { csrf: false };
    for (const [method, url, payload] of [
      ['POST', `/api/v1/notifications/${forum.id}/read`, undefined],
      ['POST', '/api/v1/notifications/read-all', undefined],
      ['DELETE', '/api/v1/notifications', undefined],
      ['PUT', '/api/v1/me/notification-prefs', { forum: { email: false } }],
    ] as const) {
      const reply = await session.request(method, url, {
        ...(payload === undefined ? {} : { payload }),
        ...off,
      });
      expect(reply.statusCode, `${method} ${url}`).toBe(403);
      expect(reply.json().code).toBe('csrf_token_invalid');
    }
  });
});

describe('GET /notifications', () => {
  it('lista só o usuário da sessão, da mais nova para a mais antiga, com autor e grupo', async () => {
    const session = await loggedIn(aluna);
    const reply = await session.request('GET', '/api/v1/notifications');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    const page = reply.json() as { items: Record<string, unknown>[]; nextCursor: string | null };
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item) => item.id)).toEqual([forum.id, certificado.id, antiga.id]);

    const [topico, emissao, lida] = page.items;
    expect(topico).toEqual({
      id: forum.id,
      type: 'forum.reply',
      group: 'forum',
      actor: { id: autora.id, name: 'Ana Autora', avatarUrl: null },
      targetType: 'topic',
      targetId: expect.any(String),
      data: { topicTitle: `${SECRET} tópico`, excerpt: `${SECRET} resposta` },
      count: 1,
      readAt: null,
      createdAt: expect.stringMatching(ISO),
    });
    // Aviso do sistema não tem autor; o item lido traz o instante.
    expect(emissao).toMatchObject({
      id: certificado.id,
      type: 'certificate.issued',
      group: 'courses',
      actor: null,
      readAt: null,
    });
    expect(lida).toMatchObject({ id: antiga.id, group: 'courses', readAt: expect.any(String) });
    // Campos de escrita do banco não vão para o fio.
    for (const item of page.items) {
      expect(item).not.toHaveProperty('userId');
      expect(item).not.toHaveProperty('actorId');
    }

    const other = await loggedIn(outra);
    const otherPage = (await other.request('GET', '/api/v1/notifications')).json() as {
      items: { id: string }[];
    };
    expect(otherPage.items.map((item) => item.id)).toEqual([daOutra]);
  });

  it('pagina por cursor, sem repetir nem perder item', async () => {
    const session = await loggedIn(aluna);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const reply = await session.request(
        'GET',
        `/api/v1/notifications?limit=1${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      expect(reply.statusCode).toBe(200);
      const body = reply.json() as { items: { id: string }[]; nextCursor: string | null };
      expect(body.items).toHaveLength(1);
      const [item] = body.items;
      if (item === undefined) {
        throw new Error('Página vazia no meio da paginação.');
      }
      seen.push(item.id);
      cursor = body.nextCursor;
      if (cursor === null) {
        break;
      }
    }
    expect(cursor).toBeNull();
    expect(seen).toEqual([forum.id, certificado.id, antiga.id]);
  });

  it('cursor fora do formato e limite fora da faixa: 400 validation_failed', async () => {
    const session = await loggedIn(aluna);
    const badCursor = await session.request('GET', '/api/v1/notifications?cursor=abc');
    expect(badCursor.statusCode).toBe(400);
    expect(badCursor.json().code).toBe('validation_failed');
    for (const limit of ['0', '51', 'abc']) {
      const reply = await session.request('GET', `/api/v1/notifications?limit=${limit}`);
      expect(reply.statusCode, `limit=${limit}`).toBe(400);
      expect(reply.json().code).toBe('validation_failed');
    }
  });
});

describe('agrupamento', () => {
  it('o mesmo tipo e alvo ainda não lido sai numa linha com `count`', async () => {
    const alvo = await createUser(test.db, { name: 'Alvo do Agrupamento' });
    const topico = randomUUID();
    for (let index = 0; index < 3; index += 1) {
      await test.db.transaction().execute((trx) =>
        createNotification(trx, {
          userId: alvo.id,
          type: 'forum.reply',
          actorId: autora.id,
          targetType: 'topic',
          targetId: topico,
          data: { topicTitle: `${SECRET} agrupado ${index}` },
        }),
      );
    }
    const session = await loggedIn(alvo);
    const page = (await session.request('GET', '/api/v1/notifications')).json() as {
      items: { type: string; group: string; count: number; data: { topicTitle: string } }[];
    };
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      type: 'forum.reply',
      group: 'forum',
      count: 3,
      data: { topicTitle: `${SECRET} agrupado 2` },
    });
    expect((await unread(session)).json()).toEqual({ unreadCount: 1 });
  });
});

describe('GET /notifications/unread-count', () => {
  it('conta as não lidas de cada usuário, sem cruzar', async () => {
    const session = await loggedIn(aluna);
    const reply = await unread(session);
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({ unreadCount: 2 });

    const other = await loggedIn(outra);
    expect((await unread(other)).json()).toEqual({ unreadCount: 1 });
    // O contador do banco confere com a rota.
    expect(await getUnreadNotificationCount(test.db, aluna.id)).toBe(2);
  });
});

describe('POST /notifications/{id}/read', () => {
  it('marca a própria notificação, devolve o item e o contador, e é idempotente', async () => {
    const session = await loggedIn(aluna);
    const first = await session.request('POST', `/api/v1/notifications/${forum.id}/read`);
    expect(first.statusCode).toBe(200);
    const body = first.json() as {
      notification: { id: string; readAt: string; count: number };
      unreadCount: number;
    };
    expect(body.notification.id).toBe(forum.id);
    expect(body.notification.readAt).toMatch(ISO);
    expect(body.unreadCount).toBe(1);

    const again = await session.request('POST', `/api/v1/notifications/${forum.id}/read`);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({
      notification: body.notification,
      unreadCount: 1,
    });
  });

  it('notificação de outra pessoa e inexistente: 404; id fora do formato: 400', async () => {
    const session = await loggedIn(aluna);
    const alheia = await session.request('POST', `/api/v1/notifications/${daOutra}/read`);
    expect(alheia.statusCode).toBe(404);
    expect(alheia.json().code).toBe('not_found');
    const inexistente = await session.request('POST', `/api/v1/notifications/${randomUUID()}/read`);
    expect(inexistente.statusCode).toBe(404);
    expect(inexistente.json().code).toBe('not_found');
    const foraDoFormato = await session.request('POST', '/api/v1/notifications/abc/read');
    expect(foraDoFormato.statusCode).toBe(400);
    expect(foraDoFormato.json().code).toBe('validation_failed');

    // A notificação da outra pessoa continua não lida e na central dela.
    const other = await loggedIn(outra);
    expect((await unread(other)).json()).toEqual({ unreadCount: 1 });
  });
});

describe('POST /notifications/read-all', () => {
  it('marca todas as não lidas do usuário e o contador fica zero', async () => {
    const session = await loggedIn(aluna);
    const reply = await session.request('POST', '/api/v1/notifications/read-all');
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({ updated: 1, unreadCount: 0 });
    expect((await unread(session)).json()).toEqual({ unreadCount: 0 });

    const again = await session.request('POST', '/api/v1/notifications/read-all');
    expect(again.json()).toEqual({ updated: 0, unreadCount: 0 });
    // Nada da outra pessoa mudou.
    const other = await loggedIn(outra);
    expect((await unread(other)).json()).toEqual({ unreadCount: 1 });
  });
});

describe('DELETE /notifications', () => {
  it('apaga lidas e não lidas do próprio usuário, devolve quantas e não alcança outra pessoa', async () => {
    const session = await loggedIn(aluna);
    const reply = await session.request('DELETE', '/api/v1/notifications');
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({ deleted: 3 });

    const page = (await session.request('GET', '/api/v1/notifications')).json() as {
      items: unknown[];
      nextCursor: string | null;
    };
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect((await unread(session)).json()).toEqual({ unreadCount: 0 });

    const again = await session.request('DELETE', '/api/v1/notifications');
    expect(again.json()).toEqual({ deleted: 0 });

    const other = await loggedIn(outra);
    expect((await other.request('GET', '/api/v1/notifications')).json().items).toHaveLength(1);
  });
});

describe('GET|PUT /me/notification-prefs', () => {
  it('devolve os onze grupos, na ordem da spec, com os padrões e as regras de trava', async () => {
    const session = await loggedIn(aluna);
    const reply = await session.request('GET', '/api/v1/me/notification-prefs');
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    const prefs = reply.json() as Record<
      string,
      { inApp: boolean; email: boolean; emailRequired: boolean; inAppAvailable: boolean }
    >;
    expect(Object.keys(prefs)).toEqual([
      'account',
      'purchase',
      'courses',
      'forum',
      'messages',
      'community',
      'events',
      'support',
      'announcements',
      'moderation',
      'staff',
    ]);
    expect(prefs.account).toEqual({
      inApp: false,
      email: true,
      emailRequired: true,
      inAppAvailable: false,
    });
    expect(prefs.purchase).toEqual({
      inApp: true,
      email: true,
      emailRequired: true,
      inAppAvailable: true,
    });
    expect(prefs.courses).toEqual({
      inApp: true,
      email: true,
      emailRequired: false,
      inAppAvailable: true,
    });
    expect(prefs.messages).toEqual({
      inApp: true,
      email: false,
      emailRequired: false,
      inAppAvailable: true,
    });
    expect(prefs.support).toEqual({
      inApp: true,
      email: true,
      emailRequired: true,
      inAppAvailable: true,
    });
    expect(prefs.staff).toEqual({
      inApp: true,
      email: true,
      emailRequired: false,
      inAppAvailable: true,
    });
  });

  it('grava só os canais enviados e mantém os outros grupos', async () => {
    const session = await loggedIn(aluna);
    const reply = await session.request('PUT', '/api/v1/me/notification-prefs', {
      payload: { forum: { email: false } },
    });
    expect(reply.statusCode).toBe(200);
    const prefs = reply.json() as Record<string, { inApp: boolean; email: boolean }>;
    expect(prefs.forum).toMatchObject({ inApp: true, email: false });
    expect(prefs.courses).toMatchObject({ inApp: true, email: true });
    expect(prefs.account).toMatchObject({ inApp: false, email: true });

    // Persistiu: a leitura seguinte vê o mesmo.
    const read = (await session.request('GET', '/api/v1/me/notification-prefs')).json() as Record<
      string,
      { inApp: boolean; email: boolean }
    >;
    expect(read.forum).toMatchObject({ inApp: true, email: false });

    const second = await session.request('PUT', '/api/v1/me/notification-prefs', {
      payload: { messages: { inApp: false } },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().messages).toMatchObject({ inApp: false, email: false });
    expect(second.json().forum).toMatchObject({ inApp: true, email: false });
    // Preferência de um usuário não vale para o outro.
    const other = await loggedIn(outra);
    const otherPrefs = (
      await other.request('GET', '/api/v1/me/notification-prefs')
    ).json() as Record<string, { email: boolean }>;
    expect(otherPrefs.forum).toMatchObject({ inApp: true, email: true });
  });

  it('recusa e-mail desligado nos grupos obrigatórios e o canal plataforma em account', async () => {
    const session = await loggedIn(aluna);
    for (const payload of [
      { account: { email: false } },
      { purchase: { email: false } },
      { support: { email: false } },
      { moderation: { email: false } },
      { account: { inApp: true } },
    ]) {
      const reply = await session.request('PUT', '/api/v1/me/notification-prefs', { payload });
      expect(reply.statusCode, JSON.stringify(payload)).toBe(400);
      expect(reply.json().code).toBe('validation_failed');
    }
    // Nada disso foi gravado.
    const prefs = (await session.request('GET', '/api/v1/me/notification-prefs')).json() as Record<
      string,
      { email: boolean; inApp: boolean }
    >;
    expect(prefs.account).toMatchObject({ email: true, inApp: false });
    expect(prefs.purchase).toMatchObject({ email: true });
    expect(prefs.support).toMatchObject({ email: true });
    expect(prefs.moderation).toMatchObject({ email: true });
  });

  it('corpo inválido pelo contrato: grupo desconhecido, canal desconhecido, vazio ou não booleano', async () => {
    const session = await loggedIn(aluna);
    for (const payload of [
      { desconhecido: { email: false } },
      { forum: { sms: true } },
      {},
      { forum: { email: 'não' } },
      { forum: { email: false }, extra: true },
    ]) {
      const reply = await session.request('PUT', '/api/v1/me/notification-prefs', { payload });
      expect(reply.statusCode, JSON.stringify(payload)).toBe(400);
      expect(reply.json().code).toBe('validation_failed');
    }
    const textPlain = await session.request('PUT', '/api/v1/me/notification-prefs', {
      payload: '{"forum":{"email":false}}',
      headers: { 'content-type': 'text/plain' },
    });
    expect(textPlain.statusCode).toBe(415);
  });
});

describe('POST /unsubscribe/{token}', () => {
  it('sem login e sem CSRF, desliga só o e-mail do grupo do token e é idempotente', async () => {
    const alvo = await createUser(test.db, { name: 'Alvo do Descadastro' });
    const forumToken = await tokenFor(alvo.id, 'forum');
    const visitor = new Browser(test.app, scan);

    const reply = await visitor.request('POST', `/api/v1/unsubscribe/${forumToken}`, {
      csrf: false,
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.headers['cache-control']).toBe('private, no-cache');
    expect(reply.json()).toEqual({ group: 'forum', prefs: { inApp: true, email: false } });

    // A sessão não é necessária nem atrapalha: com um cookie inválido, o mesmo resultado.
    const withBogusCookie = await visitor.request('POST', `/api/v1/unsubscribe/${forumToken}`, {
      csrf: false,
      headers: { cookie: `${COOKIE}=invalido` },
    });
    expect(withBogusCookie.statusCode).toBe(200);

    const session = await loggedIn(alvo);
    const prefs = (await session.request('GET', '/api/v1/me/notification-prefs')).json() as Record<
      string,
      { inApp: boolean; email: boolean }
    >;
    expect(prefs.forum).toMatchObject({ inApp: true, email: false, emailRequired: false });
    // O canal plataforma e os outros grupos ficam como estavam.
    expect(prefs.courses).toMatchObject({ inApp: true, email: true });
    expect(prefs.events).toMatchObject({ inApp: true, email: true });
    expect(prefs.messages).toMatchObject({ inApp: true, email: false });
  });

  it('token de um grupo não afeta os outros nem a preferência de outra pessoa', async () => {
    const alvo = await createUser(test.db, { name: 'Outro Alvo' });
    const session = await loggedIn(alvo);
    await session.request('PUT', '/api/v1/me/notification-prefs', {
      payload: { forum: { email: false }, messages: { inApp: false } },
    });
    const eventsToken = await tokenFor(alvo.id, 'events');
    const visitor = new Browser(test.app, scan);
    const reply = await visitor.request('POST', `/api/v1/unsubscribe/${eventsToken}`, {
      csrf: false,
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({ group: 'events', prefs: { inApp: true, email: false } });

    const prefs = (await session.request('GET', '/api/v1/me/notification-prefs')).json() as Record<
      string,
      { inApp: boolean; email: boolean }
    >;
    expect(prefs.events).toMatchObject({ email: false });
    expect(prefs.forum).toMatchObject({ inApp: true, email: false });
    expect(prefs.messages).toMatchObject({ inApp: false, email: false });
    expect(prefs.courses).toMatchObject({ inApp: true, email: true });

    // A aluna dos outros testes não foi tocada.
    const untouched = await loggedIn(aluna);
    const untouchedPrefs = (
      await untouched.request('GET', '/api/v1/me/notification-prefs')
    ).json() as Record<string, { email: boolean }>;
    expect(untouchedPrefs.events).toMatchObject({ email: true });
  });

  it('token fora do formato, em maiúsculas ou desconhecido: 404, sem criar preferência', async () => {
    const visitor = new Browser(test.app, scan);
    for (const token of ['abc', 'x'.repeat(64), 'A'.repeat(64), 'ab'.repeat(32)]) {
      const reply = await visitor.request('POST', `/api/v1/unsubscribe/${token}`, { csrf: false });
      expect(reply.statusCode, token).toBe(404);
      expect(reply.json().code).toBe('not_found');
    }
    // Caminho com token vazio: recusado pela validação do contrato.
    expect(
      (await visitor.request('POST', '/api/v1/unsubscribe/', { csrf: false })).statusCode,
    ).toBe(400);
  });

  it('grupo obrigatório não gera link de descadastro', async () => {
    const alvo = await createUser(test.db, { name: 'Sem Descadastro' });
    await expect(tokenFor(alvo.id, 'purchase')).rejects.toThrow(TypeError);
    await expect(tokenFor(alvo.id, 'account')).rejects.toThrow(TypeError);
  });
});

describe('sino em tempo real (SSE)', () => {
  const connections: SseConnection[] = [];
  afterAll(() => {
    for (const connection of connections.splice(0)) {
      connection.close();
    }
  });

  it('o destinatário recebe notification.created com o contador; os outros, não', async () => {
    const destinataria = await createUser(test.db, { name: 'Destinatária do Sino' });
    const outraPessoa = await createUser(test.db, { name: 'Outra do Sino' });
    const autoraDoFato = await createUser(test.db, { name: 'Autora do Fato' });
    const session = await loggedIn(destinataria);
    const otherSession = await loggedIn(outraPessoa);

    const mine = await openSse(`${baseUrl}/api/v1/stream`, {
      cookie: `${COOKIE}=${session.cookie}`,
    });
    connections.push(mine);
    expect(mine.status).toBe(200);
    const theirs = await openSse(`${baseUrl}/api/v1/stream`, {
      cookie: `${COOKIE}=${otherSession.cookie}`,
    });
    connections.push(theirs);
    expect(theirs.status).toBe(200);

    // Primeiro para outra pessoa: o fluxo da destinatária fica em silêncio.
    await test.db.transaction().execute((trx) =>
      createNotification(trx, {
        userId: outraPessoa.id,
        type: 'forum.reply',
        actorId: autoraDoFato.id,
        targetType: 'topic',
        targetId: randomUUID(),
        data: { topicTitle: `${SECRET} de outra` },
      }),
    );
    await expect(theirs.next()).resolves.toMatchObject({ event: 'notification.created' });
    await expect(mine.next(300)).rejects.toThrow();

    const created = await test.db.transaction().execute((trx) =>
      createNotification(trx, {
        userId: destinataria.id,
        type: 'forum.reply',
        actorId: autoraDoFato.id,
        targetType: 'topic',
        targetId: randomUUID(),
        data: { topicTitle: `${SECRET} do sino`, excerpt: `${SECRET} resposta` },
      }),
    );
    expect(created).not.toBeNull();

    const frame = await mine.next();
    expect(frame.event).toBe('notification.created');
    const event = JSON.parse(frame.data ?? '{}') as {
      notificationId: string;
      type: string;
      unreadCount: number;
    };
    expect(event).toEqual({
      notificationId: created?.notification.id,
      type: 'forum.reply',
      unreadCount: 1,
    });

    // A reconexão recarrega a central e o contador pela rota normal: o estado está no banco.
    expect((await unread(session)).json()).toEqual({ unreadCount: event.unreadCount });
    const page = (await session.request('GET', '/api/v1/notifications')).json() as {
      items: { id: string; type: string }[];
    };
    expect(page.items[0]).toMatchObject({ id: created?.notification.id, type: 'forum.reply' });
    // A outra pessoa só tem a dela.
    expect((await unread(otherSession)).json()).toEqual({ unreadCount: 1 });
  }, 20_000);
});
