// Parte pura do `scripts/verify.mjs` (specs/032): argumentos, grafo do workspace, seleção de
// arquivos e de testes, montagem dos comandos e resumo. Nada aqui toca disco, Git ou processos;
// quem precisa do disco recebe a função `exists` de fora.

/** Nome do pacote do banco: os testes dele formam o passo "banco". */
export const DATABASE_PACKAGE = '@nuva-edu/database';

/** Pacote do cliente gerado dos contratos OpenAPI: confere se o gerado acompanha o contrato. */
export const API_CLIENT_PACKAGE = '@nuva-edu/api-client';

/** Script que confere os tipos gerados do banco contra as migrations (tem em `packages/core`). */
export const DB_TYPES_SCRIPT = 'db:types:check';

/** Pasta, relativa ao pacote, dos testes de contrato de uma API. */
export const CONTRACT_DIR = 'test/contract';

/** Nome usado para a raiz do repositório quando ela é tratada como um pacote. */
export const ROOT_PACKAGE = '(raiz)';

const LINT_EXTENSIONS = /\.(?:[cm]?[jt]s|[jt]sx|jsonc?|css)$/;
const TYPE_EXTENSIONS = /\.(?:[cm]?[jt]s|[jt]sx|json)$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const TEST_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'];

export const USAGE = `Uso:
  pnpm verify:quick [--files <caminhos...>] [-- <argumentos do executor de testes>]
  pnpm verify:full [--e2e]

quick  confere só o que mudou: alterações não commitadas mais os commits ainda não enviados
       (origin/main..HEAD). Com --files, só os caminhos dados (relativos à raiz). Roda todos os
       passos e sai com código diferente de zero se algum falhar.
       Contrato alterado roda o teste de contrato da API e confere o cliente gerado; migration
       alterada roda os testes de banco e confere os tipos gerados do banco.
full   lint, tipos, tipos gerados do banco, todos os testes com banco isolado (Testcontainers),
       contrato, banco e build; --e2e acrescenta os testes de ponta a ponta. Para na primeira
       falha.

Saída: 0 tudo certo; 1 algum passo falhou; 2 ambiente indisponível.`;

/**
 * Lê a linha de comando (sem `node` e sem o caminho do script).
 * Devolve `{ error }` quando ela não faz sentido.
 */
export function parseCliArgs(argv) {
  const [mode, ...rest] = argv;
  if (mode === '--help' || mode === '-h' || rest.includes('--help') || rest.includes('-h')) {
    return { help: true };
  }
  if (mode !== 'quick' && mode !== 'full') {
    return { error: `Modo desconhecido: ${mode ?? '(vazio)'}. Use quick ou full.` };
  }
  const result = { mode, files: null, e2e: false, extra: [] };
  const separator = rest.indexOf('--');
  const own = separator === -1 ? rest : rest.slice(0, separator);
  const extra = separator === -1 ? [] : rest.slice(separator + 1);
  for (let i = 0; i < own.length; i += 1) {
    const arg = own[i];
    if (arg === '--e2e' && mode === 'full') {
      result.e2e = true;
    } else if (arg === '--files' && mode === 'quick') {
      result.files = [];
      while (i + 1 < own.length && !own[i + 1].startsWith('--')) {
        i += 1;
        result.files.push(normalizePath(own[i]));
      }
      if (result.files.length === 0) {
        return { error: '--files espera ao menos um caminho.' };
      }
    } else {
      return { error: `Opção desconhecida no modo ${mode}: ${arg}` };
    }
  }
  if (extra.length > 0 && mode !== 'quick') {
    return { error: 'Argumentos depois de "--" só valem no modo quick.' };
  }
  result.extra = extra;
  return result;
}

/** Caminho relativo à raiz, com `/`, sem `./` no começo nem `/` no fim. */
export function normalizePath(path) {
  return path
    .replaceAll('\\', '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '');
}

/** Extrai a lista `packages:` do `pnpm-workspace.yaml` (só o subconjunto usado aqui). */
export function parseWorkspacePatterns(yaml) {
  const patterns = [];
  let inside = false;
  for (const line of yaml.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inside = true;
    } else if (inside) {
      const item = /^\s+-\s+["']?([^"'#]+?)["']?\s*(?:#.*)?$/.exec(line);
      if (item) {
        patterns.push(normalizePath(item[1]));
      } else if (/^\S/.test(line)) {
        inside = false;
      }
    }
  }
  return patterns;
}

/**
 * Monta a descrição de um pacote a partir do `package.json` dele.
 * `dir` é relativo à raiz; a raiz usa `dir: ''`.
 */
export function describePackage(dir, manifest) {
  const deps = new Set();
  for (const field of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      deps.add(name);
    }
  }
  return { name: manifest.name, dir, scripts: { ...manifest.scripts }, deps: [...deps] };
}

