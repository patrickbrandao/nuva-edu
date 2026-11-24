import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  closeDatabase,
  createDatabase,
  createSettingsReader,
  type Database,
  getSchoolName,
  getSchoolTimezone,
  getSetting,
  getSettings,
  isDomainError,
  SCHOOL_NAME_MAX_LENGTH,
  SETTING_DEFAULTS,
  SETTING_KEYS,
  SETTINGS_CACHE_TTL_MS,
  setSetting,
} from '../src/index.ts';

let db: Database;
let queries = 0;

beforeAll(() => {
  db = createDatabase({
    connectionString: inject('databaseUrl'),
    maxConnections: 3,
    logger: {
      debug: () => {
        queries += 1;
      },
      error: () => {},
    } as never,
  });
});

afterAll(async () => {
  await closeDatabase(db);
});

beforeEach(async () => {
  await sql`DELETE FROM settings WHERE key LIKE 'school.%'`.execute(db);
  queries = 0;
});

describe('leitura das configurações', () => {
  it('as chaves passam na restrição de formato da tabela', () => {
    expect(SETTING_KEYS).toEqual(['school.name', 'school.timezone']);
    for (const key of SETTING_KEYS) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/);
    }
  });

  it('devolve o padrão enquanto a escola não define', async () => {
    expect(await getSchoolName(db)).toBe('nuva-edu');
    expect(await getSchoolTimezone(db)).toBe('America/Sao_Paulo');
    expect(await getSettings(db)).toEqual(SETTING_DEFAULTS);
  });

  it('devolve o que foi gravado', async () => {
    expect(await setSetting(db, 'school.name', '  Escola do Zé  ')).toBe('Escola do Zé');
    await setSetting(db, 'school.timezone', 'America/Manaus');
    expect(await getSchoolName(db)).toBe('Escola do Zé');
    expect(await getSetting(db, 'school.timezone')).toBe('America/Manaus');
    expect(await getSettings(db)).toEqual({
      'school.name': 'Escola do Zé',
      'school.timezone': 'America/Manaus',
    });
  });

  it('valor inválido gravado por fora não derruba a leitura: vale o padrão', async () => {
    await sql`
      INSERT INTO settings (key, value) VALUES
        ('school.name', '{"errado": true}'::jsonb),
        ('school.timezone', '"Marte/Olympus"'::jsonb)
    `.execute(db);
    expect(await getSettings(db)).toEqual(SETTING_DEFAULTS);
    expect(await getSchoolName(db)).toBe('nuva-edu');
  });
});

describe('setSetting', () => {
  it('substitui o valor sem duplicar a linha, e atualiza updated_at', async () => {
    await setSetting(db, 'school.name', 'Primeira');
    await setSetting(db, 'school.name', 'Segunda');
    const rows = await db
      .selectFrom('settings')
      .select(['value', 'createdAt', 'updatedAt'])
      .where('key', '=', 'school.name')
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe('Segunda');
    expect(rows[0]?.updatedAt.getTime()).toBeGreaterThanOrEqual(rows[0]?.createdAt.getTime() ?? 0);
  });

  it.each([
    ['school.name', ''],
    ['school.name', '   '],
    ['school.name', 'x'.repeat(SCHOOL_NAME_MAX_LENGTH + 1)],
    ['school.name', 42 as unknown as string],
    ['school.timezone', 'Marte/Olympus'],
    ['school.timezone', ''],
    ['school.timezone', null as unknown as string],
  ] as const)('recusa %s = %j com validation_failed, sem gravar', async (key, value) => {
    const error = await setSetting(db, key, value).catch((caught: unknown) => caught);
    expect(isDomainError(error)).toBe(true);
    expect(error).toMatchObject({
      code: 'validation_failed',
      status: 400,
      errors: [{ path: 'body.value' }],
    });
    expect(await getSettings(db)).toEqual(SETTING_DEFAULTS);
  });

  it('participa da transação de quem chama', async () => {
    await expect(
      db.transaction().execute(async (trx) => {
        await setSetting(trx, 'school.name', 'Desfeita');
        throw new Error('desiste');
      }),
    ).rejects.toThrow('desiste');
    expect(await getSchoolName(db)).toBe('nuva-edu');
  });
});

describe('createSettingsReader', () => {
  it('lê uma vez e serve do cache até o prazo vencer', async () => {
    let clock = 1_000;
    const reader = createSettingsReader(db, { now: () => clock });
    expect(await reader.schoolName()).toBe('nuva-edu');
    expect(await reader.schoolTimezone()).toBe('America/Sao_Paulo');
    expect(await reader.get('school.name')).toBe('nuva-edu');
    expect(queries).toBe(1);

    await setSetting(db, 'school.name', 'Nova');
    queries = 0;
    clock += SETTINGS_CACHE_TTL_MS - 1;
    expect(await reader.schoolName()).toBe('nuva-edu');
    expect(queries).toBe(0);

    clock += 1;
    expect(await reader.schoolName()).toBe('Nova');
    expect(queries).toBe(1);
  });

  it('invalidate força a próxima leitura a ir ao banco', async () => {
    const reader = createSettingsReader(db);
    expect(await reader.schoolName()).toBe('nuva-edu');
    await setSetting(db, 'school.name', 'Depois');
    expect(await reader.schoolName()).toBe('nuva-edu');
    reader.invalidate();
    expect(await reader.all()).toEqual({
      'school.name': 'Depois',
      'school.timezone': 'America/Sao_Paulo',
    });
  });

  it('leituras simultâneas compartilham a mesma consulta', async () => {
    const reader = createSettingsReader(db);
    const names = await Promise.all([reader.schoolName(), reader.schoolName(), reader.all()]);
    expect(names[0]).toBe('nuva-edu');
    expect(queries).toBe(1);
  });

  it('leitura iniciada antes do invalidate não repovoa o cache', async () => {
    const reader = createSettingsReader(db);
    const before = reader.schoolName();
    reader.invalidate();
    await setSetting(db, 'school.name', 'Atual');
    await before;
    expect(await reader.schoolName()).toBe('Atual');
  });

  it('ttl zero desliga o cache', async () => {
    const reader = createSettingsReader(db, { ttlMs: 0 });
    await reader.schoolName();
    await reader.schoolName();
    expect(queries).toBe(2);
  });

  it('falha de leitura não fica no cache', async () => {
    const broken = createDatabase({
      connectionString: 'postgres://nuva:x@127.0.0.1:1/nuva_edu',
      maxConnections: 1,
    });
    const reader = createSettingsReader(broken);
    await expect(reader.schoolName()).rejects.toThrow();
    await expect(reader.schoolName()).rejects.toThrow();
    await closeDatabase(broken);
  });
});
