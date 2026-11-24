import { createHash, randomBytes } from 'node:crypto';
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

/**
 * Primeira metade da chave da trava consultiva de cada modelo (forma de dois `int4`, tomada no
 * banco principal); a segunda metade sai do hash das migrations. Conjuntos diferentes travam
 * chaves diferentes e não esperam um pelo outro.
 */
const TEMPLATE_LOCK_CLASS = 774100300;

/** Prefixo do `COMMENT` do banco modelo; o resto é o hash da pasta de migrations. */
const COMMENT_PREFIX = 'nuva-edu migrations sha256:';

/** Marca do último uso no `COMMENT`, depois do hash: `... usado:<ms desde 1970>`. */
const USED_MARK = ' usado:';

/** Mude ao alterar a forma de montar o modelo, para forçar um modelo novo. */
const TEMPLATE_FORMAT = 1;

/** Tamanho do trecho do hash no nome do modelo (`<base>_tpl_<12 hex>`). */
const NAME_HASH_LENGTH = 12;

/** O último uso só é regravado quando está mais velho que isto: evita escrita a cada execução. */
const TOUCH_AFTER_MS = 10 * 60 * 1000;

/** Padrões do expurgo dos modelos: sem uso há 7 dias, e sempre os 3 usados por último ficam. */
const STALE_TEMPLATE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_TEMPLATES = 3;

export interface TemplateOptions {
  /** Conexão com o banco principal. Padrão: a do ambiente. */
  config?: DbConfig;
  /**
   * Base dos nomes `<base>_tpl_<hash>` e `<base>_test_<id>`. Padrão: o nome do banco principal.
   */
  baseName?: string;
  /** Pasta das migrations. O modelo é o do conjunto desta pasta. */
  dir?: string;
  log?: (message: string) => void;
}

export interface TemplateResult {
  /** Nome do modelo do conjunto: `<base>_tpl_<12 primeiros do hash>`. */
  name: string;
  hash: string;
  /** Falso quando o modelo existente já estava pronto. */
  rebuilt: boolean;
}

export interface TestDatabase {
  name: string;
  config: DbConfig;
  url: string;
  /** Apaga o banco, derrubando as conexões que restarem. */
  drop: () => Promise<void>;
}

export interface StaleTemplateOptions extends TemplateOptions {
  /** Modelo sem uso há mais que isto pode sair. Padrão: 7 dias. */
  maxAgeMs?: number;
  /** Os N modelos usados por último nunca saem. Padrão: 3. */
  keep?: number;
}

interface Resolved {
  config: DbConfig;
  base: string;
  templatePrefix: string;
  testPrefix: string;
  dir: string;
}

function resolve(options: TemplateOptions): Resolved {
  const config = options.config ?? loadConfig();
  const base = options.baseName ?? config.database;
  // O nome mais longo derivado da base é o do modelo: ele precisa caber em 63 caracteres.
  quoteIdent(`${base}_tpl_${'0'.repeat(NAME_HASH_LENGTH)}`);
  return {
    config,
    base,
    templatePrefix: `${base}_tpl_`,
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

/** Trecho do nome do modelo: os 12 primeiros hex do hash (ou do hash do hash com formato). */
function nameHash(hash: string): string {
  const hex = /^[0-9a-f]+$/.test(hash) ? hash : createHash('sha256').update(hash).digest('hex');
  return hex.slice(0, NAME_HASH_LENGTH);
}

/** Segunda metade da chave da trava: os 8 primeiros hex do trecho do nome, como `int4`. */
function lockObject(shortHash: string): number {
  return Number.parseInt(shortHash.slice(0, 8), 16) | 0;
}

/** Modelo pronto: o `COMMENT` traz o hash certo (com ou sem a marca de uso). */
function isReady(comment: string | null, expected: string): boolean {
  return comment === expected || (comment?.startsWith(expected + USED_MARK) ?? false);
}

/** Instante do último uso gravado no `COMMENT`, ou `null` sem a marca. */
function usedAt(comment: string | null): number | null {
  const at = comment?.lastIndexOf(USED_MARK) ?? -1;
  if (!comment || at < 0) {
    return null;
  }
  const value = Number(comment.slice(at + USED_MARK.length));
  return Number.isSafeInteger(value) ? value : null;
}

async function writeComment(admin: pg.Client, name: string, expected: string): Promise<void> {
  // O texto só tem hex, letras, dois-pontos, espaço e dígitos: não há aspas a escapar.
  await admin.query(
    `COMMENT ON DATABASE ${quoteIdent(name)} IS '${expected}${USED_MARK}${Date.now()}'`,
  );
}

/**
 * Regrava o último uso de um modelo pronto, se ele estiver velho. Só com a trava exclusiva livre
 * (ninguém criando nem copiando o modelo); ocupada, fica para a próxima. Nunca falha.
 */
async function touchTemplate(
  admin: pg.Client,
  name: string,
  shortHash: string,
  expected: string,
): Promise<void> {
  try {
    const comment = await readComment(admin, name);
    const used = usedAt(comment);
    if (used !== null && Date.now() - used < TOUCH_AFTER_MS) {
      return;
    }
    const { rows } = await admin.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1, $2) AS locked',
      [TEMPLATE_LOCK_CLASS, lockObject(shortHash)],
    );
    if (!rows[0]?.locked) {
      return;
    }
    try {
      if (isReady(await readComment(admin, name), expected)) {
        await writeComment(admin, name, expected);
      }
    } finally {
      await admin.query('SELECT pg_advisory_unlock($1, $2)', [
        TEMPLATE_LOCK_CLASS,
        lockObject(shortHash),
      ]);
    }
  } catch {
    // Marca de uso é só um palpite para o expurgo; perder uma não estraga nada.
  }
}

