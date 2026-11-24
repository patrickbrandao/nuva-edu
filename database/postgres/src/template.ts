import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import {
  connect,
  type DbConfig,
  defaultMigrationsDir,
  loadConfig,
  quoteIdent,
  toDatabaseUrl,
} from './config.ts';
import { hashMigrationsDir } from './migrations.ts';
import { migrateUp } from './migrator.ts';

/** Chave da trava consultiva do banco modelo (tomada no banco principal). */
const TEMPLATE_LOCK_KEY = '7741003002';

/** Prefixo do `COMMENT` do banco modelo; o resto é o hash da pasta de migrations. */
const COMMENT_PREFIX = 'nuva-edu migrations sha256:';

/** Mude ao alterar a forma de montar o modelo, para forçar a recriação. */
const TEMPLATE_FORMAT = 1;

export interface TemplateOptions {
  /** Conexão com o banco principal. Padrão: a do ambiente. */
  config?: DbConfig;
  /** Base dos nomes `<base>_tpl` e `<base>_test_<id>`. Padrão: o nome do banco principal. */
  baseName?: string;
  /** Pasta das migrations. */
  dir?: string;
  log?: (message: string) => void;
}

export interface TemplateResult {
  name: string;
  hash: string;
  /** Falso quando o modelo existente já estava em dia. */
  rebuilt: boolean;
}

export interface TestDatabase {
  name: string;
  config: DbConfig;
  url: string;
  /** Apaga o banco, derrubando as conexões que restarem. */
  drop: () => Promise<void>;
}

interface Resolved {
  config: DbConfig;
  base: string;
  template: string;
  testPrefix: string;
  dir: string;
}

function resolve(options: TemplateOptions): Resolved {
  const config = options.config ?? loadConfig();
  const base = options.baseName ?? config.database;
  quoteIdent(base);
  return {
    config,
    base,
    template: `${base}_tpl`,
    testPrefix: `${base}_test_`,
    dir: options.dir ?? defaultMigrationsDir,
  };
}

async function withAdmin<T>(config: DbConfig, fn: (admin: pg.Client) => Promise<T>): Promise<T> {
  const admin = await connect(config);
  try {
    return await fn(admin);
  } finally {
    await admin.end();
  }
}

async function readComment(admin: pg.Client, database: string): Promise<string | null> {
  const { rows } = await admin.query<{ comment: string | null }>(
    `SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1`,
    [database],
  );
  return rows[0]?.comment ?? null;
}

async function templateHash(dir: string): Promise<string> {
  const hash = await hashMigrationsDir(dir);
  return TEMPLATE_FORMAT === 1 ? hash : `${hash}-f${TEMPLATE_FORMAT}`;
}

/**
 * Garante que `<base>_tpl` existe com todas as migrations aplicadas. O hash da pasta fica no
 * `COMMENT` do banco, gravado por último: modelo sem o comentário certo é refeito do zero.
 */
export async function ensureTemplate(options: TemplateOptions = {}): Promise<TemplateResult> {
  const { config, template, dir } = resolve(options);
  const hash = await templateHash(dir);
  const expected = COMMENT_PREFIX + hash;
  const name = quoteIdent(template);

  return withAdmin(config, async (admin) => {
    if ((await readComment(admin, template)) === expected) {
      return { name: template, hash, rebuilt: false };
    }
    await admin.query('SELECT pg_advisory_lock($1::bigint)', [TEMPLATE_LOCK_KEY]);
    try {
      // Outra execução pode ter refeito o modelo enquanto esta esperava a trava.
      if ((await readComment(admin, template)) === expected) {
        return { name: template, hash, rebuilt: false };
      }
      options.log?.(`Refazendo o banco modelo ${template}...`);
      const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [template]);
      if (exists.rowCount) {
        await admin.query(`ALTER DATABASE ${name} WITH IS_TEMPLATE false`);
        await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
      }
      await admin.query(`CREATE DATABASE ${name}`);
      try {
        const client = await connect(config, template);
        try {
          await migrateUp(client, options.log ? { dir, log: options.log } : { dir });
        } finally {
          await client.end();
        }
        // Sem conexões, a cópia por TEMPLATE nunca encontra o modelo "em uso".
        await admin.query(`ALTER DATABASE ${name} WITH IS_TEMPLATE true ALLOW_CONNECTIONS false`);
        await admin.query(`COMMENT ON DATABASE ${name} IS '${expected}'`);
      } catch (error) {
        // Modelo pela metade não pode ser copiado por ninguém.
        await admin.query(`ALTER DATABASE ${name} WITH IS_TEMPLATE false`).catch(() => {});
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
        throw error;
      }
      return { name: template, hash, rebuilt: true };
    } finally {
      await admin.query('SELECT pg_advisory_unlock($1::bigint)', [TEMPLATE_LOCK_KEY]);
    }
  });
}