/**
 * A raiz vista como pacote: sem checagem de tipos nem build próprios (os scripts `typecheck` e
 * `build` da raiz percorrem o workspace), e com os testes dos scripts no lugar de `test`.
 */
export function describeRoot(manifest) {
  const described = describePackage('', manifest);
  const test = manifest.scripts?.['test:scripts'];
  return { ...described, name: ROOT_PACKAGE, scripts: test ? { test } : {} };
}

/** Pacote dono do arquivo: o de pasta mais longa que o contém; a raiz, se nenhum. */
export function packageOf(file, packages) {
  let best = packages.find((pkg) => pkg.dir === '');
  for (const pkg of packages) {
    if (
      pkg.dir !== '' &&
      file.startsWith(`${pkg.dir}/`) &&
      pkg.dir.length > (best?.dir.length ?? 0)
    ) {
      best = pkg;
    }
  }
  return best;
}

/** Caminho do arquivo relativo à pasta do pacote. */
export function relativeTo(pkg, file) {
  return pkg.dir === '' ? file : file.slice(pkg.dir.length + 1);
}

/** Nomes dos pacotes que dependem, direta ou indiretamente, de algum dos `names`. */
export function dependentsOf(names, packages) {
  const found = new Set(names);
  let grew = true;
  while (grew) {
    grew = false;
    for (const pkg of packages) {
      if (!found.has(pkg.name) && pkg.deps.some((dep) => found.has(dep))) {
        found.add(pkg.name);
        grew = true;
      }
    }
  }
  for (const name of names) {
    found.delete(name);
  }
  return [...found];
}

/** Verdadeiro se o pacote é o do banco ou depende dele (direta ou indiretamente). */
export function usesDatabase(pkg, packages) {
  return (
    pkg.name === DATABASE_PACKAGE || dependentsOf([DATABASE_PACKAGE], packages).includes(pkg.name)
  );
}

export function isTestFile(file) {
  return TEST_FILE.test(file);
}

export function isContractPath(relative) {
  return relative === CONTRACT_DIR || relative.startsWith(`${CONTRACT_DIR}/`);
}

/**
 * Script que confere o cliente gerado contra os contratos: `check`; na falta dele, o `test` do
 * pacote. `null` se o pacote não tem nenhum dos dois.
 */
export function clientCheckScript(pkg) {
  return ['check', 'test'].find((name) => pkg?.scripts[name]) ?? null;
}

/**
 * Onde pode morar o teste de um arquivo-fonte, em caminhos relativos ao pacote:
 * `src/a/x.ts` → `test/a/x.test.ts`, `test/x.test.ts`, `src/a/x.test.ts`, `src/a/__tests__/x.test.ts`
 * (em qualquer extensão de teste).
 */
export function testCandidates(relative) {
  const slash = relative.lastIndexOf('/');
  const dir = slash === -1 ? '' : relative.slice(0, slash);
  const base = relative.slice(slash + 1).replace(/\.[^.]+$/, '');
  if (!base || isTestFile(relative)) {
    return [];
  }
  const dirs = [dir, dir ? `${dir}/__tests__` : '__tests__'];
  if (dir === 'src' || dir.startsWith('src/')) {
    const inner = dir.slice(4);
    dirs.unshift(inner ? `test/${inner}` : 'test', 'test');
  }
  const candidates = new Set();
  for (const where of dirs) {
    for (const kind of ['test', 'spec']) {
      for (const ext of TEST_EXTENSIONS) {
        candidates.add(`${where ? `${where}/` : ''}${base}.${kind}.${ext}`);
      }
    }
  }
  return [...candidates];
}

function addTo(map, key, values) {
  const list = map.get(key) ?? [];
  for (const value of values) {
    if (!list.includes(value)) {
      list.push(value);
    }
  }
  map.set(key, list);
}