/**
 * Garante o modelo do conjunto de migrations de `dir`: `<base>_tpl_<12 primeiros do hash>`, com
 * todas as migrations aplicadas. Conjuntos diferentes (worktrees com migrations diferentes) têm
 * modelos diferentes e não se refazem um por cima do outro. O hash completo fica no `COMMENT` do
 * banco, gravado por último: modelo sem o comentário certo é refeito do zero. A criação corre sob
 * a trava consultiva do conjunto, então dois processos do mesmo conjunto criam o modelo uma vez.
 * Quando cria um modelo, expurga os modelos velhos sem uso (`dropStaleTemplates`).
 */
export async function ensureTemplate(options: TemplateOptions = {}): Promise<TemplateResult> {
  const { config, templatePrefix, dir } = resolve(options);
  const hash = await templateHash(dir);
  const short = nameHash(hash);
  const template = templatePrefix + short;
  const expected = COMMENT_PREFIX + hash;
  const name = quoteIdent(template);
  const lockArgs = [TEMPLATE_LOCK_CLASS, lockObject(short)];

  const result = await withAdmin(config, async (admin): Promise<TemplateResult> => {
    if (isReady(await readComment(admin, template), expected)) {
      await touchTemplate(admin, template, short, expected);
      return { name: template, hash, rebuilt: false };
    }
    await admin.query('SELECT pg_advisory_lock($1, $2)', lockArgs);
    try {
      // Outra execução do mesmo conjunto pode ter criado o modelo enquanto esta esperava.
      if (isReady(await readComment(admin, template), expected)) {
        return { name: template, hash, rebuilt: false };
      }
      options.log?.(`Criando o banco modelo ${template}...`);
      const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [template]);
      if (exists.rowCount) {
        // Resto de uma criação interrompida (ou de outro conjunto com o mesmo trecho de hash).
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
        await writeComment(admin, template, expected);
      } catch (error) {
        // Modelo pela metade não pode ser copiado por ninguém.
        await admin.query(`ALTER DATABASE ${name} WITH IS_TEMPLATE false`).catch(() => {});
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
        throw error;
      }
      return { name: template, hash, rebuilt: true };
    } finally {
      await admin.query('SELECT pg_advisory_unlock($1, $2)', lockArgs);
    }
  });

  if (result.rebuilt) {
    try {
      const dropped = await dropStaleTemplates(options);
      for (const old of dropped) {
        options.log?.(`Banco modelo sem uso removido: ${old}`);
      }
    } catch (error) {
      options.log?.(
        `Expurgo dos modelos antigos falhou (segue sem ele): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}

/**
 * Cria um banco de teste novo copiando o modelo do conjunto de `dir`
 * (`CREATE DATABASE ... TEMPLATE <base>_tpl_<hash>`). O nome é
 * `<base>_test_<instante em base 36>_<aleatório>`, único por chamada. Chame `ensureTemplate`
 * antes, uma vez por execução, com a mesma pasta.
 */
export async function createTestDatabase(options: TemplateOptions = {}): Promise<TestDatabase> {
  const { config, templatePrefix, testPrefix, dir } = resolve(options);
  const hash = await templateHash(dir);
  const short = nameHash(hash);
  const template = templatePrefix + short;
  const lockArgs = [TEMPLATE_LOCK_CLASS, lockObject(short)];
  const name = `${testPrefix}${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
  await withAdmin(config, async (admin) => {
    // Trava compartilhada: várias cópias ao mesmo tempo, nenhuma durante a criação do modelo
    // nem durante o expurgo dele.
    await admin.query('SELECT pg_advisory_lock_shared($1, $2)', lockArgs);
    try {
      if (!isReady(await readComment(admin, template), COMMENT_PREFIX + hash)) {
        throw new Error(
          `Banco modelo ${template} ausente ou incompleto. Chame ensureTemplate() ou rode "pnpm db:migrate template".`,
        );
      }
      await admin.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(template)}`);
    } finally {
      await admin.query('SELECT pg_advisory_unlock_shared($1, $2)', lockArgs);
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

/**
 * Remove os modelos `<base>_tpl_<hash>` que nenhum conjunto usa há mais de `maxAgeMs` (padrão
 * 7 dias), guardando sempre os `keep` usados por último (padrão 3) e o do conjunto de `dir`.
 * Cada modelo só sai com a trava exclusiva dele livre: modelo sendo criado ou copiado fica.
 * Modelo sem `COMMENT` pronto e com a trava livre é resto de criação interrompida e sai.
 * Não toca no modelo antigo de nome fixo (`<base>_tpl`). Devolve os nomes removidos.
 */
export async function dropStaleTemplates(options: StaleTemplateOptions = {}): Promise<string[]> {
  const { config, base, templatePrefix, dir } = resolve(options);
  const current = templatePrefix + nameHash(await templateHash(dir));
  const limit = Date.now() - (options.maxAgeMs ?? STALE_TEMPLATE_AGE_MS);
  const keep = options.keep ?? KEEP_TEMPLATES;
  const pattern = new RegExp(`^${base}_tpl_([0-9a-f]{${NAME_HASH_LENGTH}})$`);

  return withAdmin(config, async (admin) => {
    const { rows } = await admin.query<{ datname: string; comment: string | null }>(
      `SELECT datname, shobj_description(oid, 'pg_database') AS comment
         FROM pg_database WHERE starts_with(datname, $1)`,
      [templatePrefix],
    );
    const candidates = rows
      .map((row) => ({ ...row, short: pattern.exec(row.datname)?.[1], used: usedAt(row.comment) }))
      .filter((row): row is typeof row & { short: string } => row.short !== undefined)
      .sort((a, b) => (b.used ?? 0) - (a.used ?? 0));
    const kept = new Set(
      candidates
        .filter((row) => row.comment?.startsWith(COMMENT_PREFIX))
        .slice(0, Math.max(0, keep))
        .map((row) => row.datname),
    );
    kept.add(current);

    const dropped: string[] = [];
    for (const row of candidates) {
      if (kept.has(row.datname)) {
        continue;
      }
      const lockArgs = [TEMPLATE_LOCK_CLASS, lockObject(row.short)];
      const { rows: lock } = await admin.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1, $2) AS locked',
        lockArgs,
      );
      if (!lock[0]?.locked) {
        continue;
      }
      try {
        // Relido sob a trava: alguém pode ter usado o modelo desde a listagem.
        const comment = await readComment(admin, row.datname);
        const ready = comment?.startsWith(COMMENT_PREFIX) ?? false;
        const used = usedAt(comment);
        if (ready && (used === null || used >= limit)) {
          // Sem marca de uso (modelo de antes da marca) ou usado há pouco: fica.
          continue;
        }
        const name = quoteIdent(row.datname);
        await admin.query(`ALTER DATABASE ${name} WITH IS_TEMPLATE false`);
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        dropped.push(row.datname);
      } finally {
        await admin.query('SELECT pg_advisory_unlock($1, $2)', lockArgs);
      }
    }
    return dropped.sort();
  });
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