/**
 * Cria um banco de teste novo copiando o modelo (`CREATE DATABASE ... TEMPLATE`). O nome é
 * `<base>_test_<instante em base 36>_<aleatório>`, único por chamada. Chame `ensureTemplate`
 * antes, uma vez por execução.
 */
export async function createTestDatabase(options: TemplateOptions = {}): Promise<TestDatabase> {
  const { config, template, testPrefix } = resolve(options);
  const name = `${testPrefix}${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  await withAdmin(config, async (admin) => {
    // Trava compartilhada: várias cópias ao mesmo tempo, nenhuma durante a recriação do modelo.
    await admin.query('SELECT pg_advisory_lock_shared($1::bigint)', [TEMPLATE_LOCK_KEY]);
    try {
      if (!(await readComment(admin, template))?.startsWith(COMMENT_PREFIX)) {
        throw new Error(
          `Banco modelo ${template} ausente ou incompleto. Chame ensureTemplate() ou rode "pnpm db:migrate template".`,
        );
      }
      await admin.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(template)}`);
    } finally {
      await admin.query('SELECT pg_advisory_unlock_shared($1::bigint)', [TEMPLATE_LOCK_KEY]);
    }
  });
  const testConfig = { ...config, database: name };
  return {
    name,
    config: testConfig,
    url: toDatabaseUrl(testConfig),
    drop: () => dropTestDatabase(name, options),
  };
}

/** Apaga um banco de teste. Recusa nomes fora do padrão `<base>_test_*`. */
export async function dropTestDatabase(name: string, options: TemplateOptions = {}): Promise<void> {
  const { config, testPrefix } = resolve(options);
  if (!name.startsWith(testPrefix)) {
    throw new Error(`Só apago bancos ${testPrefix}*; recebi ${JSON.stringify(name)}.`);
  }
  await withAdmin(config, (admin) =>
    admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(name)} WITH (FORCE)`),
  );
}

/** Instante de criação gravado no nome do banco de teste, ou `null` se o nome não segue o padrão. */
export function testDatabaseCreatedAt(name: string, testPrefix: string): number | null {
  if (!name.startsWith(testPrefix)) {
    return null;
  }
  const match = /^([0-9a-z]+)_[0-9a-f]{8}$/.exec(name.slice(testPrefix.length));
  if (!match?.[1]) {
    return null;
  }
  const created = Number.parseInt(match[1], 36);
  return Number.isSafeInteger(created) ? created : null;
}

/**
 * Remove os bancos de teste esquecidos por execuções interrompidas: os criados há mais de
 * `maxAgeMs` (padrão 1 hora). Devolve os nomes removidos.
 */
export async function dropStaleTestDatabases(
  options: TemplateOptions & { maxAgeMs?: number } = {},
): Promise<string[]> {
  const { config, testPrefix } = resolve(options);
  const limit = Date.now() - (options.maxAgeMs ?? 60 * 60 * 1000);
  return withAdmin(config, async (admin) => {
    const { rows } = await admin.query<{ datname: string }>(
      'SELECT datname FROM pg_database WHERE starts_with(datname, $1) ORDER BY datname',
      [testPrefix],
    );
    const dropped: string[] = [];
    for (const { datname } of rows) {
      const created = testDatabaseCreatedAt(datname, testPrefix);
      if (created !== null && created < limit) {
        await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(datname)} WITH (FORCE)`);
        dropped.push(datname);
      }
    }
    return dropped;
  });
}
