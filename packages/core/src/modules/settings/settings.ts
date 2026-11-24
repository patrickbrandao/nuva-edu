import type { Database } from '../../db/database.ts';
import { type FieldError, validationFailed } from '../../errors/domain-error.ts';
import type { Logger } from '../../logging/logger.ts';
import { isImageId } from '../images/image-url.ts';

// Configuração da escola, na tabela `settings` (chave → valor JSON); a lista única das chaves é
// a tabela "Configurações da escola" da spec 031.
// Dono dos dados: admin-api. Só ela chama `setSetting`; os demais componentes só leem.

/**
 * Registro das configurações: chave → tipo do valor. A chave segue a restrição
 * `settings_key_format` (migration 0001): `grupo.nome`, em minúsculas com `_`.
 */
export interface SettingValues {
  /** Nome da escola, mostrado nos sites e nos e-mails (`schoolName` de `/api/v1/meta`). */
  'school.name': string;
  /** Fuso da escola, no formato IANA: janela das tarefas recorrentes e datas exibidas. */
  'school.timezone': string;
  /**
   * Imagem do logotipo (spec 029, finalidade `school_logo`), ou `null` sem logotipo. Só o
   * formato é conferido aqui; `schoolLogoUrl` monta o `logoUrl` do `/meta`.
   */
  'school.logo_image_id': string | null;
  /** Cor de destaque `#RRGGBB` (`accentColor` do `/meta`), ou `null` para a padrão da interface. */
  'school.accent_color': string | null;
  /** Endereço `https` do código-fonte (`sourceCodeUrl` do `/meta`); sempre presente (AGPL-3.0). */
  'school.source_code_url': string;
}

export type SettingKey = keyof SettingValues;

export const SCHOOL_NAME_MAX_LENGTH = 120;
/** Repositório do projeto: padrão de `school.source_code_url`. */
export const DEFAULT_SOURCE_CODE_URL = 'https://github.com/patrickbrandao/nuva-edu';
export const SOURCE_CODE_URL_MAX_LENGTH = 2048;

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

interface SettingDefinition<T> {
  /** Valor usado quando a chave não existe na tabela ou o valor guardado é inválido. */
  defaultValue: T;
  /** Devolve o valor aceito (normalizado), ou a mensagem de recusa. */
  parse(value: unknown): ParseResult<T>;
}

const ACCENT_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const SETTING_DEFINITIONS: { readonly [K in SettingKey]: SettingDefinition<SettingValues[K]> } = {
  'school.name': {
    defaultValue: 'nuva-edu',
    parse(value) {
      const text = typeof value === 'string' ? value.trim() : '';
      if (text === '') {
        return { ok: false, message: 'Informe o nome da escola.' };
      }
      if (text.length > SCHOOL_NAME_MAX_LENGTH) {
        return {
          ok: false,
          message: `O nome da escola tem no máximo ${SCHOOL_NAME_MAX_LENGTH} caracteres.`,
        };
      }
      return { ok: true, value: text };
    },
  },
  'school.timezone': {
    defaultValue: 'America/Sao_Paulo',
    parse(value) {
      if (typeof value !== 'string' || !isTimeZone(value)) {
        return { ok: false, message: 'Informe um fuso horário IANA, como America/Sao_Paulo.' };
      }
      return { ok: true, value };
    },
  },
  'school.logo_image_id': {
    defaultValue: null,
    parse(value) {
      if (value === null) {
        return { ok: true, value: null };
      }
      if (!isImageId(value)) {
        return { ok: false, message: 'Informe o identificador (UUID) da imagem, ou nulo.' };
      }
      return { ok: true, value: value.toLowerCase() };
    },
  },
  'school.accent_color': {
    defaultValue: null,
    parse(value) {
      if (value === null) {
        return { ok: true, value: null };
      }
      if (typeof value !== 'string' || !ACCENT_COLOR_PATTERN.test(value)) {
        return { ok: false, message: 'Informe a cor no formato #RRGGBB, ou nulo.' };
      }
      return { ok: true, value };
    },
  },
  'school.source_code_url': {
    defaultValue: DEFAULT_SOURCE_CODE_URL,
    parse(value) {
      const text = typeof value === 'string' ? value.trim() : '';
      if (text.length > SOURCE_CODE_URL_MAX_LENGTH || !isHttpsUrl(text)) {
        return { ok: false, message: 'Informe um endereço completo começando com https://.' };
      }
      return { ok: true, value: text };
    },
  },
};

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

/** Valores usados enquanto a escola não define os seus. */
export const SETTING_DEFAULTS: Readonly<SettingValues> = {
  'school.name': SETTING_DEFINITIONS['school.name'].defaultValue,
  'school.timezone': SETTING_DEFINITIONS['school.timezone'].defaultValue,
  'school.logo_image_id': SETTING_DEFINITIONS['school.logo_image_id'].defaultValue,
  'school.accent_color': SETTING_DEFINITIONS['school.accent_color'].defaultValue,
  'school.source_code_url': SETTING_DEFINITIONS['school.source_code_url'].defaultValue,
};

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** URL `https` com host, sem usuário nem senha embutidos e sem espaços. */
function isHttpsUrl(value: string): boolean {
  if (!/^https:\/\/\S+$/i.test(value)) {
    return false;
  }
  const url = URL.parse(value);
  return url !== null && url.protocol === 'https:' && url.username === '' && url.password === '';
}

export interface SettingsReadOptions {
  /**
   * Recebe o aviso de valor inválido guardado no banco (spec 031): a leitura segue com o padrão.
   * O aviso leva só a chave (`setting_key`), nunca o valor. Sem logger, a troca é silenciosa.
   */
  logger?: Pick<Logger, 'warn'>;
}

