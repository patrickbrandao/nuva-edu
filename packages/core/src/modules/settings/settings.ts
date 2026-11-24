import type { Database } from '../../db/database.ts';
import { type FieldError, validationFailed } from '../../errors/domain-error.ts';

// Configuração da escola, na tabela `settings` (chave → valor JSON).
// Dono dos dados: admin-api. Só ela chama `setSetting`; os demais componentes só leem.

/**
 * Registro das configurações: chave → tipo do valor. A chave segue a restrição
 * `settings_key_format` (migration 0001): palavras em minúsculas separadas por ponto.
 */
export interface SettingValues {
  /** Nome da escola, mostrado nos sites e nos e-mails (`schoolName` de `/api/v1/meta`). */
  'school.name': string;
  /** Fuso da escola, no formato IANA: janela das tarefas recorrentes e datas exibidas. */
  'school.timezone': string;
}

export type SettingKey = keyof SettingValues;

export const SCHOOL_NAME_MAX_LENGTH = 120;

interface SettingDefinition<T> {
  /** Valor usado quando a chave não existe na tabela ou o valor guardado é inválido. */
  defaultValue: T;
  /** Devolve o valor aceito (normalizado), ou a mensagem de recusa. */
  parse(value: unknown): { ok: true; value: T } | { ok: false; message: string };
}

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
};

export const SETTING_KEYS = Object.keys(SETTING_DEFINITIONS) as SettingKey[];

/** Valores usados enquanto a escola não define os seus. */
export const SETTING_DEFAULTS: Readonly<SettingValues> = {
  'school.name': SETTING_DEFINITIONS['school.name'].defaultValue,
  'school.timezone': SETTING_DEFINITIONS['school.timezone'].defaultValue,
};

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function resolve<K extends SettingKey>(key: K, stored: unknown): SettingValues[K] {
  const definition: SettingDefinition<SettingValues[K]> = SETTING_DEFINITIONS[key];
  if (stored === undefined) {
    return definition.defaultValue;
  }
  const parsed = definition.parse(stored);
  // Valor inválido gravado por fora da admin-api não derruba a leitura: vale o padrão.
  return parsed.ok ? parsed.value : definition.defaultValue;
}

/** Todas as configurações do registro numa consulta só, com o padrão no que faltar. */
export async function getSettings(db: Database): Promise<SettingValues> {
  const rows = await db
    .selectFrom('settings')
    .select(['key', 'value'])
    .where('key', 'in', SETTING_KEYS)
    .execute();
  const stored = new Map<string, unknown>(rows.map((row) => [row.key, row.value]));
  return {
    'school.name': resolve('school.name', stored.get('school.name')),
    'school.timezone': resolve('school.timezone', stored.get('school.timezone')),
  };
}

/** Uma configuração, direto do banco (sem cache), com o padrão quando não definida. */
export async function getSetting<K extends SettingKey>(
  db: Database,
  key: K,
): Promise<SettingValues[K]> {
  const row = await db
    .selectFrom('settings')
    .select('value')
    .where('key', '=', key)
    .executeTakeFirst();
  return resolve(key, row?.value);
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

export interface SettingsReaderOptions {
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
    const current = getSettings(db)
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
