import { createTermsDraft, publishTermsVersion } from '@nuva-edu/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Browser,
  createUser,
  isolatedDatabase,
  OTHER_PASSWORD,
  type Reply,
  TEST_PASSWORD,
  uniqueEmail,
} from './accounts.ts';
import { createTestApp, type TestApp } from './helpers.ts';

// Versão publicada não se apaga: este arquivo usa um banco só dele (veja `isolatedDatabase`).
let database: Awaited<ReturnType<typeof isolatedDatabase>>;
let test: TestApp;

function scan(reply: Reply): void {
  const seen = JSON.stringify(reply.headers) + reply.body;
  expect(seen).not.toContain(TEST_PASSWORD);
  expect(seen).not.toContain(OTHER_PASSWORD);
}
const browser = () => new Browser(test.app, scan);

beforeAll(async () => {
  database = await isolatedDatabase();
  test = createTestApp({ DATABASE_URL: database.url });
});
afterAll(async () => {
  expect(test.logText()).not.toContain(TEST_PASSWORD);
  await test.close();
  await database.drop();
});

async function publish(document: 'terms' | 'privacy', requiresReacceptance = false) {
  const draft = await createTermsDraft(test.db, {
    document,
    bodyMd: `# ${document} ${Date.now()}`,
    requiresReacceptance,
  });
  await test.db
    .transaction()
    .execute((trx) => publishTermsVersion(trx, draft.id, { origin: 'cli' }));
  return draft.id;
}

describe('termos (spec 030, "Termos na Fase 1")', () => {
  let termsV1: string;
  let privacyV1: string;
  let veteran: { id: string; email: string };

  it('GET /legal/{document} sem versão publicada: 404; documento desconhecido: 400', async () => {
    // Conta criada antes da primeira publicação: fica com o aceite pendente depois dela.
    veteran = await createUser(test.db);
    expect((await browser().request('GET', '/api/v1/legal/terms')).statusCode).toBe(404);
    expect((await browser().request('GET', '/api/v1/legal/outro')).statusCode).toBe(400);
  });

  it('GET /legal/{document} devolve a vigente com o texto, sem sessão', async () => {
    termsV1 = await publish('terms');
    privacyV1 = await publish('privacy');
    const reply = await browser().request('GET', '/api/v1/legal/terms');
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({
      id: termsV1,
      document: 'terms',
      version: 1,
      bodyMd: expect.stringContaining('# terms'),
    });
    expect(reply.json().effectiveAt).toMatch(/Z$/);
  });

  it('cadastro com termos publicados exige o aceite das vigentes (422 terms_acceptance_required)', async () => {
    const email = uniqueEmail();
    const missing = await browser().request('POST', '/api/v1/auth/register', {
      payload: { name: 'Ana', email, password: TEST_PASSWORD, acceptedTerms: [termsV1] },
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json()).toMatchObject({
      code: 'terms_acceptance_required',
      errors: [{ path: 'body.acceptedTerms', message: 'privacy' }],
    });

    const accepted = await browser().request('POST', '/api/v1/auth/register', {
      payload: { name: 'Ana', email, password: TEST_PASSWORD, acceptedTerms: [termsV1, privacyV1] },
    });
    expect(accepted.statusCode).toBe(204);
    const client = browser();
    const login = await client.login(email);
    expect(login.json().termsPending).toEqual([]);
  });

  it('termos pendentes travam as escritas (403 terms_acceptance_pending), salvo as exceções', async () => {
    const client = browser();
    const login = await client.login(veteran.email);
    expect(login.statusCode).toBe(200);
    expect(
      login
        .json()
        .termsPending.map((item: { id: string }) => item.id)
        .sort(),
    ).toEqual([termsV1, privacyV1].sort());

    const blocked = await client.request('PUT', '/api/v1/me/profile/avatar', {
      payload: { imageId: null },
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: 'terms_acceptance_pending' });
    // Leitura continua liberada; encerrar as outras sessões também.
    expect((await client.request('GET', '/api/v1/account/sessions')).statusCode).toBe(200);
    expect((await client.request('DELETE', '/api/v1/account/sessions')).statusCode).toBe(204);
    // A trava vem depois do CSRF: sem o token, o erro é o do CSRF.
    const noCsrf = await client.request('PUT', '/api/v1/me/profile/avatar', {
      payload: { imageId: null },
      csrf: false,
    });
    expect(noCsrf.json()).toMatchObject({ code: 'csrf_token_invalid' });

    // Aceite de versão que não é a vigente: 422 terms_version_outdated.
    const draft = await createTermsDraft(test.db, { document: 'terms', bodyMd: '# rascunho' });
    const outdated = await client.request('POST', '/api/v1/me/terms-acceptance', {
      payload: { termsVersionIds: [draft.id] },
    });
    expect(outdated.statusCode).toBe(422);
    expect(outdated.json()).toMatchObject({ code: 'terms_version_outdated' });

    const accept = await client.request('POST', '/api/v1/me/terms-acceptance', {
      payload: { termsVersionIds: [termsV1, privacyV1] },
    });
    expect(accept.statusCode).toBe(204);
    // Aceitar de novo não duplica.
    expect(
      (
        await client.request('POST', '/api/v1/me/terms-acceptance', {
          payload: { termsVersionIds: [termsV1] },
        })
      ).statusCode,
    ).toBe(204);
    const rows = await test.db
      .selectFrom('termsAcceptances')
      .select(['termsVersionId', 'ip', 'userAgent'])
      .where('userId', '=', veteran.id)
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.ip).toBe(client.ip);
    expect(rows[0]?.userAgent).toContain('Chrome');

    expect((await client.request('GET', '/api/v1/session')).json().termsPending).toEqual([]);
    const free = await client.request('PUT', '/api/v1/me/profile/avatar', {
      payload: { imageId: null },
    });
    expect(free.statusCode).toBe(200);
  });

  it('versão nova com requires_reacceptance volta a travar; sair continua liberado', async () => {
    const termsV2 = await publish('terms', true);
    const client = browser();
    const login = await client.login(veteran.email);
    expect(login.json().termsPending).toEqual([
      expect.objectContaining({ id: termsV2, document: 'terms', version: 2 }),
    ]);
    expect((await client.request('POST', '/api/v1/auth/email/resend')).statusCode).toBe(403);
    expect((await client.request('POST', '/api/v1/auth/logout')).statusCode).toBe(204);
  });

  it('POST /me/terms-acceptance sem sessão: 401; sem CSRF: 403', async () => {
    const anonymous = await browser().request('POST', '/api/v1/me/terms-acceptance', {
      payload: { termsVersionIds: [termsV1] },
    });
    expect(anonymous.statusCode).toBe(401);
    const client = browser();
    await client.login(veteran.email);
    const noCsrf = await client.request('POST', '/api/v1/me/terms-acceptance', {
      payload: { termsVersionIds: [termsV1] },
      csrf: false,
    });
    expect(noCsrf.json()).toMatchObject({ code: 'csrf_token_invalid' });
  });
});
