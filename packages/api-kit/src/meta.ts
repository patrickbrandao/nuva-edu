import { readFileSync } from 'node:fs';
import {
  type Config,
  type SettingsReader,
  type SettingValues,
  schoolLogoUrl,
} from '@nuva-edu/core';
import type { FastifyInstance } from 'fastify';

// `GET /api/v1/meta` (spec 003, "Meta"): o mesmo esquema `Meta` e a mesma montagem nas duas APIs.

/** `operationId` de `GET /api/v1/meta` nos dois contratos. */
export const META_OPERATION = 'getMeta';

/** Corpo de `GET /api/v1/meta` (esquema `Meta` dos contratos). Os oito campos vão sempre. */
export interface InstallationMeta {
  schoolName: string;
  version: string;
  currency: string;
  locale: string;
  authProviders: ('google' | 'facebook' | 'apple')[];
  /** Caminho do logotipo na própria API (variante de 256 px), ou `null` sem logotipo. */
  logoUrl: string | null;
  /** `#RRGGBB`, ou `null` para a cor padrão de `packages/ui`. */
  accentColor: string | null;
  sourceCodeUrl: string;
}

/** O que o `/meta` usa da configuração do processo. */
export type MetaConfig = Pick<Config, 'currency' | 'locale' | 'authProviders'>;

/** O que o `/meta` usa das configurações da escola (`settings`). */
export type MetaSettings = Pick<
  SettingValues,
  'school.name' | 'school.logo_image_id' | 'school.accent_color' | 'school.source_code_url'
>;

const AUTH_PROVIDERS = ['google', 'facebook', 'apple'] as const;

/**
 * Dados públicos da instalação e da marca. `settings` vem do leitor do núcleo, que já aplicou o
 * padrão no que falta ou é inválido. Não inclui nenhum segredo.
 */
export function installationMeta(
  config: MetaConfig,
  version: string,
  settings: MetaSettings,
): InstallationMeta {
  return {
    schoolName: settings['school.name'],
    version,
    currency: config.currency,
    locale: config.locale,
    // Só o nome dos provedores ligados: as credenciais nunca saem daqui.
    authProviders: AUTH_PROVIDERS.filter((provider) => config.authProviders[provider] !== null),
    logoUrl: schoolLogoUrl(settings['school.logo_image_id']),
    accentColor: settings['school.accent_color'],
    sourceCodeUrl: settings['school.source_code_url'],
  };
}

/**
 * Versão instalada: a `version` de um `package.json` (o do serviço). Na imagem é a versão
 * gravada pelo argumento de build `NUVA_VERSION` (spec 031).
 *
 * ```ts
 * readPackageVersion(new URL('../package.json', import.meta.url));
 * ```
 */
export function readPackageVersion(packageJson: string | URL): string {
  const manifest = JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: unknown };
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error(`${String(packageJson)} sem "version".`);
  }
  return manifest.version;
}

export interface MetaRouteOptions {
  config: MetaConfig;
  /** Versão do serviço (`readPackageVersion`). */
  version: string;
  /**
   * Leitor das configurações da escola, um por processo e criado com o `logger`
   * (`createSettingsReader(db, { logger })`): sem ele o aviso de valor inválido não sai.
   */
  settings: Pick<SettingsReader, 'all'>;
}

/**
 * Registra `GET /api/v1/meta` (operação `getMeta`), sem sessão. Lê `settings` pelo leitor com
 * cache do núcleo; banco fora do ar com o cache vencido vira `503 database_unavailable`.
 */
export function registerMetaRoute(app: FastifyInstance, options: MetaRouteOptions): void {
  app.operation(META_OPERATION, async () =>
    installationMeta(options.config, options.version, await options.settings.all()),
  );
}
