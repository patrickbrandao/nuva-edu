import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { findStaleFiles } from '../scripts/check.mjs';
import { CONTRACTS, contractsFromArgs, renderContract } from '../scripts/contracts.mjs';

const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const tempDir = mkdtempSync(join(tmpdir(), 'nuva-api-client-'));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

/** Copia um contrato para a pasta temporária aplicando uma alteração; o original não muda. */
function alteredCopy(api: keyof typeof CONTRACTS, from: string, to: string) {
  const original = readFileSync(CONTRACTS[api], 'utf8');
  expect(original).toContain(from);
  const path = join(tempDir, `${api}-${Math.random().toString(36).slice(2)}.yaml`);
  writeFileSync(path, original.replaceAll(from, to));
  return path;
}

function runCheck(...args: string[]) {
  return spawnSync(process.execPath, ['scripts/check.mjs', ...args], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
  });
}

describe('verificação do código gerado', () => {
  it('src/generated está em dia com os contratos', async () => {
    expect(await findStaleFiles()).toEqual([]);
  });

  it('mudar um esquema do contrato sem regenerar é detectado', async () => {
    const admin = alteredCopy(
      'admin',
      'required: [schoolName, version, currency, locale, authProviders]',
      'required: [schoolName, version, currency, locale]',
    );

    expect(await findStaleFiles({ contracts: { ...CONTRACTS, admin } })).toEqual([
      'admin.ts: diferente do contrato',
    ]);
  });

  it('mudar um evento do fluxo SSE sem regenerar é detectado nos tipos e nos nomes', async () => {
    const classroom = alteredCopy('classroom', 'announcement.published', 'announcement.created');

    expect(await findStaleFiles({ contracts: { ...CONTRACTS, classroom } })).toEqual([
      'classroom.ts: diferente do contrato',
      'classroom-stream.ts: diferente do contrato',
    ]);
  });

  it('recusa gerar quando o const do evento diverge do mapping do discriminador', async () => {
    const classroom = alteredCopy('classroom', 'const: presence', 'const: presence.changed');

    await expect(findStaleFiles({ contracts: { ...CONTRACTS, classroom } })).rejects.toThrow(
      'o mapping chama "presence" o evento que StreamEventPresence declara como "presence.changed"',
    );
  });

  it('arquivo que falta ou sobra na pasta gerada é detectado', async () => {
    const generatedDir = join(tempDir, 'generated');
    const files = await renderContract('admin', CONTRACTS.admin);
    mkdirSync(generatedDir);
    writeFileSync(join(generatedDir, 'admin.ts'), files['admin.ts'] ?? '');
    writeFileSync(join(generatedDir, 'antigo.ts'), '');

    expect(await findStaleFiles({ generatedDir })).toEqual([
      'classroom.ts: falta gerar',
      'classroom-stream.ts: falta gerar',
      'antigo.ts: sobra (não vem de nenhum contrato)',
    ]);
  });

  it('o comando check sai com 0 quando está em dia', () => {
    const result = runCheck();

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('o comando check sai com 1 e orienta a regenerar quando o contrato mudou', () => {
    const classroom = alteredCopy('classroom', 'operationId: openStream', 'operationId: getStream');

    const result = runCheck('--contract', `classroom=${classroom}`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('src/generated/classroom.ts: diferente do contrato');
    expect(result.stderr).toContain('pnpm --filter @nuva-edu/api-client generate');
  });

  it('recusa argumento de contrato desconhecido', () => {
    expect(() => contractsFromArgs(['--contract', 'worker=/tmp/x.yaml'])).toThrow(
      /admin\|classroom/,
    );
    expect(contractsFromArgs(['--contract', 'admin=/tmp/x.yaml'])).toEqual({
      ...CONTRACTS,
      admin: '/tmp/x.yaml',
    });
  });
});
