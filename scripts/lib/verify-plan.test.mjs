import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  API_CLIENT_PACKAGE,
  addExplicitTests,
  buildFullTestCommand,
  buildScriptCommand,
  buildTestCommand,
  DATABASE_PACKAGE,
  dependentsOf,
  describePackage,
  describeRoot,
  exitCodeFor,
  formatSummary,
  packageOf,
  parseCliArgs,
  parseWorkspacePatterns,
  planQuick,
  ROOT_PACKAGE,
  resolveExtraArgs,
  testCandidates,
  tokenizeScript,
  usesDatabase,
} from './verify-plan.mjs';

const typecheck = 'tsc --noEmit -p tsconfig.json';
const packages = [
  describeRoot({
    name: 'nuva-edu',
    scripts: {
      'test:scripts': 'node --test "scripts/**/*.test.mjs"',
      typecheck: 'pnpm -r run typecheck',
    },
  }),
  describePackage('database/postgres', {
    name: DATABASE_PACKAGE,
    scripts: { test: 'node --test "test/**/*.test.ts"', typecheck },
  }),
  describePackage('packages/core', {
    name: '@nuva-edu/core',
    scripts: { test: 'vitest run', typecheck },
    dependencies: { [DATABASE_PACKAGE]: 'workspace:*', kysely: '1.0.0' },
  }),
  describePackage('packages/ui', {
    name: '@nuva-edu/ui',
    scripts: { test: 'vitest run', typecheck },
    peerDependencies: { react: '^19.0.0' },
  }),
  describePackage('apps/classroom-api', {
    name: '@nuva-edu/classroom-api',
    scripts: { test: 'vitest run', typecheck },
    dependencies: { '@nuva-edu/core': 'workspace:*' },
  }),
  describePackage('apps/classroom', {
    name: '@nuva-edu/classroom',
    scripts: { test: 'vitest run', typecheck },
    dependencies: { '@nuva-edu/ui': 'workspace:*' },
    devDependencies: { '@nuva-edu/classroom-api': 'workspace:*' },
  }),
];

/** Disco de mentira: só existem os caminhos listados (e as pastas acima deles). */
function disk(...files) {
  return (path) => files.some((file) => file === path || file.startsWith(`${path}/`));
}

function changedOf(...paths) {
  return paths.map((path) => ({ path, deleted: false }));
}

describe('linha de comando', () => {
  test('quick sem argumentos', () => {
    assert.deepEqual(parseCliArgs(['quick']), {
      mode: 'quick',
      files: null,
      e2e: false,
      extra: [],
    });
  });

  test('--files recebe vários caminhos e normaliza', () => {
    const parsed = parseCliArgs(['quick', '--files', './apps/x/src/a.ts', 'apps/x/test/']);
    assert.deepEqual(parsed.files, ['apps/x/src/a.ts', 'apps/x/test']);
  });

  test('o que vem depois de -- é repassado intacto', () => {
    const parsed = parseCliArgs([
      'quick',
      '--files',
      'a.ts',
      '--',
      'test/p.test.ts',
      '-t',
      'estorno',
    ]);
    assert.deepEqual(parsed.files, ['a.ts']);
    assert.deepEqual(parsed.extra, ['test/p.test.ts', '-t', 'estorno']);
  });

  test('full aceita --e2e e recusa --files e argumentos extras', () => {
    assert.equal(parseCliArgs(['full', '--e2e']).e2e, true);
    assert.match(parseCliArgs(['full', '--files', 'a']).error, /desconhecida/);
    assert.match(parseCliArgs(['full', '--', '-t', 'x']).error, /quick/);
  });

  test('erros de uso', () => {
    assert.match(parseCliArgs([]).error, /Modo desconhecido/);
    assert.match(parseCliArgs(['rapido']).error, /Modo desconhecido/);
    assert.match(parseCliArgs(['quick', '--files']).error, /ao menos um/);
    assert.match(parseCliArgs(['quick', '--e2e']).error, /desconhecida/);
    assert.equal(parseCliArgs(['quick', '--help']).help, true);
  });
});

