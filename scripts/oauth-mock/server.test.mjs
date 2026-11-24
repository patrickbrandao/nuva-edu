// Testes do provedor OAuth simulado: um cliente de teste percorre o fluxo dos três provedores
// (autorização, decisão, troca do código com PKCE, `id_token` conferido pela JWKS, `/me`).
import assert from 'node:assert/strict';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { createOAuthMock, TEST_CLIENTS } from './server.mjs';

const PUBLIC = 'http://oauth-mock.test:8080';
const REDIRECT = 'http://classroom.localhost:8080/api/v1/auth/google/callback';
const b64url = (input) => Buffer.from(input).toString('base64url');

let server;
let origin;
let clock = Date.now();

before(async () => {
  server = createOAuthMock({ publicUrl: PUBLIC, now: () => clock });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

/** Troca o endereço público pelo local, mantendo caminho e consulta. */
const local = (url) => `${origin}${new URL(url, PUBLIC).pathname}${new URL(url, PUBLIC).search}`;

function pkce() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

function authParams(provider, extra = {}) {
  const { challenge, verifier } = pkce();
  const clientId =
    provider === 'facebook' ? TEST_CLIENTS.facebook.appId : TEST_CLIENTS[provider].clientId;
  const scope = {
    google: 'openid email profile',
    facebook: 'email,public_profile',
    apple: 'name email',
  }[provider];
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope,
    state: b64url(randomBytes(32)),
    nonce: b64url(randomBytes(16)),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(provider === 'apple' ? { response_mode: 'form_post' } : {}),
    ...extra,
  });
  return { params, verifier };
}

const AUTH_PATH = {
  google: '/google/o/oauth2/v2/auth',
  facebook: '/facebook/v27.0/dialog/oauth',
  apple: '/apple/auth/authorize',
};

/** Abre a tela de autorização e devolve os campos ocultos do formulário. */
async function openAuthorization(provider, params) {
  const res = await fetch(`${origin}${AUTH_PATH[provider]}?${params}`);
  assert.equal(res.status, 200, await res.clone().text());
  const html = await res.text();
  const hidden = new URLSearchParams();
  for (const [, name, value] of html.matchAll(
    /<input type="hidden" name="([^"]*)" value="([^"]*)">/g,
  )) {
    hidden.append(name, value.replaceAll('&amp;', '&'));
  }
  const action = html.match(/<form method="post" action="([^"]*)"/)[1];
  return { html, hidden, action };
}

async function decide(provider, params, fields = {}) {
  const { hidden, action } = await openAuthorization(provider, params);
  const body = new URLSearchParams(hidden);
  const defaults = {
    sub: 'usuario-1',
    email: 'Aluno@Example.com',
    email_verified: '1',
    name: 'Ana Maria Souza',
    decision: 'allow',
  };
  // Como o navegador: as caixas marcadas por padrão vão no formulário.
  if (provider === 'apple') defaults.first_authorization = '1';
  for (const [name, value] of Object.entries({ ...defaults, ...fields })) {
    if (value === null) body.delete(name);
    else body.set(name, value);
  }
  return fetch(local(action), { method: 'POST', body, redirect: 'manual' });
}

/** Lê o retorno: `Location` (Google, Facebook) ou o formulário do `form_post` (Apple). */
async function callback(res) {
  if (res.status === 302) {
    const url = new URL(res.headers.get('location'));
    assert.equal(`${url.origin}${url.pathname}`, REDIRECT);
    return Object.fromEntries(url.searchParams);
  }
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, new RegExp(`<form method="post" action="${REDIRECT}">`));
  const fields = {};
  for (const [, name, value] of html.matchAll(
    /<input type="hidden" name="([^"]*)" value="([^"]*)">/g,
  )) {
    fields[name] = value.replaceAll('&quot;', '"').replaceAll('&amp;', '&');
  }
  return fields;
}

async function verifyIdToken(jwt, provider) {
  const [header, payload, signature] = jwt.split('.');
  const { kid, alg } = JSON.parse(Buffer.from(header, 'base64url'));
  assert.equal(alg, 'RS256');
  const jwksPath = provider === 'google' ? '/google/oauth2/v3/certs' : '/apple/auth/keys';
  const { keys } = await (await fetch(`${origin}${jwksPath}`)).json();
  const jwk = keys.find((key) => key.kid === kid);
  assert.ok(jwk, 'kid publicado na JWKS');
  const valid = verify(
    'sha256',
    Buffer.from(`${header}.${payload}`),
    createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(signature, 'base64url'),
  );
  return { valid, claims: JSON.parse(Buffer.from(payload, 'base64url')) };
}

