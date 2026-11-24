import { describe, expect, it } from 'vitest';
import {
  createLogger,
  type LoggerOptions,
  newRequestId,
  REDACTED,
  REQUEST_ID_HEADER,
  resolveRequestId,
  SENSITIVE_KEY_PARTS,
} from '../src/index.ts';

function capture(options: Partial<LoggerOptions> = {}) {
  const lines: string[] = [];
  const logger = createLogger({
    service: 'admin-api',
    write: (line) => lines.push(line),
    now: () => new Date('2026-11-24T12:00:00.000Z'),
    ...options,
  });
  return { logger, lines, records: () => lines.map((line) => JSON.parse(line)) };
}

describe('createLogger', () => {
  it('escreve uma linha JSON por evento com os campos da spec 033', () => {
    const { logger, lines, records } = capture();
    logger.info('Requisição atendida', {
      request_id: 'req-1',
      user_id: 'u1',
      route: '/api/v1/users',
      status: 200,
      duration_ms: 12,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith('\n')).toBe(true);
    expect(lines[0]?.trimEnd()).not.toContain('\n');
    expect(records()[0]).toEqual({
      time: '2026-11-24T12:00:00.000Z',
      level: 'info',
      service: 'admin-api',
      request_id: 'req-1',
      user_id: 'u1',
      route: '/api/v1/users',
      status: 200,
      duration_ms: 12,
      msg: 'Requisição atendida',
    });
  });

  it('aceita as formas do pino: objeto primeiro, erro primeiro e formatação', () => {
    const { logger, records } = capture();
    logger.info({ job_id: 'j1' }, 'Tarefa %s concluída em %d ms', 'email.send', 40);
    logger.info({ job_id: 'j2' });
    logger.info('Servidor ouvindo em %s', 'http://0.0.0.0:3000');
    logger.error(new Error('falhou'));
    logger.error(new Error('falhou'), 'Tarefa falhou');
    logger.warn('lista', ['a', 'b']);
    const [formatted, bare, text, error, described, list] = records();
    expect(formatted).toMatchObject({ job_id: 'j1', msg: 'Tarefa email.send concluída em 40 ms' });
    expect(bare).toMatchObject({ job_id: 'j2', msg: '' });
    expect(text.msg).toBe('Servidor ouvindo em http://0.0.0.0:3000');
    expect(error.msg).toBe('falhou');
    expect(error.err).toMatchObject({ type: 'Error', message: 'falhou' });
    expect(error.err.stack).toContain('logger.test.ts');
    expect(described.msg).toBe('Tarefa falhou');
    expect(list.msg).toBe("lista [ 'a', 'b' ]");
  });

  it('respeita o nível, que pode mudar em execução', () => {
    const { logger, records } = capture({ level: 'warn' });
    logger.trace('a');
    logger.debug('b');
    logger.info('c');
    logger.warn('d');
    logger.error('e');
    logger.fatal('f');
    logger.silent('g');
    expect(records().map((record) => record.level)).toEqual(['warn', 'error', 'fatal']);
    expect(logger.isLevelEnabled('info')).toBe(false);

    logger.level = 'trace';
    expect(logger.level).toBe('trace');
    logger.trace('h');
    expect(records()).toHaveLength(4);

    logger.level = 'silent';
    logger.fatal('i');
    expect(records()).toHaveLength(4);
  });

  it('usa info como nível padrão', () => {
    const { logger, records } = capture();
    logger.debug('a');
    logger.info('b');
    expect(records()).toHaveLength(1);
  });

  it('propaga o identificador de requisição e os campos do pai aos filhos', () => {
    const { logger, records } = capture({ bindings: { version: '0.1.0' } });
    const request = logger.withRequestId('req-42');
    const job = request.child({ job_id: 'j9' });
    request.info('a');
    job.info('b', { request_id: 'outro' });
    logger.info('c');
    const [a, b, c] = records();
    expect(a).toMatchObject({ version: '0.1.0', request_id: 'req-42' });
    expect(a).not.toHaveProperty('job_id');
    expect(b).toMatchObject({ version: '0.1.0', request_id: 'outro', job_id: 'j9' });
    expect(c).not.toHaveProperty('request_id');
  });

  it('dá ao filho um nível próprio, herdado do pai na criação', () => {
    const { logger, records } = capture({ level: 'error' });
    const child = logger.child({ a: 1 });
    child.level = 'debug';
    child.debug('filho');
    logger.info('pai');
    expect(records().map((record) => record.msg)).toEqual(['filho']);
  });

  it('não deixa campos de quem chama sobrescreverem time, level, service e msg', () => {
    const { logger, records } = capture();
    logger.info({ time: 'x', level: 'fatal', service: 'outro', msg: 'forjada' }, 'real');
    expect(records()[0]).toEqual({
      time: '2026-11-24T12:00:00.000Z',
      level: 'info',
      service: 'admin-api',
      msg: 'real',
    });
  });

  it('escreve na saída padrão quando nenhum destino é dado', () => {
    const original = process.stdout.write.bind(process.stdout);
    const lines: string[] = [];
    process.stdout.write = ((chunk: string) => {
      lines.push(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      createLogger({ service: 'worker' }).info('olá');
    } finally {
      process.stdout.write = original;
    }
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({ service: 'worker', msg: 'olá' });
    expect(Number.isNaN(Date.parse(JSON.parse(lines[0] ?? '').time))).toBe(false);
  });
});

describe('logger: campos proibidos (spec 033, RNF-02)', () => {
  const secrets = {
    password: 'S3nh4-do-aluno',
    token: 'tok_4f9a1c',
    secret: 'whsec_77aa',
    authorization: 'Bearer eyJhbGciOi.payload.assinatura',
    cookie: 'sid=9f8e7d6c',
    cpf: '529.982.247-25',
    cnpj: '11.222.333/0001-81',
    document: '52998224725',
    key: 'nuva_mcp_k3y',
  };

  it('cobre toda a lista da spec', () => {
    for (const field of Object.keys(secrets)) {
      expect(SENSITIVE_KEY_PARTS).toContain(field);
    }
  });

  it('nunca imprime o valor, onde quer que o campo apareça', () => {
    const { logger, lines, records } = capture({
      level: 'trace',
      bindings: { session: { ...secrets } },
    });
    const request = {
      headers: { Authorization: secrets.authorization, Cookie: secrets.cookie },
      body: { email: 'ana@example.com', password: secrets.password, user: { CPF: secrets.cpf } },
      query: [{ resetToken: secrets.token }, { api_key: secrets.key }],
    };
    logger.info({ ...secrets }, 'campos na raiz');
    logger.info('campos aninhados', { req: request });
    logger.child({ company: { cnpj: secrets.cnpj, webhookSecret: secrets.secret } }).warn('filho');
    logger.error(
      Object.assign(new Error('falha no login'), { password: secrets.password, context: request }),
      'erro com campos',
    );
    logger.debug({ document: secrets.document, MP_ACCESS_TOKEN: secrets.token }, 'variações');

    const output = lines.join('');
    for (const [field, value] of Object.entries(secrets)) {
      expect(output, `valor de "${field}" vazou`).not.toContain(value);
    }
    expect(output).not.toContain('eyJhbGciOi');
    expect(output).toContain('ana@example.com');
    expect(records()[0]).toMatchObject({
      password: REDACTED,
      token: REDACTED,
      secret: REDACTED,
      authorization: REDACTED,
      cookie: REDACTED,
      cpf: REDACTED,
      cnpj: REDACTED,
      document: REDACTED,
      key: REDACTED,
    });
  });

  it('mascara o que é reconhecível pela forma em mensagens e textos livres', () => {
    const { logger, lines } = capture();
    logger.info(`Conectando em postgres://nuva:${secrets.password}@db:5432/nuva_edu`);
    logger.info('Cabeçalho recebido: %s', secrets.authorization);
    logger.info({ url: `/reset?token=${secrets.token}` }, `CPF ${secrets.cpf} recusado`);
    logger.info({ note: `aluno ${secrets.document}, empresa ${secrets.cnpj}` });
    logger.error(new Error(`login com password=${secrets.password} falhou`));
    const output = lines.join('');
    for (const value of Object.values(secrets)) {
      expect(output).not.toContain(value);
    }
  });
});

describe('identificador de requisição', () => {
  it('cria identificadores únicos em formato UUID', () => {
    const first = newRequestId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newRequestId()).not.toBe(first);
  });

  it('aproveita o identificador do proxy quando tem forma segura', () => {
    expect(REQUEST_ID_HEADER).toBe('x-request-id');
    expect(resolveRequestId('abc-123')).toBe('abc-123');
    expect(resolveRequestId(['primeiro', 'segundo'])).toBe('primeiro');
  });

  it.each([undefined, null, '', 'a b', 'x"\n{"level":"fatal"}', 'a'.repeat(129), []])(
    'cria um novo quando o cabeçalho é %j',
    (header) => {
      const id = resolveRequestId(header);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});