describe('workspace', () => {
  test('lê os padrões do pnpm-workspace.yaml e para no fim da lista', () => {
    const yaml = [
      'packages:',
      '  - "apps/*"',
      "  - 'packages/*'",
      '  - e2e # ponta a ponta',
      '',
      'engineStrict: true',
      'allowBuilds:',
      '  - nada',
    ].join('\n');
    assert.deepEqual(parseWorkspacePatterns(yaml), ['apps/*', 'packages/*', 'e2e']);
  });

  test('a raiz não herda typecheck nem build do workspace e testa os scripts', () => {
    const rootPackage = packages[0];
    assert.equal(rootPackage.name, ROOT_PACKAGE);
    assert.deepEqual(rootPackage.scripts, { test: 'node --test "scripts/**/*.test.mjs"' });
  });

  test('acha o pacote dono do arquivo; fora de pacote, é a raiz', () => {
    assert.equal(packageOf('packages/core/src/a.ts', packages).name, '@nuva-edu/core');
    assert.equal(
      packageOf('apps/classroom-api/src/a.ts', packages).name,
      '@nuva-edu/classroom-api',
    );
    assert.equal(packageOf('apps/classroom/src/a.ts', packages).name, '@nuva-edu/classroom');
    assert.equal(packageOf('scripts/verify.mjs', packages).name, ROOT_PACKAGE);
    assert.equal(packageOf('packages/corexy/a.ts', packages).name, ROOT_PACKAGE);
  });

  test('dependentes são transitivos e contam dev e peer', () => {
    assert.deepEqual(dependentsOf(['@nuva-edu/core'], packages).sort(), [
      '@nuva-edu/classroom',
      '@nuva-edu/classroom-api',
    ]);
    assert.deepEqual(dependentsOf(['@nuva-edu/classroom'], packages), []);
    assert.deepEqual(dependentsOf([DATABASE_PACKAGE], packages).sort(), [
      '@nuva-edu/classroom',
      '@nuva-edu/classroom-api',
      '@nuva-edu/core',
    ]);
  });

  test('sabe quais pacotes usam o banco', () => {
    const uses = (name) =>
      usesDatabase(
        packages.find((pkg) => pkg.name === name),
        packages,
      );
    assert.equal(uses(DATABASE_PACKAGE), true);
    assert.equal(uses('@nuva-edu/classroom-api'), true);
    assert.equal(uses('@nuva-edu/ui'), false);
  });
});

describe('fonte → teste', () => {
  test('src/x.ts → test/x.test.ts, com subpastas e teste ao lado', () => {
    const candidates = testCandidates('src/orders/refund.ts');
    for (const expected of [
      'test/orders/refund.test.ts',
      'test/refund.test.ts',
      'src/orders/refund.test.ts',
      'src/orders/refund.test.tsx',
      'src/orders/__tests__/refund.spec.ts',
    ]) {
      assert.ok(candidates.includes(expected), expected);
    }
    assert.equal(candidates[0], 'test/orders/refund.test.ts');
  });

  test('fora de src só procura ao lado', () => {
    const candidates = testCandidates('scripts/verify.mjs');
    assert.ok(candidates.includes('scripts/verify.test.mjs'));
    assert.ok(!candidates.some((candidate) => candidate.startsWith('test/')));
  });

  test('arquivo de teste não tem "teste do teste"', () => {
    assert.deepEqual(testCandidates('test/a.test.ts'), []);
  });
});