const halfHash = (value) => b64url(createHash('sha256').update(value).digest().subarray(0, 16));

function postForm(path, form, headers = {}) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(form),
  });
}

function googleExchange(code, verifier, extra = {}) {
  return postForm('/google/token', {
    code,
    client_id: TEST_CLIENTS.google.clientId,
    client_secret: TEST_CLIENTS.google.clientSecret,
    redirect_uri: REDIRECT,
    grant_type: 'authorization_code',
    code_verifier: verifier,
    ...extra,
  });
}

function appleClientSecret(overrides = {}) {
  const iat = Math.floor(clock / 1000);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: TEST_CLIENTS.apple.keyId }));
  const payload = b64url(
    JSON.stringify({
      iss: TEST_CLIENTS.apple.teamId,
      sub: TEST_CLIENTS.apple.clientId,
      aud: `${PUBLIC}/apple`,
      iat,
      exp: iat + 300,
      ...overrides,
    }),
  );
  return `${header}.${payload}.${b64url('assinatura-nao-conferida')}`;
}

function appleExchange(code, verifier, extra = {}) {
  return postForm('/apple/auth/token', {
    code,
    client_id: TEST_CLIENTS.apple.clientId,
    client_secret: appleClientSecret(),
    redirect_uri: REDIRECT,
    grant_type: 'authorization_code',
    code_verifier: verifier,
    ...extra,
  });
}

function facebookExchange(code, verifier, extra = {}) {
  const query = new URLSearchParams({
    client_id: TEST_CLIENTS.facebook.appId,
    client_secret: TEST_CLIENTS.facebook.appSecret,
    redirect_uri: REDIRECT,
    code,
    code_verifier: verifier,
    ...extra,
  });
  return fetch(`${origin}/facebook/v27.0/oauth/access_token?${query}`);
}

test('saúde e descoberta OpenID com os endereços públicos', async () => {
  assert.equal((await fetch(`${origin}/healthz`)).status, 200);
  const google = await (await fetch(`${origin}/google/.well-known/openid-configuration`)).json();
  assert.equal(google.issuer, `${PUBLIC}/google`);
  assert.equal(google.authorization_endpoint, `${PUBLIC}/google/o/oauth2/v2/auth`);
  assert.equal(google.token_endpoint, `${PUBLIC}/google/token`);
  assert.equal(google.jwks_uri, `${PUBLIC}/google/oauth2/v3/certs`);
  const apple = await (await fetch(`${origin}/apple/.well-known/openid-configuration`)).json();
  assert.equal(apple.issuer, `${PUBLIC}/apple`);
  assert.deepEqual(apple.response_modes_supported, ['query', 'fragment', 'form_post']);
});

test('a tela de autorização tem os campos e os botões com rótulo', async () => {
  const { params } = authParams('apple');
  const { html } = await openAuthorization('apple', params);
  for (const [id, label] of [
    ['sub', 'Identificador'],
    ['email', 'E-mail'],
    ['email_verified', 'E-mail verificado'],
    ['name', 'Nome'],
    ['hide_email', 'Ocultar e-mail (retransmissão da Apple)'],
    ['simulate', 'Simular falha'],
  ]) {
    assert.match(html, new RegExp(`<label for="${id}">${label.replace(/[()]/g, '\\$&')}</label>`));
  }
  assert.match(html, /<button type="submit" name="decision" value="allow">Autorizar<\/button>/);
  assert.match(html, /<button type="submit" name="decision" value="deny">Recusar<\/button>/);
});

