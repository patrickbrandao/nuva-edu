// Imagens dos sites (spec 031). O `vite build` roda dentro do contêiner, então todo pacote do
// workspace alcançado pelo bundle precisa estar no Dockerfile: desde a ADR 0027 o UI importa
// `@nuva-edu/core/markdown`, e sem o núcleo no estágio `build` a imagem não constrói (task 702).
// O teste faz o caminho contrário: parte do que cada site importa e exige o pacote no `deps`
// (manifesto, para o `pnpm install` resolver `workspace:*`) e no `build` (código).
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { parseWorkspacePatterns } from './lib/verify-plan.mjs';

const root = resolve(import.meta.dirname, '..');
const SITES = ['admin', 'classroom'];
// O `.dockerignore` deixa os testes de fora: o que só um teste importa não precisa resolver.
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.vite']);

/** Pacotes do workspace: nome do pacote -> pasta relativa à raiz. */
function workspacePackages() {
  const patterns = parseWorkspacePatterns(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'));
  const packages = new Map();
  for (const pattern of patterns) {
    const dirs = pattern.endsWith('/*')
      ? readdirSync(join(root, pattern.slice(0, -2)), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${pattern.slice(0, -2)}/${entry.name}`)
      : [pattern];
    for (const dir of dirs.sort()) {
      const manifest = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
      packages.set(manifest.name, dir);
    }
  }
  return packages;
}

const PACKAGES = workspacePackages();

function manifest(dir) {
  return JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
}

/** Dependências de produção que são pacotes do workspace. */
function workspaceDependencies(dir) {
  return Object.keys(manifest(dir).dependencies ?? {}).filter((name) => PACKAGES.has(name));
}

/** O site mais tudo o que o bundle dele pode alcançar pelo `package.json`. */
function bundleClosure(app) {
  const start = `apps/${app}`;
  const seen = new Map([[manifest(start).name, start]]);
  const queue = [start];
  while (queue.length > 0) {
    for (const name of workspaceDependencies(queue.shift())) {
      if (seen.has(name)) continue;
      seen.set(name, PACKAGES.get(name));
      queue.push(PACKAGES.get(name));
    }
  }
  return seen;
}

function sourceFiles(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path);
      } else if (/\.(?:[cm]?[jt]sx?|css)$/.test(entry.name) && !TEST_FILE.test(entry.name)) {
        files.push(path);
      }
    }
  };
  if (existsSync(join(root, dir))) walk(join(root, dir));
  return files;
}

// `import ... from`, `export ... from`, `import(...)` e `require(...)`.
const IMPORT_PATTERNS = [
  /\b(?:import|export)\b[^;]*?\bfrom\s*['"]@nuva-edu\/([\w-]+)/g,
  /\b(?:import|require)\s*\(\s*['"]@nuva-edu\/([\w-]+)/g,
];

/** Pacotes do workspace citados nos imports do que o Vite empacota (`src/`) de um pacote. */
function importedPackages(dir) {
  const names = new Set();
  for (const file of sourceFiles(`${dir}/src`)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of IMPORT_PATTERNS) {
      for (const [, name] of text.matchAll(pattern)) {
        if (PACKAGES.has(`@nuva-edu/${name}`)) names.add(`@nuva-edu/${name}`);
      }
    }
  }
  return names;
}

/** Estágios do Dockerfile: nome -> linhas. */
function stages(text) {
  const found = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const from = /^FROM\s+\S+\s+AS\s+(\S+)\s*$/i.exec(line);
    if (from) {
      current = from[1];
      found.set(current, []);
    } else if (current) {
      found.get(current).push(line);
    }
  }
  return found;
}

/** Origens de `COPY` de um estágio, sem as opções (`--from=`, `--chmod=`). */
function copySources(lines) {
  return new Set(
    lines
      .map((line) => /^COPY\s+(?:--\S+\s+)*(\S+)/.exec(line))
      .filter(Boolean)
      .map(([, source]) => source.replace(/\/$/, '')),
  );
}

test('cada site declara no package.json todo pacote do workspace que importa', () => {
  for (const app of SITES) {
    const closure = bundleClosure(app);
    for (const [name, dir] of closure) {
      const declared = new Set([
        ...Object.keys(manifest(dir).dependencies ?? {}),
        ...Object.keys(manifest(dir).peerDependencies ?? {}),
        name,
      ]);
      for (const imported of importedPackages(dir)) {
        assert.ok(
          declared.has(imported),
          `${dir} importa ${imported} e não o declara no package.json`,
        );
      }
    }
  }
});

test('o Dockerfile de cada site copia no deps e no build todo pacote alcançado pelo bundle', () => {
  for (const app of SITES) {
    const dockerfile = `apps/${app}/Dockerfile`;
    const parsed = stages(readFileSync(join(root, dockerfile), 'utf8'));
    assert.ok(parsed.has('deps') && parsed.has('build'), `${dockerfile}: estágios esperados`);
    const deps = copySources(parsed.get('deps'));
    const build = copySources(parsed.get('build'));
    for (const [, dir] of bundleClosure(app)) {
      // No `deps` entra o manifesto: o `pnpm install --filter` resolve o `workspace:*` por ele.
      const copy = `${dir}/package.json`;
      assert.ok(deps.has(copy), `${dockerfile}: falta "COPY ${copy}" no estágio deps`);
      assert.ok(existsSync(join(root, copy)), `${dockerfile}: ${copy} não existe`);
      // No `build` entra o código do pacote.
      assert.ok(build.has(dir), `${dockerfile}: falta "COPY ${dir}" no estágio build`);
      assert.ok(existsSync(join(root, dir)), `${dockerfile}: ${dir} não existe`);
    }
  }
});

test('o UI importa o núcleo e o núcleo acompanha as duas imagens', () => {
  // A regressão da task 702, escrita como teste para ela não voltar calada.
  assert.ok(importedPackages('packages/ui').has('@nuva-edu/core'));
  for (const app of SITES) {
    const dockerfile = readFileSync(join(root, `apps/${app}/Dockerfile`), 'utf8');
    assert.ok(dockerfile.includes('COPY packages/core/package.json packages/core/'), app);
    assert.ok(dockerfile.includes('COPY packages/core packages/core'), app);
  }
});

test('o .dockerignore não exclui o que as imagens copiam', () => {
  const ignored = readFileSync(join(root, '.dockerignore'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  const ignoredTop = new Set(ignored.map((rule) => rule.replace(/\/$/, '')));
  for (const app of SITES) {
    for (const dir of new Set([...bundleClosure(app).values(), `apps/${app}`])) {
      assert.ok(!ignoredTop.has(dir.split('/')[0]), `.dockerignore exclui ${dir}`);
    }
  }
  // Os testes de dentro do workspace ficam de fora; o bundle não os alcança.
  assert.ok(ignored.includes('**/*.test.ts'));
});
