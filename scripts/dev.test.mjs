import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeArgs, envFileArgs, mergeEnv, publishPostgres } from './dev.mjs';

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
