#!/usr/bin/env node
// Um worktree por tarefa (specs/002, ADR 0021): `pnpm task:start`, `task:finish`, `task:abort`,
// `task:path` e `task:list`.
//
// A tarefa NNN é o arquivo `tasks/NNN-*.md` do checkout principal; o trabalho acontece em
// `.worktrees/task-NNN/`, no branch local `task/NNN`. O script nunca usa `git stash`,
// `git reset --hard` nem `git push --force`.
//
// Janela de contrato (specs/002, ADR 0022): a tarefa com `janela: NNN` no cabeçalho não tem
// worktree nem branch próprios. Entra com `task:start MMM --as <papel> --join NNN`, trabalha no
// worktree da tarefa NNN, fica `pronta` com `task:finish MMM` e só chega à `main` no
// `task:finish NNN`, que remove os arquivos de todas as tarefas da janela.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, sep } from 'node:path';

/** Códigos de saída. Cada parada do `finish` tem o seu, para o agente saber o que relatar. */
export const EXIT = Object.freeze({
  /** Deu certo. */
  OK: 0,
  /** Uso errado (argumento, tarefa inexistente) ou erro inesperado do Git. */
  ERROR: 1,
  /** Recusa por pré-condição; nada foi alterado. */
  REFUSED: 2,
  /** O worktree da tarefa tem alterações não commitadas. */
  DIRTY: 3,
  /** O rebase sobre a `main` parou em conflito (fica em andamento no worktree). */
  CONFLICT: 4,
  /** A verificação falhou no worktree. */
  VERIFY: 5,
  /** O fast-forward da `main` continuou impossível depois da nova tentativa. */
  NOT_FF: 6,
  /** O push falhou: a `main` local já tem a tarefa e a limpeza local foi feita. */
  PUSH: 7,
  /** O `pnpm install` falhou no worktree. */
  INSTALL: 8,
});

export const USAGE = `Uso:
  pnpm task:start NNN --as <papel>   cria .worktrees/task-NNN no branch task/NNN a partir da main
  pnpm task:start MMM --as <papel> --join NNN
                                     entra na janela de contrato NNN, sem worktree nem branch
  pnpm task:finish [NNN]             rebase, verificação, fast-forward da main, push e limpeza
  pnpm task:abort NNN [--force]      remove worktree e branch; a tarefa volta a "aberta"
  pnpm task:path                     caminho do checkout principal (onde fica a fila tasks/)
  pnpm task:list                     tarefas da fila: status, papel, dependências e worktree

finish  sem NNN, usa o branch task/NNN do diretório atual. --skip-verify só vale junto de
        --i-know e é de uso do humano.
abort   recusa com alterações não commitadas ou commits fora da main; --force os descarta e pede
        confirmação digitada num terminal.

Janela de contrato (specs/002): a tarefa MMM com "janela: NNN" no cabeçalho trabalha no worktree
da tarefa NNN (a do contrato), que precisa estar aberta e "em-andamento".
start   sem --join, recusa tarefa que tem "janela:". Com --join NNN, só marca a tarefa como
        "em-andamento" e imprime WORKTREE=<worktree da janela>. Dependência atendida: a própria
        NNN, ou tarefa da mesma janela já "pronta".
finish  MMM (tarefa da janela): exige commit terminando com "(task MMM)" em main..task/NNN e a
        seção "## Relato" no arquivo da tarefa; só marca "pronta". Não faz rebase, não verifica,
        não toca a main e não remove nada.
        NNN (a janela): recusa enquanto houver tarefa da janela que não esteja "pronta"; depois
        é o finish normal, e a limpeza remove também os arquivos das tarefas da janela.
abort   MMM (tarefa da janela): só devolve a tarefa a "aberta"; recusa se já há commit
        "(task MMM)" no branch da janela.
        NNN (a janela): as regras de sempre; devolve a "aberta" também as tarefas da janela.

Códigos de saída:
  0  sucesso
  1  uso errado ou erro inesperado do Git
  2  recusa por pré-condição (estado da tarefa, dependência pendente, branch ou worktree já
     existente, checkout principal sujo ou fora da main, --force sem terminal; na janela de
     contrato: --join que não confere, janela fechada, falta de commit ou de relato, tarefa da
     janela que não está "pronta"); nada muda
  3  worktree da tarefa com alterações não commitadas
  4  conflito no rebase sobre a main (o rebase fica em andamento no worktree)
  5  verificação falhou no worktree
  6  fast-forward da main impossível depois de uma nova tentativa
  7  push falhou: a main local já avançou, worktree, branch e arquivo da tarefa já foram
     removidos; falta só "git push origin main" no checkout principal
  8  pnpm install falhou no worktree`;

const GIT_ENV_TO_DROP = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX'];
const ROLE = /^[a-z][a-z0-9-]*$/;

class TaskError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new TaskError(code, message);
}

// ---------------------------------------------------------------------------------------------
// Parte pura: argumentos e o arquivo da tarefa.

