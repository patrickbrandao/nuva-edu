import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_SITES,
  assertCsrfToken,
  assertEmailVerified,
  assertValidPassword,
  auditContextFor,
  auditOriginFor,
  avatarUrlFor,
  deviceKeyFor,
  hashSessionToken,
  isAccountSite,
  isAuthProvider,
  isBlankPassword,
  isDomainError,
  isTermsGateExempt,
  isValidEmail,
  isValidPassword,
  normalizeEmail,
  normalizeName,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  parseUserAgent,
  passwordLength,
  passwordMatches,
  requireIp,
  SESSION_COOKIE_NAMES,
  safeTextEqual,
  sessionCookieName,
  sessionCookieOptions,
  tooManyAttempts,
} from '../src/index.ts';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';
const SAMSUNG_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const OPERA_CROS =
  'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/114.0.0.0';

describe('senha (RF-05, RNF-01, ADR 0002)', () => {
  it('aceita de 8 a 128 caracteres, contados como o PostgreSQL', () => {
    expect(isValidPassword('a'.repeat(PASSWORD_MIN_LENGTH))).toBe(true);
    expect(isValidPassword('a'.repeat(PASSWORD_MAX_LENGTH))).toBe(true);
    expect(isValidPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
    expect(isValidPassword('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toBe(false);
    // Emoji: dois code units em UTF-16, um caractere no banco.
    expect(passwordLength('😀'.repeat(8))).toBe(8);
    expect(isValidPassword('😀'.repeat(128))).toBe(true);
  });

  it('recusa senha vazia, só de espaços ou que não é texto', () => {
    expect(isBlankPassword('')).toBe(true);
    expect(isBlankPassword('          ')).toBe(true);
    expect(isBlankPassword(undefined)).toBe(true);
    expect(isBlankPassword(12345678)).toBe(true);
    expect(isValidPassword(' '.repeat(10))).toBe(false);
    expect(isValidPassword(null)).toBe(false);
  });

  it('assertValidPassword lança 400 password_invalid com o campo', () => {
    expect(() => assertValidPassword('curta', 'body.newPassword')).toThrow(
      expect.objectContaining({
        code: 'password_invalid',
        status: 400,
        errors: [expect.objectContaining({ path: 'body.newPassword' })],
      }),
    );
    expect(() => assertValidPassword('senha-boa-123')).not.toThrow();
  });

  it('passwordMatches: só confere com senha definida e enviada', () => {
    expect(passwordMatches('senha-certa', 'senha-certa')).toBe(true);
    expect(passwordMatches('senha-certa', 'senha-errada')).toBe(false);
    expect(passwordMatches('senha-certa', 'senha-cert')).toBe(false);
    expect(passwordMatches(null, '')).toBe(false);
    expect(passwordMatches(null, '   ')).toBe(false);
    expect(passwordMatches(null, 'qualquer texto')).toBe(false);
    expect(passwordMatches(undefined, 'qualquer texto')).toBe(false);
    expect(passwordMatches('', '')).toBe(false);
    expect(passwordMatches('        ', '        ')).toBe(false);
    expect(passwordMatches('senha-certa', undefined)).toBe(false);
    expect(passwordMatches('senha-certa', 42)).toBe(false);
  });

  it('safeTextEqual compara textos', () => {
    expect(safeTextEqual('abc', 'abc')).toBe(true);
    expect(safeTextEqual('abc', 'abd')).toBe(false);
    expect(safeTextEqual('abc', 'abcd')).toBe(false);
  });
});

describe('e-mail e nome', () => {
  it('normaliza e confere o formato', () => {
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com');
    expect(isValidEmail('ana@example.com')).toBe(true);
    expect(isValidEmail('admin@localhost')).toBe(true);
    expect(isValidEmail('sem-arroba')).toBe(false);
    expect(isValidEmail('a b@example.com')).toBe(false);
    expect(isValidEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });

  it('nome de 1 a 80 caracteres, sem espaços nas pontas', () => {
    expect(normalizeName('  Ana  ')).toBe('Ana');
    expect(normalizeName('   ')).toBeNull();
    expect(normalizeName('a'.repeat(81))).toBeNull();
    expect(normalizeName(42)).toBeNull();
  });
});

describe('User-Agent e dispositivo', () => {
  it.each([
    [CHROME_MAC, 'Chrome', 'macOS'],
    [SAFARI_IPHONE, 'Safari', 'iOS'],
    [FIREFOX_LINUX, 'Firefox', 'Linux'],
    [EDGE_WINDOWS, 'Edge', 'Windows'],
    [SAMSUNG_ANDROID, 'Samsung Internet', 'Android'],
    [OPERA_CROS, 'Opera', 'ChromeOS'],
  ])('%s', (userAgent, browser, os) => {
    expect(parseUserAgent(userAgent)).toEqual({ browser, os });
    expect(deviceKeyFor(userAgent)).toBe(`${browser}|${os}`);
  });

  it('sem User-Agent reconhecível', () => {
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null });
    expect(parseUserAgent('curl/8.0')).toEqual({ browser: null, os: null });
    expect(deviceKeyFor(undefined)).toBe('Outro|Outro');
  });
});

describe('contexto da requisição', () => {
  it('sites e origem da auditoria', () => {
    expect(ACCOUNT_SITES).toEqual(['classroom', 'admin']);
    expect(isAccountSite('admin')).toBe(true);
    expect(isAccountSite('mcp')).toBe(false);
    expect(auditOriginFor('admin')).toBe('admin_panel');
    expect(auditOriginFor('classroom')).toBe('classroom');
    expect(
      auditContextFor('classroom', { ip: '203.0.113.5' }, { id: 'u1', role: 'student' }),
    ).toEqual({
      origin: 'classroom',
      actorUserId: 'u1',
      actorRole: 'student',
      requestId: null,
      ip: '203.0.113.5',
      userAgent: null,
    });
  });

  it('requireIp exige um IP', () => {
    expect(requireIp(' 2001:db8::1 ')).toBe('2001:db8::1');
    expect(() => requireIp('não é ip')).toThrow(TypeError);
  });
});

describe('sessão: cookie, CSRF e termos', () => {
  it('cookie por site, com os atributos da spec', () => {
    expect(SESSION_COOKIE_NAMES).toEqual({
      classroom: 'nuva_classroom_session',
      admin: 'nuva_admin_session',
    });
    expect(sessionCookieName('admin')).toBe('nuva_admin_session');
    expect(sessionCookieOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86_400,
    });
    expect(sessionCookieOptions(7).maxAge).toBe(7 * 86_400);
    expect(hashSessionToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('CSRF: igual passa; ausente, vazio, lista ou diferente é 403 csrf_token_invalid', () => {
    const session = { csrfToken: 'token-da-sessao' };
    expect(() => assertCsrfToken(session, 'token-da-sessao')).not.toThrow();
    for (const header of [undefined, null, '', 'outro', ['token-da-sessao']]) {
      try {
        assertCsrfToken(session, header);
        expect.unreachable();
      } catch (error) {
        expect(isDomainError(error) && error.code).toBe('csrf_token_invalid');
        expect(isDomainError(error) && error.status).toBe(403);
      }
    }
  });

  it('exceções da trava dos termos', () => {
    expect(isTermsGateExempt('GET', '/api/v1/courses')).toBe(true);
    expect(isTermsGateExempt('post', '/api/v1/me/terms-acceptance')).toBe(true);
    expect(isTermsGateExempt('POST', '/api/v1/auth/logout/')).toBe(true);
    expect(isTermsGateExempt('DELETE', '/api/v1/account/sessions')).toBe(true);
    expect(isTermsGateExempt('DELETE', '/api/v1/account/sessions/abc?x=1')).toBe(true);
    expect(isTermsGateExempt('PUT', '/api/v1/account/password')).toBe(false);
    expect(isTermsGateExempt('PUT', '/api/v1/me/terms-acceptance')).toBe(false);
    expect(isTermsGateExempt('DELETE', '/api/v1/account/sessionsx')).toBe(false);
  });

  it('avatarUrl, e-mail confirmado, provedores e 429', () => {
    const id = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70';
    expect(avatarUrlFor(id)).toBe(`/api/v1/images/${id}/256.webp`);
    expect(avatarUrlFor(null)).toBeNull();
    expect(() => assertEmailVerified({ emailVerified: true })).not.toThrow();
    expect(() => assertEmailVerified({ emailVerified: false })).toThrow(
      expect.objectContaining({ code: 'email_not_verified', status: 403 }),
    );
    expect(isAuthProvider('google')).toBe(true);
    expect(isAuthProvider('github')).toBe(false);
    expect(tooManyAttempts(42)).toMatchObject({
      code: 'too_many_attempts',
      status: 429,
      extras: { retryAfterSeconds: 42 },
    });
  });
});
