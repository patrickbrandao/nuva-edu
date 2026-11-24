import {
  ConfigError,
  EMAIL_TYPES,
  type EmailDataByType,
  type EmailType,
  loadConfig,
} from '@nuva-edu/core';
import { describe, expect, it } from 'vitest';
import { classifySmtpError, smtpTransportOptions } from '../src/email/smtp.ts';
import { escapeHtml, renderEmail } from '../src/email/templates.ts';
import { workerRequiredSecrets } from '../src/secrets.ts';

const TOKEN = 'a'.repeat(43);
const CLASSROOM = 'https://classroom.escola.test';
const ADMIN = 'https://edu-admin.escola.test';

const SAMPLE_DATA: { [T in EmailType]: EmailDataByType[T] } = {
  'account.verify_email': {},
  'account.password_reset': {},
  'account.exists': {},
  'account.new_login': {
    at: '2026-11-24T15:30:00.000Z',
    ip: '203.0.113.7',
    browser: 'Firefox',
    os: null,
    site: 'admin',
  },
  'account.locked': { until: '2026-11-24T15:45:00.000Z' },
  'account.password_changed': { by: 'admin' },
  'account.role_changed': { role: 'manager' },
  'moderation.suspended': { kind: 'posting', endsAt: null },
};

function render<T extends EmailType>(type: T, data: EmailDataByType[T] = SAMPLE_DATA[type]) {
  return renderEmail({
    type,
    data,
    locale: 'pt-BR',
    recipientName: 'Ana <b>',
    school: {
      name: 'Escola & Cia',
      timezone: 'America/Sao_Paulo',
      accentColor: null,
      logoUrl: null,
    },
    classroomUrl: CLASSROOM,
    adminUrl: ADMIN,
    token: EMAIL_TYPES[type].tokenPurpose === null ? null : TOKEN,
  });
}

describe('modelos de e-mail', () => {
  it.each(Object.keys(EMAIL_TYPES) as EmailType[])('%s monta assunto, texto e HTML', (type) => {
    const email = render(type);
    expect(email.subject).toContain('Escola & Cia');
    expect(email.text).toContain('Olá, Ana <b>.');
    expect(email.html).toContain('Olá, Ana &lt;b&gt;.');
    expect(email.html).not.toContain('<b>');
    for (const output of [email.subject, email.text, email.html]) {
      expect(output).not.toMatch(/undefined|null|\[object/);
    }
  });

  it('os links seguem a tabela da spec 024', () => {
    expect(render('account.verify_email').text).toContain(`${CLASSROOM}/confirmar?token=${TOKEN}`);
    expect(render('account.password_reset').text).toContain(
      `${CLASSROOM}/redefinir?token=${TOKEN}`,
    );
    const exists = render('account.exists').text;
    expect(exists).toContain(`${CLASSROOM}/entrar`);
    expect(exists).toContain(`${CLASSROOM}/redefinir`);
    expect(exists).not.toContain('token=');
    expect(render('account.new_login').text).toContain(`${CLASSROOM}/conta/acesso`);
    expect(render('account.locked').text).toContain(`${CLASSROOM}/redefinir`);
    expect(render('account.password_changed').text).toContain(`${CLASSROOM}/redefinir`);
    expect(render('account.role_changed').text).toContain(`${ADMIN}/`);
    expect(render('account.role_changed', { role: 'student' }).text).not.toContain(ADMIN);
    expect(render('moderation.suspended').text).not.toContain('http');
  });

  it('datas no fuso da escola e campos ausentes por extenso', () => {
    const login = render('account.new_login').text;
    expect(login).toContain('24/11/2026, 12:30');
    expect(login).toContain('Sistema: não identificado');
    expect(login).toContain('painel de administração');
    expect(
      render('moderation.suspended', { kind: 'full', endsAt: '2026-12-01T03:00:00.000Z' }).text,
    ).toContain('01/12/2026, 00:00');
  });

  it('tipo com token sem token emitido é erro, não link quebrado', () => {
    expect(() =>
      renderEmail({
        type: 'account.verify_email',
        data: {},
        locale: 'pt-BR',
        recipientName: 'Ana',
        school: { name: 'E', timezone: 'UTC', accentColor: null, logoUrl: null },
        classroomUrl: CLASSROOM,
        adminUrl: ADMIN,
        token: null,
      }),
    ).toThrow(/sem token/);
  });

  it('escapa HTML', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('transporte SMTP', () => {
  const base = {
    host: 'smtp.escola.test',
    port: 587,
    user: null,
    password: null,
    from: 'x <a@b.c>',
  };

  it('porta 465: TLS desde a conexão', () => {
    expect(smtpTransportOptions({ ...base, port: 465 })).toMatchObject({
      secure: true,
      requireTLS: false,
    });
  });

  it('outra porta: STARTTLS obrigatório', () => {
    expect(smtpTransportOptions(base)).toMatchObject({ secure: false, requireTLS: true });
    expect(smtpTransportOptions({ ...base, port: 1025 })).toMatchObject({ requireTLS: true });
  });

  it('só o host mailpit dispensa TLS', () => {
    expect(smtpTransportOptions({ ...base, host: 'mailpit', port: 1025 })).toMatchObject({
      secure: false,
      requireTLS: false,
    });
    expect(smtpTransportOptions({ ...base, host: 'localhost', port: 1025 })).toMatchObject({
      requireTLS: true,
    });
  });

  it('autentica só com SMTP_USER', () => {
    expect(smtpTransportOptions(base).auth).toBeUndefined();
    expect(smtpTransportOptions({ ...base, user: 'u', password: 'p' }).auth).toEqual({
      user: 'u',
      pass: 'p',
    });
  });

  it('classifica 5xx de destinatário como permanente, sem repetir a resposta do servidor', () => {
    const rejected = Object.assign(new Error('<ana@escola.test>: no such user'), {
      code: 'EENVELOPE',
      responseCode: 550,
    });
    expect(classifySmtpError(rejected)).toEqual({
      permanent: true,
      summary: 'smtp: EENVELOPE 550 (recusa permanente)',
    });
    expect(
      classifySmtpError(Object.assign(new Error('x'), { code: 'EENVELOPE', responseCode: 451 })),
    ).toEqual({
      permanent: false,
      summary: 'smtp: EENVELOPE 451',
    });
    expect(
      classifySmtpError(Object.assign(new Error('x'), { code: 'EAUTH', responseCode: 535 }))
        ?.permanent,
    ).toBe(false);
    expect(classifySmtpError(Object.assign(new Error('x'), { code: 'ECONNECTION' }))).toEqual({
      permanent: false,
      summary: 'smtp: ECONNECTION',
    });
    expect(classifySmtpError(new Error('outra coisa'))).toBeNull();
  });
});

describe('segredos na subida', () => {
  const env = { DATABASE_URL: 'postgres://u:p@localhost:5432/nuva' };

  it('SMTP_PASSWORD é exigida quando SMTP_USER existe', () => {
    const withUser = { ...env, SMTP_USER: 'worker' };
    expect(workerRequiredSecrets(withUser)).toEqual(['SMTP_PASSWORD']);
    let error: unknown;
    try {
      loadConfig({ env: withUser, required: workerRequiredSecrets(withUser) });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as ConfigError).issues.map((issue) => issue.variable)).toEqual(['SMTP_PASSWORD']);
  });

  it('sem SMTP_USER não exige senha', () => {
    expect(workerRequiredSecrets({ ...env, SMTP_USER: '  ' })).toEqual([]);
    expect(() => loadConfig({ env, required: workerRequiredSecrets(env) })).not.toThrow();
  });
});