/** `69` vira `069`; devolve `null` se não for um número de tarefa. */
export function normalizeId(raw) {
  return /^\d{1,6}$/.test(raw ?? '') ? raw.padStart(3, '0') : null;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    id: null,
    as: null,
    join: null,
    force: false,
    skipVerify: false,
    iKnow: false,
  };
  if (!command || command === '--help' || command === '-h') return { help: true };
  if (!['start', 'finish', 'abort', 'path', 'list'].includes(command)) {
    return { error: `Subcomando desconhecido: ${command}` };
  }
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--as' && command === 'start') {
      i += 1;
      options.as = rest[i] ?? '';
    } else if (arg.startsWith('--as=') && command === 'start') {
      options.as = arg.slice('--as='.length);
    } else if ((arg === '--join' || arg.startsWith('--join=')) && command === 'start') {
      const raw = arg === '--join' ? rest[++i] : arg.slice('--join='.length);
      options.join = normalizeId(raw);
      if (!options.join) return { error: `Número de janela inválido em --join: ${raw ?? ''}` };
    } else if (arg === '--force' && command === 'abort') {
      options.force = true;
    } else if (arg === '--skip-verify' && command === 'finish') {
      options.skipVerify = true;
    } else if (arg === '--i-know' && command === 'finish') {
      options.iKnow = true;
    } else if (arg.startsWith('-')) {
      return { error: `Opção desconhecida para ${command}: ${arg}` };
    } else if (options.id === null && ['start', 'finish', 'abort'].includes(command)) {
      options.id = normalizeId(arg);
      if (!options.id) return { error: `Número de tarefa inválido: ${arg}` };
    } else {
      return { error: `Argumento a mais: ${arg}` };
    }
  }
  if ((command === 'start' || command === 'abort') && !options.id) {
    return { error: `Falta o número da tarefa: pnpm task:${command} NNN` };
  }
  if (command === 'start' && !ROLE.test(options.as ?? '')) {
    return { error: 'Falta o papel de quem assume a tarefa: --as <papel>' };
  }
  if (options.skipVerify && !options.iKnow) {
    return { error: '--skip-verify só vale junto de --i-know (uso do humano).' };
  }
  return options;
}

/** Lê o cabeçalho de um arquivo de tarefa. Campo ausente vira texto vazio ou lista vazia. */
export function parseTask(text) {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const field = (name) =>
    new RegExp(`^${name}:[ \\t]*(.*?)[ \\t]*$`, 'm').exec(header)?.[1].trim() ?? '';
  const dependsOn = field('depende-de')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((item) => normalizeId(item.trim()))
    .filter(Boolean);
  const task = {
    status: field('status'),
    owner: field('responsavel'),
    role: field('papel'),
    dependsOn,
    title: /^# (.+)$/m.exec(text)?.[1].trim() ?? '',
  };
  // `window` é a janela de contrato (`janela: NNN`), normalizada como os IDs; vazia quando o campo
  // falta. Fica fora da enumeração para que quem compara ou copia o cabeçalho campo a campo veja
  // os mesmos cinco campos de antes da janela existir.
  Object.defineProperty(task, 'window', { value: normalizeId(field('janela')) ?? '' });
  return task;
}

/** O título de commit termina com `(task NNN)` desta tarefa? */
export function citesTask(subject, id) {
  const cited = /\(task (\d+)\)$/.exec(subject.trim())?.[1];
  return cited !== undefined && normalizeId(cited) === id;
}

/** Troca campos do cabeçalho, sem tocar no resto do arquivo. */
export function setTaskFields(text, fields) {
  const match = /^---\r?\n[\s\S]*?\r?\n---/.exec(text);
  if (!match) return text;
  let header = match[0];
  for (const [name, value] of Object.entries(fields)) {
    const line = new RegExp(`^${name}:.*$`, 'm');
    const next = value === '' ? `${name}:` : `${name}: ${value}`;
    header = line.test(header)
      ? header.replace(line, next)
      : header.replace(/\r?\n---$/, `\n${next}\n---`);
  }
  return header + text.slice(match[0].length);
}

/** Blocos de `git worktree list --porcelain`. O primeiro é o checkout principal. */
export function parseWorktrees(porcelain) {
  return porcelain
    .split(/\n\n+/)
    .map((block) => {
      const entry = { path: '', branch: null };
      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) entry.path = line.slice('worktree '.length);
        if (line.startsWith('branch ')) entry.branch = line.slice('branch '.length);
      }
      return entry;
    })
    .filter((entry) => entry.path);
}

export function formatTable(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows
    .map((row) =>
      row
        .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i])))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

// ---------------------------------------------------------------------------------------------
// Git, disco e processos.

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const name of GIT_ENV_TO_DROP) delete env[name];
  return env;
}

function git(cwd, args, env = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: cleanEnv(env),
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

function real(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function inside(child, parent) {
  const a = real(child);
  const b = real(parent);
  return a === b || a.startsWith(b + sep);
}

function runInherit(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: cleanEnv() });
  return result.status ?? 1;
}

