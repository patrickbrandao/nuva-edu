import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeArgs, envFileArgs } from './dev.mjs';

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
