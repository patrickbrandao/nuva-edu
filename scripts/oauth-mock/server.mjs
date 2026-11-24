#!/usr/bin/env node
// Provedor OAuth simulado (ADR 0024; specs 007, "Provedor simulado", e 031, serviço `oauth-mock`).
// Imita o necessário do Google (OpenID Connect), do Facebook (Login + Graph) e da Apple (Sign in
// with Apple, `form_post`), só com módulos do Node. Nunca usar em produção: qualquer um escolhe a
// identidade na tela de autorização.
//
// Endereços (BASE = OAUTH_MOCK_PUBLIC_URL; detalhes no README):
//   Google   BASE/google/o/oauth2/v2/auth   BASE/google/token   BASE/google/oauth2/v3/certs
//            BASE/google/v1/userinfo        BASE/google/.well-known/openid-configuration
//   Facebook BASE/facebook/vNN.N/dialog/oauth   BASE/facebook/vNN.N/oauth/access_token
//            BASE/facebook/vNN.N/me
//   Apple    BASE/apple/auth/authorize   BASE/apple/auth/token   BASE/apple/auth/keys
//            BASE/apple/.well-known/openid-configuration

import { createHash, generateKeyPairSync, randomBytes, sign, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

/**
 * Credenciais fixas de teste. São as mesmas que o core usa com `NUVA_OAUTH_MOCK_URL` definida
 * (tarefa 141). Não são segredo: só valem contra este simulador.
 */
export const TEST_CLIENTS = Object.freeze({
  google: Object.freeze({
    clientId: 'nuva-edu-mock.apps.googleusercontent.com',
    clientSecret: 'nuva-edu-mock-google-secret',
  }),
  facebook: Object.freeze({
    appId: '1000000000000001',
    appSecret: 'nuva-edu-mock-facebook-secret',
  }),
  apple: Object.freeze({
    clientId: 'br.com.tmsoft.nuva-edu.mock',
    teamId: 'NUVAEDUTM1',
    keyId: 'NUVAEDUKY1',
  }),
});

const FACEBOOK_VERSION = /^v\d+\.\d+$/;
const CODE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_S = 3600;
const APPLE_RELAY_DOMAIN = 'privaterelay.appleid.com';
const PROVIDERS = ['google', 'facebook', 'apple'];
const SIMULATIONS = {
  '': 'Nenhuma',
  state: 'Devolver o state alterado',
  exchange: 'Falhar a troca do código (erro do provedor)',
  signature: 'id_token com assinatura inválida',
  nonce: 'id_token com nonce diferente',
};

const b64url = (input) => Buffer.from(input).toString('base64url');
const sha256 = (input) => createHash('sha256').update(input).digest();
/** `at_hash` e `c_hash` (OpenID Connect Core 3.1.3.6): metade esquerda do SHA-256, base64url. */
const halfHash = (value) => b64url(sha256(value).subarray(0, 16));
const token = (bytes = 32) => randomBytes(bytes).toString('base64url');

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}

function newSigningKey() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = token(8);
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  return { kid, privateKey, jwk };
}

function signJwt(payload, key, signingKey = key.privateKey) {
  const header = b64url(JSON.stringify({ alg: 'RS256', kid: key.kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = sign('sha256', Buffer.from(`${header}.${body}`), signingKey);
  return `${header}.${body}.${b64url(signature)}`;
}

function decodeJwt(jwt) {
  const parts = String(jwt).split('.');
  if (parts.length !== 3) return null;
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
      payload: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
    };
  } catch {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error('corpo grande demais'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'cache-control': 'no-store', ...headers });
  res.end(body);
}

const sendJson = (res, status, value, headers = {}) =>
  send(res, status, JSON.stringify(value), {
    'content-type': 'application/json; charset=utf-8',
    ...headers,
  });

const sendHtml = (res, status, html) =>
  send(res, status, html, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy':
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action *",
    'x-frame-options': 'DENY',
  });

