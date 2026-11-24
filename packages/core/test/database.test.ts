import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import {
  closeDatabase,
  createDatabase,
  createLogger,
  type Database,
  pingDatabase,
  summarizeDatabaseError,
} from '../src/index.ts';

const lines: string[] = [];
const logger = createLogger({
  service: 'core-test',
  level: 'debug',
  write: (line) => lines.push(line),
});
const records = () => lines.map((line) => JSON.parse(line));

let db: Database;

beforeAll(() => {
  db = createDatabase({
    connectionString: inject('databaseUrl'),
    maxConnections: 2,
    applicationName: 'core-test',
    logger,
  });
});

afterAll(async () => {
  await closeDatabase(db);
});

describe('createDatabase', () => {
  it('responde ao ping e se identifica no servidor', async () => {
    expect(await pingDatabase(db)).toBe(true);
    const result = await sql<{
      name: string;
    }>`select current_setting('application_name') as name`.execute(db);
    expect(result.rows[0]?.name).toBe('core-test');
  });

  it('consulta com os tipos gerados, em camelCase, sem converter o conteúdo JSON', async () => {
    const value = { snake_case_key: 1, nested: { other_key: true } };
    const inserted = await db
      .insertInto('settings')
      .values({ key: 'core_test.sample', value: JSON.stringify(value) })
      .returning(['id', 'key', 'value', 'createdAt', 'updatedAt'])
      .executeTakeFirstOrThrow();
    expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted.createdAt).toBeInstanceOf(Date);
    expect(inserted.value).toEqual(value);

    const found = await db
      .selectFrom('settings')
      .select(['key', 'updatedAt'])
      .where('key', '=', 'core_test.sample')
      .orderBy('createdAt', 'desc')
      .executeTakeFirstOrThrow();
    expect(found.key).toBe('core_test.sample');
    expect(found.updatedAt).toBeInstanceOf(Date);
  });

  it('desfaz a transação quando o bloco falha', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await trx
          .insertInto('settings')
          .values({ key: 'core_test.rollback', value: JSON.stringify(1) })
          .execute();
        throw new Error('desiste');
      }),
    ).rejects.toThrow('desiste');
    const row = await db
      .selectFrom('settings')
      .select('id')
      .where('key', '=', 'core_test.rollback')
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it('registra o SQL das consultas em debug, sem os parâmetros', async () => {
    lines.length = 0;
    await db
      .selectFrom('settings')
      .select('id')
      .where('key', '=', 'parametro-que-nao-pode-aparecer')
      .execute();
    const [record] = records();
    expect(record).toMatchObject({ level: 'debug', msg: 'Consulta executada' });
    expect(record.sql).toContain('from "settings"');
    expect(record.sql).toContain('$1');
    expect(typeof record.duration_ms).toBe('number');
    expect(lines.join('')).not.toContain('parametro-que-nao-pode-aparecer');
  });

  it('registra a falha sem os valores da linha recusada', async () => {
    lines.length = 0;
    const insert = db
      .insertInto('settings')
      .values({ key: 'Chave Inválida', value: JSON.stringify({ note: 'valor-da-linha-recusada' }) })
      .execute();
    await expect(insert).rejects.toThrow(/settings_key_format/);
    const error = await insert.catch((reason: unknown) => reason);
    expect((error as { detail?: string }).detail).toContain('valor-da-linha-recusada');

    const failure = records().find((record) => record.level === 'error');
    expect(failure).toMatchObject({
      msg: 'Consulta falhou',
      err: { code: '23514', table: 'settings', constraint: 'settings_key_format' },
    });
    expect(lines.join('')).not.toContain('valor-da-linha-recusada');

    // Mesmo quando o erro cru do pg vai direto ao logger, o detalhe não sai.
    logger.error(error as Error, 'erro cru');
    expect(lines.join('')).not.toContain('valor-da-linha-recusada');
  });
});

describe('banco fora do ar', () => {
  it('pingDatabase devolve false em vez de lançar', async () => {
    const offline = createDatabase({ connectionString: 'postgres://nuva:x@127.0.0.1:1/nuva_edu' });
    try {
      expect(await pingDatabase(offline)).toBe(false);
    } finally {
      await closeDatabase(offline);
    }
  });
});

describe('summarizeDatabaseError', () => {
  it('mantém só os campos que identificam o erro', () => {
    const error = Object.assign(new Error('duplicate key'), {
      code: '23505',
      severity: 'ERROR',
      constraint: 'users_email_unique',
      detail: 'Key (email)=(ana@example.com) already exists.',
      length: 200,
    });
    expect(summarizeDatabaseError(error)).toEqual({
      type: 'Error',
      message: 'duplicate key',
      code: '23505',
      severity: 'ERROR',
      constraint: 'users_email_unique',
    });
  });

  it('aceita qualquer valor lançado', () => {
    expect(summarizeDatabaseError('texto')).toEqual({ type: 'UnknownError' });
  });
});
