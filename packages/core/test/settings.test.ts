import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import {
  closeDatabase,
  createDatabase,
  createLogger,
  createSettingsReader,
  type Database,
  DEFAULT_SOURCE_CODE_URL,
  getSchoolName,
  getSchoolTimezone,
  getSetting,
  getSettings,
  isDomainError,
  SCHOOL_NAME_MAX_LENGTH,
  SETTING_DEFAULTS,
  SETTING_KEYS,
  SETTINGS_CACHE_TTL_MS,
  SOURCE_CODE_URL_MAX_LENGTH,
  schoolLogoUrl,
  setSetting,
} from '../src/index.ts';

const LOGO_ID = '019aa3f2-7b1c-7e55-9a10-5299822472aa';

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
    expect(SETTING_KEYS).toEqual([
      'school.name',
      'school.timezone',
      'school.logo_image_id',
      'school.accent_color',
      'school.source_code_url',
    ]);
    for (const key of SETTING_KEYS) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/);
    }
  });

  it('devolve o padrão enquanto a escola não define', async () => {
    expect(await getSchoolName(db)).toBe('nuva-edu');
    expect(await getSchoolTimezone(db)).toBe('America/Sao_Paulo');
    expect(await getSettings(db)).toEqual(SETTING_DEFAULTS);
  });

  it('banco sem linha em settings devolve todos os padrões da tabela da spec 031', async () => {
    const count = await sql<{
      n: number;
    }>`SELECT count(*)::int AS n FROM settings WHERE key LIKE 'school.%'`.execute(db);
    expect(count.rows[0]?.n).toBe(0);
    const defaults = {
      'school.name': 'nuva-edu',
      'school.timezone': 'America/Sao_Paulo',
      'school.logo_image_id': null,
      'school.accent_color': null,
      'school.source_code_url': 'https://github.com/patrickbrandao/nuva-edu',
    };
    expect(SETTING_DEFAULTS).toEqual(defaults);
    expect(DEFAULT_SOURCE_CODE_URL).toBe(defaults['school.source_code_url']);
    expect(await getSettings(db)).toEqual(defaults);
    expect(await createSettingsReader(db).all()).toEqual(defaults);
    for (const key of SETTING_KEYS) {
      expect(await getSetting(db, key)).toBe(defaults[key]);
    }
  });

  it('grava e lê a marca da escola: logotipo, cor e endereço do código', async () => {
    expect(await setSetting(db, 'school.logo_image_id', LOGO_ID.toUpperCase())).toBe(LOGO_ID);
    expect(await setSetting(db, 'school.accent_color', '#1A2b3C')).toBe('#1A2b3C');
    expect(
      await setSetting(db, 'school.source_code_url', '  https://git.escola.example/fork  '),
    ).toBe('https://git.escola.example/fork');
    expect(await getSettings(db)).toEqual({
      ...SETTING_DEFAULTS,
      'school.logo_image_id': LOGO_ID,
      'school.accent_color': '#1A2b3C',
      'school.source_code_url': 'https://git.escola.example/fork',
    });
    expect(schoolLogoUrl(await getSetting(db, 'school.logo_image_id'))).toBe(
      `/api/v1/images/${LOGO_ID}/256.webp`,
    );

    // Nulo gravado é valor válido (sem logotipo, cor padrão), não ausência.
    expect(await setSetting(db, 'school.logo_image_id', null)).toBeNull();
    expect(await setSetting(db, 'school.accent_color', null)).toBeNull();
    const rows = await db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('key', 'in', ['school.logo_image_id', 'school.accent_color'])
      .execute();
    expect(rows.map((row) => row.value)).toEqual([null, null]);
    expect(await getSetting(db, 'school.accent_color')).toBeNull();
    expect(schoolLogoUrl(await getSetting(db, 'school.logo_image_id'))).toBeNull();
  });

  it('devolve o que foi gravado', async () => {
    expect(await setSetting(db, 'school.name', '  Escola do Zé  ')).toBe('Escola do Zé');
    await setSetting(db, 'school.timezone', 'America/Manaus');
    expect(await getSchoolName(db)).toBe('Escola do Zé');
    expect(await getSetting(db, 'school.timezone')).toBe('America/Manaus');
    expect(await getSettings(db)).toEqual({
      ...SETTING_DEFAULTS,
      'school.name': 'Escola do Zé',
      'school.timezone': 'America/Manaus',
    });
  });

  it('valor inválido gravado por fora não derruba a leitura: vale o padrão', async () => {
    await sql`
      INSERT INTO settings (key, value) VALUES
        ('school.name', '{"errado": true}'::jsonb),
        ('school.timezone', '"Marte/Olympus"'::jsonb),
        ('school.logo_image_id', '"não é uuid"'::jsonb),
        ('school.accent_color', '"vermelho"'::jsonb),
        ('school.source_code_url', '"http://sem-tls.example"'::jsonb)
    `.execute(db);
    expect(await getSettings(db)).toEqual(SETTING_DEFAULTS);
    expect(await getSchoolName(db)).toBe('nuva-edu');
  });

  it('valor inválido gera aviso no log, com a chave e sem o valor', async () => {
    await sql`
      INSERT INTO settings (key, value) VALUES
        ('school.name', '"Escola Boa"'::jsonb),
        ('school.accent_color', '"segredo-vermelho"'::jsonb),
        ('school.source_code_url', '42'::jsonb)
    `.execute(db);
    const lines: string[] = [];
    const logger = createLogger({ service: 'core-test', write: (line) => lines.push(line) });

    expect(await getSettings(db, { logger })).toEqual({
      ...SETTING_DEFAULTS,
      'school.name': 'Escola Boa',
    });
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ level: 'warn', setting_key: 'school.accent_color' }),
      expect.objectContaining({ level: 'warn', setting_key: 'school.source_code_url' }),
    ]);
    expect(lines.join('')).not.toContain('segredo-vermelho');

    lines.length = 0;
    expect(await getSetting(db, 'school.accent_color', { logger })).toBeNull();
    expect(await getSetting(db, 'school.name', { logger })).toBe('Escola Boa');
    expect(lines).toHaveLength(1);

    // O leitor com cache avisa a cada ida ao banco, não a cada leitura.
    lines.length = 0;
    const reader = createSettingsReader(db, { logger });
    expect(await reader.get('school.accent_color')).toBeNull();
    expect(await reader.get('school.source_code_url')).toBe(DEFAULT_SOURCE_CODE_URL);
    expect(lines).toHaveLength(2);
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
    ['school.logo_image_id', ''],
    ['school.logo_image_id', '019aa3f2-7b1c-7e55-9a10'],
    ['school.logo_image_id', 7 as unknown as string],
    ['school.accent_color', 'red'],
    ['school.accent_color', '#FFF'],
    ['school.accent_color', '#12345G'],
    ['school.accent_color', '1A2B3C'],
    ['school.source_code_url', ''],
    ['school.source_code_url', 'http://github.com/escola/fork'],
    ['school.source_code_url', 'github.com/escola/fork'],
    ['school.source_code_url', 'https://'],
    ['school.source_code_url', 'https://exemplo.com/com espaço'],
    ['school.source_code_url', 'https://usuario:senha@exemplo.com/fork'],
    ['school.source_code_url', `https://exemplo.com/${'a'.repeat(SOURCE_CODE_URL_MAX_LENGTH)}`],
    ['school.source_code_url', null as unknown as string],
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
    expect(await reader.all()).toEqual({ ...SETTING_DEFAULTS, 'school.name': 'Depois' });
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
