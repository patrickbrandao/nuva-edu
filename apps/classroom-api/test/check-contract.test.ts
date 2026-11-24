import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:net';
import { fileURLToPath } from 'node:url';
import { CHECK_CONTRACT_EXIT } from '@nuva-edu/api-kit';
import { closeDatabase, createDatabase, createLogger, loadConfig } from '@nuva-edu/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildClassroomApp, userEventStream } from '../src/app.ts';
import { loadClassroomContract } from '../src/contract.ts';

const COMMAND = fileURLToPath(new URL('../src/check-contract.ts', import.meta.url));
const PENDING_COMMAND = fileURLToPath(
  new URL('./fixtures/check-contract-pending.ts', import.meta.url),
);
const PENDING_OPERATION = 'GET /api/v1/check-contract-pendente';

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

/** Executa o comando como processo, com um banco inalcançável: ele não pode depender do banco. */
function run(script: string, args: string[] = []): Promise<Run> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [script, ...args],
      {
        env: { PATH: process.env.PATH, DATABASE_URL: 'postgres://x@127.0.0.1:1/x' },
        timeout: 30_000,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          // Não iniciou, estourou o prazo ou morreu por sinal: não é um código de saída.
          reject(error);
          return;
        }
        resolve({ code: error ? (error.code as number) : 0, stdout, stderr });
      },
    );
  });
}

describe('comando check-contract', () => {
  it('sai com 0 no contrato atual, sem banco e sem subir o servidor', async () => {
    const result = await run(COMMAND);
    expect(
      result.stderr.split('\n').filter((line) => line !== '' && !line.includes('aviso:')),
    ).toEqual([]);
    expect(result.stdout).toMatch(
      /^check-contract classroom-api: contrato e rotas conferem \(\d+ operações/,
    );
    expect(result.code).toBe(CHECK_CONTRACT_EXIT.ok);
  });

  it('com --no-pending, sai com 0 se o contrato não tem pendente e falha listando-as se tem', async () => {
    const pending = loadClassroomContract()
      .operations.filter((operation) => operation.pending)
      .map((operation) => operation.key);
    const result = await run(COMMAND, ['--no-pending']);
    if (pending.length === 0) {
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('nenhuma pendente');
      expect(result.code).toBe(CHECK_CONTRACT_EXIT.ok);
      return;
    }
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('x-nuva-pending');
    for (const key of pending) {
      expect(result.stderr).toContain(key);
    }
    expect(result.code).toBe(CHECK_CONTRACT_EXIT.mismatch);
  });

  it('sai com 2 em opção desconhecida', async () => {
    const result = await run(COMMAND, ['--inexistente']);
    expect(result.stderr).toContain('opção desconhecida: --inexistente');
    expect(result.code).toBe(CHECK_CONTRACT_EXIT.usage);
  });

  it('com operação pendente no contrato, só avisa sem --no-pending', async () => {
    const result = await run(PENDING_COMMAND);
    expect(result.stderr).toContain('aviso:');
    expect(result.stderr).toContain(PENDING_OPERATION);
    expect(result.stdout).toContain('contrato e rotas conferem');
    expect(result.code).toBe(CHECK_CONTRACT_EXIT.ok);
  });

  it('com operação pendente no contrato, falha com --no-pending e lista a operação', async () => {
    const result = await run(PENDING_COMMAND, ['--no-pending']);
    expect(result.stderr).toContain('x-nuva-pending');
    expect(result.stderr).toContain(PENDING_OPERATION);
    expect(result.stdout).toBe('');
    expect(result.code).toBe(CHECK_CONTRACT_EXIT.mismatch);
  });
});

describe('buildClassroomApp sem a escuta do nuva_user_events', () => {
  const cleanup: (() => Promise<unknown>)[] = [];
  afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) {
      await close();
    }
  });

  /** Um "banco" que só conta as conexões recebidas e as derruba. */
  async function countingServer(): Promise<{ url: string; connections: () => number }> {
    let connections = 0;
    const server: Server = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise((resolve) => server.close(resolve)));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Endereço do servidor de teste indisponível.');
    }
    return { url: `postgres://x@127.0.0.1:${address.port}/x`, connections: () => connections };
  }

  async function readyApp(url: string, listenUserEvents?: false) {
    const config = loadConfig({ env: { NUVA_ENV: 'test', DATABASE_URL: url } });
    const db = createDatabase({ connectionString: config.databaseUrl, maxConnections: 1 });
    const app = buildClassroomApp({
      config,
      db,
      logger: createLogger({ service: 'classroom-api', level: 'silent' }),
      readiness: {},
      ...(listenUserEvents === false ? { listenUserEvents } : {}),
    });
    cleanup.push(async () => {
      await app.close();
      await closeDatabase(db);
    });
    await app.ready();
    return app;
  }

  it('listenUserEvents: false não abre conexão com o banco na subida', async () => {
    const database = await countingServer();
    const app = await readyApp(database.url, false);
    await userEventStream(app).whenListening();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(database.connections()).toBe(0);
    expect(userEventStream(app).isListening()).toBe(false);
  });

  it('o padrão abre a escuta na subida (o contador de conexões funciona)', async () => {
    const database = await countingServer();
    await readyApp(database.url);
    await expect.poll(() => database.connections(), { timeout: 5_000 }).toBeGreaterThan(0);
  });
});
