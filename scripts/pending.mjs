#!/usr/bin/env node
// Aviso para comandos reservados que ainda não foram implementados.
const [name = 'comando', task = '?'] = process.argv.slice(2);
console.error(
  `pnpm ${name}: ainda não disponível. Entra na tarefa ${task} da Fase 0 (specs/PLAN.md).`,
);
process.exit(1);