describe('Google', () => {
  test('fluxo completo: código, PKCE, id_token assinado e userinfo', async () => {
    const { params, verifier } = authParams('google');
    const back = await callback(await decide('google', params));
    assert.equal(back.state, params.get('state'));
    assert.ok(back.code);

    const res = await googleExchange(back.code, verifier);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.token_type, 'Bearer');
    assert.equal(body.scope, 'openid email profile');
    const { valid, claims } = await verifyIdToken(body.id_token, 'google');
    assert.ok(valid, 'assinatura confere pela JWKS');
    assert.equal(claims.iss, `${PUBLIC}/google`);
    assert.equal(claims.aud, TEST_CLIENTS.google.clientId);
    assert.equal(claims.azp, TEST_CLIENTS.google.clientId);
    assert.equal(claims.sub, 'usuario-1');
    assert.equal(claims.email, 'aluno@example.com');
    assert.equal(claims.email_verified, true);
    assert.equal(claims.name, 'Ana Maria Souza');
    assert.equal(claims.given_name, 'Ana');
    assert.equal(claims.family_name, 'Maria Souza');
    assert.equal(claims.nonce, params.get('nonce'));
    assert.equal(claims.at_hash, halfHash(body.access_token));
    assert.ok(claims.exp > claims.iat);

    const info = await fetch(`${origin}/google/v1/userinfo`, {
      headers: { authorization: `Bearer ${body.access_token}` },
    });
    assert.equal((await info.json()).email, 'aluno@example.com');
  });

  test('e-mail não verificado vai como email_verified=false', async () => {
    const { params, verifier } = authParams('google');
    const back = await callback(await decide('google', params, { email_verified: null }));
    const body = await (await googleExchange(back.code, verifier)).json();
    const { claims } = await verifyIdToken(body.id_token, 'google');
    assert.equal(claims.email_verified, false);
  });

  test('aceita client_secret_basic', async () => {
    const { params, verifier } = authParams('google');
    const back = await callback(await decide('google', params));
    const basic = Buffer.from(
      `${TEST_CLIENTS.google.clientId}:${TEST_CLIENTS.google.clientSecret}`,
    ).toString('base64');
    const res = await postForm(
      '/google/token',
      {
        code: back.code,
        redirect_uri: REDIRECT,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      },
      { authorization: `Basic ${basic}` },
    );
    assert.equal(res.status, 200);
  });

  test('recusa devolve error=access_denied com o state', async () => {
    const { params } = authParams('google');
    const back = await callback(await decide('google', params, { decision: 'deny' }));
    assert.deepEqual(back, { error: 'access_denied', state: params.get('state') });
  });

  test('código é de uso único, e PKCE, segredo e redirect_uri são conferidos', async () => {
    const { params, verifier } = authParams('google');
    const back = await callback(await decide('google', params));
    const wrongVerifier = await googleExchange(back.code, pkce().verifier);
    assert.equal(wrongVerifier.status, 400);
    assert.equal((await wrongVerifier.json()).error, 'invalid_grant');
    // O código já foi consumido pela tentativa errada.
    assert.equal((await googleExchange(back.code, verifier)).status, 400);

    const second = authParams('google');
    const code2 = (await callback(await decide('google', second.params))).code;
    const badSecret = await googleExchange(code2, second.verifier, { client_secret: 'errado' });
    assert.equal(badSecret.status, 401);
    assert.equal((await badSecret.json()).error, 'invalid_client');

    const third = authParams('google');
    const code3 = (await callback(await decide('google', third.params))).code;
    const badRedirect = await googleExchange(code3, third.verifier, {
      redirect_uri: `${REDIRECT}x`,
    });
    assert.equal((await badRedirect.json()).error, 'redirect_uri_mismatch');
  });

  test('código vencido em 10 minutos', async () => {
    const { params, verifier } = authParams('google');
    const back = await callback(await decide('google', params));
    clock += 10 * 60 * 1000 + 1;
    try {
      assert.equal((await googleExchange(back.code, verifier)).status, 400);
    } finally {
      clock = Date.now();
    }
  });

  test('simulações: state alterado, falha na troca, assinatura e nonce inválidos', async () => {
    const state = authParams('google');
    const backState = await callback(await decide('google', state.params, { simulate: 'state' }));
    assert.notEqual(backState.state, state.params.get('state'));

    const exchange = authParams('google');
    const code = (await callback(await decide('google', exchange.params, { simulate: 'exchange' })))
      .code;
    assert.equal((await googleExchange(code, exchange.verifier)).status, 500);

    const signature = authParams('google');
    const code2 = (
      await callback(await decide('google', signature.params, { simulate: 'signature' }))
    ).code;
    const signed = await (await googleExchange(code2, signature.verifier)).json();
    assert.equal((await verifyIdToken(signed.id_token, 'google')).valid, false);

    const nonce = authParams('google');
    const code3 = (await callback(await decide('google', nonce.params, { simulate: 'nonce' })))
      .code;
    const withNonce = await (await googleExchange(code3, nonce.verifier)).json();
    const { valid, claims } = await verifyIdToken(withNonce.id_token, 'google');
    assert.ok(valid);
    assert.notEqual(claims.nonce, nonce.params.get('nonce'));
  });

  test('cliente ou redirect_uri inválidos param no provedor; sem PKCE volta com erro', async () => {
    const wrongClient = authParams('google', { client_id: 'outro' });
    assert.equal((await fetch(`${origin}${AUTH_PATH.google}?${wrongClient.params}`)).status, 400);
    const noRedirect = authParams('google', { redirect_uri: 'nao-e-url' });
    assert.equal((await fetch(`${origin}${AUTH_PATH.google}?${noRedirect.params}`)).status, 400);

    const { params } = authParams('google');
    params.delete('code_challenge');
    const res = await fetch(`${origin}${AUTH_PATH.google}?${params}`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    const back = Object.fromEntries(new URL(res.headers.get('location')).searchParams);
    assert.equal(back.error, 'invalid_request');
    assert.equal(back.state, params.get('state'));
  });
});

