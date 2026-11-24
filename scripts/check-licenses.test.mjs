// Checagem de licenças do fluxo `security` (spec 032): expressões SPDX e a lista versionada.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { ALLOWLIST_FILE, findViolations, isAllowed } from './check-licenses.mjs';

const allowed = ['MIT', 'Apache-2.0', 'ISC', 'GPL-3.0-or-later'];

test('licença simples: só passa a que está na lista', () => {
  assert.equal(isAllowed('MIT', allowed), true);
  assert.equal(isAllowed('mit', allowed), true);
  assert.equal(isAllowed('SSPL-1.0', allowed), false);
  assert.equal(isAllowed('', allowed), false);
  assert.equal(isAllowed(undefined, allowed), false);
  assert.equal(isAllowed('Unknown', allowed), false);
});

test('OR basta uma permitida; AND exige todas', () => {
  assert.equal(isAllowed('MIT OR SSPL-1.0', allowed), true);
  assert.equal(isAllowed('(SSPL-1.0 OR Apache-2.0)', allowed), true);
  assert.equal(isAllowed('MIT AND SSPL-1.0', allowed), false);
  assert.equal(isAllowed('MIT AND ISC', allowed), true);
  assert.equal(isAllowed('(MIT AND SSPL-1.0) OR ISC', allowed), true);
  assert.equal(isAllowed('MIT AND (SSPL-1.0 OR BUSL-1.1)', allowed), false);
});

test('WITH e "+" seguem a licença base; expressão malformada não passa', () => {
  assert.equal(isAllowed('Apache-2.0 WITH LLVM-exception', allowed), true);
  assert.equal(isAllowed('SSPL-1.0 WITH Qualquer-exception', allowed), false);
  assert.equal(isAllowed('Apache-2.0+', allowed), true);
  assert.equal(isAllowed('MIT OR', allowed), false);
  assert.equal(isAllowed('(MIT', allowed), false);
  assert.equal(isAllowed('MIT ISC', allowed), false);
  assert.equal(isAllowed('SEE LICENSE IN LICENSE.txt', allowed), false);
});

test('findViolations lista os pacotes fora da lista e respeita as exceções', () => {
  const report = {
    MIT: [{ name: 'a', versions: ['1.0.0'] }],
    'SSPL-1.0': [
      { name: 'z-proibido', versions: ['2.0.0'] },
      { name: 'b-liberado', versions: ['3.0.0'] },
    ],
    Unknown: [{ name: 'c-sem-licenca', versions: ['0.1.0'] }],
  };
  const violations = findViolations(report, {
    allowed,
    exceptions: { 'b-liberado': 'motivo registrado' },
  });
  assert.deepEqual(violations, [
    { name: 'c-sem-licenca', versions: ['0.1.0'], license: 'Unknown' },
    { name: 'z-proibido', versions: ['2.0.0'], license: 'SSPL-1.0' },
  ]);
});

test('a lista versionada na raiz tem o formato esperado e inclui a licença do projeto', () => {
  const file = resolve(import.meta.dirname, '..', ALLOWLIST_FILE);
  const allowlist = JSON.parse(readFileSync(file, 'utf8'));
  assert.ok(Array.isArray(allowlist.allowed) && allowlist.allowed.length > 0);
  assert.ok(allowlist.allowed.includes('AGPL-3.0-only'));
  assert.equal(typeof allowlist.exceptions, 'object');
  for (const [name, reason] of Object.entries(allowlist.exceptions)) {
    assert.ok(typeof reason === 'string' && reason.length > 0, `${name}: exceção sem motivo`);
  }
});
