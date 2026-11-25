import { describe, expect, it } from 'vitest';
import {
  isSensitiveKey,
  NON_SENSITIVE_KEY_NAMES,
  REDACTED,
  redact,
  redactString,
  SENSITIVE_KEY_PARTS,
} from '../src/index.ts';

describe('isSensitiveKey', () => {
  it.each([
    'password',
    'Password',
    'newPassword',
    'password_confirmation',
    'token',
    'accessToken',
    'csrf-token',
    'secret',
    'clientSecret',
    'SESSION_SECRET',
    'authorization',
    'Authorization',
    'cookie',
    'set-cookie',
    'cpf',
    'cnpj',
    'document',
    'documentNumber',
    'key',
    'Key',
    'keys',
    'apiKey',
    'api_key',
    'apikey',
    'secretKey',
    'privateKey',
    'private_key',
    'accessKey',
    'accessKeyId',
    'keyId',
    'APPLE_KEY_ID',
    'mcp_key',
    'signingKey',
    'encryption_key',
    'idempotencyKey',
    'unique_key_token',
    'secretSettingKey',
    'senha',
    'credentials',
    'cardNumber',
    'cvv',
  ])('trata %s como campo proibido', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each([
    'email',
    'user_id',
    'request_id',
    'route',
    'status',
    'name',
    'duration_ms',
    'unique_key',
    'uniqueKey',
    'UNIQUE_KEY',
    'job.unique_key',
    'setting_key',
    'settingKey',
    'settings_key',
    'translation_key',
    'translationKey',
    'i18n_key',
  ])('deixa %s passar', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });

  // Spec 033: a lista obrigatória não afrouxa, nem com a exceção de `unique_key` e afins.
  const REQUIRED = [
    'password',
    'token',
    'secret',
    'authorization',
    'cookie',
    'cpf',
    'cnpj',
    'document',
    'key',
  ];

  it('mantém os nove campos da spec 033 no começo da lista', () => {
    expect(SENSITIVE_KEY_PARTS.slice(0, 9)).toEqual(REQUIRED);
  });

  it.each(REQUIRED)('campo obrigatório %s segue proibido em todas as grafias', (field) => {
    const upper = field.toUpperCase();
    const capital = `${upper.slice(0, 1)}${field.slice(1)}`;
    for (const name of [
      field,
      upper,
      capital,
      `user_${field}`,
      `new${capital}`,
      `${field}_value`,
      `${field}Hash`,
      `x-${field}`,
      `api${field}`,
    ]) {
      expect(isSensitiveKey(name), name).toBe(true);
      expect(redact({ [name]: 'valor' }), name).toEqual({ [name]: REDACTED });
      expect(redactString(`${name}=valor`), name).toBe(`${name}=${REDACTED}`);
    }
  });

  it.each(NON_SENSITIVE_KEY_NAMES)('exceção %s não perdoa outro trecho proibido', (name) => {
    expect(isSensitiveKey(name)).toBe(false);
    for (const field of REQUIRED) {
      expect(isSensitiveKey(`${name}_${field}`), `${name}_${field}`).toBe(true);
      expect(isSensitiveKey(`${field}_${name}`), `${field}_${name}`).toBe(true);
    }
  });
});