describe('Facebook', () => {
  test('fluxo completo: código, PKCE, access_token e /me do Graph', async () => {
    const { params, verifier } = authParams('facebook');
    const back = await callback(await decide('facebook', params));
    assert.equal(back.state, params.get('state'));

    const res = await facebookExchange(back.code, verifier);
    assert.equal(res.status, 200);
    const token = await res.json();
    assert.equal(token.token_type, 'bearer');
    assert.equal(typeof token.expires_in, 'number');

    const me = await fetch(
      `${origin}/facebook/v27.0/me?fields=id,name,email,first_name&access_token=${encodeURIComponent(token.access_token)}`,
    );
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), {
      id: 'usuario-1',
      name: 'Ana Maria Souza',
      email: 'aluno@example.com',
      first_name: 'Ana',
    });
    // Sem `fields`, o Graph devolve só id e name.
    const plain = await fetch(`${origin}/facebook/v27.0/me`, {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    assert.deepEqual(await plain.json(), { id: 'usuario-1', name: 'Ana Maria Souza' });
  });

  test('sem e-mail verificado, o /me não devolve email', async () => {
    const { params, verifier } = authParams('facebook');
    const back = await callback(await decide('facebook', params, { email_verified: null }));
    const token = await (await facebookExchange(back.code, verifier)).json();
    const me = await fetch(
      `${origin}/facebook/v27.0/me?fields=id,name,email&access_token=${token.access_token}`,
    );
    assert.deepEqual(await me.json(), { id: 'usuario-1', name: 'Ana Maria Souza' });
  });

  test('recusa no formato do Facebook', async () => {
    const { params } = authParams('facebook');
    const back = await callback(await decide('facebook', params, { decision: 'deny' }));
    assert.deepEqual(back, {
      error: 'access_denied',
      error_code: '200',
      error_description: 'Permissions error',
      error_reason: 'user_denied',
      state: params.get('state'),
    });
  });

  test('erros no formato do Graph: código usado e token inválido', async () => {
    const { params, verifier } = authParams('facebook');
    const back = await callback(await decide('facebook', params));
    assert.equal((await facebookExchange(back.code, verifier)).status, 200);
    const reused = await facebookExchange(back.code, verifier);
    assert.equal(reused.status, 400);
    const { error } = await reused.json();
    assert.equal(error.type, 'OAuthException');
    assert.equal(error.code, 100);
    assert.ok(error.fbtrace_id);

    const me = await fetch(`${origin}/facebook/v27.0/me?access_token=invalido`);
    assert.equal(me.status, 400);
    assert.equal((await me.json()).error.code, 190);
  });
});

