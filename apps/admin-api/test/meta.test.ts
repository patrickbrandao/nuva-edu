import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHOOL_NAME, installationMeta, readServiceVersion } from '../src/meta.ts';

const none = { google: null, facebook: null, apple: null };

describe('installationMeta', () => {
  it('monta os dados públicos a partir da configuração', () => {
    expect(
      installationMeta({ currency: 'BRL', locale: 'pt-BR', authProviders: none }, '0.1.0'),
    ).toEqual({
      schoolName: DEFAULT_SCHOOL_NAME,
      version: '0.1.0',
      currency: 'BRL',
      locale: 'pt-BR',
      authProviders: [],
    });
  });

  it('lista os provedores ligados na ordem do contrato e usa o nome dado', () => {
    const meta = installationMeta(
      {
        currency: 'BRL',
        locale: 'pt-BR',
        authProviders: {
          google: null,
          facebook: { clientId: 'a', clientSecret: 'b' },
          apple: { clientId: 'a', teamId: 'b', keyId: 'c', privateKey: 'd' },
        },
      },
      '0.1.0',
      'Escola Exemplo',
    );
    expect(meta.schoolName).toBe('Escola Exemplo');
    expect(meta.authProviders).toEqual(['facebook', 'apple']);
  });
});

describe('readServiceVersion', () => {
  it('lê a versão do package.json do serviço', () => {
    expect(readServiceVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