describe('plano do modo rápido', () => {
  test('mudança em core: tipos de core e dependentes, só o teste correspondente', () => {
    const plan = planQuick({
      changed: changedOf('packages/core/src/access.ts'),
      packages,
      exists: disk('packages/core/test/access.test.ts', 'packages/core/test/sales.test.ts'),
    });
    assert.deepEqual(plan.lint, ['packages/core/src/access.ts']);
    assert.deepEqual(plan.types, [
      '@nuva-edu/classroom',
      '@nuva-edu/classroom-api',
      '@nuva-edu/core',
    ]);
    assert.deepEqual([...plan.tests], [['@nuva-edu/core', ['test/access.test.ts']]]);
    assert.equal(plan.contract.size, 0);
    assert.equal(plan.database.size, 0);
  });

  test('teste alterado roda ele mesmo; teste ao lado do fonte também é achado', () => {
    const plan = planQuick({
      changed: changedOf(
        'packages/ui/src/components/Button.tsx',
        'packages/ui/src/index.test.ts',
        'packages/ui/src/styles/tokens.css',
      ),
      packages,
      exists: disk('packages/ui/src/components/Button.test.tsx'),
    });
    assert.deepEqual(
      [...plan.tests],
      [['@nuva-edu/ui', ['src/components/Button.test.tsx', 'src/index.test.ts']]],
    );
    assert.deepEqual(plan.types, ['@nuva-edu/classroom', '@nuva-edu/ui']);
    assert.equal(plan.lint.length, 3);
  });

  test('fonte e teste alterados juntos não repetem o arquivo', () => {
    const plan = planQuick({
      changed: changedOf('packages/core/src/a.ts', 'packages/core/test/a.test.ts'),
      packages,
      exists: disk('packages/core/test/a.test.ts'),
    });
    assert.deepEqual(plan.tests.get('@nuva-edu/core'), ['test/a.test.ts']);
  });

  test('sem mudança, nada a fazer', () => {
    const plan = planQuick({ changed: [], packages, exists: disk() });
    assert.deepEqual(plan.lint, []);
    assert.deepEqual(plan.types, []);
    assert.equal(plan.tests.size + plan.contract.size + plan.database.size, 0);
  });

  test('arquivo sem lint nem tipos (markdown, SQL) não entra nesses passos', () => {
    const plan = planQuick({
      changed: changedOf('README.md', 'packages/core/README.md', 'CHANGELOG.md'),
      packages,
      exists: disk(),
    });
    assert.deepEqual(plan.lint, []);
    assert.deepEqual(plan.types, []);
  });

  test('arquivo apagado não vai para o lint, mas afeta os tipos; teste apagado não roda', () => {
    const plan = planQuick({
      changed: [
        { path: 'packages/core/src/old.ts', deleted: true },
        { path: 'packages/core/test/gone.test.ts', deleted: true },
      ],
      packages,
      exists: disk('packages/core/test/old.test.ts'),
    });
    assert.deepEqual(plan.lint, []);
    assert.ok(plan.types.includes('@nuva-edu/core'));
    assert.deepEqual(plan.tests.get('@nuva-edu/core'), ['test/old.test.ts']);
  });

  test('scripts da raiz: testa o de mesmo nome, sem passo de tipos', () => {
    const plan = planQuick({
      changed: changedOf('scripts/verify.mjs', 'package.json'),
      packages,
      exists: disk('scripts/verify.test.mjs'),
    });
    assert.deepEqual(plan.lint, ['scripts/verify.mjs', 'package.json']);
    assert.deepEqual(plan.types, []);
    assert.deepEqual([...plan.tests], [[ROOT_PACKAGE, ['scripts/verify.test.mjs']]]);
  });

  test('tsconfig.base.json alterado confere os tipos de todos os pacotes', () => {
    const plan = planQuick({ changed: changedOf('tsconfig.base.json'), packages, exists: disk() });
    assert.equal(plan.types.length, 5);
  });

  test('banco: teste alterado, fonte com teste de mesmo nome e migration', () => {
    const existsDb = disk('database/postgres/test/migrator.test.ts');
    const some = planQuick({
      changed: changedOf(
        'database/postgres/src/migrator.ts',
        'database/postgres/test/schema.test.ts',
      ),
      packages,
      exists: existsDb,
    });
    assert.deepEqual(
      [...some.database],
      [[DATABASE_PACKAGE, ['test/migrator.test.ts', 'test/schema.test.ts']]],
    );
    assert.equal(some.tests.size, 0);
    assert.ok(some.types.includes('@nuva-edu/core'));

    const migration = planQuick({
      changed: changedOf(
        'database/postgres/test/schema.test.ts',
        'database/postgres/migrations/0002_users.sql',
      ),
      packages,
      exists: existsDb,
    });
    assert.deepEqual([...migration.database], [[DATABASE_PACKAGE, null]]);

    const onlySql = planQuick({
      changed: changedOf('database/postgres/migrations/0002_users.sql'),
      packages,
      exists: existsDb,
    });
    assert.deepEqual([...onlySql.database], [[DATABASE_PACKAGE, null]]);
    assert.deepEqual(onlySql.types, []);
    assert.deepEqual(onlySql.lint, []);
  });

  test('contrato: openapi.yaml ou rotas alteradas rodam test/contract da API', () => {
    const existsApi = disk(
      'apps/classroom-api/test/contract/routes.test.ts',
      'apps/classroom-api/test/orders.test.ts',
    );
    const yaml = planQuick({
      changed: changedOf('apps/classroom-api/openapi.yaml'),
      packages,
      exists: existsApi,
    });
    assert.deepEqual([...yaml.contract], [['@nuva-edu/classroom-api', ['test/contract']]]);
    assert.equal(yaml.tests.size, 0);

    const routes = planQuick({
      changed: changedOf(
        'apps/classroom-api/src/routes/orders.ts',
        'apps/classroom-api/test/contract/routes.test.ts',
      ),
      packages,
      exists: existsApi,
    });
    assert.deepEqual([...routes.contract], [['@nuva-edu/classroom-api', ['test/contract']]]);
    assert.deepEqual([...routes.tests], [['@nuva-edu/classroom-api', ['test/orders.test.ts']]]);

    const other = planQuick({
      changed: changedOf('apps/classroom-api/src/services/orders.ts'),
      packages,
      exists: existsApi,
    });
    assert.equal(other.contract.size, 0);
  });

  test('API sem testes de contrato ainda: passo fica vazio', () => {
    const plan = planQuick({
      changed: changedOf('apps/classroom-api/openapi.yaml'),
      packages,
      exists: disk(),
    });
    assert.equal(plan.contract.size, 0);
  });
});