describe('redact', () => {
  it('mascara campos proibidos em qualquer profundidade, inclusive em listas', () => {
    const output = redact({
      user: { email: 'ana@example.com', password: 'abc123', profile: { cpf: '52998224725' } },
      headers: { Authorization: 'Bearer xyz', Cookie: 'sid=1', 'x-request-id': 'r1' },
      items: [{ token: 't1', ok: true }],
    });
    expect(output).toEqual({
      user: { email: 'ana@example.com', password: REDACTED, profile: { cpf: REDACTED } },
      headers: { Authorization: REDACTED, Cookie: REDACTED, 'x-request-id': 'r1' },
      items: [{ token: REDACTED, ok: true }],
    });
  });

  it('mascara o campo proibido inteiro, mesmo quando o valor é objeto, número ou vazio', () => {
    expect(redact({ password: '', token: 0, secret: { a: 1 }, key: ['a'] })).toEqual({
      password: REDACTED,
      token: REDACTED,
      secret: REDACTED,
      key: REDACTED,
    });
  });

  it('deixa passar a chave de unicidade, o nome da configuração e a chave de tradução', () => {
    const input = {
      unique_key: 'retention.purge:2026-11-24',
      uniqueKey: 'echo:42',
      setting_key: 'school.name',
      translationKey: 'checkout.title',
      apiKey: 'k-1',
      key: 'school.name',
    };
    expect(redact(input)).toEqual({
      ...input,
      apiKey: REDACTED,
      key: REDACTED,
    });
  });

  it('preserva nulo e ausente em campo proibido: não há valor a esconder', () => {
    expect(redact({ password: null, token: undefined })).toEqual({ password: null });
  });

  it('não altera o objeto original', () => {
    const input = { password: 'abc123', nested: { token: 't' } };
    redact(input);
    expect(input).toEqual({ password: 'abc123', nested: { token: 't' } });
  });

  it('devolve sempre algo serializável em JSON', () => {
    const circular: Record<string, unknown> = { name: 'a' };
    circular.self = circular;
    const shared = { n: 1 };
    const output = redact({
      circular,
      twice: [shared, shared],
      when: new Date('2026-01-02T03:04:05.000Z'),
      invalid: new Date('x'),
      big: 12n,
      bytes: Buffer.from('abc'),
      buffer: new ArrayBuffer(8),
      map: new Map<string, unknown>([
        ['a', 1],
        ['password', 'x'],
      ]),
      set: new Set(['a', undefined]),
      nan: Number.NaN,
      fn: () => 1,
      symbol: Symbol('s'),
      url: new URL('https://user:pw@example.com/x'),
    });
    expect(output).toEqual({
      circular: { name: 'a', self: '[Circular]' },
      twice: [{ n: 1 }, { n: 1 }],
      when: '2026-01-02T03:04:05.000Z',
      invalid: null,
      big: '12',
      bytes: '[3 bytes]',
      buffer: '[8 bytes]',
      map: { a: 1, password: REDACTED },
      set: ['a', null],
      nan: 'NaN',
      url: `https://user:${REDACTED}@example.com/x`,
    });
    expect(() => JSON.stringify(output)).not.toThrow();
  });

  it('corta estruturas profundas demais', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 20; index += 1) {
      deep = { child: deep };
    }
    expect(JSON.stringify(redact(deep))).toContain('[Truncated]');
  });

  it('serializa erros com pilha, causa e campos próprios, mascarando os proibidos', () => {
    const error = Object.assign(new Error('falhou', { cause: new Error('origem') }), {
      code: 'E_X',
      token: 'abc',
      ignored: undefined,
    });
    const output = redact(error) as Record<string, unknown>;
    expect(output).toMatchObject({
      type: 'Error',
      message: 'falhou',
      code: 'E_X',
      token: REDACTED,
      cause: { type: 'Error', message: 'origem' },
    });
    expect(output.stack).toContain('redact.test.ts');
    expect(output).not.toHaveProperty('ignored');
  });

  it('esconde detail e where de erros do PostgreSQL, que reproduzem valores das linhas', () => {
    const error = Object.assign(new Error('null value in column "name" violates not-null'), {
      severity: 'ERROR',
      code: '23502',
      detail: 'Failing row contains (1, ana@example.com, abc123, null).',
      where: 'PL/pgSQL function f() line 3',
      table: 'users',
      routine: 'ExecConstraints',
    });
    const output = redact({ err: error });
    expect(JSON.stringify(output)).not.toContain('abc123');
    expect(output).toMatchObject({
      err: { code: '23502', table: 'users', detail: REDACTED, where: REDACTED },
    });
  });
});