function page(title, content) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;color:#111;background:#fff}
label{display:block;margin:.75rem 0 .25rem}input[type=text],input[type=email],select{width:100%;padding:.4rem;box-sizing:border-box}
.check{display:flex;gap:.5rem;align-items:center}.check label{margin:0}
.actions{display:flex;gap:.75rem;margin-top:1.25rem}button{padding:.5rem 1rem}
.note{color:#555;font-size:.9rem}code{background:#f2f2f2;padding:0 .2rem}
</style>
</head>
<body>
${content}
</body>
</html>`;
}

function errorPage(res, status, message) {
  sendHtml(
    res,
    status,
    page(
      'Erro de autorização',
      `<h1>Erro de autorização</h1><p role="alert">${escapeHtml(message)}</p>`,
    ),
  );
}

/** Página que reenvia por `POST` ao `redirect_uri`, como a Apple faz com `response_mode=form_post`. */
function formPostPage(action, fields) {
  const inputs = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('\n');
  return page(
    'Retornando ao site',
    `<form method="post" action="${escapeHtml(action)}">
${inputs}
<noscript><button type="submit">Continuar</button></noscript>
</form>
<script>document.forms[0].submit()</script>`,
  );
}

function redirectWith(res, redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(name, value);
  }
  send(res, 302, '', { location: url.toString() });
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.hash;
  } catch {
    return false;
  }
}

/** Identificador estável de retransmissão da Apple para um par (cliente, usuário). */
function appleRelayEmail(clientId, sub) {
  const local = createHash('sha256')
    .update(`${clientId}:${sub}`)
    .digest('hex')
    .replace(/[^a-z]/g, '')
    .slice(0, 10)
    .padEnd(10, 'x');
  return `${local}@${APPLE_RELAY_DOMAIN}`;
}

function splitName(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

/**
 * Cria o servidor HTTP do simulador (sem escutar porta).
 * @param {{ publicUrl: string, now?: () => number, log?: (line: string) => void }} options
 */
export function createOAuthMock({ publicUrl, now = Date.now, log = () => {} }) {
  const base = String(publicUrl).replace(/\/+$/, '');
  const issuer = { google: `${base}/google`, apple: `${base}/apple` };
  const keys = { google: newSigningKey(), apple: newSigningKey() };
  // Chave que ninguém publica, para o caso "assinatura inválida".
  const rogueKey = newSigningKey().privateKey;
  const codes = new Map();
  const accessTokens = new Map();
  const seconds = () => Math.floor(now() / 1000);

  function purge() {
    const at = now();
    for (const [code, entry] of codes) if (entry.expiresAt <= at) codes.delete(code);
    for (const [value, entry] of accessTokens)
      if (entry.expiresAt <= at) accessTokens.delete(value);
  }

  function discovery(provider) {
    const iss = issuer[provider];
    if (provider === 'google') {
      return {
        issuer: iss,
        authorization_endpoint: `${iss}/o/oauth2/v2/auth`,
        token_endpoint: `${iss}/token`,
        userinfo_endpoint: `${iss}/v1/userinfo`,
        jwks_uri: `${iss}/oauth2/v3/certs`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        scopes_supported: ['openid', 'email', 'profile'],
        token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
        claims_supported: [
          'aud',
          'email',
          'email_verified',
          'exp',
          'family_name',
          'given_name',
          'iat',
          'iss',
          'name',
          'sub',
        ],
        code_challenge_methods_supported: ['S256'],
        grant_types_supported: ['authorization_code'],
      };
    }
    return {
      issuer: iss,
      authorization_endpoint: `${iss}/auth/authorize`,
      token_endpoint: `${iss}/auth/token`,
      jwks_uri: `${iss}/auth/keys`,
      response_types_supported: ['code', 'code id_token'],
      response_modes_supported: ['query', 'fragment', 'form_post'],
      subject_types_supported: ['pairwise'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'email', 'name'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
      claims_supported: [
        'aud',
        'email',
        'email_verified',
        'exp',
        'iat',
        'is_private_email',
        'iss',
        'nonce',
        'nonce_supported',
        'real_user_status',
        'sub',
        'transfer_sub',
      ],
    };
  }

  function clientIdOf(provider) {
    return provider === 'facebook' ? TEST_CLIENTS.facebook.appId : TEST_CLIENTS[provider].clientId;
  }

  /**
   * Confere os parâmetros da autorização. Cliente ou `redirect_uri` inválidos não voltam ao site
   * (como nos provedores reais, a tela de erro fica no provedor); os demais erros voltam.
   */
  function validateAuthorization(provider, params) {
    const redirectUri = params.get('redirect_uri') ?? '';
    if (params.get('client_id') !== clientIdOf(provider)) {
      return { fatal: `client_id desconhecido para ${provider}.` };
    }
    if (!isHttpUrl(redirectUri)) return { fatal: 'redirect_uri ausente ou inválido.' };
    const responseType = (params.get('response_type') ?? 'code').split(' ').sort().join(' ');
    const allowed = provider === 'apple' ? ['code', 'code id_token'] : ['code'];
    if (!allowed.includes(responseType)) {
      return { redirectUri, error: 'unsupported_response_type' };
    }
    const scopes = (params.get('scope') ?? '').split(/[\s,]+/).filter(Boolean);
    const responseMode = params.get('response_mode') ?? 'query';
    if (provider === 'apple' && (scopes.includes('name') || scopes.includes('email'))) {
      if (responseMode !== 'form_post') {
        return { fatal: 'response_mode deve ser form_post quando o escopo pede name ou email.' };
      }
    }
    if (provider === 'google' && !scopes.includes('openid')) {
      return { redirectUri, error: 'invalid_scope', description: 'Missing required scope: openid' };
    }
    // O simulador exige PKCE S256: o código do projeto sempre o envia (spec 007, "Fluxo do provedor").
    const challenge = params.get('code_challenge') ?? '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || params.get('code_challenge_method') !== 'S256') {
      return {
        redirectUri,
        error: 'invalid_request',
        description: 'code_challenge (S256) é obrigatório no simulador',
      };
    }
    return { redirectUri, responseType, responseMode, scopes, challenge };
  }

  function returnError(res, provider, redirectUri, responseMode, state, error, description) {
    if (provider === 'apple' && responseMode === 'form_post') {
      sendHtml(res, 200, formPostPage(redirectUri, { error, state }));
      return;
    }
    redirectWith(res, redirectUri, { error, error_description: description, state });
  }

  function authorizationPage(provider, params) {
    const hidden = [...params.entries()]
      .map(
        ([name, value]) =>
          `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
      )
      .join('\n');
    const label = { google: 'Google', facebook: 'Facebook', apple: 'Apple' }[provider];
    const defaultSub = {
      google: '100000000000000000001',
      facebook: '10000000000001',
      apple: '000001.mock.0001',
    }[provider];
    const simulations = Object.entries(SIMULATIONS)
      .filter(([value]) => provider !== 'facebook' || !['signature', 'nonce'].includes(value))
      .map(([value, text]) => `<option value="${value}">${escapeHtml(text)}</option>`)
      .join('');
    const appleFields =
      provider === 'apple'
        ? `<div class="check"><input type="checkbox" id="hide_email" name="hide_email" value="1">
<label for="hide_email">Ocultar e-mail (retransmissão da Apple)</label></div>
<div class="check"><input type="checkbox" id="first_authorization" name="first_authorization" value="1" checked>
<label for="first_authorization">Primeira autorização (envia o campo user)</label></div>`
        : '';
    const facebookNote =
      provider === 'facebook'
        ? '<p class="note">Facebook: sem "e-mail verificado" (ou sem e-mail), o <code>/me</code> não devolve <code>email</code>.</p>'
        : '';
    return page(
      `${label} (simulado)`,
      `<h1>Entrar com ${label} (simulado)</h1>
<p class="note">Provedor OAuth simulado do nuva-edu. Escolha a identidade devolvida ao site.</p>
<form method="post" action="${escapeHtml(`${base}/${provider}/__decision`)}">
${hidden}
<label for="sub">Identificador</label>
<input type="text" id="sub" name="sub" value="${defaultSub}" required>
<label for="email">E-mail</label>
<input type="email" id="email" name="email" value="aluno@example.com">
<div class="check"><input type="checkbox" id="email_verified" name="email_verified" value="1" checked>
<label for="email_verified">E-mail verificado</label></div>
<label for="name">Nome</label>
<input type="text" id="name" name="name" value="Aluno Teste">
${appleFields}
${facebookNote}
<label for="simulate">Simular falha</label>
<select id="simulate" name="simulate">${simulations}</select>
<div class="actions">
<button type="submit" name="decision" value="allow">Autorizar</button>
<button type="submit" name="decision" value="deny">Recusar</button>
</div>
</form>`,
    );
  }

  async function handleDecision(req, res, provider) {
    const form = new URLSearchParams(await readBody(req));
    const checked = validateAuthorization(provider, form);
    if (checked.fatal) return errorPage(res, 400, checked.fatal);
    const { redirectUri, responseMode = 'query' } = checked;
    const simulate = form.get('simulate') ?? '';
    const originalState = form.get('state') ?? undefined;
    const state =
      simulate === 'state' && originalState !== undefined ? `${originalState}x` : originalState;
    if (checked.error) {
      return returnError(
        res,
        provider,
        redirectUri,
        responseMode,
        state,
        checked.error,
        checked.description,
      );
    }
    if (form.get('decision') !== 'allow') {
      if (provider === 'facebook') {
        return redirectWith(res, redirectUri, {
          error: 'access_denied',
          error_code: '200',
          error_description: 'Permissions error',
          error_reason: 'user_denied',
          state,
        });
      }
      // A Apple devolve `user_cancelled_authorize` quando a pessoa cancela.
      const error = provider === 'apple' ? 'user_cancelled_authorize' : 'access_denied';
      return returnError(res, provider, redirectUri, responseMode, state, error);
    }

    const sub = (form.get('sub') ?? '').trim();
    if (!sub) return errorPage(res, 400, 'Informe o identificador.');
    const name = (form.get('name') ?? '').trim();
    let email = (form.get('email') ?? '').trim().toLowerCase();
    let emailVerified = form.get('email_verified') === '1';
    let isPrivateEmail = false;
    if (provider === 'apple' && form.get('hide_email') === '1') {
      email = appleRelayEmail(TEST_CLIENTS.apple.clientId, sub);
      emailVerified = true;
      isPrivateEmail = true;
    }
    const identity = { sub, name, email, emailVerified, isPrivateEmail };

    const code = `${provider.slice(0, 1)}.${token()}`;
    codes.set(code, {
      provider,
      clientId: form.get('client_id'),
      redirectUri,
      challenge: checked.challenge,
      nonce: form.get('nonce') ?? undefined,
      scopes: checked.scopes,
      identity,
      simulate,
      authTime: seconds(),
      expiresAt: now() + CODE_TTL_MS,
    });

    if (provider !== 'apple') return redirectWith(res, redirectUri, { code, state });

    // Apple: o campo `user` só vem na primeira autorização do par (cliente, usuário).
    const first = form.get('first_authorization') === '1';
    const wantsName = checked.scopes.includes('name');
    const wantsEmail = checked.scopes.includes('email');
    let user;
    if (first && (wantsName || wantsEmail)) {
      const { first: firstName, last: lastName } = splitName(name);
      user = JSON.stringify({
        ...(wantsName && name ? { name: { firstName, lastName } } : {}),
        ...(wantsEmail && email ? { email } : {}),
      });
    }
    const idToken = checked.responseType.includes('id_token')
      ? appleIdToken(codes.get(code), { c_hash: halfHash(code) })
      : undefined;
    if (responseMode === 'form_post') {
      return sendHtml(
        res,
        200,
        formPostPage(redirectUri, { code, state, id_token: idToken, user }),
      );
    }
    return redirectWith(res, redirectUri, { code, state, id_token: idToken, user });
  }

  function idTokenFor(entry, extra) {
    const iat = seconds();
    return {
      iss: issuer[entry.provider],
      aud: entry.clientId,
      sub: entry.identity.sub,
      iat,
      exp: iat + TOKEN_TTL_S,
      auth_time: entry.authTime,
      ...(entry.nonce !== undefined
        ? { nonce: entry.simulate === 'nonce' ? `${entry.nonce}x` : entry.nonce }
        : {}),
      ...extra,
    };
  }

  function signFor(entry, payload) {
    const key = keys[entry.provider];
    return signJwt(payload, key, entry.simulate === 'signature' ? rogueKey : key.privateKey);
  }

  function googleIdToken(entry, accessToken) {
    const { identity, scopes } = entry;
    const { first, last } = splitName(identity.name);
    const claims = idTokenFor(entry, {
      azp: entry.clientId,
      at_hash: halfHash(accessToken),
      ...(scopes.includes('email') && identity.email
        ? { email: identity.email, email_verified: identity.emailVerified }
        : {}),
      ...(scopes.includes('profile') && identity.name
        ? { name: identity.name, given_name: first, ...(last ? { family_name: last } : {}) }
        : {}),
    });
    return signFor(entry, claims);
  }

  /** A Apple manda `email_verified` e `is_private_email` como texto (`"true"`/`"false"`). */
  function appleIdToken(entry, hashes) {
    const { identity, scopes } = entry;
    const claims = idTokenFor(entry, {
      ...hashes,
      nonce_supported: true,
      real_user_status: 2,
      ...(scopes.includes('email') && identity.email
        ? {
            email: identity.email,
            email_verified: String(identity.emailVerified),
            is_private_email: String(identity.isPrivateEmail),
          }
        : {}),
    });
    return signFor(entry, claims);
  }

  function pkceMatches(entry, verifier) {
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier ?? '')) return false;
    return safeEqual(b64url(sha256(verifier)), entry.challenge);
  }

  /** Consome o código (uso único) e confere cliente, `redirect_uri` e PKCE. */
  function redeem(provider, form) {
    purge();
    const code = form.get('code') ?? '';
    const entry = codes.get(code);
    codes.delete(code);
    if (!entry || entry.provider !== provider) return { error: 'code' };
    if (entry.clientId !== form.get('client_id')) return { error: 'code' };
    if (entry.redirectUri !== form.get('redirect_uri')) return { error: 'redirect_uri' };
    if (!pkceMatches(entry, form.get('code_verifier'))) return { error: 'pkce' };
    return { entry };
  }

  function issueAccessToken(entry) {
    const value = `${entry.provider.slice(0, 2)}.${token()}`;
    accessTokens.set(value, {
      provider: entry.provider,
      identity: entry.identity,
      scopes: entry.scopes,
      expiresAt: now() + TOKEN_TTL_S * 1000,
    });
    return value;
  }

  function basicCredentials(req) {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Basic ')) return {};
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const at = decoded.indexOf(':');
    if (at < 0) return {};
    return {
      clientId: decodeURIComponent(decoded.slice(0, at)),
      clientSecret: decodeURIComponent(decoded.slice(at + 1)),
    };
  }

  async function googleToken(req, res) {
    const form = new URLSearchParams(await readBody(req));
    const basic = basicCredentials(req);
    if (basic.clientId) {
      form.set('client_id', basic.clientId);
      form.set('client_secret', basic.clientSecret);
    }
    if (
      form.get('client_id') !== TEST_CLIENTS.google.clientId ||
      !safeEqual(form.get('client_secret') ?? '', TEST_CLIENTS.google.clientSecret)
    ) {
      return sendJson(res, 401, { error: 'invalid_client', error_description: 'Unauthorized' });
    }
    if (form.get('grant_type') !== 'authorization_code') {
      return sendJson(res, 400, {
        error: 'unsupported_grant_type',
        error_description: 'Invalid grant_type',
      });
    }
    const { entry, error } = redeem('google', form);
    if (error === 'redirect_uri') {
      return sendJson(res, 400, {
        error: 'redirect_uri_mismatch',
        error_description: 'Bad Request',
      });
    }
    if (error === 'pkce') {
      return sendJson(res, 400, {
        error: 'invalid_grant',
        error_description: 'Invalid code verifier.',
      });
    }
    if (error)
      return sendJson(res, 400, { error: 'invalid_grant', error_description: 'Bad Request' });
    if (entry.simulate === 'exchange') {
      return sendJson(res, 500, { error: 'internal_failure', error_description: 'Backend Error' });
    }
    const accessToken = issueAccessToken(entry);
    return sendJson(res, 200, {
      access_token: accessToken,
      expires_in: TOKEN_TTL_S - 1,
      scope: entry.scopes.join(' '),
      token_type: 'Bearer',
      id_token: googleIdToken(entry, accessToken),
    });
  }

  function appleClientSecretValid(value) {
    const decoded = decodeJwt(value);
    if (!decoded) return false;
    const { header, payload } = decoded;
    // A assinatura (ES256, chave .p8 do desenvolvedor) não é conferida: o core pode usar uma
    // chave qualquer gerada na subida. Conferem-se o algoritmo, o `kid` e as declarações.
    const t = seconds();
    return (
      header.alg === 'ES256' &&
      header.kid === TEST_CLIENTS.apple.keyId &&
      payload.iss === TEST_CLIENTS.apple.teamId &&
      payload.sub === TEST_CLIENTS.apple.clientId &&
      (payload.aud === issuer.apple || payload.aud === 'https://appleid.apple.com') &&
      Number.isInteger(payload.iat) &&
      Number.isInteger(payload.exp) &&
      payload.exp > t &&
      payload.iat <= t + 60 &&
      payload.exp - payload.iat <= 15_777_000
    );
  }

  async function appleToken(req, res) {
    const form = new URLSearchParams(await readBody(req));
    if (
      form.get('client_id') !== TEST_CLIENTS.apple.clientId ||
      !appleClientSecretValid(form.get('client_secret'))
    ) {
      return sendJson(res, 400, { error: 'invalid_client' });
    }
    if (form.get('grant_type') !== 'authorization_code') {
      return sendJson(res, 400, { error: 'unsupported_grant_type' });
    }
    const { entry, error } = redeem('apple', form);
    if (error) return sendJson(res, 400, { error: 'invalid_grant' });
    if (entry.simulate === 'exchange') return sendJson(res, 503, { error: 'server_error' });
    const accessToken = issueAccessToken(entry);
    return sendJson(res, 200, {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_S,
      refresh_token: `ar.${token()}`,
      id_token: appleIdToken(entry, { at_hash: halfHash(accessToken) }),
    });
  }

  const graphError = (res, status, message, code, extra = {}) =>
    sendJson(res, status, {
      error: { message, type: 'OAuthException', code, ...extra, fbtrace_id: token(9) },
    });

  function facebookToken(res, url) {
    const form = url.searchParams;
    if (
      form.get('client_id') !== TEST_CLIENTS.facebook.appId ||
      !safeEqual(form.get('client_secret') ?? '', TEST_CLIENTS.facebook.appSecret)
    ) {
      return graphError(res, 400, 'Error validating client secret.', 1);
    }
    const { entry, error } = redeem('facebook', form);
    if (error === 'redirect_uri') {
      return graphError(
        res,
        400,
        'Error validating verification code. Please make sure your redirect_uri is identical to the one you used in the OAuth dialog request',
        100,
        { error_subcode: 36008 },
      );
    }
    if (error === 'pkce') {
      return graphError(res, 400, 'Invalid code verifier', 100);
    }
    if (error) {
      return graphError(res, 400, 'This authorization code has been used.', 100, {
        error_subcode: 36009,
      });
    }
    if (entry.simulate === 'exchange') {
      return graphError(
        res,
        500,
        'An unexpected error has occurred. Please retry your request later.',
        2,
        { is_transient: true },
      );
    }
    return sendJson(res, 200, {
      access_token: issueAccessToken(entry),
      token_type: 'bearer',
      expires_in: 5_183_944,
    });
  }

  function bearer(req, url) {
    const header = req.headers.authorization ?? '';
    if (/^(Bearer|OAuth) /i.test(header)) return header.replace(/^\S+ /, '');
    return url.searchParams.get('access_token') ?? '';
  }

  function lookupAccessToken(provider, value) {
    purge();
    const entry = accessTokens.get(value);
    return entry && entry.provider === provider ? entry : null;
  }

  function facebookMe(req, res, url) {
    const entry = lookupAccessToken('facebook', bearer(req, url));
    if (!entry)
      return graphError(res, 400, 'Invalid OAuth access token - Cannot parse access token', 190);
    const { identity } = entry;
    const { first, last } = splitName(identity.name);
    const available = {
      id: identity.sub,
      name: identity.name || undefined,
      first_name: first || undefined,
      last_name: last || undefined,
      // Spec 007: o Facebook só devolve e-mail quando tem um confirmado e o escopo `email` foi dado.
      email:
        identity.email && identity.emailVerified && entry.scopes.includes('email')
          ? identity.email
          : undefined,
    };
    const fields = (url.searchParams.get('fields') ?? 'id,name')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
    const body = {};
    for (const field of fields) {
      if (field === 'picture') {
        body.picture = {
          data: { height: 50, width: 50, is_silhouette: true, url: `${base}/facebook/picture.png` },
        };
      } else if (!(field in available)) {
        return graphError(
          res,
          400,
          `(#100) Tried accessing nonexisting field (${field}) on node type (User)`,
          100,
        );
      } else if (available[field] !== undefined) {
        body[field] = available[field];
      }
    }
    body.id = identity.sub;
    return sendJson(res, 200, body);
  }

  function googleUserinfo(req, res, url) {
    const entry = lookupAccessToken('google', bearer(req, url));
    if (!entry) {
      return sendJson(
        res,
        401,
        { error: 'invalid_request', error_description: 'Invalid Credentials' },
        { 'www-authenticate': 'Bearer error="invalid_token"' },
      );
    }
    const { identity } = entry;
    const { first, last } = splitName(identity.name);
    return sendJson(res, 200, {
      sub: identity.sub,
      ...(identity.name
        ? { name: identity.name, given_name: first, ...(last ? { family_name: last } : {}) }
        : {}),
      ...(identity.email ? { email: identity.email, email_verified: identity.emailVerified } : {}),
    });
  }

  function authorize(res, provider, url) {
    const checked = validateAuthorization(provider, url.searchParams);
    if (checked.fatal) return errorPage(res, 400, checked.fatal);
    if (checked.error) {
      return returnError(
        res,
        provider,
        checked.redirectUri,
        url.searchParams.get('response_mode') ?? 'query',
        url.searchParams.get('state') ?? undefined,
        checked.error,
        checked.description,
      );
    }
    return sendHtml(res, 200, authorizationPage(provider, url.searchParams));
  }

  async function route(req, res) {
    const url = new URL(req.url ?? '/', 'http://oauth-mock.invalid');
    const { pathname } = url;
    const method = req.method ?? 'GET';
    const [, provider, ...rest] = pathname.split('/');
    const tail = `/${rest.join('/')}`;

    if (pathname === '/healthz') return sendJson(res, 200, { status: 'ok' });
    if (pathname === '/') {
      return sendJson(res, 200, {
        name: 'nuva-edu oauth-mock',
        providers: PROVIDERS,
        google: discovery('google'),
        apple: discovery('apple'),
        facebook: {
          authorization_endpoint: `${base}/facebook/v27.0/dialog/oauth`,
          token_endpoint: `${base}/facebook/v27.0/oauth/access_token`,
          me_endpoint: `${base}/facebook/v27.0/me`,
        },
      });
    }
    if (!PROVIDERS.includes(provider)) return sendJson(res, 404, { error: 'not_found' });

    if (method === 'POST' && tail === '/__decision') return handleDecision(req, res, provider);

    if (provider === 'google') {
      if (method === 'GET' && tail === '/.well-known/openid-configuration') {
        return sendJson(res, 200, discovery('google'));
      }
      if (method === 'GET' && tail === '/o/oauth2/v2/auth') return authorize(res, 'google', url);
      if (method === 'POST' && tail === '/token') return googleToken(req, res);
      if (method === 'GET' && tail === '/oauth2/v3/certs') {
        return sendJson(res, 200, { keys: [keys.google.jwk] });
      }
      if (tail === '/v1/userinfo') return googleUserinfo(req, res, url);
    }

    if (provider === 'apple') {
      if (method === 'GET' && tail === '/.well-known/openid-configuration') {
        return sendJson(res, 200, discovery('apple'));
      }
      if (method === 'GET' && tail === '/auth/authorize') return authorize(res, 'apple', url);
      if (method === 'POST' && tail === '/auth/token') return appleToken(req, res);
      if (method === 'GET' && tail === '/auth/keys') {
        return sendJson(res, 200, { keys: [keys.apple.jwk] });
      }
    }

    if (provider === 'facebook' && FACEBOOK_VERSION.test(rest[0] ?? '')) {
      const endpoint = `/${rest.slice(1).join('/')}`;
      if (method === 'GET' && endpoint === '/dialog/oauth') return authorize(res, 'facebook', url);
      if (method === 'GET' && endpoint === '/oauth/access_token') return facebookToken(res, url);
      if (method === 'GET' && endpoint === '/me') return facebookMe(req, res, url);
    }

    return sendJson(res, 404, { error: 'not_found' });
  }

  return createServer((req, res) => {
    // Só método e caminho: a consulta leva `code`, `state` e tokens, que não vão para o log.
    // A sonda de saúde do Compose fica de fora, para não encher o log.
    const path = (req.url ?? '/').split('?')[0];
    if (path !== '/healthz') log(`${req.method} ${path}`);
    route(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
      else res.end();
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 8080);
  const publicUrl = process.env.OAUTH_MOCK_PUBLIC_URL || `http://localhost:${port}`;
  const server = createOAuthMock({
    publicUrl,
    log: (line) =>
      process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), msg: line })}\n`),
  });
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(
      `${JSON.stringify({ time: new Date().toISOString(), msg: 'oauth-mock no ar', port, publicUrl })}\n`,
    );
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