describe('plano do modo rápido: cliente gerado e tipos do banco', () => {
  const withGenerated = [
    ...packages.map((pkg) =>
      pkg.name === '@nuva-edu/core'
        ? {
            ...pkg,
            scripts: { ...pkg.scripts, 'db:types:check': 'node scripts/db-types.ts --verify' },
          }
        : pkg,
    ),
    describePackage('packages/api-client', {
      name: API_CLIENT_PACKAGE,
      scripts: {
        check: 'node scripts/check.mjs',
        test: 'node scripts/check.mjs && vitest run',
        'test:files': 'vitest run',
        typecheck,
      },
    }),
  ];
  const plan = (exists, ...paths) =>
    planQuick({ changed: changedOf(...paths), packages: withGenerated, exists });

  test('openapi.yaml alterado: contrato da API e conferência do cliente gerado', () => {
    const result = plan(
      disk('apps/classroom-api/test/contract/routes.test.ts'),
      'apps/classroom-api/openapi.yaml',
    );
    assert.deepEqual([...result.contract], [['@nuva-edu/classroom-api', ['test/contract']]]);
    assert.deepEqual(result.client, [API_CLIENT_PACKAGE]);
    assert.deepEqual(result.dbTypes, []);
  });

  test('API ainda sem teste de contrato: o cliente é conferido mesmo assim', () => {
    const result = plan(disk(), 'apps/classroom-api/openapi.yaml');
    assert.equal(result.contract.size, 0);
    assert.deepEqual(result.client, [API_CLIENT_PACKAGE]);
  });

  test('contrato apagado também confere o cliente', () => {
    const result = planQuick({
      changed: [{ path: 'apps/classroom-api/openapi.yaml', deleted: true }],
      packages: withGenerated,
      exists: disk(),
    });
    assert.deepEqual(result.client, [API_CLIENT_PACKAGE]);
  });

  test('gerado ou gerador do cliente mexido à mão: confere; resto do pacote, não', () => {
    assert.deepEqual(plan(disk(), 'packages/api-client/src/generated/admin.ts').client, [
      API_CLIENT_PACKAGE,
    ]);
    assert.deepEqual(plan(disk(), 'packages/api-client/scripts/contracts.mjs').client, [
      API_CLIENT_PACKAGE,
    ]);
    assert.deepEqual(plan(disk(), 'packages/api-client/src/errors.ts').client, []);
    assert.deepEqual(plan(disk(), 'apps/classroom-api/src/routes/meta.ts').client, []);
    assert.deepEqual(plan(disk(), 'openapi.yaml').client, []);
  });

  test('sem o pacote do cliente, ou sem script de conferência, nada a conferir', () => {
    const without = planQuick({
      changed: changedOf('apps/classroom-api/openapi.yaml'),
      packages,
      exists: disk(),
    });
    assert.deepEqual(without.client, []);
    const bare = planQuick({
      changed: changedOf('apps/classroom-api/openapi.yaml'),
      packages: [...packages, describePackage('packages/api-client', { name: API_CLIENT_PACKAGE })],
      exists: disk(),
    });
    assert.deepEqual(bare.client, []);
  });

  test('migration alterada: testes de banco e conferência dos tipos gerados', () => {
    const result = plan(disk(), 'database/postgres/migrations/0003_users.sql');
    assert.deepEqual([...result.database], [[DATABASE_PACKAGE, null]]);
    assert.deepEqual(result.dbTypes, ['@nuva-edu/core']);
    assert.deepEqual(result.client, []);
  });

  test('migration apagada também confere os tipos', () => {
    const result = planQuick({
      changed: [{ path: 'database/postgres/migrations/0003_users.sql', deleted: true }],
      packages: withGenerated,
      exists: disk(),
    });
    assert.deepEqual(result.dbTypes, ['@nuva-edu/core']);
  });

  test('tipos gerados ou gerador mexidos à mão: confere; outra mudança no pacote, não', () => {
    assert.deepEqual(plan(disk(), 'packages/core/src/db/generated/database.ts').dbTypes, [
      '@nuva-edu/core',
    ]);
    assert.deepEqual(plan(disk(), 'packages/core/scripts/db-types.ts').dbTypes, ['@nuva-edu/core']);
    assert.deepEqual(plan(disk(), 'packages/core/src/access.ts').dbTypes, []);
    assert.deepEqual(plan(disk(), 'database/postgres/src/migrator.ts').dbTypes, []);
    assert.deepEqual(plan(disk(), 'database/postgres/test/schema.test.ts').dbTypes, []);
  });

  test('sem pacote com db:types:check, migration só roda os testes de banco', () => {
    const result = planQuick({
      changed: changedOf('database/postgres/migrations/0003_users.sql'),
      packages,
      exists: disk(),
    });
    assert.deepEqual(result.dbTypes, []);
    assert.deepEqual([...result.database], [[DATABASE_PACKAGE, null]]);
  });
});