describe('redactString', () => {
  it.each([
    ['postgres://nuva:s3nh4@db:5432/nuva_edu', `postgres://nuva:${REDACTED}@db:5432/nuva_edu`],
    ['Authorization: Bearer abc.def-123', `Authorization: ${REDACTED} ${REDACTED}`],
    ['enviado com Bearer abc.def-123', `enviado com Bearer ${REDACTED}`],
    ['Basic dXNlcjpwYXNz foi recusado', `Basic ${REDACTED} foi recusado`],
    ['GET /reset?token=abc123&next=/home', `GET /reset?token=${REDACTED}&next=/home`],
    ['login com password=abc123 falhou', `login com password=${REDACTED} falhou`],
    [
      'corpo {"password":"abc 123","email":"a@b.c"}',
      `corpo {"password":${REDACTED},"email":"a@b.c"}`,
    ],
    ["senha: 'abc 123' recusada", `senha: ${REDACTED} recusada`],
    ['api_key=k-1; x', `api_key=${REDACTED}; x`],
    ['key=abc123', `key=${REDACTED}`],
    ['{"privateKey":"abc"}', `{"privateKey":${REDACTED}}`],
    ['unique_key=a:1 e secret_key=s3', `unique_key=a:1 e secret_key=${REDACTED}`],
    ['CPF 529.982.247-25 inválido', `CPF ${REDACTED} inválido`],
    ['CNPJ 11.222.333/0001-81 inválido', `CNPJ ${REDACTED} inválido`],
    ['CNPJ 12.ABC.345/01DE-35 inválido', `CNPJ ${REDACTED} inválido`],
    ['aluno 52998224725 criado', `aluno ${REDACTED} criado`],
    ['empresa 11222333000181 criada', `empresa ${REDACTED} criada`],
    // A busca ancorada no `://` e no início da sequência não pode perder estes (tarefa 325).
    ['1http://u:p@h e x+y://v:q@h', `1http://u:${REDACTED}@h e x+y://v:${REDACTED}@h`],
    ['a=password=abc&b=1', `a=password=${REDACTED}&b=1`],
    ['x.y-z.ApiKey: abc e TOKEN="t"', `x.y-z.ApiKey: ${REDACTED} e TOKEN=${REDACTED}`],
    ['password="a"token=b', `password=${REDACTED}token=${REDACTED}`],
  ])('mascara "%s"', (input, expected) => {
    expect(redactString(input)).toBe(expected);
  });

  it.each([
    'pedido 12345678901 pago',
    'lote 11111111111',
    'evento 11222333000199 recebido',
    'at tokenize (/app/src/tokenize.ts:10:5)',
    'id 019aa3f2-7b1c-7e55-9a10-52998224725a',
    'duplicate key value violates unique constraint "settings_key_unique"',
    'levou 0.52998224725 s',
    'tarefa com unique_key=retention.purge:2026-11-24 já existe',
    '{"uniqueKey":"echo:42","setting_key":"school.name"}',
    'translation_key: checkout.title ausente',
  ])('não mexe em "%s"', (input) => {
    expect(redactString(input)).toBe(input);
  });

  it('não mascara duas vezes', () => {
    const once = redactString('password=abc123');
    expect(redactString(once)).toBe(once);
  });

  // Roda em toda linha de log, com texto vindo de fora: tempo linear também em entrada feita para
  // travar cada expressão (tarefa 325). Antes, `key` repetido em 10 mil caracteres passava de 20 s.
  const fill = (unit: string, size: number): string =>
    unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
  const SIZE = 100_000;
  it.each([
    ['texto comum', fill('Falha no pedido 1234 de joao@example.com em /api/v1/x; ', SIZE)],
    ['um caractere repetido', 'x'.repeat(SIZE)],
    ['nome proibido repetido', fill('key', SIZE)],
    ['nome proibido com ponto', fill('key.', SIZE)],
    ['par sem valor', fill('password=', SIZE)],
    ['aspa sem fechar', `password="${'a'.repeat(SIZE)}`],
    ['separador com espaços sem valor', `token:${' '.repeat(SIZE)}`],
    ['esquema de URL sem fim', fill('a.', SIZE)],
    ['URL sem arroba', fill('a://', SIZE)],
    ['URL com dois-pontos sem arroba', `a://${fill('x:', SIZE)}`],
    ['Bearer seguido de espaços', `Bearer${' '.repeat(SIZE)}`],
    ['dígitos', '1'.repeat(SIZE)],
    ['CPF incompleto', fill('111.', SIZE)],
    ['CNPJ incompleto', fill('AA.AAA.', SIZE)],
  ])('100 mil caracteres (%s) em menos de 200 ms', (_name, text) => {
    // Melhor de três: com a máquina carregada, uma pausa isolada passa dos 200 ms; o tempo
    // quadrático de antes, não (segundos a cada execução).
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run += 1) {
      const start = performance.now();
      redactString(text);
      best = Math.min(best, performance.now() - start);
    }
    expect(best).toBeLessThan(200);
  });
});
