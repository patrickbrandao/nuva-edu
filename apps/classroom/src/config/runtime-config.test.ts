import { afterEach, describe, expect, it, vi } from 'vitest';
import { devRuntimeConfig } from './dev-server';
import { loadRuntimeConfig, parseRuntimeConfig } from './runtime-config';

const VALID = {
  app: 'classroom',
  adminUrl: 'https://edu-admin.escola.com.br',
  classroomUrl: 'https://classroom.escola.com.br',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const fetchWith = (respond: () => Response | Promise<Response>) =>
  vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => respond());

function mockWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

afterEach(() => vi.restoreAllMocks());

// Mesmos casos de `apps/admin/src/runtime/runtimeConfig.test.ts`: a regra é uma só nos dois sites.
describe('loadRuntimeConfig', () => {
  it('lê app, adminUrl e classroomUrl de /config.json, sem cache', async () => {
    const warn = mockWarn();
    const fetchMock = fetchWith(() => json(VALID));

    expect(await loadRuntimeConfig(fetchMock)).toEqual(VALID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/config.json');
    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe('no-store');
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignora moeda, idioma, versão e qualquer outro campo do arquivo', async () => {
    mockWarn();
    const fetchMock = fetchWith(() =>
      json({ ...VALID, currency: 'USD', locale: 'en', version: '9.9.9', adminHost: 'x' }),
    );
    expect(await loadRuntimeConfig(fetchMock)).toEqual(VALID);
  });

  it('arquivo ausente (o index.html no lugar): devolve vazio e avisa no console', async () => {
    const warn = mockWarn();
    const html = '<!doctype html><html><body><div id="root"></div></body></html>';
    const fetchMock = fetchWith(
      () => new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );

    expect(await loadRuntimeConfig(fetchMock)).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('/config.json');
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('doctype');
  });

  it('resposta 404: devolve vazio e avisa com o status', async () => {
    const warn = mockWarn();
    const fetchMock = fetchWith(() => new Response('not found', { status: 404 }));

    expect(await loadRuntimeConfig(fetchMock)).toEqual({});
    expect(String(warn.mock.calls[0]?.[0])).toContain('404');
  });

  it('falha de rede: devolve vazio e avisa, sem rejeitar', async () => {
    const warn = mockWarn();
    const fetchMock = fetchWith(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(await loadRuntimeConfig(fetchMock)).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('campo faltando: mantém os válidos e cita só o nome do campo no aviso', async () => {
    const warn = mockWarn();
    const fetchMock = fetchWith(() => json({ app: 'classroom', adminUrl: VALID.adminUrl }));

    expect(await loadRuntimeConfig(fetchMock)).toEqual({
      app: 'classroom',
      adminUrl: VALID.adminUrl,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('classroomUrl');
  });

  it('não põe no console o valor recebido fora do formato', async () => {
    const warn = mockWarn();
    const fetchMock = fetchWith(() => json({ ...VALID, adminUrl: 'valor-secreto' }));

    expect((await loadRuntimeConfig(fetchMock)).adminUrl).toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('valor-secreto');
  });

  it('avisa quando o arquivo é de outro site', async () => {
    const warn = mockWarn();
    const fetchMock = fetchWith(() => json({ ...VALID, app: 'admin' }));

    expect((await loadRuntimeConfig(fetchMock)).adminUrl).toBe(VALID.adminUrl);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('parseRuntimeConfig', () => {
  it.each([
    ['null', null],
    ['lista', [VALID]],
    ['texto', 'config'],
  ])('corpo que não é objeto (%s): todos os campos inválidos', (_name, body) => {
    expect(parseRuntimeConfig(body)).toEqual({
      config: {},
      invalid: ['app', 'adminUrl', 'classroomUrl'],
    });
  });

  it.each([
    ['barra no fim', 'https://edu-admin.escola.com.br/'],
    ['caminho', 'https://edu-admin.escola.com.br/painel'],
    ['consulta', 'https://edu-admin.escola.com.br?x=1'],
    ['esquema que não é http', 'javascript:alert(1)'],
    ['sem esquema', 'edu-admin.escola.com.br'],
    ['endereço relativo', '/admin'],
    ['número', 8080],
    ['vazio', ''],
  ])('recusa adminUrl com %s', (_name, adminUrl) => {
    const { config, invalid } = parseRuntimeConfig({ ...VALID, adminUrl });
    expect(config.adminUrl).toBeUndefined();
    expect(invalid).toEqual(['adminUrl']);
  });

  it('recusa classroomUrl com barra no fim e mantém o adminUrl válido', () => {
    const { config, invalid } = parseRuntimeConfig({
      ...VALID,
      classroomUrl: 'https://classroom.escola.com.br/',
    });
    expect(config).toEqual({ app: 'classroom', adminUrl: VALID.adminUrl });
    expect(invalid).toEqual(['classroomUrl']);
  });

  it('aceita origem https sem porta e http com porta', () => {
    const body = {
      app: 'classroom',
      adminUrl: 'https://edu-admin.escola.com.br',
      classroomUrl: 'http://classroom.localhost:8080',
    };
    expect(parseRuntimeConfig(body)).toEqual({ config: body, invalid: [] });
  });

  it('recusa app desconhecido', () => {
    expect(parseRuntimeConfig({ ...VALID, app: 'worker' }).invalid).toEqual(['app']);
  });
});

describe('devRuntimeConfig (vite dev)', () => {
  it('usa os padrões da spec 031', () => {
    expect(devRuntimeConfig({})).toEqual({
      app: 'classroom',
      adminUrl: 'http://edu-admin.localhost:8080',
      classroomUrl: 'http://classroom.localhost:8080',
    });
  });

  it('monta os endereços das variáveis e omite a porta padrão do esquema', () => {
    const config = devRuntimeConfig({
      NUVA_PUBLIC_SCHEME: 'https',
      NUVA_ADMIN_HOST: 'painel.escola.com.br',
      NUVA_CLASSROOM_HOST: 'aulas.escola.com.br',
      NUVA_PUBLIC_PORT: '443',
    });
    expect(config.adminUrl).toBe('https://painel.escola.com.br');
    expect(config.classroomUrl).toBe('https://aulas.escola.com.br');
  });

  it('deriva os nomes de NUVA_DOMAIN e aceita porta vazia', () => {
    const config = devRuntimeConfig({ NUVA_DOMAIN: 'escola.test', NUVA_PUBLIC_PORT: '' });
    expect(config.adminUrl).toBe('http://edu-admin.escola.test');
    expect(parseRuntimeConfig(config)).toEqual({ config, invalid: [] });
  });
});