describe('testes explícitos depois de --', () => {
  const existsAll = disk(
    'apps/classroom-api/test/pedidos.test.ts',
    'packages/core/test/pedidos.test.ts',
    'database/postgres/test/schema.test.ts',
  );

  test('caminho a partir da raiz', () => {
    const resolved = resolveExtraArgs({
      extra: ['packages/core/test/pedidos.test.ts', '-t', 'estorno'],
      packages,
      exists: existsAll,
    });
    assert.deepEqual([...resolved.files], [['@nuva-edu/core', ['test/pedidos.test.ts']]]);
    assert.deepEqual(resolved.flags, ['-t', 'estorno']);
    assert.deepEqual(resolved.unresolved, []);
  });

  test('caminho relativo ao pacote prefere o pacote afetado pela mudança', () => {
    const resolved = resolveExtraArgs({
      extra: ['test/pedidos.test.ts', '-t', 'estorno'],
      packages,
      preferred: ['@nuva-edu/classroom-api'],
      exists: existsAll,
    });
    assert.deepEqual([...resolved.files], [['@nuva-edu/classroom-api', ['test/pedidos.test.ts']]]);
  });

  test('valor de opção não é confundido com arquivo; caminho inexistente é acusado', () => {
    const resolved = resolveExtraArgs({
      extra: ['--reporter', 'dot', '--bail=1', 'test/nao-existe.test.ts'],
      packages,
      exists: existsAll,
    });
    assert.deepEqual(resolved.flags, ['--reporter', 'dot', '--bail=1']);
    assert.deepEqual(resolved.unresolved, ['test/nao-existe.test.ts']);
  });

  test('cada teste explícito entra no passo certo', () => {
    const plan = planQuick({ changed: [], packages, exists: existsAll });
    addExplicitTests(
      plan,
      new Map([
        ['@nuva-edu/core', ['test/pedidos.test.ts']],
        ['@nuva-edu/classroom-api', ['test/contract/a.test.ts']],
        [DATABASE_PACKAGE, ['test/schema.test.ts']],
      ]),
    );
    assert.deepEqual(plan.tests.get('@nuva-edu/core'), ['test/pedidos.test.ts']);
    assert.deepEqual(plan.contract.get('@nuva-edu/classroom-api'), ['test/contract/a.test.ts']);
    assert.deepEqual(plan.database.get(DATABASE_PACKAGE), ['test/schema.test.ts']);
  });
});