function resolve<K extends SettingKey>(
  key: K,
  stored: unknown,
  options: SettingsReadOptions,
): SettingValues[K] {
  const definition: SettingDefinition<SettingValues[K]> = SETTING_DEFINITIONS[key];
  if (stored === undefined) {
    return definition.defaultValue;
  }
  const parsed = definition.parse(stored);
  if (parsed.ok) {
    return parsed.value;
  }
  // Valor inválido gravado por fora da admin-api não derruba a leitura: vale o padrão.
  options.logger?.warn(
    { setting_key: key },
    'Configuração com valor inválido no banco; usando o padrão',
  );
  return definition.defaultValue;
}

/** Todas as configurações do registro numa consulta só, com o padrão no que faltar. */
export async function getSettings(
  db: Database,
  options: SettingsReadOptions = {},
): Promise<SettingValues> {
  const rows = await db
    .selectFrom('settings')
    .select(['key', 'value'])
    .where('key', 'in', SETTING_KEYS)
    .execute();
  const stored = new Map<string, unknown>(rows.map((row) => [row.key, row.value]));
  const read = <K extends SettingKey>(key: K) => resolve(key, stored.get(key), options);
  return {
    'school.name': read('school.name'),
    'school.timezone': read('school.timezone'),
    'school.logo_image_id': read('school.logo_image_id'),
    'school.accent_color': read('school.accent_color'),
    'school.source_code_url': read('school.source_code_url'),
  };
}

/** Uma configuração, direto do banco (sem cache), com o padrão quando não definida. */
export async function getSetting<K extends SettingKey>(
  db: Database,
  key: K,
  options: SettingsReadOptions = {},
): Promise<SettingValues[K]> {
  const row = await db
    .selectFrom('settings')
    .select('value')
    .where('key', '=', key)
    .executeTakeFirst();
  return resolve(key, row?.value, options);
}

/** Nome da escola; `nuva-edu` enquanto não definido. */
export function getSchoolName(db: Database): Promise<string> {
  return getSetting(db, 'school.name');
}

/** Fuso da escola; `America/Sao_Paulo` enquanto não definido. */
export function getSchoolTimezone(db: Database): Promise<string> {
  return getSetting(db, 'school.timezone');
}

/**
 * Grava uma configuração (cria ou substitui) e devolve o valor aceito, já normalizado. Escrita
 * da admin-api. Valor inválido lança `validation_failed` com o campo `body.value`.
 * Aceita transação. Depois de confirmar, chame `invalidate()` do leitor com cache deste
 * processo; os outros processos enxergam a mudança quando o cache deles vencer.
 */
export async function setSetting<K extends SettingKey>(
  db: Database,
  key: K,
  value: SettingValues[K],
): Promise<SettingValues[K]> {
  const definition: SettingDefinition<SettingValues[K]> = SETTING_DEFINITIONS[key];
  const parsed = definition.parse(value);
  if (!parsed.ok) {
    const errors: FieldError[] = [{ path: 'body.value', message: parsed.message }];
    throw validationFailed(errors, `Valor inválido para a configuração "${key}".`);
  }
  const json = JSON.stringify(parsed.value);
  await db
    .insertInto('settings')
    .values({ key, value: json })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value: json }))
    .execute();
  return parsed.value;
}

/** Tempo padrão de vida do cache do leitor. */
export const SETTINGS_CACHE_TTL_MS = 30_000;

export interface SettingsReaderOptions extends SettingsReadOptions {
  /** Por quanto tempo uma leitura vale. Padrão: `SETTINGS_CACHE_TTL_MS`. Zero desliga o cache. */
  ttlMs?: number;
  /** Relógio em milissegundos, para teste. Padrão: `Date.now`. */
  now?: () => number;
}

export interface SettingsReader {
  /** Todas as configurações, do cache enquanto ele valer. */
  all(): Promise<SettingValues>;
  get<K extends SettingKey>(key: K): Promise<SettingValues[K]>;
  schoolName(): Promise<string>;
  schoolTimezone(): Promise<string>;
  /** Descarta o cache: a próxima leitura vai ao banco. Chame depois de `setSetting`. */
  invalidate(): void;
}

/**
 * Leitor com cache curto, um por processo: as rotas que mostram o nome da escola não vão ao
 * banco a cada requisição. Uma consulta traz todas as chaves; leituras simultâneas com o cache
 * vencido compartilham a mesma consulta. Falha de leitura não fica no cache.
 */
export function createSettingsReader(
  db: Database,
  options: SettingsReaderOptions = {},
): SettingsReader {
  const ttlMs = options.ttlMs ?? SETTINGS_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: { values: SettingValues; expiresAt: number } | null = null;
  let loading: Promise<SettingValues> | null = null;
  /** Muda a cada `invalidate`: leitura iniciada antes não repovoa o cache. */
  let generation = 0;

  const all = (): Promise<SettingValues> => {
    if (cached && now() < cached.expiresAt) {
      return Promise.resolve(cached.values);
    }
    if (loading) {
      return loading;
    }
    const startedAt = generation;
    const current = getSettings(db, options)
      .then((values) => {
        if (generation === startedAt) {
          cached = { values, expiresAt: now() + ttlMs };
        }
        return values;
      })
      .finally(() => {
        if (loading === current) {
          loading = null;
        }
      });
    loading = current;
    return current;
  };

  return {
    all,
    get: async (key) => (await all())[key],
    schoolName: async () => (await all())['school.name'],
    schoolTimezone: async () => (await all())['school.timezone'],
    invalidate: () => {
      generation += 1;
      cached = null;
      loading = null;
    },
  };
}
