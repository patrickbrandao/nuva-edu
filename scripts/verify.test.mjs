import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, test } from 'node:test';
import { prepareLocalDatabase } from './verify.mjs';

const script = resolve(import.meta.dirname, 'verify.mjs');

function verify(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
}

function refused() {
  return Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' });
}

const quiet = { log: () => {}, wait: 0 };

describe('linha de comando do verify', () => {
  test('--help mostra o uso e sai com 0', () => {
    const result = verify('--help');
    assert.equal(result.status, 0);
    assert.match(result.stdout, /pnpm verify:quick \[--files/);
  });

  test('modo ou opção inválidos saem com 1', () => {
    assert.equal(verify().status, 1);
    assert.equal(verify('quick', '--tudo').status, 1);
    assert.match(verify('full', '--files', 'a').stderr, /Opção desconhecida/);
  });

  test('quick sem nada ligado aos arquivos dados: tudo pulado, código 0', () => {
    const result = verify('quick', '--files', 'README.md');
    assert.equal(result.status, 0, result.stderr);
    for (const name of ['lint', 'tipos', 'testes', 'contrato', 'banco']) {
      assert.match(result.stdout, new RegExp(`^– ${name}\\s+pulado`, 'm'));
    }
    assert.doesNotMatch(result.stdout, /^[✓✗]/m);
  });

  test('teste explícito inexistente depois de -- falha com 1', () => {
    const result = verify('quick', '--files', 'README.md', '--', 'test/nao-existe.test.ts');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Não achei estes testes/);
    assert.match(result.stdout, /^✗ testes/m);
  });
});

describe('Postgres local do modo rápido', () => {
  test('no ar: não tenta subir e prepara o modelo', async () => {
    let started = 0;
    const result = await prepareLocalDatabase({
      ...quiet,
      canStart: true,
      ping: async () => {},
      startServer: async () => {
        started += 1;
        return true;
      },
      prepare: async () => 'modelo em dia',
    });
    assert.deepEqual(result, { ok: true, note: 'modelo em dia' });
    assert.equal(started, 0);
  });

  test('fora do ar: sobe pelo Compose e espera responder', async () => {
    let up = false;
    let pings = 0;
    const result = await prepareLocalDatabase({
      ...quiet,
      canStart: true,
      ping: async () => {
        pings += 1;
        if (!up || pings < 4) {
          throw refused();
        }
      },
      startServer: async () => {
        up = true;
        return true;
      },
      prepare: async () => 'modelo refeito',
    });
    assert.deepEqual(result, { ok: true, note: 'modelo refeito' });
    assert.equal(pings, 4);
  });

  test('fora do ar e sem conseguir subir: mostra o comando', async () => {
    let prepared = false;
    const result = await prepareLocalDatabase({
      ...quiet,
      canStart: true,
      ping: async () => {
        throw refused();
      },
      startServer: async () => false,
      prepare: async () => {
        prepared = true;
      },
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /docker compose --env-file \.env .*up -d --wait postgres/);
    assert.equal(prepared, false);
  });

  test('subiu mas nunca respondeu: desiste depois das tentativas', async () => {
    let pings = 0;
    const result = await prepareLocalDatabase({
      ...quiet,
      attempts: 3,
      canStart: true,
      ping: async () => {
        pings += 1;
        throw refused();
      },
      startServer: async () => true,
      prepare: async () => 'x',
    });
    assert.equal(result.ok, false);
    assert.equal(pings, 4);
  });

  test('conexão dada por DATABASE_URL: não mexe no Compose', async () => {
    let started = 0;
    const result = await prepareLocalDatabase({
      ...quiet,
      canStart: false,
      ping: async () => {
        throw refused();
      },
      startServer: async () => {
        started += 1;
        return true;
      },
      prepare: async () => 'x',
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /DATABASE_URL/);
    assert.equal(started, 0);
  });

  test('erro que não é de conexão (senha errada, por exemplo) sobe como está', async () => {
    await assert.rejects(
      prepareLocalDatabase({
        ...quiet,
        canStart: true,
        ping: async () => {
          throw Object.assign(new Error('senha incorreta'), { code: '28P01' });
        },
        startServer: async () => true,
        prepare: async () => 'x',
      }),
      /senha incorreta/,
    );
  });
});
