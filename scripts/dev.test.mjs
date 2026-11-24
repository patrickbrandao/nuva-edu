import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { composeArgs, envFileArgs, mergeEnv, publishPostgres, volumeMigrateArgs } from './dev.mjs';

const temps = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

test('envFileArgs lê .env e depois .env.local', () => {
  assert.deepEqual(envFileArgs(true), ['--env-file', '.env', '--env-file', '.env.local']);
  assert.deepEqual(envFileArgs(false), ['--env-file', '.env']);
});

test('compose repassa os argumentos depois dos arquivos de ambiente', () => {
  assert.deepEqual(composeArgs('compose', ['ps', '--all']), [
    '--env-file',
    '.env',
    '--env-file',
    '.env.local',
    'ps',
    '--all',
  ]);
});

test('up liga os perfis traefik e mailpit, constrói e espera a saúde', () => {
  assert.deepEqual(composeArgs('up', [], { hasLocal: false }), [
    '--env-file',
    '.env',
    '--profile',
    'traefik',
    '--profile',
    'mailpit',
    'up',
    '-d',
    '--build',
    '--wait',
  ]);
});

test('down derruba os mesmos perfis e nunca remove volumes por conta própria', () => {
  const args = composeArgs('down');
  assert.deepEqual(args.slice(-5), ['--profile', 'traefik', '--profile', 'mailpit', 'down']);
  assert.ok(!args.includes('-v') && !args.includes('--volumes'));
});

test('comando desconhecido devolve null', () => {
  assert.equal(composeArgs('restart'), null);
});

test('sem NUVA_POSTGRES_PUBLISH, a porta do Postgres só é publicada com NUVA_DOMAIN=localhost', () => {
  assert.equal(publishPostgres({}), true);
  assert.equal(publishPostgres({ NUVA_DOMAIN: 'localhost' }), true);
  assert.equal(publishPostgres({ NUVA_DOMAIN: 'escola.com.br' }), false);
  assert.equal(publishPostgres({ NUVA_DOMAIN: 'escola.com.br', NUVA_POSTGRES_PUBLISH: '' }), false);
});

test('NUVA_POSTGRES_PUBLISH explícita ganha do domínio; valor estranho é erro', () => {
  assert.equal(
    publishPostgres({ NUVA_DOMAIN: 'localhost', NUVA_POSTGRES_PUBLISH: 'false' }),
    false,
  );
  assert.equal(
    publishPostgres({ NUVA_DOMAIN: 'escola.com.br', NUVA_POSTGRES_PUBLISH: 'TRUE' }),
    true,
  );
  assert.throws(() => publishPostgres({ NUVA_POSTGRES_PUBLISH: 'sim' }), /NUVA_POSTGRES_PUBLISH/);
});

test('mergeEnv segue a precedência do Compose: processo, .env.local, .env', () => {
  const env = mergeEnv(
    { NUVA_DOMAIN: 'localhost', NUVA_POSTGRES_PUBLISH: 'true' },
    { NUVA_DOMAIN: 'escola.com.br', NUVA_POSTGRES_PUBLISH: '' },
    { NUVA_POSTGRES_PUBLISH: 'false', OUTRA: undefined },
  );
  assert.deepEqual(env, { NUVA_DOMAIN: 'escola.com.br', NUVA_POSTGRES_PUBLISH: 'false' });
});

test('com a publicação ligada, os três comandos incluem o docker-compose.dev.yml', () => {
  const files = ['-f', 'docker-compose.yml', '-f', 'docker-compose.dev.yml'];
  for (const command of ['compose', 'up', 'down']) {
    const args = composeArgs(command, ['ps'], { publish: true });
    assert.deepEqual(args.slice(0, 8), [
      '--env-file',
      '.env',
      '--env-file',
      '.env.local',
      ...files,
    ]);
    assert.ok(!composeArgs(command, ['ps'], { publish: false }).includes('-f'), command);
  }
  // `-f` dado por quem chama não é misturado com os arquivos do projeto.
  for (const own of [
    ['-f', 'outro.yml', 'config'],
    ['--file=outro.yml', 'config'],
  ]) {
    assert.ok(!composeArgs('compose', own, { publish: true }).includes('docker-compose.dev.yml'));
  }
});

test('a migração de volume usa os mesmos arquivos de ambiente e de Compose do up', () => {
  assert.deepEqual(volumeMigrateArgs({ hasLocal: true, publish: false }), [
    'scripts/volume-migrate.sh',
    '--',
    '--env-file',
    '.env',
    '--env-file',
    '.env.local',
  ]);
  assert.deepEqual(volumeMigrateArgs({ hasLocal: false, publish: true }).slice(2), [
    '--env-file',
    '.env',
    '-f',
    'docker-compose.yml',
    '-f',
    'docker-compose.dev.yml',
  ]);
});

// `dev:up` com um dublê do docker: nada chega ao Docker de verdade.
function devUp(configStatus) {
  const dir = mkdtempSync(join(tmpdir(), 'nuva-dev-'));
  temps.push(dir);
  mkdirSync(join(dir, 'bin'));
  writeFileSync(
    join(dir, 'bin', 'docker'),
    `#!/bin/bash
echo "docker $*" >> "${join(dir, 'log')}"
case " $* " in
  *" config"*)
    printf 'name: nuva-edu\nservices:\n  postgres:\n    volumes:\n      - source: d\n        target: /var/lib/postgresql\nvolumes:\n  d:\n    name: nuva-edu-postgres-data\n'
    exit ${configStatus}
    ;;
  *" volume inspect "*) exit 0 ;;
esac
exit 0
`,
  );
  chmodSync(join(dir, 'bin', 'docker'), 0o755);
  writeFileSync(join(dir, 'log'), '');
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, 'dev.mjs'), 'up'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` },
  });
  const log = readFileSync(join(dir, 'log'), 'utf8').split('\n').filter(Boolean);
  return { ...result, log };
}

test('dev:up roda a migração de volume antes de subir', () => {
  const result = devUp(0);
  assert.equal(result.status, 0, result.stderr);
  const config = result.log.findIndex((line) => / config$/.test(line));
  const up = result.log.findIndex((line) => / up -d --build --wait/.test(line));
  assert.ok(config >= 0 && up > config, result.log.join('\n'));
  assert.match(result.stdout, /já existe/);
});

test('dev:up não sobe nada quando a migração de volume falha', () => {
  const result = devUp(1);
  assert.notEqual(result.status, 0);
  assert.ok(!result.log.some((line) => / up /.test(line)), result.log.join('\n'));
  assert.match(result.stderr, /migração de volume falhou/);
});
