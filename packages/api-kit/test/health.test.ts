import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDatabase, createDatabase, type Database } from '@nuva-edu/core';
import { defaultMigrationsDir, latestVersion } from '@nuva-edu/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseReadiness, runReadinessChecks } from '../src/index.ts';

describe('runReadinessChecks', () => {
  it('pronto quando todas passam', async () => {
    expect(await runReadinessChecks({ a: () => true, b: async () => ({ ok: true }) })).toEqual({
      status: 'ready',
      checks: { a: 'ok', b: 'ok' },
      reasons: {},
    });
  });

  it('não pronto quando uma falha, lança ou passa do prazo', async () => {
    const report = await runReadinessChecks(
      {
        ok: () => true,
        falsa: () => false,
        motivo: () => ({ ok: false, reason: 'versão antiga' }),
        lanca: () => {
          throw new Error('quebrou');
        },
        rejeita: () => Promise.reject(new Error('rejeitou')),
        lenta: () => new Promise((resolve) => setTimeout(() => resolve(true), 300)),
      },
      50,
    );
    expect(report).toEqual({
      status: 'not_ready',
      checks: {
        ok: 'ok',
        falsa: 'fail',
        motivo: 'fail',
        lanca: 'fail',
        rejeita: 'fail',
        lenta: 'fail',
      },
      reasons: {
        falsa: 'falhou',
        motivo: 'versão antiga',
        lanca: 'quebrou',
        rejeita: 'rejeitou',
        lenta: 'sem resposta em 50 ms',
      },
    });
  });
});

describe('databaseReadiness', () => {
  const url = process.env.DATABASE_URL ?? '';
  let db: Database;
  let scratch: string;

  beforeAll(() => {
    db = createDatabase({ connectionString: url, maxConnections: 2 });
    scratch = mkdtempSync(join(tmpdir(), 'api-kit-migrations-'));
  });
  afterAll(async () => {
    await closeDatabase(db);
    rmSync(scratch, { recursive: true, force: true });
  });

  it('pronto com o banco no ar e na versão esperada', async () => {
    const report = await runReadinessChecks(databaseReadiness({ db, connectionString: url }), 5000);
    expect(report).toEqual({
      status: 'ready',
      checks: { database: 'ok', migrations: 'ok' },
      reasons: {},
    });
  });

  it('não pronto quando o código espera uma migration que o banco não tem', async () => {
    cpSync(defaultMigrationsDir, scratch, { recursive: true });
    const next = (await latestVersion(defaultMigrationsDir)) + 1;
    writeFileSync(
      join(scratch, `${String(next).padStart(4, '0')}_futura.sql`),
      '-- migrate:up\nSELECT 1;\n\n-- migrate:down\nSELECT 1;\n',
    );
    const report = await runReadinessChecks(
      databaseReadiness({ db, connectionString: url, migrationsDir: scratch }),
      5000,
    );
    expect(report.checks).toEqual({ database: 'ok', migrations: 'fail' });
    expect(report.reasons.migrations).toBe(
      `banco na migration ${next - 1}, o serviço espera a ${next}`,
    );
  });

  it('não pronto com o banco inacessível, sem lançar', async () => {
    // Porta 9 (discard): nada escuta ali.
    const unreachable = 'postgres://nuva:x@127.0.0.1:9/nuva';
    const down = createDatabase({ connectionString: unreachable, maxConnections: 1 });
    try {
      const report = await runReadinessChecks(
        databaseReadiness({ db: down, connectionString: unreachable }),
        5000,
      );
      expect(report.status).toBe('not_ready');
      expect(report.checks).toEqual({ database: 'fail', migrations: 'fail' });
      expect(report.reasons).toEqual({
        database: 'banco inacessível',
        migrations: 'banco inacessível',
      });
    } finally {
      await closeDatabase(down);
    }
  });
});