describe('Apple', () => {
  test('fluxo completo: form_post com user, troca e id_token', async () => {
    const { params, verifier } = authParams('apple', { response_type: 'code id_token' });
    const back = await callback(await decide('apple', params));
    assert.equal(back.state, params.get('state'));
    assert.deepEqual(JSON.parse(back.user), {
      name: { firstName: 'Ana', lastName: 'Maria Souza' },
      email: 'aluno@example.com',
    });
    const fromForm = await verifyIdToken(back.id_token, 'apple');
    assert.ok(fromForm.valid);
    assert.equal(fromForm.claims.c_hash, halfHash(back.code));
    assert.equal(fromForm.claims.nonce, params.get('nonce'));

    const res = await appleExchange(back.code, verifier);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.token_type, 'Bearer');
    assert.ok(body.refresh_token);
    const { valid, claims } = await verifyIdToken(body.id_token, 'apple');
    assert.ok(valid);
    assert.equal(claims.iss, `${PUBLIC}/apple`);
    assert.equal(claims.aud, TEST_CLIENTS.apple.clientId);
    assert.equal(claims.sub, 'usuario-1');
    assert.equal(claims.email, 'aluno@example.com');
    assert.equal(claims.email_verified, 'true');
    assert.equal(claims.is_private_email, 'false');
    assert.equal(claims.nonce_supported, true);
    assert.equal(claims.name, undefined, 'a Apple não põe o nome no id_token');
  });

  test('autorização seguinte não traz o campo user', async () => {
    const { params } = authParams('apple');
    const back = await callback(await decide('apple', params, { first_authorization: null }));
    assert.equal(back.user, undefined);
    assert.ok(back.code);
    assert.equal(back.id_token, undefined, 'response_type=code não traz id_token no form_post');
  });

  test('e-mail oculto: endereço de retransmissão, verificado e privado', async () => {
    const { params, verifier } = authParams('apple');
    const back = await callback(
      await decide('apple', params, { hide_email: '1', email_verified: null }),
    );
    const relay = JSON.parse(back.user).email;
    assert.match(relay, /^[a-z]{10}@privaterelay\.appleid\.com$/);
    const body = await (await appleExchange(back.code, verifier)).json();
    const { claims } = await verifyIdToken(body.id_token, 'apple');
    assert.equal(claims.email, relay);
    assert.equal(claims.email_verified, 'true');
    assert.equal(claims.is_private_email, 'true');
    // O mesmo usuário recebe sempre o mesmo endereço.
    const again = authParams('apple');
    const back2 = await callback(await decide('apple', again.params, { hide_email: '1' }));
    assert.equal(JSON.parse(back2.user).email, relay);
  });

  test('e-mail não verificado vai como "false"', async () => {
    const { params, verifier } = authParams('apple');
    const back = await callback(await decide('apple', params, { email_verified: null }));
    const body = await (await appleExchange(back.code, verifier)).json();
    assert.equal((await verifyIdToken(body.id_token, 'apple')).claims.email_verified, 'false');
  });

  test('cancelar devolve user_cancelled_authorize por form_post', async () => {
    const { params } = authParams('apple');
    const back = await callback(await decide('apple', params, { decision: 'deny' }));
    assert.deepEqual(back, { error: 'user_cancelled_authorize', state: params.get('state') });
  });

  test('client_secret precisa ser o JWT ES256 com as declarações da equipe', async () => {
    for (const secret of [
      'texto',
      appleClientSecret({ iss: 'OUTRAEQUIPE' }),
      appleClientSecret({ exp: Math.floor(clock / 1000) - 1 }),
    ]) {
      const { params, verifier } = authParams('apple');
      const back = await callback(await decide('apple', params));
      const res = await appleExchange(back.code, verifier, { client_secret: secret });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error, 'invalid_client');
    }
  });

  test('escopo name/email sem form_post é recusado no provedor', async () => {
    const { params } = authParams('apple', { response_mode: 'query' });
    assert.equal((await fetch(`${origin}${AUTH_PATH.apple}?${params}`)).status, 400);
  });
});

test('o log só leva método e caminho', async () => {
  const lines = [];
  const logged = createOAuthMock({ publicUrl: PUBLIC, log: (line) => lines.push(line) });
  await new Promise((resolve) => logged.listen(0, '127.0.0.1', resolve));
  try {
    await fetch(`http://127.0.0.1:${logged.address().port}/facebook/v27.0/me?access_token=segredo`);
    assert.deepEqual(lines, ['GET /facebook/v27.0/me']);
  } finally {
    await new Promise((resolve) => logged.close(resolve));
  }
});
