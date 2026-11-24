import { describe, expect, it } from 'vitest';
import { parseRuntimeConfig } from '../src/runtime/runtimeConfig';
import { buildDevRuntimeConfig } from './devRuntimeConfig';

describe('config.json do servidor de desenvolvimento', () => {
  it('usa os padrões da spec 031 quando não há variável', () => {
    expect(buildDevRuntimeConfig('admin', {})).toEqual({
      app: 'admin',
      adminUrl: 'http://edu-admin.localhost:8080',
      classroomUrl: 'http://classroom.localhost:8080',
    });
  });

  it('monta os endereços das variáveis e some com a porta padrão do esquema', () => {
    const env = {
      NUVA_PUBLIC_SCHEME: 'https',
      NUVA_PUBLIC_PORT: '443',
      NUVA_ADMIN_HOST: 'painel.escola.com.br',
      NUVA_CLASSROOM_HOST: 'aulas.escola.com.br',
    };
    expect(buildDevRuntimeConfig('admin', env)).toEqual({
      app: 'admin',
      adminUrl: 'https://painel.escola.com.br',
      classroomUrl: 'https://aulas.escola.com.br',
    });
  });

  it('deriva os hosts de NUVA_DOMAIN e aceita porta vazia', () => {
    const config = buildDevRuntimeConfig('admin', {
      NUVA_DOMAIN: 'escola.test',
      NUVA_PUBLIC_PORT: '',
    });
    expect(config.adminUrl).toBe('http://edu-admin.escola.test');
    expect(config.classroomUrl).toBe('http://classroom.escola.test');
  });

  it('recusa valor fora do formato citando a variável', () => {
    expect(() => buildDevRuntimeConfig('admin', { NUVA_CLASSROOM_HOST: 'a b"c' })).toThrow(
      'NUVA_CLASSROOM_HOST',
    );
    expect(() => buildDevRuntimeConfig('admin', { NUVA_PUBLIC_SCHEME: 'ftp' })).toThrow(
      'NUVA_PUBLIC_SCHEME',
    );
  });

  it('gera um arquivo que o site aceita inteiro', () => {
    const config = buildDevRuntimeConfig('admin', { NUVA_PUBLIC_PORT: '9000' });
    expect(parseRuntimeConfig(config)).toEqual({ config, invalid: [] });
  });
});