describe('comandos', () => {
  const byName = (name) => packages.find((pkg) => pkg.name === name);

  test('tokenizeScript entende aspas e recusa recursos do shell', () => {
    assert.deepEqual(tokenizeScript('node --test "test/**/*.test.ts"'), [
      'node',
      '--test',
      'test/**/*.test.ts',
    ]);
    assert.deepEqual(tokenizeScript("vitest run --dir 'a b'"), ['vitest', 'run', '--dir', 'a b']);
    assert.equal(tokenizeScript('tsc && vitest run'), null);
    assert.equal(tokenizeScript('vitest run > out.txt'), null);
    assert.equal(tokenizeScript('FOO=$BAR vitest'), null);
    assert.equal(tokenizeScript('vitest "aberta'), null);
  });

  test('Vitest: os arquivos e as opções vão no fim', () => {
    const command = buildTestCommand(
      byName('@nuva-edu/core'),
      ['test/a.test.ts'],
      ['-t', 'estorno'],
    );
    assert.deepEqual(command.argv, ['vitest', 'run', '-t', 'estorno', 'test/a.test.ts']);
    assert.equal(command.filtered, true);
  });

  test('node:test: o glob do script sai, -t vira --test-name-pattern', () => {
    const command = buildTestCommand(
      byName(DATABASE_PACKAGE),
      ['test/schema.test.ts'],
      ['-t', 'audit'],
    );
    assert.deepEqual(command.argv, [
      'node',
      '--test',
      '--test-name-pattern=audit',
      'test/schema.test.ts',
    ]);
    const rootCommand = buildTestCommand(packages[0], ['scripts/verify.test.mjs']);
    assert.deepEqual(rootCommand.argv, ['node', '--test', 'scripts/verify.test.mjs']);
  });

  test('sem arquivos, roda o script como está', () => {
    assert.deepEqual(buildTestCommand(byName(DATABASE_PACKAGE), null).argv, [
      'node',
      '--test',
      'test/**/*.test.ts',
    ]);
    assert.deepEqual(buildTestCommand(byName(DATABASE_PACKAGE), null, ['-t=x']).argv, [
      'node',
      '--test',
      '--test-name-pattern=x',
      'test/**/*.test.ts',
    ]);
    assert.deepEqual(buildTestCommand(byName('@nuva-edu/ui'), null).argv, ['vitest', 'run']);
  });

  test('test:files, quando existe, é o script usado para repassar arquivos', () => {
    const pkg = describePackage('packages/x', {
      name: 'x',
      scripts: { test: 'node scripts/check.mjs && vitest run', 'test:files': 'vitest run' },
    });
    assert.deepEqual(buildTestCommand(pkg, ['test/a.test.ts'], ['-t', 'n']), {
      argv: ['vitest', 'run', '-t', 'n', 'test/a.test.ts'],
      filtered: true,
    });
    assert.deepEqual(buildTestCommand(pkg, null).argv, ['pnpm', 'run', 'test']);
  });

  test('completo: API com test/contract roda a suíte sem a pasta de contrato', () => {
    const api = byName('@nuva-edu/classroom-api');
    assert.deepEqual(buildFullTestCommand(api, { hasContract: true }), {
      argv: ['vitest', 'run', '--exclude', 'test/contract/**'],
      script: 'test',
      contractExcluded: true,
    });
    assert.deepEqual(buildFullTestCommand(api).argv, ['vitest', 'run']);
    assert.equal(buildFullTestCommand(api).contractExcluded, false);
  });

  test('completo: test:coverage substitui test; executor sem exclusão roda tudo', () => {
    const covered = describePackage('packages/core', {
      name: '@nuva-edu/core',
      scripts: { test: 'vitest run', 'test:coverage': 'vitest run --coverage' },
    });
    assert.deepEqual(buildFullTestCommand(covered, { hasContract: true }), {
      argv: ['vitest', 'run', '--coverage', '--exclude', 'test/contract/**'],
      script: 'test:coverage',
      contractExcluded: true,
    });
    const nodeTest = describePackage('apps/x', {
      name: 'x',
      scripts: { test: 'node --test "test/**/*.test.ts"' },
    });
    assert.deepEqual(buildFullTestCommand(nodeTest, { hasContract: true }), {
      argv: ['node', '--test', 'test/**/*.test.ts'],
      script: 'test',
      contractExcluded: false,
    });
    const shell = describePackage('apps/y', { name: 'y', scripts: { test: 'a && vitest run' } });
    assert.deepEqual(buildFullTestCommand(shell, { hasContract: true }), {
      argv: ['pnpm', 'run', 'test'],
      script: 'test',
      contractExcluded: false,
    });
    assert.equal(buildFullTestCommand(describePackage('apps/z', { name: 'z' })), null);
  });

  test('script com shell não é filtrado; pacote sem script devolve null', () => {
    const shell = describePackage('apps/x', { name: 'x', scripts: { test: 'tsc && vitest run' } });
    assert.deepEqual(buildTestCommand(shell, ['test/a.test.ts']), {
      argv: ['pnpm', 'run', 'test'],
      filtered: false,
    });
    assert.equal(buildTestCommand(describePackage('apps/y', { name: 'y' }), null), null);
    assert.deepEqual(buildScriptCommand(shell, 'test'), ['pnpm', 'run', 'test']);
    assert.deepEqual(buildScriptCommand(byName('@nuva-edu/ui'), 'typecheck'), [
      'tsc',
      '--noEmit',
      '-p',
      'tsconfig.json',
    ]);
  });
});

