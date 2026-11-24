import { DEFAULT_SOURCE_CODE_URL, SETTING_DEFAULTS } from '@nuva-edu/core';
import { describe, expect, it } from 'vitest';
import {
  createApiApp,
  installationMeta,
  META_OPERATION,
  parseContract,
  readPackageVersion,
  registerMetaRoute,
} from '../src/index.ts';
import { captureLogs, READY } from './helpers.ts';

const none = { google: null, facebook: null, apple: null };
const config = { currency: 'BRL', locale: 'pt-BR', authProviders: none };
const LOGO_ID = '0193A5B2-7C1E-7D3A-9F4B-2A6C8E1D5F70';

describe('installationMeta', () => {
  it('sem nada gravado devolve os padrões, com logoUrl e accentColor nulos', () => {
    expect(installationMeta(config, '0.1.0', SETTING_DEFAULTS)).toEqual({
      schoolName: 'nuva-edu',
      version: '0.1.0',
      currency: 'BRL',
      locale: 'pt-BR',
      authProviders: [],
      logoUrl: null,
      accentColor: null,
      sourceCodeUrl: DEFAULT_SOURCE_CODE_URL,
    });
  });

  it('usa os valores da escola e monta o caminho do logotipo na variante de 256 px', () => {
    const meta = installationMeta(
      {
        currency: 'USD',
        locale: 'en-US',
        authProviders: {
          google: null,
          facebook: { clientId: 'a', clientSecret: 'b' },
          apple: { clientId: 'a', teamId: 'b', keyId: 'c', privateKey: 'd' },
        },
      },
      '1.2.3',
      {
        'school.name': 'Escola Exemplo',
        'school.logo_image_id': LOGO_ID,
        'school.accent_color': '#1F6FEB',
        'school.source_code_url': 'https://example.com/escola/codigo',
      },
    );
    expect(meta).toEqual({
      schoolName: 'Escola Exemplo',
      version: '1.2.3',
      currency: 'USD',
      locale: 'en-US',
      // Na ordem do contrato, e só o nome: nenhuma credencial.
      authProviders: ['facebook', 'apple'],
      logoUrl: `/api/v1/images/${LOGO_ID.toLowerCase()}/256.webp`,
      accentColor: '#1F6FEB',
      sourceCodeUrl: 'https://example.com/escola/codigo',
    });
  });
});

describe('readPackageVersion', () => {
  it('lê a versão de um package.json e recusa arquivo sem ela', () => {
    expect(readPackageVersion(new URL('../package.json', import.meta.url))).toMatch(
      /^\d+\.\d+\.\d+/,
    );
    expect(() => readPackageVersion(new URL('../tsconfig.json', import.meta.url))).toThrow(
      /sem "version"/,
    );
  });
});

describe('registerMetaRoute', () => {
  const nullableText = (extra: Record<string, unknown>) => ({ type: ['string', 'null'], ...extra });
  const contract = parseContract({
    openapi: '3.1.0',
    paths: {
      '/api/v1/meta': {
        get: {
          operationId: META_OPERATION,
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['schoolName', 'logoUrl', 'accentColor', 'sourceCodeUrl'],
                    properties: {
                      logoUrl: nullableText({ format: 'uri-reference' }),
                      accentColor: nullableText({ pattern: '^#[0-9A-Fa-f]{6}$' }),
                      sourceCodeUrl: { type: 'string', format: 'uri' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  it('lê as configurações pelo leitor a cada requisição e responde no contrato', async () => {
    const logs = captureLogs();
    const app = createApiApp({
      contract,
      logger: logs.logger,
      trustedProxies: [],
      readiness: READY,
    });
    let settings = { ...SETTING_DEFAULTS };
    let reads = 0;
    registerMetaRoute(app, {
      config,
      version: '0.1.0',
      settings: {
        all: async () => {
          reads += 1;
          return settings;
        },
      },
    });
    try {
      const first = await app.inject({ method: 'GET', url: '/api/v1/meta' });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        schoolName: 'nuva-edu',
        logoUrl: null,
        accentColor: null,
      });

      settings = { ...settings, 'school.name': 'Escola', 'school.accent_color': '#abcdef' };
      const second = await app.inject({ method: 'GET', url: '/api/v1/meta' });
      expect(second.json()).toMatchObject({ schoolName: 'Escola', accentColor: '#abcdef' });
      expect(reads).toBe(2);
    } finally {
      await app.close();
    }
  });
});