/**
 * Decide o que o modo rápido roda.
 *
 * @param changed   `[{ path, deleted }]`, caminhos relativos à raiz
 * @param packages  pacotes do workspace mais a raiz (`dir: ''`)
 * @param exists    `(caminho relativo à raiz) => boolean`
 * @returns `lint` (arquivos), `types` (nomes de pacote), e `tests`, `contract`, `database`:
 *          mapas nome do pacote → arquivos de teste relativos ao pacote. Em `database`, o valor
 *          `null` quer dizer "a suíte inteira do pacote". `client`: pacotes do cliente gerado a
 *          conferir (contrato ou gerado alterado). `dbTypes`: pacotes cujos tipos gerados do
 *          banco conferir (migration ou gerado alterado).
 */
export function planQuick({ changed, packages, exists }) {
  const plan = {
    lint: [],
    types: [],
    tests: new Map(),
    contract: new Map(),
    client: [],
    database: new Map(),
    dbTypes: [],
  };
  const typed = new Set();
  let allTypes = false;
  const client = packages.find((pkg) => pkg.name === API_CLIENT_PACKAGE);
  const withDbTypes = packages.filter((pkg) => pkg.scripts[DB_TYPES_SCRIPT]);
  const dbTypes = new Set();
  let checkClient = false;

  for (const { path, deleted } of changed) {
    const pkg = packageOf(path, packages);
    const relative = relativeTo(pkg, path);
    const isDatabase = pkg.name === DATABASE_PACKAGE;

    if (!deleted && LINT_EXTENSIONS.test(path)) {
      plan.lint.push(path);
    }
    if (path === 'tsconfig.base.json') {
      allTypes = true;
    } else if (pkg.dir !== '' && TYPE_EXTENSIONS.test(path)) {
      typed.add(pkg.name);
    }

    if (isDatabase && relative.startsWith('migrations/')) {
      plan.database.set(pkg.name, null);
      // Migration nova ou alterada sem regenerar os tipos: quem acusa é o `db:types:check`.
      for (const owner of withDbTypes) {
        dbTypes.add(owner.name);
      }
      continue;
    }
    // O próprio gerado (ou o script que o gera) mexido à mão também é conferido.
    const generated = /(?:^|\/)generated\//.test(relative) || relative.startsWith('scripts/');
    if (generated && pkg.scripts[DB_TYPES_SCRIPT]) {
      dbTypes.add(pkg.name);
    }
    if (pkg.dir !== '' && (relative === 'openapi.yaml' || (generated && pkg === client))) {
      checkClient = true;
    }

    const inPackage = (candidate) => (pkg.dir === '' ? candidate : `${pkg.dir}/${candidate}`);
    let found = [];
    if (isTestFile(relative)) {
      found = deleted ? [] : [relative];
    } else {
      found = testCandidates(relative).filter((candidate) => exists(inPackage(candidate)));
    }

    const touchesContract =
      relative === 'openapi.yaml' || /^src\/(?:.*\/)?routes?(?:\/|\.[^/]+$)/.test(relative);
    if (touchesContract && exists(inPackage(CONTRACT_DIR))) {
      addTo(plan.contract, pkg.name, [CONTRACT_DIR]);
    }

    for (const file of found) {
      if (isDatabase) {
        if (plan.database.get(pkg.name) !== null) {
          addTo(plan.database, pkg.name, [file]);
        }
      } else if (isContractPath(file)) {
        addTo(plan.contract, pkg.name, [file]);
      } else {
        addTo(plan.tests, pkg.name, [file]);
      }
    }
  }

  const affected = allTypes ? packages.map((pkg) => pkg.name) : [...typed];
  const withDependents = new Set([...affected, ...dependentsOf(affected, packages)]);
  plan.types = packages
    .filter((pkg) => withDependents.has(pkg.name) && pkg.scripts.typecheck)
    .map((pkg) => pkg.name)
    .sort();

  // O diretório inteiro de contrato já inclui os arquivos soltos dele.
  for (const [name, files] of plan.contract) {
    if (files.includes(CONTRACT_DIR)) {
      plan.contract.set(name, [CONTRACT_DIR]);
    }
  }
  plan.client = checkClient && clientCheckScript(client) ? [client.name] : [];
  plan.dbTypes = [...dbTypes].sort();
  return plan;
}