describe('resumo e código de saída', () => {
  const steps = [
    { name: 'lint', status: 'ok', ms: 1234, note: '4 arquivos' },
    { name: 'testes', status: 'fail', ms: 3100, note: 'falhou em core' },
    { name: 'contrato', status: 'skipped', ms: 0, note: 'sem mudança' },
    { name: 'build', status: 'not-run', ms: 0 },
  ];

  test('mostra ✓, ✗ e pulado com o tempo de cada passo', () => {
    const lines = formatSummary(steps).split('\n');
    assert.match(lines[0], /^✓ lint\s+1\.2s\s+\(4 arquivos\)$/);
    assert.match(lines[1], /^✗ testes\s+3\.1s\s+\(falhou em core\)$/);
    assert.match(lines[2], /^– contrato\s+pulado \(sem mudança\)$/);
    assert.match(lines[3], /^– build\s+pulado \(não rodou/);
  });

  test('0 sem falha, 1 com falha, 2 se toda falha for de ambiente', () => {
    assert.equal(exitCodeFor([steps[0], steps[2]]), 0);
    assert.equal(exitCodeFor(steps), 1);
    const environment = { name: 'banco', status: 'fail', ms: 1, environment: true };
    assert.equal(exitCodeFor([steps[0], environment]), 2);
    assert.equal(exitCodeFor([steps[1], environment]), 1);
  });
});
