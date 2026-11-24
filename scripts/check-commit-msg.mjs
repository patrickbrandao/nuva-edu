#!/usr/bin/env node
// Valida a mensagem de commit: Conventional Commits citando a tarefa (specs/002).
// Uso: node scripts/check-commit-msg.mjs <arquivo-da-mensagem>
import { readFileSync } from 'node:fs';

const TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];
const HEADER = new RegExp(`^(${TYPES.join('|')})(\\([a-z0-9][a-z0-9-]*\\))?!?: \\S.*$`);
const TASK = /\(task \d{3}\)/;

export function checkCommitMessage(raw) {
  const lines = raw.split('\n').filter((line) => !line.startsWith('#'));
  const header = (lines[0] ?? '').trim();
  const errors = [];
  if (/^(Merge|Revert) /.test(header)) return errors;
  if (!HEADER.test(header)) {
    errors.push(`o título deve seguir "tipo(escopo): resumo"; tipos aceitos: ${TYPES.join(', ')}`);
  }
  if (header.length > 100) errors.push('o título passa de 100 caracteres');
  if (!TASK.test(lines.join('\n'))) errors.push('cite a tarefa no formato "(task 012)"');
  return errors;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('uso: check-commit-msg.mjs <arquivo-da-mensagem>');
    process.exit(2);
  }
  const errors = checkCommitMessage(readFileSync(file, 'utf8'));
  if (errors.length > 0) {
    console.error('Mensagem de commit recusada:');
    for (const error of errors) console.error(`  - ${error}`);
    console.error('Exemplo: feat(api-admin): lista de usuários com filtro (task 012)');
    process.exit(1);
  }
}