function askOnTerminal(prompt) {
  process.stdout.write(prompt);
  const buffer = Buffer.alloc(256);
  const read = readSync(0, buffer, 0, buffer.length, null);
  return buffer.toString('utf8', 0, read).trim();
}

/**
 * O que os testes trocam: diretório de partida, saída, instalação, verificação e a confirmação
 * do `--force`. Em uso normal, tudo vem do processo.
 */
function withDefaults(deps) {
  return {
    cwd: process.cwd(),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    install: (dir) => runInherit('pnpm', ['install', '--frozen-lockfile'], dir),
    verify: (dir) => runInherit('pnpm', ['verify:quick'], dir),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    ask: askOnTerminal,
    ...deps,
  };
}

function loadContext(deps) {
  const list = git(deps.cwd, ['worktree', 'list', '--porcelain']);
  if (!list.ok) fail(EXIT.ERROR, `Aqui não é um repositório Git: ${deps.cwd}`);
  const worktrees = parseWorktrees(list.stdout);
  const main = worktrees[0].path;
  return { ...deps, main, worktrees, tasksDir: join(main, 'tasks') };
}

function taskFile(ctx, id) {
  if (!existsSync(ctx.tasksDir)) return null;
  const names = readdirSync(ctx.tasksDir).filter(
    (name) => name.startsWith(`${id}-`) && name.endsWith('.md'),
  );
  if (names.length > 1) {
    fail(EXIT.ERROR, `Mais de um arquivo para a tarefa ${id} em tasks/: ${names.join(', ')}`);
  }
  return names.length === 1 ? join(ctx.tasksDir, names[0]) : null;
}

const branchOf = (id) => `task/${id}`;
const worktreeOf = (ctx, id) => join(ctx.main, '.worktrees', `task-${id}`);

/** A fila inteira, em ordem de ID: arquivo, texto e cabeçalho de cada tarefa. */
function readQueue(ctx) {
  if (!existsSync(ctx.tasksDir)) return [];
  return readdirSync(ctx.tasksDir)
    .filter((name) => /^\d{3,}-.*\.md$/.test(name))
    .sort()
    .map((name) => {
      const file = join(ctx.tasksDir, name);
      const text = readFileSync(file, 'utf8');
      return { id: name.split('-')[0], name, file, text, task: parseTask(text) };
    });
}

/** As tarefas da janela `windowId`: as que trazem `janela: <windowId>` no cabeçalho. */
function windowMembers(ctx, windowId) {
  return readQueue(ctx).filter((entry) => entry.task.window === windowId && entry.id !== windowId);
}

/** A janela está aberta quando a tarefa do contrato tem worktree e branch. */
function windowOpen(ctx, windowId) {
  return branchExists(ctx, branchOf(windowId)) && existsSync(worktreeOf(ctx, windowId));
}

/** Tarefa da janela não tem worktree nem branch próprios; é isso que a distingue no finish/abort. */
function hasOwnWorktree(ctx, id) {
  return branchExists(ctx, branchOf(id)) || existsSync(worktreeOf(ctx, id));
}

/** Títulos dos commits de `main..task/<windowId>` que terminam com `(task <id>)`. */
function commitsCiting(ctx, windowId, id) {
  const log = git(ctx.main, ['log', '--format=%s', `main..${branchOf(windowId)}`]);
  if (!log.ok) fail(EXIT.ERROR, `git log main..${branchOf(windowId)} falhou:\n${log.output}`);
  return log.stdout.split('\n').filter((subject) => citesTask(subject, id));
}

function describeMembers(members) {
  return formatTable(
    members.map((entry) => [
      `  ${entry.id}`,
      entry.task.status || 'sem status',
      entry.task.owner || '-',
    ]),
  );
}

