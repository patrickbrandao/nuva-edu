import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Uma migration lida do disco. */
export interface Migration {
  version: number;
  /** Nome do arquivo sem a extensão, por exemplo `0001_base`. */
  name: string;
  file: string;
  up: string;
  /** SQL de volta; `null` quando a migration é marcada como irreversível. */
  down: string | null;
  /** SHA-256 da seção `up`: é o que não pode mudar depois de aplicada. */
  checksum: string;
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const MARKER = /^--\s*migrate:(up|down|irreversible)\s*$/;

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Verdadeiro se o trecho só tem espaços e comentários de linha. */
function isBlankSql(sql: string): boolean {
  return sql.split('\n').every((line) => line.trim() === '' || line.trim().startsWith('--'));
}

/**
 * Separa as seções de um arquivo de migration:
 *
 *     -- migrate:up
 *     CREATE TABLE ...;
 *     -- migrate:down
 *     DROP TABLE ...;
 *
 * Uma migration sem volta troca o SQL do `down` pela linha `-- migrate:irreversible`.
 */
export function parseMigration(file: string, content: string): Omit<Migration, 'file'> {
  const match = FILE_PATTERN.exec(file);
  if (!match) {
    throw new Error(
      `${file}: nome inválido. Use NNNN_descricao.sql (quatro dígitos, minúsculas, números e "_").`,
    );
  }
  const sections: Record<'up' | 'down', string[] | undefined> = { up: undefined, down: undefined };
  let current: string[] | undefined;
  let irreversible = false;

  for (const line of content.split(/\r?\n/)) {
    const marker = MARKER.exec(line.trim())?.[1];
    if (marker === 'up' || marker === 'down') {
      if (sections[marker]) {
        throw new Error(`${file}: seção "-- migrate:${marker}" repetida.`);
      }
      if (marker === 'down' && !sections.up) {
        throw new Error(`${file}: "-- migrate:down" antes de "-- migrate:up".`);
      }
      current = [];
      sections[marker] = current;
    } else if (marker === 'irreversible') {
      if (current === undefined || current !== sections.down) {
        throw new Error(`${file}: "-- migrate:irreversible" só vale dentro da seção down.`);
      }
      irreversible = true;
    } else if (current) {
      current.push(line);
    } else if (line.trim() !== '' && !line.trim().startsWith('--')) {
      throw new Error(`${file}: SQL antes de "-- migrate:up".`);
    }
  }

  if (!sections.up || !sections.down) {
    throw new Error(`${file}: faltam as seções "-- migrate:up" e "-- migrate:down".`);
  }
  const up = sections.up.join('\n').trim();
  const down = sections.down.join('\n').trim();
  if (isBlankSql(up)) {
    throw new Error(`${file}: seção up vazia.`);
  }
  if (irreversible && !isBlankSql(down)) {
    throw new Error(`${file}: migration irreversível não pode ter SQL no down.`);
  }
  if (!irreversible && isBlankSql(down)) {
    throw new Error(
      `${file}: seção down vazia. Escreva a volta ou marque "-- migrate:irreversible" (exige aval do humano).`,
    );
  }
  return {
    version: Number(match[1]),
    name: file.slice(0, -'.sql'.length),
    up,
    down: irreversible ? null : down,
    checksum: sha256(up),
  };
}

/** Lê a pasta, em ordem, e exige numeração contínua a partir de 0001. */
export async function loadMigrations(dir: string): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const migrations: Migration[] = [];
  for (const file of files) {
    const content = await readFile(join(dir, file), 'utf8');
    const migration = { ...parseMigration(file, content), file };
    const expected = migrations.length + 1;
    if (migration.version !== expected) {
      throw new Error(
        `${file}: esperava a migration ${String(expected).padStart(4, '0')}. A numeração é contínua, sem repetição nem salto.`,
      );
    }
    migrations.push(migration);
  }
  return migrations;
}

/** Hash da pasta de migrations (nomes e conteúdo dos `.sql`), usado pelo banco modelo. */
export async function hashMigrationsDir(dir: string): Promise<string> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update('\0');
    hash.update(await readFile(join(dir, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}
