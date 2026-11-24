import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  closeDatabase,
  createDatabase,
  createLogger,
  type Database,
  type Logger,
} from '@nuva-edu/core';
import type { TestDatabase } from '@nuva-edu/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CREATE_ADMIN_EXIT,
  type HiddenPrompt,
  parseCreateAdminArgs,
  runCreateAdmin,
} from '../src/create-admin.ts';
import { ensureInitialAdminOnStartup } from '../src/initial-admin.ts';
import { createIsolatedDatabase, createUser, TEST_PASSWORD } from './helpers.ts';

// Banco próprio: o admin inicial depende de "nenhum admin no banco", e os outros arquivos criam
// admins no banco da execução.

const OTHER_PASSWORD = 'Outra-Senha-Admin-4Hw#t';
let isolated: TestDatabase;
let db: Database;
const lines: string[] = [];
let logger: Logger;

beforeAll(async () => {
  isolated = await createIsolatedDatabase();
  db = createDatabase({ connectionString: isolated.url, maxConnections: 2 });
  logger = createLogger({
    service: 'admin-api',
    level: 'debug',
    write: (line) => lines.push(line),
  });
});

afterAll(async () => {
  await closeDatabase(db);
  await isolated.drop();
});

const run = promisify(execFile);
const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const CREATE_ADMIN = fileURLToPath(new URL('../src/create-admin.ts', import.meta.url));

async function admins() {
  return db
    .selectFrom('users')
    .select(['id', 'email', 'password', 'role', 'name', 'emailVerifiedAt', 'version'])
    .where('role', '=', 'admin')
    .orderBy('createdAt')
    .execute();
}

describe('admin inicial na subida', () => {
  it('sem admin e sem variáveis: aviso no log a cada subida, sem senha', async () => {
    const before = lines.length;
    await expect(
      ensureInitialAdminOnStartup(db, { admin: { email: null, password: null } }, logger),
    ).resolves.toBe('missing_variables');
    const warning = lines.slice(before).map((line) => JSON.parse(line));
    expect(warning).toMatchObject([
      { level: 'warn', variables: ['ADMIN_EMAIL', 'ADMIN_PASSWORD'] },
    ]);
    expect(await admins()).toEqual([]);
  });

  it('primeira subida com as variáveis cria o admin; a segunda, com valores diferentes, não altera nada', async () => {
    await expect(
      ensureInitialAdminOnStartup(
        db,
        { admin: { email: 'Diretora@Escola.test', password: TEST_PASSWORD } },
        logger,
      ),
    ).resolves.toBe('created');
    const first = await admins();
    expect(first).toMatchObject([
      { email: 'diretora@escola.test', name: 'diretora', password: TEST_PASSWORD },
    ]);
    expect(first[0]?.emailVerifiedAt).toBeInstanceOf(Date);

    await expect(
      ensureInitialAdminOnStartup(
        db,
        { admin: { email: 'outra@escola.test', password: OTHER_PASSWORD } },
        logger,
      ),
    ).resolves.toBe('exists');
    expect(await admins()).toEqual(first);
    const audit = await db
      .selectFrom('auditLog')
      .select(['action', 'origin', 'actorUserId'])
      .where('targetId', '=', first[0]?.id as string)
      .execute();
    expect(audit).toEqual([{ action: 'user.create', origin: 'cli', actorUserId: null }]);
    // Nem a senha nem o e-mail vão para o log.
    const log = lines.join('');
    expect(log).not.toContain(TEST_PASSWORD);
    expect(log).not.toContain('diretora@escola.test');
  });

  it('banco inacessível: registra o erro e a subida segue', async () => {
    const down = createDatabase({
      connectionString: 'postgres://nuva:x@127.0.0.1:9/nuva',
      maxConnections: 1,
    });
    try {
      await expect(
        ensureInitialAdminOnStartup(
          down,
          { admin: { email: 'a@escola.test', password: TEST_PASSWORD } },
          logger,
        ),
      ).resolves.toBe('skipped');
    } finally {
      await closeDatabase(down);
    }
    expect(lines.join('')).not.toContain(TEST_PASSWORD);
  });

  it('ADMIN_PASSWORD fora de 8 a 128 caracteres impede a subida, citando a variável', async () => {
    const result = await run(process.execPath, [MAIN], {
      env: {
        PATH: process.env.PATH,
        DATABASE_URL: 'postgres://x@127.0.0.1:1/x',
        ADMIN_EMAIL: 'curta@escola.test',
        ADMIN_PASSWORD: 'curta',
      },
    }).then(
      () => ({ code: 0, stdout: '' }),
      (error: { code: number; stdout: string }) => error,
    );
    expect(result.code).toBe(1);
    const line = JSON.parse(result.stdout.trim().split('\n').at(-1) as string);
    expect(line).toMatchObject({ level: 'fatal', variables: ['ADMIN_PASSWORD'] });
    expect(result.stdout).not.toContain('curta"');
  });
});

/** Respostas do terminal, na ordem; guarda as perguntas feitas. */
function answers(...values: string[]): HiddenPrompt & { questions: string[] } {
  const questions: string[] = [];
  const prompt = async (question: string) => {
    questions.push(question);
    return values.shift() ?? '';
  };
  return Object.assign(prompt, { questions });
}