function branchExists(ctx, name) {
  return git(ctx.main, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`]).ok;
}

function worktreeRegistered(ctx, id) {
  const path = worktreeOf(ctx, id);
  return ctx.worktrees.some(
    (entry) => entry.branch === `refs/heads/${branchOf(id)}` || real(entry.path) === real(path),
  );
}

function statusOf(dir) {
  const status = git(dir, ['status', '--porcelain']);
  if (!status.ok) fail(EXIT.ERROR, `git status falhou em ${dir}:\n${status.output}`);
  return status.stdout.trimEnd();
}

function currentBranch(dir) {
  return git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']).stdout.trim();
}

function rebaseInProgress(dir) {
  return ['rebase-merge', 'rebase-apply'].some((name) => {
    const path = git(dir, ['rev-parse', '--path-format=absolute', '--git-path', name]);
    return path.ok && existsSync(path.stdout.trim());
  });
}

function indent(text) {
  return text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

/** O checkout principal tem de estar na `main` e limpo; senão, para sem tocar em nada. */
function requireCleanMain(ctx) {
  const branch = currentBranch(ctx.main);
  if (branch !== 'main') {
    fail(
      EXIT.REFUSED,
      `O checkout principal (${ctx.main}) está em "${branch || 'HEAD solto'}", não na main. Nada foi alterado.`,
    );
  }
  const dirty = statusOf(ctx.main);
  if (dirty) {
    fail(
      EXIT.REFUSED,
      `O checkout principal (${ctx.main}) tem alterações não commitadas. Nada foi alterado.\n${indent(dirty)}`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Subcomandos.

function start(ctx, { id, as, join: windowId }) {
  const say = (line) => ctx.log(`task:start ${id} — ${line}`);
  const file = taskFile(ctx, id);
  if (!file) fail(EXIT.ERROR, `Tarefa ${id} não está na fila: falta tasks/${id}-*.md.`);
  const text = readFileSync(file, 'utf8');
  const task = parseTask(text);
  if (windowId) return startJoin(ctx, { id, as, windowId, file, text, task, say });
  if (task.window) {
    fail(
      EXIT.REFUSED,
      `Tarefa ${id} faz parte da janela ${task.window}: não abre worktree próprio. Use: pnpm task:start ${id} --as ${as} --join ${task.window}`,
    );
  }
  if (task.status !== 'aberta') {
    fail(
      EXIT.REFUSED,
      `Tarefa ${id} está "${task.status || 'sem status'}"${task.owner ? ` (responsável: ${task.owner})` : ''}; só começa tarefa "aberta".`,
    );
  }
  const pending = task.dependsOn.filter((dep) => taskFile(ctx, dep));
  if (pending.length > 0) {
    fail(
      EXIT.REFUSED,
      `Tarefa ${id} depende de tarefa ainda na fila: ${pending.join(', ')}. Termine essas primeiro.`,
    );
  }
  const branch = branchOf(id);
  const dir = worktreeOf(ctx, id);
  if (branchExists(ctx, branch)) fail(EXIT.REFUSED, `O branch ${branch} já existe.`);
  if (existsSync(dir) || worktreeRegistered(ctx, id)) {
    fail(EXIT.REFUSED, `O worktree ${dir} já existe.`);
  }
  if (!branchExists(ctx, 'main')) fail(EXIT.REFUSED, 'Não existe o branch local main.');
  if (task.role && task.role !== as) {
    say(`aviso: a tarefa é do papel "${task.role}" e está sendo assumida por "${as}".`);
  }

  const added = git(ctx.main, ['worktree', 'add', '-b', branch, dir, 'main']);
  if (!added.ok) fail(EXIT.ERROR, `git worktree add falhou:\n${added.output}`);
  say(`worktree criado no branch ${branch}, a partir da main`);

  const envLocal = join(ctx.main, '.env.local');
  if (existsSync(envLocal)) {
    symlinkSync(envLocal, join(dir, '.env.local'));
    say('.env.local ligado ao do checkout principal');
  }

  say('pnpm install --frozen-lockfile');
  const installed = ctx.install(dir);
  if (installed !== 0) {
    // O worktree acabou de nascer e não tem trabalho de ninguém: desfaz para o start ser atômico.
    git(ctx.main, ['worktree', 'remove', '--force', dir]);
    git(ctx.main, ['branch', '-D', branch]);
    fail(
      EXIT.INSTALL,
      `pnpm install falhou (código ${installed}). Worktree e branch foram desfeitos; a tarefa continua "aberta".`,
    );
  }

  writeFileSync(file, setTaskFields(text, { status: 'em-andamento', responsavel: as }));
  say(`tarefa marcada como em-andamento (responsável: ${as})`);
  ctx.log(`WORKTREE=${dir}`);
  return EXIT.OK;
}

/**
 * `task:start MMM --as <papel> --join NNN`: a tarefa entra na janela NNN. Não cria branch nem
 * worktree e não instala nada; só marca a tarefa e diz onde fica o worktree da janela.
 */
function startJoin(ctx, { id, as, windowId, file, text, task, say }) {
  if (id === windowId) {
    fail(
      EXIT.REFUSED,
      `A tarefa ${id} é a própria janela: abra-a com pnpm task:start ${id} --as ${as}, sem --join.`,
    );
  }
  if (task.status !== 'aberta') {
    fail(
      EXIT.REFUSED,
      `Tarefa ${id} está "${task.status || 'sem status'}"${task.owner ? ` (responsável: ${task.owner})` : ''}; só começa tarefa "aberta".`,
    );
  }
  if (task.window !== windowId) {
    fail(
      EXIT.REFUSED,
      `Tarefa ${id} não é da janela ${windowId}: o cabeçalho traz ${task.window ? `"janela: ${task.window}"` : 'o campo "janela" ausente ou vazio'}.`,
    );
  }
  const dir = worktreeOf(ctx, windowId);
  if (!windowOpen(ctx, windowId)) {
    fail(
      EXIT.REFUSED,
      `A janela ${windowId} não foi aberta: falta o worktree (${dir}) ou o branch (${branchOf(windowId)}). Quem abre é a tarefa do contrato: pnpm task:start ${windowId} --as <papel>.`,
    );
  }
  const windowFile = taskFile(ctx, windowId);
  const windowTask = windowFile ? parseTask(readFileSync(windowFile, 'utf8')) : null;
  if (windowTask?.status !== 'em-andamento') {
    fail(
      EXIT.REFUSED,
      `A janela ${windowId} não está em andamento: ${windowTask ? `a tarefa ${windowId} está "${windowTask.status || 'sem status'}"` : `falta tasks/${windowId}-*.md na fila`}.`,
    );
  }
  // Dentro da janela, a dependência está atendida quando é a própria janela ou uma tarefa dela
  // já "pronta". Qualquer outra tarefa ainda na fila segura o início, como no start normal.
  const pending = [];
  for (const dep of task.dependsOn) {
    if (dep === windowId) continue;
    const depFile = taskFile(ctx, dep);
    if (!depFile) continue;
    const depTask = parseTask(readFileSync(depFile, 'utf8'));
    if (depTask.window === windowId && depTask.status === 'pronta') continue;
    pending.push(`${dep} (${depTask.status || 'sem status'})`);
  }
  if (pending.length > 0) {
    fail(
      EXIT.REFUSED,
      `Tarefa ${id} depende de tarefa ainda não atendida: ${pending.join(', ')}. Na janela ${windowId}, a dependência precisa ser a própria ${windowId} ou uma tarefa da janela já "pronta".`,
    );
  }
  if (task.role && task.role !== as) {
    say(`aviso: a tarefa é do papel "${task.role}" e está sendo assumida por "${as}".`);
  }
  writeFileSync(file, setTaskFields(text, { status: 'em-andamento', responsavel: as }));
  say(`tarefa marcada como em-andamento (responsável: ${as}), na janela ${windowId}`);
  say(
    'o worktree é compartilhado: git add e git commit só com caminhos explícitos, citando esta tarefa',
  );
  ctx.log(`WORKTREE=${dir}`);
  return EXIT.OK;
}

/**
 * `task:finish MMM` em tarefa da janela: confere que há commit citando a tarefa no branch da
 * janela e a marca como "pronta". Não confere worktree limpo, não faz rebase, não verifica, não
 * toca a `main`, não faz push e não remove nada.
 */
function finishMember(ctx, { id, file, text, task }) {
  const say = (line) => ctx.log(`task:finish ${id} — ${line}`);
  const windowId = task.window;
  if (task.status !== 'em-andamento') {
    fail(
      EXIT.REFUSED,
      `Tarefa ${id} (janela ${windowId}) está "${task.status || 'sem status'}"; só fica "pronta" a tarefa "em-andamento".`,
    );
  }
  if (!windowOpen(ctx, windowId)) {
    fail(
      EXIT.REFUSED,
      `A janela ${windowId} não tem worktree (${worktreeOf(ctx, windowId)}) e branch (${branchOf(windowId)}): não foi aberta, ou já foi fechada.`,
    );
  }
  const cited = commitsCiting(ctx, windowId, id);
  if (cited.length === 0) {
    fail(
      EXIT.REFUSED,
      `Nenhum commit em main..${branchOf(windowId)} tem o título terminando com "(task ${id})": falta commitar no worktree da janela citando a tarefa.`,
    );
  }
  if (!/^## Relato[ \t]*$/m.test(text)) {
    fail(
      EXIT.REFUSED,
      `Falta a seção "## Relato" em ${file}: acrescente os commits, o que foi verificado e a linha sugerida para o CHANGELOG.md (specs/002, "Janela de contrato") e rode de novo.`,
    );
  }
  writeFileSync(file, setTaskFields(text, { status: 'pronta' }));
  say(
    `tarefa marcada como pronta (${cited.length} commit(s) em ${branchOf(windowId)} citam a tarefa)`,
  );
  say('nada foi enviado: a tarefa chega à main no fechamento da janela');
  const members = windowMembers(ctx, windowId);
  ctx.log(`Tarefas da janela ${windowId}:`);
  ctx.log(describeMembers(members));
  const waiting = members.filter((entry) => entry.task.status !== 'pronta');
  ctx.log(
    waiting.length === 0
      ? `Janela ${windowId} pronta para fechar: acrescente o CHANGELOG.md (task ${windowId}) e rode pnpm task:finish ${windowId}`
      : `Janela ${windowId} ainda aberta: falta(m) ${waiting.map((entry) => entry.id).join(', ')}.`,
  );
  return EXIT.OK;
}

/** `task:abort MMM` em tarefa da janela: só a tarefa volta a "aberta"; o worktree não é tocado. */
function abortMember(ctx, { id, file, text, task }) {
  const say = (line) => ctx.log(`task:abort ${id} — ${line}`);
  const windowId = task.window;
  const cited = branchExists(ctx, branchOf(windowId)) ? commitsCiting(ctx, windowId, id) : [];
  if (cited.length > 0) {
    fail(
      EXIT.REFUSED,
      `Já há ${cited.length} commit(s) "(task ${id})" em main..${branchOf(windowId)}. Desfazer é pela janela (pnpm task:abort ${windowId} --force, com o humano) ou por um novo commit que reverta. Nada foi alterado.`,
    );
  }
  if (task.status === 'em-andamento' || task.status === 'pronta') {
    writeFileSync(file, setTaskFields(text, { status: 'aberta', responsavel: '' }));
    say(`tarefa devolvida a "aberta"; o worktree da janela ${windowId} não foi tocado`);
  } else {
    say(`a tarefa está "${task.status || 'sem status'}": nada a desfazer`);
  }
  return EXIT.OK;
}

function rebaseAndVerify(ctx, id, dir, options, say) {
  const before = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
  say('git rebase main');
  const rebase = git(dir, ['rebase', 'main']);
  if (!rebase.ok) {
    fail(
      EXIT.CONFLICT,
      [
        `O rebase de ${branchOf(id)} sobre a main parou:`,
        indent(rebase.output),
        `Resolva em ${dir}: edite os arquivos, "git add <arquivo>" e "git rebase --continue"`,
        '(ou "git rebase --abort" para voltar ao estado anterior). Conflito em pnpm-lock.yaml se',
        `resolve refazendo "pnpm install" no worktree, nunca à mão. Depois: pnpm task:finish ${id}.`,
      ].join('\n'),
    );
  }
  if (git(dir, ['diff', '--quiet', before, 'HEAD', '--', 'pnpm-lock.yaml']).status === 1) {
    say('o pnpm-lock.yaml mudou com o rebase: pnpm install --frozen-lockfile');
    const installed = ctx.install(dir);
    if (installed !== 0) {
      fail(EXIT.INSTALL, `pnpm install falhou no worktree (código ${installed}): ${dir}`);
    }
  }
  if (options.skipVerify) {
    say('AVISO: verificação PULADA por --skip-verify --i-know (decisão do humano).');
  } else {
    say('pnpm verify:quick');
    const verified = ctx.verify(dir);
    if (verified !== 0) {
      fail(
        EXIT.VERIFY,
        `A verificação falhou no worktree (código ${verified}): ${dir}\nA main não foi alterada. Corrija, commite e rode de novo: pnpm task:finish ${id}.`,
      );
    }
  }
  const dirty = statusOf(dir);
  if (dirty) {
    fail(
      EXIT.DIRTY,
      `O worktree ficou com alterações depois da verificação: ${dir}\n${indent(dirty)}`,
    );
  }
}

function finish(ctx, options) {
  let { id } = options;
  if (!id) {
    id = /^task\/(\d{3,})$/.exec(currentBranch(ctx.cwd))?.[1] ?? null;
    if (!id) {
      fail(EXIT.ERROR, 'Fora de um worktree de tarefa, diga qual: pnpm task:finish NNN');
    }
  }
  const say = (line) => ctx.log(`task:finish ${id} — ${line}`);
  const branch = branchOf(id);
  const dir = worktreeOf(ctx, id);
  const own = taskFile(ctx, id);
  if (own && !hasOwnWorktree(ctx, id)) {
    const text = readFileSync(own, 'utf8');
    const task = parseTask(text);
    if (task.window) return finishMember(ctx, { id, file: own, text, task });
  }
  // Tarefa que é janela: antes de qualquer passo, todas as tarefas dela têm de estar "prontas".
  const members = windowMembers(ctx, id);
  const waiting = members.filter((entry) => entry.task.status !== 'pronta');
  if (waiting.length > 0) {
    fail(
      EXIT.REFUSED,
      `A janela ${id} tem tarefa que não está "pronta" (ID, status, responsável):\n${describeMembers(waiting)}\nCada uma termina com pnpm task:finish <ID>. Nada foi alterado.`,
    );
  }
  if (!branchExists(ctx, branch) || !existsSync(dir)) {
    fail(
      EXIT.REFUSED,
      `A tarefa ${id} não tem worktree (${dir}) e branch (${branch}): não foi iniciada com task:start.`,
    );
  }
  if (currentBranch(dir) !== branch && !rebaseInProgress(dir)) {
    fail(EXIT.REFUSED, `O worktree ${dir} não está no branch ${branch}.`);
  }
  requireCleanMain(ctx);
  const file = taskFile(ctx, id);
  if (!file) say(`aviso: tasks/${id}-*.md não está na fila; sigo sem arquivo para remover.`);

  if (rebaseInProgress(dir)) {
    fail(
      EXIT.CONFLICT,
      `Há um rebase em andamento em ${dir}. Termine com "git rebase --continue" (ou "git rebase --abort") e rode de novo.`,
    );
  }
  const dirty = statusOf(dir);
  if (dirty) {
    fail(
      EXIT.DIRTY,
      `O worktree tem alterações não commitadas: ${dir}\n${indent(dirty)}\nCommite (ou descarte) e rode de novo.`,
    );
  }
  say('worktree limpo');

  let merged = false;
  for (let attempt = 1; attempt <= 2 && !merged; attempt += 1) {
    rebaseAndVerify(ctx, id, dir, options, say);
    say(`git merge --ff-only ${branch} (no checkout principal)`);
    const merge = git(ctx.main, ['merge', '--ff-only', branch]);
    merged = merge.ok;
    if (!merged && attempt === 1) {
      say('a main andou no meio do caminho: repito rebase e verificação uma vez');
    } else if (!merged) {
      fail(
        EXIT.NOT_FF,
        `O fast-forward da main continuou impossível depois da nova tentativa:\n${indent(merge.output)}\nA main não recebeu a tarefa; o worktree continua em ${dir}. Rode de novo: pnpm task:finish ${id}.`,
      );
    }
  }
  const commits = git(ctx.main, ['rev-parse', '--short', 'HEAD']).stdout.trim();
  say(`main avançou por fast-forward até ${commits}`);

  say('git push origin main');
  const push = git(
    ctx.main,
    ['push', 'origin', 'main'],
    ctx.isTTY ? {} : { GIT_TERMINAL_PROMPT: '0' },
  );
  if (push.output) ctx.log(indent(push.output));

  // Daqui em diante a main local já tem os commits: worktree e branch não guardam mais nada.
  const calledFromWorktree = inside(ctx.cwd, dir);
  if (inside(process.cwd(), dir)) process.chdir(ctx.main);
  const removed = git(ctx.main, ['worktree', 'remove', dir]);
  if (!removed.ok) {
    fail(
      EXIT.ERROR,
      `A main já tem a tarefa, mas o worktree não saiu:\n${indent(removed.output)}\nFalta, no checkout principal: git worktree remove ${dir} && git branch -d ${branch}${[
        file,
        ...members.map((entry) => entry.file),
      ]
        .filter(Boolean)
        .map((path) => ` && rm ${path}`)
        .join('')}${push.ok ? '' : ' && git push origin main'}`,
    );
  }
  const deleted = git(ctx.main, ['branch', '-d', branch]);
  if (!deleted.ok) fail(EXIT.ERROR, `git branch -d ${branch} falhou:\n${indent(deleted.output)}`);
  say('worktree e branch removidos');
  if (file) {
    rmSync(file);
    say('arquivo da tarefa removido da fila');
  }
  const gone = members.filter((entry) => existsSync(entry.file));
  for (const entry of gone) rmSync(entry.file);
  if (gone.length > 0) {
    say(
      `arquivos das tarefas da janela removidos da fila: ${gone.map((entry) => entry.id).join(', ')}`,
    );
  }

  if (!push.ok) {
    ctx.error(
      [
        `task:finish ${id} — PUSH PENDENTE: "git push origin main" falhou (código ${push.status}).`,
        'A main local já tem a tarefa e a limpeza local foi feita. Não insista: relate ao humano.',
        `Comando que falta: git -C ${ctx.main} push origin main`,
      ].join('\n'),
    );
    return EXIT.PUSH;
  }
  say('concluída e enviada');
  if (calledFromWorktree) ctx.log(`O diretório atual deixou de existir. Volte para: ${ctx.main}`);
  return EXIT.OK;
}

function abort(ctx, { id, force }) {
  const say = (line) => ctx.log(`task:abort ${id} — ${line}`);
  const branch = branchOf(id);
  const dir = worktreeOf(ctx, id);
  const hasDir = existsSync(dir);
  const hasBranch = branchExists(ctx, branch);
  const file = taskFile(ctx, id);
  if (!hasDir && !hasBranch && !file) fail(EXIT.ERROR, `Tarefa ${id} não existe.`);
  if (file && !hasDir && !hasBranch) {
    const text = readFileSync(file, 'utf8');
    const task = parseTask(text);
    if (task.window) return abortMember(ctx, { id, file, text, task });
  }

  const dirty = hasDir ? statusOf(dir) : '';
  if (dirty && !force) {
    fail(
      EXIT.DIRTY,
      `O worktree tem alterações não commitadas: ${dir}\n${indent(dirty)}\nCommite, descarte ou peça ao humano o --force (que apaga essas alterações).`,
    );
  }
  // Commits que ainda não chegaram à main também são trabalho: sem --force, não se apaga o branch.
  const unmerged = hasBranch
    ? Number(git(ctx.main, ['rev-list', '--count', `main..${branch}`]).stdout.trim() || '0')
    : 0;
  if (unmerged > 0 && !force) {
    fail(
      EXIT.DIRTY,
      `O branch ${branch} tem ${unmerged} commit(s) que não estão na main. Termine com "pnpm task:finish ${id}" ou peça ao humano o --force (que apaga o branch).`,
    );
  }
  if (force) {
    if (!ctx.isTTY) {
      fail(
        EXIT.REFUSED,
        '--force apaga trabalho não integrado e exige confirmação do humano num terminal interativo. Nada foi alterado.',
      );
    }
    const expected = `abortar ${id}`;
    const answer = ctx.ask(
      `Isto apaga ${dir} com tudo o que não foi commitado e o branch ${branch}${unmerged > 0 ? `, com ${unmerged} commit(s) fora da main` : ''}.\nDigite "${expected}" para confirmar: `,
    );
    if (answer !== expected) fail(EXIT.REFUSED, 'Confirmação não conferiu. Nada foi alterado.');
  }

  if (hasDir) {
    if (inside(process.cwd(), dir)) process.chdir(ctx.main);
    const removed = git(ctx.main, ['worktree', 'remove', ...(force ? ['--force'] : []), dir]);
    if (!removed.ok) fail(EXIT.ERROR, `git worktree remove falhou:\n${indent(removed.output)}`);
    say('worktree removido');
  } else {
    git(ctx.main, ['worktree', 'prune']);
  }
  if (hasBranch) {
    const tip = git(ctx.main, ['rev-parse', '--short', branch]).stdout.trim();
    const ahead = git(ctx.main, ['rev-list', '--count', `main..${branch}`]).stdout.trim();
    const deleted = git(ctx.main, ['branch', '-D', branch]);
    if (!deleted.ok) fail(EXIT.ERROR, `git branch -D ${branch} falhou:\n${indent(deleted.output)}`);
    say(
      ahead && ahead !== '0'
        ? `branch removido com ${ahead} commit(s) fora da main; para recuperar: git branch ${branch} ${tip}`
        : 'branch removido',
    );
  }
  if (file) {
    const text = readFileSync(file, 'utf8');
    if (parseTask(text).status === 'em-andamento') {
      writeFileSync(file, setTaskFields(text, { status: 'aberta', responsavel: '' }));
      say('tarefa devolvida a "aberta"');
    }
  }
  // Abortar a janela devolve à fila também o trabalho de quem estava nela.
  const reopened = windowMembers(ctx, id).filter((entry) =>
    ['em-andamento', 'pronta'].includes(entry.task.status),
  );
  for (const entry of reopened) {
    writeFileSync(entry.file, setTaskFields(entry.text, { status: 'aberta', responsavel: '' }));
  }
  if (reopened.length > 0) {
    say(`tarefas da janela devolvidas a "aberta": ${reopened.map((entry) => entry.id).join(', ')}`);
  }
  return EXIT.OK;
}

function list(ctx) {
  const queue = readQueue(ctx);
  if (queue.length === 0) {
    ctx.log('A fila tasks/ está vazia.');
    return EXIT.OK;
  }
  const byId = new Map(queue.map((entry) => [entry.id, entry.task]));
  // A coluna JANELA só aparece quando alguma tarefa da fila é de janela: sem janela, a lista é a
  // de sempre.
  const withWindow = queue.some((entry) => entry.task.window);
  const header = ['TAREFA', 'STATUS', 'PAPEL', 'RESPONSÁVEL', 'DEPENDE DE', 'WORKTREE', 'TÍTULO'];
  if (withWindow) header.splice(4, 0, 'JANELA');
  const rows = [header];
  for (const { id, name, task } of queue) {
    // Dependência "pronta" ainda não está na main: continua pendente, com a marca.
    const pending = task.dependsOn
      .filter((dep) => byId.has(dep))
      .map((dep) => (byId.get(dep).status === 'pronta' ? `${dep} (pronta)` : dep));
    let worktree = existsSync(worktreeOf(ctx, id)) ? 'sim' : '-';
    if (worktree === '-' && task.window && existsSync(worktreeOf(ctx, task.window))) {
      worktree = `task-${task.window}`;
    }
    const row = [
      id,
      task.status || '?',
      task.role || '-',
      task.owner || '-',
      pending.join(', ') || '-',
      worktree,
      task.title || name,
    ];
    if (withWindow) row.splice(4, 0, task.window || '-');
    rows.push(row);
  }
  ctx.log(formatTable(rows));
  return EXIT.OK;
}

/** Ponto de entrada. Devolve o código de saída; `deps` existe para os testes. */
export function runTask(argv, deps = {}) {
  const io = withDefaults(deps);
  const options = parseArgs(argv);
  if (options.help) {
    io.log(USAGE);
    return EXIT.OK;
  }
  if (options.error) {
    io.error(`${options.error}\n\n${USAGE}`);
    return EXIT.ERROR;
  }
  try {
    const ctx = loadContext(io);
    switch (options.command) {
      case 'start':
        return start(ctx, options);
      case 'finish':
        return finish(ctx, options);
      case 'abort':
        return abort(ctx, options);
      case 'path':
        ctx.log(ctx.main);
        return EXIT.OK;
      default:
        return list(ctx);
    }
  } catch (error) {
    if (!(error instanceof TaskError)) throw error;
    io.error(`task:${options.command}${options.id ? ` ${options.id}` : ''} — ${error.message}`);
    return error.code;
  }
}

if (import.meta.main) {
  process.exitCode = runTask(process.argv.slice(2));
}
