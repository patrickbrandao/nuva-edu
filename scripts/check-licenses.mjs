#!/usr/bin/env node
// Confere as licenças das dependências contra `license-allowlist.json` (spec 032, "CI").
//
//   pnpm licenses:check
//
// Lê o `pnpm licenses list --recursive --json` (precisa do `pnpm install` feito). Uma expressão
// SPDX passa quando é satisfeita só com licenças permitidas: `A OR B` basta uma, `A AND B`
// exige as duas. Pacote sem licença declarada, ou com texto que não é SPDX, falha.
// `exceptions` libera um pacote pelo nome, com o motivo registrado no próprio arquivo.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
export const ALLOWLIST_FILE = 'license-allowlist.json';

/** Avalia uma expressão SPDX: `true` se ela pode ser cumprida só com as licenças permitidas. */
export function isAllowed(expression, allowed) {
  const tokens = String(expression ?? '').match(/\(|\)|[^\s()]+/g) ?? [];
  if (tokens.length === 0) {
    return false;
  }
  const names = new Set([...allowed].map((name) => name.toLowerCase()));
  let position = 0;
  const peek = () => tokens[position]?.toUpperCase();

  // Gramática: or := and (OR and)* ; and := term (AND term)* ; term := "(" or ")" | id [WITH id]
  const term = () => {
    const token = tokens[position];
    position += 1;
    if (token === '(') {
      const inner = or();
      if (tokens[position] !== ')') {
        throw new Error('parêntese sem fechar');
      }
      position += 1;
      return inner;
    }
    if (token === undefined || token === ')' || /^(AND|OR|WITH)$/i.test(token)) {
      throw new Error('expressão malformada');
    }
    if (peek() === 'WITH') {
      // A exceção só afrouxa a licença base; o que decide é a licença.
      position += 2;
    }
    // O sufixo "+" (ou posterior) não muda a compatibilidade da licença base.
    return names.has(token.toLowerCase()) || names.has(token.replace(/\+$/, '').toLowerCase());
  };
  const and = () => {
    let result = term();
    while (peek() === 'AND') {
      position += 1;
      result = term() && result;
    }
    return result;
  };
  const or = () => {
    let result = and();
    while (peek() === 'OR') {
      position += 1;
      result = and() || result;
    }
    return result;
  };

  try {
    const result = or();
    return position === tokens.length && result;
  } catch {
    return false;
  }
}

/**
 * Pacotes fora da lista.
 * @param report     saída do `pnpm licenses list --json`: `{ "<licença>": [{ name, versions }] }`
 * @param allowlist  `{ allowed: string[], exceptions: { "<pacote>": "<motivo>" } }`
 * @returns `[{ name, versions, license }]`, em ordem de nome
 */
export function findViolations(report, allowlist) {
  const exceptions = allowlist.exceptions ?? {};
  const violations = [];
  for (const [license, packages] of Object.entries(report)) {
    if (isAllowed(license, allowlist.allowed ?? [])) {
      continue;
    }
    for (const pkg of packages) {
      if (!Object.hasOwn(exceptions, pkg.name)) {
        violations.push({ name: pkg.name, versions: pkg.versions ?? [], license });
      }
    }
  }
  return violations.sort((a, b) => a.name.localeCompare(b.name));
}

function main() {
  const allowlist = JSON.parse(readFileSync(resolve(root, ALLOWLIST_FILE), 'utf8'));
  const listed = spawnSync('pnpm', ['licenses', 'list', '--recursive', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (listed.error || listed.status !== 0) {
    console.error(
      `Não consegui listar as licenças (pnpm licenses list): ${listed.error?.message ?? listed.stderr}`,
    );
    return 2;
  }
  const report = JSON.parse(listed.stdout);
  const total = Object.values(report).reduce((sum, packages) => sum + packages.length, 0);
  if (total === 0) {
    console.error('Nenhuma dependência listada: rode `pnpm install` antes.');
    return 2;
  }
  const violations = findViolations(report, allowlist);
  if (violations.length > 0) {
    console.error(`Licenças fora de ${ALLOWLIST_FILE}:`);
    for (const { name, versions, license } of violations) {
      console.error(`  - ${name}@${versions.join(', ')}: ${license}`);
    }
    console.error(
      `Troque a dependência ou, confirmada a compatibilidade com a AGPL-3.0, acrescente a licença em "allowed" (ou o pacote em "exceptions", com o motivo).`,
    );
    return 1;
  }
  console.log(
    `Licenças: ${total} dependências, todas dentro de ${ALLOWLIST_FILE} (${Object.keys(report).sort().join('; ')}).`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(main());
}
