#!/usr/bin/env node
// Verificação em dois níveis (specs/032): `pnpm verify:quick` e `pnpm verify:full`.
// A lógica de seleção fica em ./lib/verify-plan.mjs; aqui estão o disco, o Git e os processos.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  addExplicitTests,
  buildScriptCommand,
  buildTestCommand,
  DATABASE_PACKAGE,
  describePackage,
  describeRoot,
  exitCodeFor,
  formatSummary,
  normalizePath,
  parseCliArgs,
  parseWorkspacePatterns,
  planQuick,
  plural,
  resolveExtraArgs,
  shortName,
  USAGE,
  usesDatabase,
} from './lib/verify-plan.mjs';

const root = resolve(import.meta.dirname, '..');
const COMPOSE_UP = `docker compose --env-file .env${
  existsSync(join(root, '.env.local')) ? ' --env-file .env.local' : ''
} up -d --wait postgres`;

const exists = (path) => existsSync(join(root, path));

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

/** Pacotes do workspace (os que têm `package.json`) mais a raiz. */
function loadPackages() {
  const packages = [describeRoot(readJson('package.json'))];
  const patterns = parseWorkspacePatterns(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'));
  for (const pattern of patterns) {
    let dirs = [pattern];
    if (pattern.endsWith('/*')) {
      const parent = pattern.slice(0, -2);
      dirs = exists(parent)
        ? readdirSync(join(root, parent), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => `${parent}/${entry.name}`)
        : [];
    }
    for (const dir of dirs.sort()) {
      if (exists(`${dir}/package.json`)) {
        packages.push(describePackage(dir, readJson(`${dir}/package.json`)));
      }
    }
  }
  return packages;
}

function git(args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

function splitNul(text) {
  return text ? text.split('\0').filter(Boolean) : [];
}

/**
 * O que mudou. Sem `--files`: tudo que difere do ponto em que o trabalho local se separou de
 * `origin/main` (commits não enviados, alterações em stage e fora dele) mais os arquivos novos
 * ainda não rastreados. Num branch de contribuição, a mesma conta dá "tudo desde o merge-base".
 * Só lê o Git; não mexe em índice, stash nem árvore de trabalho.
 */
function changedFiles(onlyFiles) {
  if (onlyFiles) {
    const seen = new Map();
    for (const path of onlyFiles) {
      if (exists(path) && statSync(join(root, path)).isDirectory()) {
        const listed = git([
          'ls-files',
          '-z',
          '--cached',
          '--others',
          '--exclude-standard',
          '--',
          path,
        ]);
        for (const file of splitNul(listed)) {
          seen.set(file, { path: file, deleted: !exists(file) });
        }
      } else {
        seen.set(path, { path, deleted: !exists(path) });
      }
    }
    return [...seen.values()];
  }
  const base = git(['merge-base', 'HEAD', 'origin/main'])?.trim() || 'HEAD';
  const diff = splitNul(git(['diff', '--name-status', '--no-renames', '-z', base]));
  const changed = new Map();
  for (let i = 0; i + 1 < diff.length; i += 2) {
    changed.set(diff[i + 1], { path: diff[i + 1], deleted: diff[i] === 'D' });
  }
  for (const file of splitNul(git(['ls-files', '-z', '--others', '--exclude-standard']))) {
    changed.set(file, { path: file, deleted: false });
  }
  return [...changed.values()];
}

/** Roda um comando com a saída ligada ao terminal. Resolve com o código de saída. */
function run(argv, { cwd = root, env = {} } = {}) {
  const [command, ...args] = argv;
  const bins = [join(cwd, 'node_modules', '.bin'), join(root, 'node_modules', '.bin')];
  return new Promise((done) => {
    const child = spawn(command === 'node' ? process.execPath : command, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...env,
        PATH: [...bins, process.env.PATH].join(delimiter),
      },
    });
    child.on('error', (error) => {
      console.error(`Não consegui executar "${command}": ${error.message}`);
      done(127);
    });
    child.on('close', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

const steps = [];

function heading(name) {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`);
}

/**
 * Executa um passo e registra o resultado. `body` devolve `{ status, note, environment }`;
 * `status` em `ok` | `fail` | `skipped`.
 */
async function step(name, body) {
  const started = performance.now();
  let outcome;
  try {
    outcome = await body();
  } catch (error) {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    outcome = { status: 'fail', note: 'erro inesperado' };
  }
  const entry = { name, ms: performance.now() - started, ...outcome };
  steps.push(entry);
  return entry;
}

function finish() {
  console.log(`\n${formatSummary(steps)}`);
  return exitCodeFor(steps);
}

/** Roda os testes de vários pacotes, um de cada vez. `targets`: mapa nome → arquivos ou `null`. */
async function runTests(packages, targets, { flags = [], env = {}, stopOnFailure = false } = {}) {
  const failed = [];
  let files = 0;
  for (const [name, list] of targets) {
    const pkg = packages.find((candidate) => candidate.name === name);
    const command = pkg && buildTestCommand(pkg, list, flags);
    if (!command) {
      console.error(`${name}: sem script "test" no package.json.`);
      failed.push(shortName(name));
      continue;
    }
    if (!command.filtered) {
      console.log(
        `${name}: o script "test" usa recursos do shell; rodo a suíte inteira do pacote.`,
      );
    }
    files += list?.length ?? 0;
    heading(`${shortName(name)}: ${command.argv.join(' ')}`);
    const code = await run(command.argv, { cwd: join(root, pkg.dir), env });
    if (code !== 0) {
      failed.push(shortName(name));
      if (stopOnFailure) {
        break;
      }
    }
  }
  const names = [...targets.keys()].map(shortName).join(', ');
  if (failed.length > 0) {
    return { status: 'fail', note: `falhou em ${failed.join(', ')}` };
  }
  return { status: 'ok', note: files > 0 ? `${plural(files, 'arquivo')}; ${names}` : names };
}

async function runScripts(packages, scriptName, env = {}) {
  const failed = [];
  for (const pkg of packages) {
    const argv = buildScriptCommand(pkg, scriptName);
    heading(`${shortName(pkg.name)}: ${argv.join(' ')}`);
    if ((await run(argv, { cwd: join(root, pkg.dir), env })) !== 0) {
      failed.push(shortName(pkg.name));
    }
  }
  if (failed.length > 0) {
    return { status: 'fail', note: `falhou em ${failed.join(', ')}` };
  }
  return { status: 'ok', note: packages.map((pkg) => shortName(pkg.name)).join(', ') };
}

function isConnectionError(error) {
  const code = error?.code ?? error?.errors?.[0]?.code;
  return ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET', '57P03'].includes(
    code,
  );
}

/**
 * Garante o Postgres local no ar e o banco modelo em dia. Se o servidor não responde, tenta
 * subi-lo pelo Compose; `deps` existe para os testes trocarem as partes que tocam o ambiente.
 * @returns `{ ok: true, note }` ou `{ ok: false, message }`
 */
export async function prepareLocalDatabase(deps) {
  const {
    ping,
    startServer,
    prepare,
    canStart,
    wait = 1000,
    attempts = 30,
    log = console.log,
  } = deps;
  const tryPing = async () => {
    try {
      await ping();
      return null;
    } catch (error) {
      if (!isConnectionError(error)) {
        throw error;
      }
      return error;
    }
  };
  let failure = await tryPing();
  if (failure) {
    if (!canStart) {
      return {
        ok: false,
        message: `Postgres inacessível em DATABASE_URL (${failure.message}). Como a conexão foi dada por variável de ambiente, não tento subir o do Compose.`,
      };
    }
    log(`Postgres local fora do ar; tentando subir: ${COMPOSE_UP}`);
    const started = await startServer();
    for (let i = 0; started && failure && i < attempts; i += 1) {
      failure = await tryPing();
      if (failure) {
        await new Promise((done) => setTimeout(done, wait));
      }
    }
    if (failure) {
      return {
        ok: false,
        message: `Postgres local fora do ar e não consegui subi-lo. Rode:\n  ${COMPOSE_UP}`,
      };
    }
    log('Postgres local no ar.');
  }
  return { ok: true, note: await prepare() };
}

async function localDatabaseDeps() {
  const db = await import('@nuva-edu/database');
  const explicitUrl = Boolean(process.env.DATABASE_URL);
  db.loadEnvFiles();
  const config = db.loadConfig();
  return {
    canStart: !explicitUrl,
    ping: async () => {
      const client = await db.connect(config);
      await client.end();
    },
    startServer: async () => {
      const argv = COMPOSE_UP.split(' ');
      return (await run(argv)) === 0;
    },
    prepare: async () => {
      const removed = await db.dropStaleTestDatabases({ config });
      const template = await db.ensureTemplate({ config, log: console.log });
      const notes = [template.rebuilt ? 'modelo refeito' : 'modelo em dia'];
      if (removed.length > 0) {
        notes.push(
          `${plural(removed.length, 'banco antigo removido', 'bancos antigos removidos')}`,
        );
      }
      return notes.join('; ');
    },
  };
}

async function quick(options) {
  const packages = loadPackages();
  const changed = changedFiles(options.files);
  const plan = planQuick({ changed, packages, exists });
  const affected = [...new Set(changed.map((file) => file.path))].length;
  console.log(
    options.files
      ? `verify:quick — ${plural(affected, 'arquivo')} de --files`
      : `verify:quick — ${plural(affected, 'arquivo alterado', 'arquivos alterados')} desde origin/main`,
  );

  const extra = resolveExtraArgs({
    extra: options.extra,
    packages,
    preferred: [...new Set([...plan.types, ...plan.tests.keys(), ...plan.contract.keys()])],
    exists,
  });
  addExplicitTests(plan, extra.files);
  const env = { NUVA_TEST_DB: 'local' };

  await step('lint', async () => {
    if (plan.lint.length === 0) {
      return { status: 'skipped', note: 'sem mudança' };
    }
    let failed = false;
    for (let i = 0; i < plan.lint.length; i += 200) {
      const files = plan.lint.slice(i, i + 200);
      heading(`biome check (${plural(files.length, 'arquivo')})`);
      const code = await run([
        'biome',
        'check',
        '--no-errors-on-unmatched',
        '--files-ignore-unknown=true',
        ...files,
      ]);
      failed ||= code !== 0;
    }
    return { status: failed ? 'fail' : 'ok', note: plural(plan.lint.length, 'arquivo') };
  });

  await step('tipos', async () => {
    const targets = packages.filter((pkg) => plan.types.includes(pkg.name));
    if (targets.length === 0) {
      return { status: 'skipped', note: 'sem mudança' };
    }
    return runScripts(targets, 'typecheck');
  });

  // O banco só é preparado se algum teste a rodar for de pacote que usa o banco.
  const needsDatabase = (targets) =>
    [...targets.keys()].some((name) => {
      const pkg = packages.find((candidate) => candidate.name === name);
      return pkg && usesDatabase(pkg, packages);
    });
  let database = { ok: true };
  if ([plan.tests, plan.contract, plan.database].some(needsDatabase)) {
    const prepared = await step('postgres', async () => {
      heading('postgres local');
      let result;
      try {
        result = await prepareLocalDatabase(await localDatabaseDeps());
      } catch (error) {
        result = { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      database = result;
      if (!result.ok) {
        console.error(result.message);
        return { status: 'fail', note: 'indisponível', environment: true };
      }
      console.log(`Postgres local pronto (${result.note}).`);
      return { status: 'ok', note: result.note };
    });
    database.ok = prepared.status === 'ok';
  }

  if (extra.unresolved.length > 0) {
    await step('testes', async () => {
      console.error(
        `Não achei estes testes pedidos depois de "--": ${extra.unresolved.join(', ')}.\nUse caminhos relativos à raiz ou à pasta do pacote.`,
      );
      return { status: 'fail', note: 'teste explícito não encontrado' };
    });
  } else {
    await step('testes', async () => {
      if (plan.tests.size === 0) {
        return { status: 'skipped', note: 'sem teste ligado à mudança' };
      }
      return runTests(packages, plan.tests, { flags: extra.flags, env });
    });
  }

  await step('contrato', async () => {
    if (plan.contract.size === 0) {
      return { status: 'skipped', note: 'sem mudança' };
    }
    return runTests(packages, plan.contract, { flags: extra.flags, env });
  });

  await step('banco', async () => {
    if (plan.database.size === 0) {
      return { status: 'skipped', note: 'sem mudança' };
    }
    if (!database.ok) {
      return { status: 'fail', note: 'Postgres local fora do ar', environment: true };
    }
    const result = await runTests(packages, plan.database, { flags: extra.flags, env });
    const whole = [...plan.database.values()].includes(null);
    return whole && result.status === 'ok'
      ? { ...result, note: 'migrations: suíte inteira' }
      : result;
  });

  return finish();
}

async function full(options) {
  const packages = loadPackages();
  const workspace = packages.filter((pkg) => pkg.dir !== '');
  const rootPackage = packages.find((pkg) => pkg.dir === '');
  const databasePackage = workspace.find((pkg) => pkg.name === DATABASE_PACKAGE);
  const e2ePackage = workspace.find((pkg) => pkg.dir === 'e2e');
  console.log(`verify:full${options.e2e ? ' --e2e' : ''} — ${plural(workspace.length, 'pacote')}`);

  let server = null;
  let env = {};
  const stopServer = async () => {
    const running = server;
    server = null;
    await running?.stop().catch(() => {});
  };
  process.once('SIGINT', () => stopServer().finally(() => process.exit(130)));
  process.once('SIGTERM', () => stopServer().finally(() => process.exit(143)));

  /** Sobe o Postgres isolado na primeira vez em que um passo precisa dele. */
  const ensureServer = async () => {
    if (!server) {
      heading('postgres isolado (Testcontainers)');
      const { startPostgresContainer } = await import('./test-db.mjs');
      try {
        server = await startPostgresContainer();
      } catch (error) {
        console.error(
          `Não consegui subir o PostgreSQL pelo Testcontainers: ${error instanceof Error ? error.message : String(error)}\nO Docker está no ar?`,
        );
        return false;
      }
      env = { NUVA_TEST_DB: 'container', NUVA_TEST_PG_URL: server.url, DATABASE_URL: server.url };
      console.log('PostgreSQL isolado no ar.');
    }
    return true;
  };
  const noDocker = { status: 'fail', note: 'Testcontainers indisponível', environment: true };

  const sequence = [
    [
      'lint',
      async () => {
        heading('biome check .');
        const code = await run(['biome', 'check', '.']);
        return { status: code === 0 ? 'ok' : 'fail', note: 'repositório inteiro' };
      },
    ],
    [
      'tipos',
      async () => {
        const targets = workspace.filter((pkg) => pkg.scripts.typecheck);
        if (targets.length === 0) {
          return { status: 'skipped', note: 'nenhum pacote com script typecheck' };
        }
        return runScripts(targets, 'typecheck');
      },
    ],
    [
      'testes',
      async () => {
        // `test:coverage`, quando existe, substitui `test`: é onde o pacote impõe a meta de
        // cobertura (packages/core, 80% de linhas).
        const targets = [rootPackage, ...workspace]
          .filter((pkg) => pkg !== databasePackage && pkg !== e2ePackage)
          .filter((pkg) => pkg.scripts.test || pkg.scripts['test:coverage']);
        if (targets.length === 0) {
          return { status: 'skipped', note: 'nenhum pacote com script test' };
        }
        if (!(await ensureServer())) {
          return noDocker;
        }
        const failed = [];
        const notes = [];
        for (const pkg of targets) {
          const script = pkg.scripts['test:coverage'] ? 'test:coverage' : 'test';
          const command = buildTestCommand(pkg, null, [], script);
          heading(`${shortName(pkg.name)}: ${command.argv.join(' ')}`);
          if ((await run(command.argv, { cwd: join(root, pkg.dir), env })) !== 0) {
            failed.push(shortName(pkg.name));
            break;
          }
          notes.push(shortName(pkg.name) + (script === 'test:coverage' ? ' com cobertura' : ''));
        }
        if (failed.length > 0) {
          return { status: 'fail', note: `falhou em ${failed.join(', ')}` };
        }
        const core = workspace.find((pkg) => pkg.dir === 'packages/core');
        if (core && !core.scripts['test:coverage']) {
          notes.push('AVISO: core sem script test:coverage, cobertura não medida');
        }
        return { status: 'ok', note: notes.join(', ') };
      },
    ],
    [
      'contrato',
      async () => {
        const targets = new Map(
          workspace
            .filter((pkg) => exists(`${pkg.dir}/test/contract`))
            .map((pkg) => [pkg.name, ['test/contract']]),
        );
        if (targets.size === 0) {
          return { status: 'skipped', note: 'sem testes de contrato' };
        }
        if (!(await ensureServer())) {
          return noDocker;
        }
        return runTests(packages, targets, { env, stopOnFailure: true });
      },
    ],
    [
      'banco',
      async () => {
        if (!databasePackage?.scripts.test) {
          return { status: 'skipped', note: 'sem testes de banco' };
        }
        if (!(await ensureServer())) {
          return noDocker;
        }
        return runTests(packages, new Map([[databasePackage.name, null]]), { env });
      },
    ],
    [
      'build',
      async () => {
        const targets = workspace.filter((pkg) => pkg.scripts.build);
        if (targets.length === 0) {
          return { status: 'skipped', note: 'nenhum pacote com script build' };
        }
        return runScripts(targets, 'build');
      },
    ],
  ];
  if (options.e2e) {
    sequence.push([
      'e2e',
      async () => {
        if (!e2ePackage?.scripts.test) {
          return { status: 'skipped', note: 'sem testes de ponta a ponta ainda' };
        }
        return runScripts([e2ePackage], 'test');
      },
    ]);
  }

  try {
    let stopped = false;
    for (const [name, body] of sequence) {
      if (stopped) {
        steps.push({ name, status: 'not-run', ms: 0 });
      } else if ((await step(name, body)).status === 'fail') {
        stopped = true;
      }
    }
  } finally {
    await stopServer();
  }
  return finish();
}

async function main(argv) {
  const options = parseCliArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.error) {
    console.error(`${options.error}\n\n${USAGE}`);
    return 1;
  }
  if (options.files) {
    options.files = options.files.map(normalizePath);
  }
  return options.mode === 'quick' ? quick(options) : full(options);
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
