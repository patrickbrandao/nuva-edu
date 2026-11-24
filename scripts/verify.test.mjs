import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { describePackage, describeRoot, exitCodeFor, formatSummary } from './lib/verify-plan.mjs';
import { fullSteps, preparedNote, prepareLocalDatabase, runSequence } from './verify.mjs';

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
    for (const name of ['lint', 'tipos', 'testes', 'contrato', 'cliente', 'banco', 'tipos-banco']) {
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
  test('nota do preparo mostra o modelo do conjunto e o que saiu', () => {
    const name = 'nuva_edu_tpl_0123456789ab';
    assert.equal(preparedNote({ template: { name, rebuilt: false } }), `modelo em dia: ${name}`);
    assert.equal(
      preparedNote({
        template: { name, rebuilt: true },
        removedDatabases: ['nuva_edu_test_a'],
        removedTemplates: ['nuva_edu_tpl_aaaaaaaaaaaa', 'nuva_edu_tpl_bbbbbbbbbbbb'],
      }),
      `modelo refeito: ${name}; 1 banco antigo removido; 2 modelos antigos removidos`,
    );
  });

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
    assert.match(result.message, /^ {2}pnpm compose up -d --wait postgres$/m);
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

describe('passos do modo completo', () => {
  const repo = resolve(import.meta.dirname, '..');
  const typecheck = 'tsc --noEmit -p tsconfig.json';
  const packages = [
    describeRoot({ name: 'nuva-edu', scripts: { 'test:scripts': 'node --test "scripts/*.mjs"' } }),
    describePackage('database/postgres', {
      name: '@nuva-edu/database',
      scripts: { test: 'node --test "test/**/*.test.ts"', typecheck },
    }),
    describePackage('packages/core', {
      name: '@nuva-edu/core',
      scripts: {
        test: 'vitest run',
        'test:coverage': 'vitest run --coverage',
        typecheck,
        'db:types:check': 'node scripts/db-types.ts --verify',
      },
      devDependencies: { '@nuva-edu/database': 'workspace:*' },
    }),
    describePackage('apps/admin-api', {
      name: '@nuva-edu/admin-api',
      scripts: { test: 'vitest run', typecheck, build: 'tsc -p tsconfig.build.json' },
      dependencies: { '@nuva-edu/core': 'workspace:*' },
    }),
  ];
  const serverEnv = { DATABASE_URL: 'postgres://isolado' };

  /**
   * Roda a sequência com processos e Postgres de mentira. `outcome(comando, pasta)` devolve o
   * código de saída; o padrão é 0.
   */
  async function runFull(t, { outcome = () => 0, list = packages, files = [], docker = true }) {
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'error', () => {});
    const calls = [];
    let servers = 0;
    const steps = await runSequence(
      fullSteps({
        packages: list,
        exists: (path) => files.some((file) => file === path || file.startsWith(`${path}/`)),
        ensureServer: async () => {
          servers += 1;
          return docker ? serverEnv : null;
        },
        exec: async (argv, { cwd, env = {} } = {}) => {
          const call = { command: argv.join(' '), dir: relative(repo, cwd), env };
          calls.push(call);
          return outcome(call.command, call.dir);
        },
      }),
      [],
    );
    return {
      steps,
      calls,
      servers,
      status: Object.fromEntries(steps.map((s) => [s.name, s.status])),
    };
  }

  test('tudo certo: confere os tipos do banco, no Postgres isolado, antes dos testes', async (t) => {
    const { steps, calls, status } = await runFull(t, {});
    assert.deepEqual(
      steps.map((step) => step.name),
      ['lint', 'tipos', 'tipos-banco', 'testes', 'contrato', 'banco', 'build'],
    );
    assert.equal(status['tipos-banco'], 'ok');
    const check = calls.find((call) => call.command === 'node scripts/db-types.ts --verify');
    assert.equal(check.dir, 'packages/core');
    assert.equal(check.env.DATABASE_URL, serverEnv.DATABASE_URL);
    const order = calls.map((call) => call.command);
    assert.ok(order.indexOf(check.command) < order.indexOf('vitest run --coverage'));
  });

  test('migration sem tipos regenerados: falha em tipos-banco e para ali, código 1', async (t) => {
    // Dublê do `db:types:check`: o gerado não bate com o banco das migrations.
    const { steps, calls, status } = await runFull(t, {
      outcome: (command) => (command.includes('db-types.ts --verify') ? 1 : 0),
    });
    assert.equal(status['tipos-banco'], 'fail');
    assert.match(steps[2].note, /falhou em core: tipos gerados diferem das migrations/);
    for (const name of ['testes', 'contrato', 'banco', 'build']) {
      assert.equal(status[name], 'not-run', name);
    }
    assert.ok(!calls.some((call) => call.command.startsWith('vitest')));
    assert.match(formatSummary(steps), /^✗ tipos-banco/m);
    assert.equal(exitCodeFor(steps), 1);
  });

  test('sem pacote com db:types:check o passo é pulado e os demais rodam', async (t) => {
    const list = packages.filter((pkg) => pkg.name !== '@nuva-edu/core');
    const { status } = await runFull(t, { list });
    assert.equal(status['tipos-banco'], 'skipped');
    assert.equal(status.testes, 'ok');
  });

  test('sem Docker: tipos-banco falha como ambiente indisponível, código 2', async (t) => {
    const { steps, status, calls } = await runFull(t, { docker: false });
    assert.equal(status['tipos-banco'], 'fail');
    assert.equal(exitCodeFor(steps), 2);
    assert.ok(!calls.some((call) => call.command.includes('db-types')));
  });

  test('contrato roda uma vez só: fora da suíte da API, dentro do passo contrato', async (t) => {
    const { calls, steps, status } = await runFull(t, {
      files: ['apps/admin-api/test/contract/contract.test.ts'],
    });
    const api = calls.filter(
      (call) => call.dir === 'apps/admin-api' && /^vitest/.test(call.command),
    );
    assert.deepEqual(
      api.map((call) => call.command),
      ['vitest run --exclude test/contract/**', 'vitest run test/contract'],
    );
    assert.equal(status.contrato, 'ok');
    assert.doesNotMatch(steps.find((step) => step.name === 'contrato').note, /já rodou/);
  });

  test('executor que não sabe excluir: o contrato roda com a suíte e não se repete', async (t) => {
    const list = packages.map((pkg) =>
      pkg.name === '@nuva-edu/admin-api'
        ? { ...pkg, scripts: { ...pkg.scripts, test: 'node --test "test/**/*.test.ts"' } }
        : pkg,
    );
    const { calls, steps } = await runFull(t, {
      list,
      files: ['apps/admin-api/test/contract/contract.test.ts'],
    });
    const api = calls.filter(
      (call) => call.dir === 'apps/admin-api' && /--test/.test(call.command),
    );
    assert.deepEqual(
      api.map((call) => call.command),
      ['node --test test/**/*.test.ts'],
    );
    const contract = steps.find((step) => step.name === 'contrato');
    assert.equal(contract.status, 'ok');
    assert.match(contract.note, /admin-api: já rodou no passo testes/);
  });

  // Dublês do `check-contract` (spec 003, "Subida estrita"): o passo descobre o script por pacote.
  const checkContract = 'node src/check-contract.ts';
  const classroomApi = describePackage('apps/classroom-api', {
    name: '@nuva-edu/classroom-api',
    scripts: { test: 'vitest run', typecheck, 'check-contract': checkContract },
    dependencies: { '@nuva-edu/core': 'workspace:*' },
  });
  const withCheck = (...names) => [
    ...packages.map((pkg) =>
      names.includes(pkg.name)
        ? { ...pkg, scripts: { ...pkg.scripts, 'check-contract': checkContract } }
        : pkg,
    ),
    ...(names.includes(classroomApi.name) ? [classroomApi] : []),
  ];
  const checksOf = (calls) =>
    calls.filter((call) => call.command.includes('check-contract')).map((call) => call.dir);

  test('uma API com check-contract: roda --no-pending nela, depois do teste de contrato', async (t) => {
    const { calls, steps, status } = await runFull(t, {
      list: withCheck('@nuva-edu/admin-api'),
      files: ['apps/admin-api/test/contract/contract.test.ts'],
    });
    assert.equal(status.contrato, 'ok');
    const order = calls.map((call) => call.command);
    const check = `${checkContract} --no-pending`;
    assert.deepEqual(checksOf(calls), ['apps/admin-api']);
    assert.ok(order.indexOf('vitest run test/contract') < order.indexOf(check));
    assert.ok(order.indexOf(check) < order.indexOf('tsc -p tsconfig.build.json'));
    assert.match(
      steps.find((step) => step.name === 'contrato').note,
      /admin-api; check-contract --no-pending: admin-api$/,
    );
  });

  test('as duas APIs com check-contract: roda --no-pending em cada uma', async (t) => {
    const { calls, steps, status } = await runFull(t, {
      list: withCheck('@nuva-edu/admin-api', '@nuva-edu/classroom-api'),
      files: [
        'apps/admin-api/test/contract/contract.test.ts',
        'apps/classroom-api/test/contract/contract.test.ts',
      ],
    });
    assert.equal(status.contrato, 'ok');
    assert.deepEqual(checksOf(calls), ['apps/admin-api', 'apps/classroom-api']);
    for (const call of calls.filter((entry) => entry.command.includes('check-contract'))) {
      assert.equal(call.command, `${checkContract} --no-pending`);
      // Confere rotas e contrato sem banco: não recebe o Postgres isolado.
      assert.equal(call.env.DATABASE_URL, undefined);
    }
    assert.match(
      steps.find((step) => step.name === 'contrato').note,
      /check-contract --no-pending: admin-api, classroom-api$/,
    );
  });

  test('contrato com x-nuva-pending: check-contract falha, o passo falha e o build não roda', async (t) => {
    // Dublê: a classroom-api tem operação pendente no contrato.
    const { calls, steps, status } = await runFull(t, {
      list: withCheck('@nuva-edu/admin-api', '@nuva-edu/classroom-api'),
      files: ['apps/admin-api/test/contract/contract.test.ts'],
      outcome: (command, dir) =>
        command.includes('--no-pending') && dir === 'apps/classroom-api' ? 1 : 0,
    });
    assert.equal(status.contrato, 'fail');
    assert.match(
      steps.find((step) => step.name === 'contrato').note,
      /check-contract --no-pending falhou em classroom-api: operação pendente/,
    );
    assert.deepEqual(checksOf(calls), ['apps/admin-api', 'apps/classroom-api']);
    assert.equal(status.banco, 'not-run');
    assert.equal(status.build, 'not-run');
    assert.equal(exitCodeFor(steps), 1);
  });

  test('falha na primeira API: para ali, sem conferir a segunda', async (t) => {
    const { calls, status } = await runFull(t, {
      list: withCheck('@nuva-edu/admin-api', '@nuva-edu/classroom-api'),
      outcome: (command, dir) =>
        command.includes('--no-pending') && dir === 'apps/admin-api' ? 1 : 0,
    });
    assert.equal(status.contrato, 'fail');
    assert.deepEqual(checksOf(calls), ['apps/admin-api']);
  });

  test('teste de contrato vermelho: o check-contract nem roda', async (t) => {
    const { calls, status } = await runFull(t, {
      list: withCheck('@nuva-edu/admin-api'),
      files: ['apps/admin-api/test/contract/contract.test.ts'],
      outcome: (command) => (command === 'vitest run test/contract' ? 1 : 0),
    });
    assert.equal(status.contrato, 'fail');
    assert.deepEqual(checksOf(calls), []);
  });

  test('check-contract sem test/contract: o passo roda só a conferência, sem Postgres', async (t) => {
    t.mock.method(console, 'log', () => {});
    const commands = [];
    const [contract] = await runSequence(
      fullSteps({
        packages: withCheck('@nuva-edu/admin-api'),
        exists: () => false,
        ensureServer: async () => assert.fail('o check-contract não usa o Postgres isolado'),
        exec: async (argv) => commands.push(argv.join(' ')) && 0,
      }).filter(([name]) => name === 'contrato'),
      [],
    );
    assert.equal(contract.status, 'ok');
    assert.equal(contract.note, 'check-contract --no-pending: admin-api');
    assert.deepEqual(commands, [`${checkContract} --no-pending`]);
  });

  test('sem test/contract em nenhum pacote, o passo contrato é pulado', async (t) => {
    const { status, calls } = await runFull(t, {});
    assert.equal(status.contrato, 'skipped');
    assert.ok(calls.some((call) => call.dir === 'apps/admin-api' && call.command === 'vitest run'));
  });
});
