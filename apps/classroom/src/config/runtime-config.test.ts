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

function mockWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

afterEach(() => vi.restoreAllMocks());

describe('loadRuntimeConfig', () => {
  it('busca /config.json sem cache e devolve os três campos', async () => {
    const warn = mockWarn();
    const fetchMock = vi.fn(async () => json(VALID));

    expect(await loadRuntimeConfig(fetchMock)).toEqual(VALID);
    expect(fetchMock).toHaveBeenCalledWith(
      '/config.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('não lê moeda, idioma nem outros campos, mesmo que o arquivo os traga', async () => {
    const extra = { ...VALID, currency: 'USD', locale: 'en', adminHost: 'edu-admin.escola.com.br' };
    expect(await loadRuntimeConfig(async () => json(extra))).toEqual(VALID);
  });

  it('devolve null e avisa no console quando o arquivo falta (a SPA responde o index.html)', async () => {
    const warn = mockWarn();
    const html = new Response('<!doctype html><html></html>', {
      headers: { 'Content-Type': 'text/html' },
    });

    expect(await loadRuntimeConfig(async () => html)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('devolve null em resposta de erro e em falha de rede', async () => {
    const warn = mockWarn();
    expect(await loadRuntimeConfig(async () => json(VALID, 404))).toBeNull();
    expect(
      await loadRuntimeConfig(async () => {
        throw new TypeError('Failed to fetch');
      }),
    ).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['campo faltando', { app: 'classroom', classroomUrl: VALID.classroomUrl }],
    ['app desconhecido', { ...VALID, app: 'loja' }],
    ['endereço relativo', { ...VALID, adminUrl: '/admin' }],
    ['endereço sem esquema', { ...VALID, adminUrl: 'edu-admin.escola.com.br' }],
    ['esquema que não é http', { ...VALID, adminUrl: 'javascript:alert(1)' }],
    ['endereço que não é texto', { ...VALID, classroomUrl: 42 }],
    ['lista', [VALID]],
    ['nulo', null],
  ])('devolve null com formato inválido: %s', async (_name, body) => {
    const warn = mockWarn();
    expect(await loadRuntimeConfig(async () => json(body))).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('parseRuntimeConfig', () => {
  it('aceita http e https', () => {
    const local = { ...VALID, adminUrl: 'http://edu-admin.localhost:8080' };
    expect(parseRuntimeConfig(local)).toEqual(local);
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
    expect(parseRuntimeConfig(config)).toEqual(config);
  });
});
