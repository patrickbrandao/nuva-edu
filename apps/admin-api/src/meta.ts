import { readFileSync } from 'node:fs';
import type { Config } from '@nuva-edu/core';

/** Corpo de `GET /api/v1/meta` (esquema `Meta` do contrato). */
export interface InstallationMeta {
  schoolName: string;
  version: string;
  currency: string;
  locale: string;
  authProviders: ('google' | 'facebook' | 'apple')[];
}

/**
 * Nome usado enquanto a escola não define o seu. O nome configurado pelo admin virá das
 * configurações da escola, por `packages/core` (tarefa aberta para o `nucleo`).
 */
export const DEFAULT_SCHOOL_NAME = 'nuva-edu';

/** Versão instalada: a do `package.json` deste serviço. */
export function readServiceVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown };
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error('apps/admin-api/package.json sem "version".');
  }
  return manifest.version;
}

/** Dados públicos da instalação, a partir da configuração. Não inclui nenhum segredo. */
export function installationMeta(
  config: Pick<Config, 'currency' | 'locale' | 'authProviders'>,
  version: string,
  schoolName: string = DEFAULT_SCHOOL_NAME,
): InstallationMeta {
  const providers = ['google', 'facebook', 'apple'] as const;
  return {
    schoolName,
    version,
    currency: config.currency,
    locale: config.locale,
    // Só o nome dos provedores ligados: as credenciais nunca saem daqui.
    authProviders: providers.filter((provider) => config.authProviders[provider] !== null),
  };
}