/**
 * Separa os argumentos dados depois de `--` em arquivos de teste (por pacote) e opções do
 * executor. Um caminho vale se existir a partir da raiz ou a partir da pasta de algum pacote;
 * os pacotes de `preferred` (os afetados pela mudança) são tentados primeiro.
 */
export function resolveExtraArgs({ extra, packages, preferred = [], exists }) {
  const files = new Map();
  const flags = [];
  const unresolved = [];
  const order = [
    ...packages.filter((pkg) => preferred.includes(pkg.name)),
    ...packages.filter((pkg) => !preferred.includes(pkg.name)),
  ];

  extra.forEach((arg, index) => {
    if (arg.startsWith('-')) {
      flags.push(arg);
      return;
    }
    const path = normalizePath(arg);
    let owner = null;
    let relative = path;
    if (exists(path)) {
      owner = packageOf(path, packages);
      relative = relativeTo(owner, path);
    } else {
      owner = order.find((pkg) => pkg.dir !== '' && exists(`${pkg.dir}/${path}`)) ?? null;
    }
    if (owner) {
      addTo(files, owner.name, [relative]);
      return;
    }
    const previous = extra[index - 1];
    if (previous?.startsWith('-') && !previous.includes('=')) {
      flags.push(arg);
    } else {
      unresolved.push(arg);
    }
  });
  return { files, flags, unresolved };
}

/** Junta ao plano os testes explícitos, cada um no passo a que pertence. */
export function addExplicitTests(plan, files) {
  for (const [name, list] of files) {
    for (const file of list) {
      if (name === DATABASE_PACKAGE) {
        if (plan.database.get(name) !== null) {
          addTo(plan.database, name, [file]);
        }
      } else if (isContractPath(file)) {
        addTo(plan.contract, name, [file]);
      } else {
        addTo(plan.tests, name, [file]);
      }
    }
  }
  return plan;
}

/**
 * Quebra um script do `package.json` em argumentos. Devolve `null` quando o script usa recursos
 * do shell (`&&`, `|`, `;`, redirecionamento, variáveis), que não dá para repassar com segurança.
 */
export function tokenizeScript(script) {
  const tokens = [];
  let current = '';
  let quote = null;
  let open = false;
  for (let i = 0; i < script.length; i += 1) {
    const char = script[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && quote === '"' && i + 1 < script.length) {
        i += 1;
        current += script[i];
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      open = true;
    } else if (/\s/.test(char)) {
      if (open || current) {
        tokens.push(current);
      }
      current = '';
      open = false;
    } else if ('&|;<>$`()'.includes(char)) {
      return null;
    } else {
      current += char;
    }
  }
  if (quote) {
    return null;
  }
  if (open || current) {
    tokens.push(current);
  }
  return tokens.length > 0 ? tokens : null;
}

function looksLikeTestTarget(token) {
  return (
    !token.startsWith('-') && (token.includes('*') || isTestFile(token) || token.endsWith('/'))
  );
}

/** Traduz `-t <nome>` (Vitest) para o executor nativo do Node. */
function flagsForNodeTest(flags) {
  const translated = [];
  for (let i = 0; i < flags.length; i += 1) {
    const flag = flags[i];
    const inline = /^(?:-t|--testNamePattern)=(.*)$/.exec(flag);
    if (inline) {
      translated.push(`--test-name-pattern=${inline[1]}`);
    } else if ((flag === '-t' || flag === '--testNamePattern') && i + 1 < flags.length) {
      i += 1;
      translated.push(`--test-name-pattern=${flags[i]}`);
    } else {
      translated.push(flag);
    }
  }
  return translated;
}

/**
 * Monta o comando que roda os testes de um pacote.
 *
 * Convenção: o script `test` do pacote é um comando só, `<executor> [opções] [alvos padrão]`, e o
 * executor aceita caminhos de arquivo relativos à pasta do pacote como argumentos. Com `files`,
 * os alvos padrão do script (globs, pastas, arquivos de teste) saem e entram os arquivos pedidos.
 * Sem `files` (`null`), roda o script como está.
 *
 * Pacote cujo `test` não cabe nessa forma (encadeia comandos com `&&`, por exemplo) declara
 * também `test:files`, que cabe; ele é o usado quando há arquivos a repassar.
 *
 * @returns `{ argv, filtered }`; `filtered` é falso quando não deu para limitar aos arquivos
 *          (script com recursos do shell) e o pacote roda a suíte inteira.
 */