async function createAdmin(argv: string[], prompt: HiddenPrompt) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCreateAdmin({
    argv,
    openDatabase: () => createDatabase({ connectionString: isolated.url, maxConnections: 1 }),
    prompt,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('create-admin', () => {
  it('recusa senha por argumento, sem tocar no banco nem pedir nada', async () => {
    for (const argv of [
      ['--email', 'a@escola.test', '--password', TEST_PASSWORD],
      ['--email=a@escola.test', `--password=${TEST_PASSWORD}`],
      ['--email', 'a@escola.test', '-p', TEST_PASSWORD],
    ]) {
      const prompt = answers();
      const result = await createAdmin(argv, prompt);
      expect(result.code).toBe(CREATE_ADMIN_EXIT.usage);
      expect(result.err).toContain('não é aceita por argumento');
      expect(result.err).not.toContain(TEST_PASSWORD);
      expect(prompt.questions).toEqual([]);
    }
    expect(parseCreateAdminArgs([])).toEqual({ error: '--email é obrigatório.' });
    expect(parseCreateAdminArgs(['--email', 'a@b.c', 'extra'])).toMatchObject({
      error: expect.stringContaining('desconhecida'),
    });
  });

  it('o processo recusa senha por argumento com o código de uso, sem banco', async () => {
    const result = await run(
      process.execPath,
      [CREATE_ADMIN, '--email', 'a@escola.test', '--password', TEST_PASSWORD],
      { env: { PATH: process.env.PATH } },
    ).then(
      () => ({ code: 0, stderr: '' }),
      (error: { code: number; stderr: string }) => error,
    );
    expect(result.code).toBe(CREATE_ADMIN_EXIT.usage);
    expect(result.stderr).toContain('não é aceita por argumento');
    expect(result.stderr).not.toContain(TEST_PASSWORD);
  });

  it('sem terminal interativo o processo não pede a senha', async () => {
    const result = await run(process.execPath, [CREATE_ADMIN, '--email', 'a@escola.test'], {
      env: { PATH: process.env.PATH },
    }).then(
      () => ({ code: 0, stderr: '' }),
      (error: { code: number; stderr: string }) => error,
    );
    expect(result.code).toBe(CREATE_ADMIN_EXIT.usage);
    expect(result.stderr).toContain('terminal interativo');
  });

  it('pede a senha duas vezes; diferentes, nada muda', async () => {
    const prompt = answers(TEST_PASSWORD, OTHER_PASSWORD);
    const result = await createAdmin(['--email', 'nova@escola.test'], prompt);
    expect(result.code).toBe(CREATE_ADMIN_EXIT.failed);
    expect(prompt.questions).toHaveLength(2);
    expect(
      await db.selectFrom('users').select('id').where('email', '=', 'nova@escola.test').execute(),
    ).toEqual([]);
  });

  it('senha fora do tamanho ou e-mail inválido: falha sem alterar nada', async () => {
    expect(
      (await createAdmin(['--email', 'nova@escola.test'], answers('curta', 'curta'))).code,
    ).toBe(CREATE_ADMIN_EXIT.failed);
    const invalid = await createAdmin(
      ['--email', 'sem-arroba'],
      answers(TEST_PASSWORD, TEST_PASSWORD),
    );
    expect(invalid.code).toBe(CREATE_ADMIN_EXIT.failed);
    expect(invalid.err).toContain('E-mail inválido');
  });

  it('cria um admin novo e promove uma conta existente, encerrando as sessões dela', async () => {
    const created = await createAdmin(
      ['--email', 'Emergencia@Escola.test'],
      answers(TEST_PASSWORD, TEST_PASSWORD),
    );
    expect(created).toMatchObject({
      code: CREATE_ADMIN_EXIT.ok,
      out: expect.stringContaining('Admin criado'),
    });
    const row = await db
      .selectFrom('users')
      .select(['role', 'password', 'emailVerifiedAt'])
      .where('email', '=', 'emergencia@escola.test')
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ role: 'admin', password: TEST_PASSWORD });
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);

    const student = await createUser(db, { role: 'student' });
    await db
      .insertInto('sessions')
      .values({
        idHash: 'a'.repeat(64),
        userId: student.id,
        site: 'classroom',
        ip: '203.0.113.9',
        csrfToken: 'c'.repeat(43),
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .execute();
    const promoted = await createAdmin(
      [`--email=${student.email}`],
      answers(OTHER_PASSWORD, OTHER_PASSWORD),
    );
    expect(promoted.code).toBe(CREATE_ADMIN_EXIT.ok);
    expect(promoted.out).toContain('1 sessões encerradas');
    const after = await db
      .selectFrom('users')
      .select(['role', 'password'])
      .where('id', '=', student.id)
      .executeTakeFirstOrThrow();
    expect(after).toEqual({ role: 'admin', password: OTHER_PASSWORD });
    const origins = await db
      .selectFrom('auditLog')
      .select(['action', 'origin'])
      .where('targetId', '=', student.id)
      .orderBy('createdAt')
      .execute();
    expect(origins.every((entry) => entry.origin === 'cli')).toBe(true);
    expect(origins.map((entry) => entry.action)).toContain('user.set_role');
    for (const text of [created.out, created.err, promoted.out, promoted.err]) {
      expect(text).not.toContain(TEST_PASSWORD);
      expect(text).not.toContain(OTHER_PASSWORD);
    }
  });
});
