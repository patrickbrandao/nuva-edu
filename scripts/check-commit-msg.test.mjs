import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCommitMessage } from './check-commit-msg.mjs';

test('aceita Conventional Commits com a tarefa citada', () => {
  assert.deepEqual(checkCommitMessage('feat(api-admin): lista de usuários (task 012)\n'), []);
  assert.deepEqual(checkCommitMessage('fix: corrige cálculo\n\nDetalhes.\n(task 003)\n'), []);
  assert.deepEqual(checkCommitMessage('feat(core)!: muda contrato (task 120)'), []);
});

test('recusa título fora do padrão', () => {
  assert.equal(checkCommitMessage('ajustes diversos (task 012)').length, 1);
  assert.equal(checkCommitMessage('feature(x): algo (task 012)').length, 1);
  assert.equal(checkCommitMessage('feat(API Admin): algo (task 012)').length, 1);
});

test('recusa commit sem tarefa', () => {
  assert.equal(checkCommitMessage('feat(core): algo').length, 1);
  assert.equal(checkCommitMessage('feat(core): algo (task 12)').length, 1);
});

test('ignora linhas de comentário e aceita merge e revert do Git', () => {
  assert.deepEqual(checkCommitMessage('# comentário\nMerge branch "x"'), []);
  assert.deepEqual(checkCommitMessage('Revert "feat: algo"'), []);
  assert.equal(checkCommitMessage('# feat(core): algo (task 001)\nbagunça').length, 2);
});

test('recusa título com mais de 100 caracteres', () => {
  const long = `feat(core): ${'a'.repeat(100)} (task 001)`;
  assert.equal(checkCommitMessage(long).length, 1);
});