export function buildTestCommand(pkg, files, flags = [], scriptName = 'test') {
  if (files !== null && scriptName === 'test' && pkg.scripts['test:files']) {
    return buildTestCommand(pkg, files, flags, 'test:files');
  }
  const script = pkg.scripts[scriptName];
  if (!script) {
    return null;
  }
  const tokens = tokenizeScript(script);
  if (!tokens) {
    return { argv: ['pnpm', 'run', scriptName], filtered: files === null };
  }
  const isNodeTest = tokens[0] === 'node' && tokens.includes('--test');
  const options = isNodeTest ? flagsForNodeTest(flags) : flags;
  if (files === null) {
    // No executor do Node as opções vêm antes dos alvos.
    const firstTarget = tokens.findIndex((token, index) => index > 0 && looksLikeTestTarget(token));
    const at = isNodeTest && firstTarget !== -1 ? firstTarget : tokens.length;
    return { argv: [...tokens.slice(0, at), ...options, ...tokens.slice(at)], filtered: true };
  }
  const base = tokens.filter((token, index) => index === 0 || !looksLikeTestTarget(token));
  return { argv: [...base, ...options, ...files], filtered: true };
}

/**
 * Comando da suíte inteira de um pacote no modo completo. `test:coverage`, quando existe,
 * substitui `test`: é onde o pacote impõe a meta de cobertura.
 *
 * Com `hasContract` (o pacote tem `test/contract`), a pasta sai desta execução para o passo
 * "contrato" não rodar os mesmos testes de novo. Só o Vitest sabe excluir pela linha de comando;
 * com outro executor a suíte roda inteira e `contractExcluded` volta falso, para o passo
 * "contrato" pular o pacote.
 *
 * @returns `{ argv, script, contractExcluded }` ou `null` se o pacote não tem testes
 */
export function buildFullTestCommand(pkg, { hasContract = false } = {}) {
  const script = ['test:coverage', 'test'].find((name) => pkg.scripts[name]);
  if (!script) {
    return null;
  }
  const tokens = tokenizeScript(pkg.scripts[script]);
  const contractExcluded = hasContract && tokens?.[0] === 'vitest';
  const flags = contractExcluded ? ['--exclude', `${CONTRACT_DIR}/**`] : [];
  return { argv: buildTestCommand(pkg, null, flags, script).argv, script, contractExcluded };
}

/** Comando de um script qualquer do pacote (`typecheck`, `build`), sem argumentos a mais. */
export function buildScriptCommand(pkg, scriptName) {
  const script = pkg.scripts[scriptName];
  if (!script) {
    return null;
  }
  return tokenizeScript(script) ?? ['pnpm', 'run', scriptName];
}

/** Nome curto do pacote para o resumo: `@nuva-edu/core` → `core`. */
export function shortName(name) {
  return name === ROOT_PACKAGE ? 'scripts' : name.replace(/^@[^/]+\//, '');
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Resumo final. Cada passo: `{ name, status, ms, note }`, com `status` em
 * `ok` | `fail` | `skipped` | `not-run`.
 */
export function formatSummary(steps) {
  const width = Math.max(...steps.map((step) => step.name.length), 8);
  return steps
    .map((step) => {
      const name = step.name.padEnd(width + 2);
      const note = step.note ? `(${step.note})` : '';
      if (step.status === 'skipped') {
        return `– ${name}${'pulado'.padEnd(7)}${note}`.trimEnd();
      }
      if (step.status === 'not-run') {
        return `– ${name}${'pulado'.padEnd(7)}(não rodou: passo anterior falhou)`;
      }
      const mark = step.status === 'ok' ? '✓' : '✗';
      return `${mark} ${name}${formatSeconds(step.ms).padEnd(7)}${note}`.trimEnd();
    })
    .join('\n');
}

/**
 * Código de saída: 0 sem falha; 2 quando toda falha veio de ambiente indisponível
 * (`step.environment`); 1 nos demais casos.
 */
export function exitCodeFor(steps) {
  const failed = steps.filter((step) => step.status === 'fail');
  if (failed.length === 0) {
    return 0;
  }
  return failed.every((step) => step.environment) ? 2 : 1;
}
