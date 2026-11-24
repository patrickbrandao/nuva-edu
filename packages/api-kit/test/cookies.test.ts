import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COOKIE_ATTRIBUTES,
  clearApiCookie,
  cookieName,
  readApiCookie,
  setApiCookie,
} from '../src/index.ts';
import { buildPhase1App } from './phase1-helpers.ts';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setCookieHeader(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

describe('cookies (spec 007, "Cookies")', () => {
  it('nomes por site e tipo', () => {
    expect(cookieName('admin', 'session')).toBe('nuva_admin_session');
    expect(cookieName('classroom', 'session')).toBe('nuva_classroom_session');
    expect(cookieName('admin', 'oauth')).toBe('nuva_admin_oauth');
    expect(cookieName('classroom', 'oauth')).toBe('nuva_classroom_oauth');
  });

  it('atributos da sessão e do retorno, sem Domain', () => {
    expect(COOKIE_ATTRIBUTES.session).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(COOKIE_ATTRIBUTES.oauth).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/api/v1/auth',
    });
  });

  it('lê o cookie de sessão antes do tratador de segurança', async () => {
    const { app } = buildPhase1App();
    apps.push(app);
    const ok = await app.inject({
      url: '/api/v1/session',
      headers: { cookie: 'nuva_admin_session=abc; outro=1' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ userId: 'abc' });
    const without = await app.inject({ url: '/api/v1/session' });
    expect(without.statusCode).toBe(401);
  });

  it('grava a sessão com SameSite=Lax e Path=/ e o retorno assinado com SameSite=None', async () => {
    const { app } = buildPhase1App(
      {},
      {
        getSession: () => (_request, reply) => {
          setApiCookie(reply, 'admin', 'session', 'sessao-1', { maxAgeSeconds: 2_592_000 });
          setApiCookie(reply, 'admin', 'oauth', '{"state":"s"}', { maxAgeSeconds: 600 });
          return { userId: 'u1' };
        },
      },
    );
    apps.push(app);
    const response = await app.inject({
      url: '/api/v1/session',
      headers: { cookie: 'nuva_admin_session=u1' },
    });
    const cookies = setCookieHeader(response.headers['set-cookie']);
    const session = cookies.find((line) => line.startsWith('nuva_admin_session='));
    const oauth = cookies.find((line) => line.startsWith('nuva_admin_oauth='));
    expect(session).toBe(
      'nuva_admin_session=sessao-1; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax',
    );
    expect(oauth).toMatch(
      /^nuva_admin_oauth=[^;]+; Max-Age=600; Path=\/api\/v1\/auth; HttpOnly; Secure; SameSite=None$/,
    );
    expect(session).not.toMatch(/Domain/i);
    expect(oauth).not.toMatch(/Domain/i);
  });

  it('o cookie de retorno só é lido com a assinatura certa', async () => {
    let seen: (string | null)[] = [];
    let signed = '';
    const { app } = buildPhase1App(
      {},
      {
        oauthCallback: () => (request, reply) => {
          seen.push(readApiCookie(request, 'admin', 'oauth'));
          setApiCookie(reply, 'admin', 'oauth', '{"state":"abc"}', { maxAgeSeconds: 600 });
          return reply.redirect('/', 302);
        },
      },
    );
    apps.push(app);
    const first = await app.inject({ url: '/api/v1/auth/google/callback' });
    const line = setCookieHeader(first.headers['set-cookie'])[0] ?? '';
    signed = line.slice('nuva_admin_oauth='.length, line.indexOf(';'));
    expect(seen).toEqual([null]);

    seen = [];
    await app.inject({
      url: '/api/v1/auth/google/callback',
      headers: { cookie: `nuva_admin_oauth=${signed}` },
    });
    const tampered = signed.replace('abc', 'abd');
    await app.inject({
      url: '/api/v1/auth/google/callback',
      headers: { cookie: `nuva_admin_oauth=${tampered}` },
    });
    await app.inject({
      url: '/api/v1/auth/google/callback',
      headers: { cookie: `nuva_admin_oauth=${encodeURIComponent('{"state":"abc"}')}` },
    });
    expect(seen).toEqual(['{"state":"abc"}', null, null]);
  });

  it('apagar usa o mesmo Path da gravação', async () => {
    const { app } = buildPhase1App(
      {},
      {
        oauthCallback: () => (_request, reply) => {
          clearApiCookie(reply, 'admin', 'oauth');
          clearApiCookie(reply, 'admin', 'session');
          return reply.redirect('/', 302);
        },
      },
    );
    apps.push(app);
    const response = await app.inject({ url: '/api/v1/auth/apple/callback' });
    const cookies = setCookieHeader(response.headers['set-cookie']);
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/^nuva_admin_oauth=; Max-Age=0; Path=\/api\/v1\/auth;/);
    expect(cookies[1]).toMatch(/^nuva_admin_session=; Max-Age=0; Path=\/;/);
  });

  it('cookie de retorno sem cookieSecret lança; segredo curto impede a subida', async () => {
    const { app } = buildPhase1App(
      { withoutCookieSecret: true },
      {
        getSession: () => (_request, reply) => {
          setApiCookie(reply, 'admin', 'oauth', 'x', { maxAgeSeconds: 600 });
          return { userId: 'u1' };
        },
      },
    );
    apps.push(app);
    const response = await app.inject({
      url: '/api/v1/session',
      headers: { cookie: 'nuva_admin_session=u1' },
    });
    expect(response.statusCode).toBe(500);
    expect(() => buildPhase1App({ cookieSecret: 'curto' })).toThrow(/32 caracteres/);
  });

  it('validade precisa ser um inteiro positivo', async () => {
    const { app } = buildPhase1App(
      {},
      {
        getSession: () => (_request, reply) => {
          setApiCookie(reply, 'admin', 'session', 'x', { maxAgeSeconds: 0 });
          return { userId: 'u1' };
        },
      },
    );
    apps.push(app);
    const response = await app.inject({
      url: '/api/v1/session',
      headers: { cookie: 'nuva_admin_session=u1' },
    });
    expect(response.statusCode).toBe(500);
  });
});
