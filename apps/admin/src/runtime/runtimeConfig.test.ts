import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIG, jsonResponse } from '../test/render';
import { loadRuntimeConfig, parseRuntimeConfig } from './runtimeConfig';

const fetchWith = (respond: () => Response | Promise<Response>) =>
  vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => respond());

function spyWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadRuntimeConfig', () => {
  it('lê app, adminUrl e classroomUrl de /config.json, sem cache', async () => {
    const warn = spyWarn();
    const fetchMock = fetchWith(() => jsonResponse(CONFIG));

    expect(await loadRuntimeConfig(fetchMock)).toEqual(CONFIG);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/config.json');
    expect(fetchMock.mock.calls[0]?.[1]?.cache).toBe('no-store');
    expect(warn).not.toHaveBeenCalled();
  });

  it('ignora moeda, idioma, versão e qualquer outro campo do arquivo', async () => {
    spyWarn();
    const fetchMock = fetchWith(() =>
      jsonResponse({ ...CONFIG, currency: 'USD', locale: 'en', version: '9.9.9', adminHost: 'x' }),
    );
    expect(await loadRuntimeConfig(fetchMock)).toEqual(CONFIG);
  });

  it('arquivo ausente (o index.html no lugar): devolve vazio e avisa no console', async () => {
    const warn = spyWarn();
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
    const warn = spyWarn();
    const fetchMock = fetchWith(() => new Response('not found', { status: 404 }));

    expect(await loadRuntimeConfig(fetchMock)).toEqual({});
    expect(String(warn.mock.calls[0]?.[0])).toContain('404');
  });

  it('falha de rede: devolve vazio e avisa, sem rejeitar', async () => {
    const warn = spyWarn();
    const fetchMock = fetchWith(() => Promise.reject(new TypeError('Failed to fetch')));

    expect(await loadRuntimeConfig(fetchMock)).toEqual({});
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('campo faltando: mantém os válidos e cita só o nome do campo no aviso', async () => {
    const warn = spyWarn();
    const fetchMock = fetchWith(() => jsonResponse({ app: 'admin', adminUrl: CONFIG.adminUrl }));

    expect(await loadRuntimeConfig(fetchMock)).toEqual({ app: 'admin', adminUrl: CONFIG.adminUrl });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('classroomUrl');
  });

  it('não põe no console o valor recebido fora do formato', async () => {
    const warn = spyWarn();
    const fetchMock = fetchWith(() => jsonResponse({ ...CONFIG, classroomUrl: 'valor-secreto' }));

    expect((await loadRuntimeConfig(fetchMock)).classroomUrl).toBeUndefined();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('valor-secreto');
  });

  it('avisa quando o arquivo é de outro site', async () => {
    const warn = spyWarn();
    const fetchMock = fetchWith(() => jsonResponse({ ...CONFIG, app: 'classroom' }));

    expect((await loadRuntimeConfig(fetchMock)).classroomUrl).toBe(CONFIG.classroomUrl);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('parseRuntimeConfig', () => {
  it.each([
    ['null', null],
    ['lista', [CONFIG]],
    ['texto', 'config'],
  ])('corpo que não é objeto (%s): todos os campos inválidos', (_name, body) => {
    expect(parseRuntimeConfig(body)).toEqual({
      config: {},
      invalid: ['app', 'adminUrl', 'classroomUrl'],
    });
  });

  it.each([
    ['barra no fim', 'https://classroom.escola.com.br/'],
    ['caminho', 'https://classroom.escola.com.br/cursos'],
    ['esquema que não é http', 'javascript:alert(1)'],
    ['sem esquema', 'classroom.escola.com.br'],
    ['número', 8080],
    ['vazio', ''],
  ])('recusa classroomUrl com %s', (_name, classroomUrl) => {
    const { config, invalid } = parseRuntimeConfig({ ...CONFIG, classroomUrl });
    expect(config.classroomUrl).toBeUndefined();
    expect(invalid).toEqual(['classroomUrl']);
  });

  it('aceita origem https sem porta e http com porta', () => {
    const body = {
      app: 'admin',
      adminUrl: 'https://edu-admin.escola.com.br',
      classroomUrl: 'http://classroom.localhost:8080',
    };
    expect(parseRuntimeConfig(body)).toEqual({ config: body, invalid: [] });
  });

  it('recusa app desconhecido', () => {
    expect(parseRuntimeConfig({ ...CONFIG, app: 'worker' }).invalid).toEqual(['app']);
  });
});
