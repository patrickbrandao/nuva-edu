import {
  closeDatabase,
  createDatabase,
  type Database,
  DEFAULT_SOURCE_CODE_URL,
  setSetting,
} from '@nuva-edu/core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.ts';

const opened: TestApp[] = [];
function open(...args: Parameters<typeof createTestApp>): TestApp {
  const test = createTestApp(...args);
  opened.push(test);
  return test;
}
afterAll(async () => {
  await Promise.all(opened.map((test) => test.close()));
});

describe('sondas', () => {
  const test = open();

  it('GET /healthz responde ok sem tocar no banco', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('GET /readyz responde 200 com o banco no ar e as migrations em dia', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/readyz' });
    expect(response.json()).toEqual({
      status: 'ready',
      checks: { database: 'ok', migrations: 'ok' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('GET /readyz responde 503 com o banco inacessível, e /healthz segue 200', async () => {
    // Porta 9 (discard): nada escuta ali.
    const unreachable = 'postgres://nuva:x@127.0.0.1:9/nuva';
    const db = createDatabase({ connectionString: unreachable, maxConnections: 1 });
    const down = open({ DATABASE_URL: unreachable }, { db });
    try {
      const ready = await down.app.inject({ method: 'GET', url: '/readyz' });
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toEqual({
        status: 'not_ready',
        checks: { database: 'fail', migrations: 'fail' },
      });
      expect(down.lines.find((line) => line.msg === 'Serviço não está pronto')).toMatchObject({
        level: 'warn',
        reasons: { database: 'banco inacessível' },
      });
      expect((await down.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    } finally {
      await closeDatabase(db);
    }
  });

  it('GET /metrics expõe as métricas no formato Prometheus', async () => {
    await test.app.inject({ method: 'GET', url: '/api/v1/meta' });
    const response = await test.app.inject({ method: 'GET', url: '/metrics' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain; version=0.0.4');
    expect(response.body).toContain(
      'http_requests_total{method="GET",route="/api/v1/meta",status="200"}',
    );
    expect(response.body).toContain('http_request_duration_seconds_bucket');
  });

  it('GET /metrics expõe o estado do pool do banco em db_pool_connections', async () => {
    // Garante ao menos uma conexão aberta e devolvida ao pool antes da leitura.
    await test.app.inject({ method: 'GET', url: '/readyz' });
    const response = await test.app.inject({ method: 'GET', url: '/metrics' });
    expect(response.body.match(/^# TYPE db_pool_connections gauge$/gm)).toHaveLength(1);
    const states = [...response.body.matchAll(/^db_pool_connections\{state="(\w+)"\} (\d+)$/gm)];
    expect(states.map((match) => match[1])).toEqual(['active', 'idle', 'waiting']);
    const pool = Object.fromEntries(states.map((match) => [match[1], Number(match[2])]));
    expect(pool.active + pool.idle).toBeGreaterThanOrEqual(1);
    expect(pool.active + pool.idle).toBeLessThanOrEqual(2);
    expect(pool.waiting).toBe(0);
  });

  it('GET /metrics não responde a quem chega pelo proxy', async () => {
    const response = await test.app.inject({
      method: 'GET',
      url: '/metrics',
      headers: { 'x-forwarded-for': '45.80.10.20' },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('GET /api/v1/meta', () => {
  it('devolve os dados públicos da instalação, sem sessão', async () => {
    const test = open({}, { version: '1.2.3' });
    const response = await test.app.inject({
      method: 'GET',
      url: '/api/v1/meta',
      headers: { 'x-request-id': 'req-meta-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['x-request-id']).toBe('req-meta-1');
    expect(response.json()).toEqual({
      schoolName: 'nuva-edu',
      version: '1.2.3',
      currency: 'BRL',
      locale: 'pt-BR',
      authProviders: [],
      logoUrl: null,
      accentColor: null,
      sourceCodeUrl: DEFAULT_SOURCE_CODE_URL,
    });
    expect(test.lines.find((line) => line.msg === 'Requisição atendida')).toMatchObject({
      request_id: 'req-meta-1',
      route: '/api/v1/meta',
      status: 200,
    });
  });

  it('lista só os provedores de login configurados, sem expor credenciais', async () => {
    const test = open({
      NUVA_CURRENCY: 'USD',
      NUVA_LOCALE: 'en-US',
      GOOGLE_CLIENT_ID: 'id-do-google',
      GOOGLE_CLIENT_SECRET: 'segredo-do-google',
      APPLE_CLIENT_ID: 'id-da-apple',
      APPLE_TEAM_ID: 'time',
      APPLE_KEY_ID: 'chave',
      APPLE_PRIVATE_KEY: 'chave-privada-da-apple',
    });
    const response = await test.app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(response.json()).toMatchObject({
      currency: 'USD',
      locale: 'en-US',
      authProviders: ['google', 'apple'],
    });
    expect(response.json().version).toMatch(/^\d+\.\d+\.\d+/);
    for (const secret of ['segredo-do-google', 'chave-privada-da-apple', 'id-do-google']) {
      expect(response.body).not.toContain(secret);
      expect(test.logText()).not.toContain(secret);
    }
  });

  it('resposta fora do contrato falha: vira 500 e o motivo vai para o log', async () => {
    // Moeda fora do padrão ISO 4217 do esquema `Meta`: a rota monta uma resposta inválida.
    const test = open();
    const broken = open({}, { config: { ...test.config, currency: 'reais' } });
    const response = await broken.app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ code: 'internal_error', instance: '/api/v1/meta' });
    expect(broken.lines.find((line) => line.level === 'error')).toMatchObject({
      operation: 'getMeta',
      err: { type: 'ResponseContractError', reason: 'schema_mismatch' },
    });
  });
});

describe('GET /api/v1/meta: marca da escola em settings', () => {
  const LOGO_ID = '0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70';
  const meta = (test: TestApp) => test.app.inject({ method: 'GET', url: '/api/v1/meta' });
  const clear = (db: Database) =>
    db.deleteFrom('settings').where('key', 'like', 'school.%').execute();
  /** Grava direto na tabela, como quem escreve por fora da admin-api (sem a validação do núcleo). */
  const storeRaw = (db: Database, key: string, value: unknown) =>
    db
      .insertInto('settings')
      .values({ key, value: JSON.stringify(value) })
      .execute();

  // Os demais testes deste arquivo esperam `settings` vazio.
  const cleaner = open();
  afterEach(() => clear(cleaner.db));

  it('com settings vazio devolve os padrões, com logoUrl e accentColor nulos (não omitidos)', async () => {
    const test = open({}, { version: '1.2.3' });
    await clear(test.db);
    const response = await meta(test);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      schoolName: 'nuva-edu',
      version: '1.2.3',
      currency: 'BRL',
      locale: 'pt-BR',
      authProviders: [],
      logoUrl: null,
      accentColor: null,
      sourceCodeUrl: 'https://github.com/patrickbrandao/nuva-edu',
    });
    expect(response.body).toContain('"logoUrl":null');
    expect(response.body).toContain('"accentColor":null');
  });

  it('com as chaves gravadas devolve o nome, o logotipo, a cor e o endereço do código-fonte', async () => {
    const test = open();
    await setSetting(test.db, 'school.name', 'Escola Exemplo');
    await setSetting(test.db, 'school.logo_image_id', LOGO_ID.toUpperCase());
    await setSetting(test.db, 'school.accent_color', '#1F6FEB');
    await setSetting(test.db, 'school.source_code_url', 'https://example.com/escola/codigo');
    const response = await meta(test);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schoolName: 'Escola Exemplo',
      // Caminho na própria API, na variante de 256 px (spec 029).
      logoUrl: `/api/v1/images/${LOGO_ID}/256.webp`,
      accentColor: '#1F6FEB',
      sourceCodeUrl: 'https://example.com/escola/codigo',
    });
  });

  it('valor inválido no banco não derruba o /meta: vale o padrão, com aviso no log', async () => {
    const test = open();
    await storeRaw(test.db, 'school.name', 'Escola Exemplo');
    await storeRaw(test.db, 'school.accent_color', 'azul');
    await storeRaw(test.db, 'school.logo_image_id', 'nao-e-uuid');
    await storeRaw(test.db, 'school.source_code_url', 'http://sem-tls.example.com');
    const response = await meta(test);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      schoolName: 'Escola Exemplo',
      logoUrl: null,
      accentColor: null,
      sourceCodeUrl: DEFAULT_SOURCE_CODE_URL,
    });
    const warnings = test.lines.filter(
      (line) => line.msg === 'Configuração com valor inválido no banco; usando o padrão',
    );
    expect(warnings.map((line) => line.setting_key).sort()).toEqual([
      'school.accent_color',
      'school.logo_image_id',
      'school.source_code_url',
    ]);
    expect(warnings.every((line) => line.level === 'warn')).toBe(true);
    // O aviso leva só a chave, nunca o valor.
    expect(test.logText()).not.toContain('sem-tls.example.com');
  });

  it('usa um leitor por processo: a segunda requisição não vai ao banco', async () => {
    const test = open();
    await setSetting(test.db, 'school.name', 'Antes');
    expect((await meta(test)).json().schoolName).toBe('Antes');
    // Gravado por outro processo: este só enxerga quando o cache do leitor vencer.
    await setSetting(test.db, 'school.name', 'Depois');
    expect((await meta(test)).json().schoolName).toBe('Antes');
    expect((await meta(open())).json().schoolName).toBe('Depois');
  });

  it('banco inacessível responde 503 database_unavailable, declarado no contrato', async () => {
    const unreachable = 'postgres://nuva:x@127.0.0.1:9/nuva';
    const db = createDatabase({ connectionString: unreachable, maxConnections: 1 });
    const down = open({ DATABASE_URL: unreachable }, { db });
    try {
      const response = await meta(down);
      expect(response.statusCode).toBe(503);
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.json()).toMatchObject({
        code: 'database_unavailable',
        instance: '/api/v1/meta',
      });
      expect(
        down.lines.some(
          (line) => line.msg === 'Resposta de erro com status que o contrato não declara',
        ),
      ).toBe(false);
    } finally {
      await closeDatabase(db);
    }
  });
});

describe('fora do contrato', () => {
  const test = open();

  it('rota inexistente responde 404 em problem+json', async () => {
    const response = await test.app.inject({ method: 'GET', url: '/api/v1/nao-existe' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toEqual({
      type: 'about:blank',
      title: 'Não encontrado',
      status: 404,
      code: 'not_found',
      instance: '/api/v1/nao-existe',
    });
  });

  it('método que o contrato não descreve não é atendido', async () => {
    const response = await test.app.inject({ method: 'POST', url: '/api/v1/meta', payload: {} });
    expect(response.statusCode).toBe(404);
  });

  it('registra o IP real quando a requisição vem do proxy confiável', async () => {
    await test.app.inject({
      method: 'GET',
      url: '/api/v1/meta',
      remoteAddress: '172.18.0.5',
      headers: { 'x-forwarded-for': '6.6.6.6, 45.80.10.20', 'x-request-id': 'req-ip' },
    });
    expect(test.lines.find((line) => line.request_id === 'req-ip')).toMatchObject({
      client_ip: '45.80.10.20',
      client_ip_source: 'x-forwarded-for',
      peer_ip: '172.18.0.5',
    });
  });
});
