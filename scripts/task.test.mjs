// Testes do `scripts/task.mjs`. Cada teste monta um repositório Git próprio num diretório
// temporário do sistema, com um remoto `origin` de mentira; o repositório real nunca é tocado.
// A instalação e a verificação são injetadas: nenhum `pnpm install` roda aqui.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import {
  citesTask,
  EXIT,
  formatTable,
  parseArgs,
  parseTask,
  runTask,
  setTaskFields,
} from './task.mjs';

// O Git dos testes ignora a configuração da máquina (ganchos, assinatura, identidade).
Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Teste',
  GIT_AUTHOR_EMAIL: 'teste@example.invalid',
  GIT_COMMITTER_NAME: 'Teste',
  GIT_COMMITTER_EMAIL: 'teste@example.invalid',
});

const created = [];
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

const CHANGELOG = '# Changelog\n\n## [Não lançado]\n\n### Adicionado\n- Linha antiga.\n';

function taskText({ id, status = 'aberta', owner = '', dependsOn = [], janela = '' }) {
  return `---\nid: ${id}\nstatus: ${status}\nresponsavel:${owner ? ` ${owner}` : ''}\nfase: 0\npapel: infra\ndepende-de: [${dependsOn.join(', ')}]\n${janela ? `janela: ${janela}\n` : ''}---\n\n# Tarefa ${id} de teste\n\nCorpo.\n`;
}

/** Repositório com `main`, um commit, remoto `origin` (bare) e a fila `tasks/` fora do Git. */
function makeRepo({ tasks = [{ id: '001' }], envLocal = true } = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'nuva-task-')));
  created.push(base);
  const repo = join(base, 'repo');
  const remote = join(base, 'origin.git');
  mkdirSync(repo);
  git(base, 'init', '--quiet', '--bare', '-b', 'main', remote);
  git(repo, 'init', '--quiet', '-b', 'main');
  writeFileSync(join(repo, '.gitignore'), '/tasks/\n/.worktrees/\nnode_modules/\n.env.local\n');
  writeFileSync(join(repo, '.gitattributes'), 'CHANGELOG.md merge=union\n');
  writeFileSync(join(repo, 'CHANGELOG.md'), CHANGELOG);
  writeFileSync(join(repo, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
  writeFileSync(join(repo, 'app.txt'), 'um\ndois\ntrês\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '--quiet', '-m', 'chore: início (task 000)');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '--quiet', '-u', 'origin', 'main');
  mkdirSync(join(repo, 'tasks'));
  for (const task of tasks) {
    writeFileSync(join(repo, 'tasks', `${task.id}-tarefa-de-teste.md`), taskText(task));
  }
  if (envLocal) writeFileSync(join(repo, '.env.local'), 'POSTGRES_PASSWORD=teste\n');
  return { repo, remote, worktree: (id) => join(repo, '.worktrees', `task-${id}`) };
}

/** Roda o script com instalação e verificação de mentira; devolve código, saída e contagens. */
function run(cwd, argv, deps = {}) {
  const out = [];
  const calls = { install: [], verify: [] };
  const code = runTask(argv, {
    cwd,
    log: (line) => out.push(line),
    error: (line) => out.push(line),
    install: (dir) => {
      calls.install.push(dir);
      return 0;
    },
    verify: (dir) => {
      calls.verify.push(dir);
      return 0;
    },
    isTTY: false,
    ask: () => assert.fail('não deveria pedir confirmação'),
    ...deps,
  });
  return { code, out: out.join('\n'), calls };
}

function commitIn(dir, file, text, message) {
  appendFileSync(join(dir, file), text);
  git(dir, 'add', file);
  git(dir, 'commit', '--quiet', '-m', message);
}

function taskOf(env, id) {
  const file = join(env.repo, 'tasks', `${id}-tarefa-de-teste.md`);
  return existsSync(file) ? parseTask(readFileSync(file, 'utf8')) : null;
}

function started(options) {
  const env = makeRepo(options);
  assert.equal(run(env.repo, ['start', '001', '--as', 'infra']).code, EXIT.OK);
  return env;
}

describe('partes puras', () => {
  test('argumentos: número com zeros, papel obrigatório, opções só no subcomando certo', () => {
    assert.equal(parseArgs(['start', '7', '--as', 'infra']).id, '007');
    assert.equal(parseArgs(['start', '007', '--as=banco']).as, 'banco');
    assert.match(parseArgs(['start', '007']).error, /--as <papel>/);
    assert.match(parseArgs(['start', '--as', 'infra']).error, /número da tarefa/);
    assert.match(parseArgs(['start', 'abc', '--as', 'infra']).error, /inválido/);
    assert.match(parseArgs(['finish', '007', '--force']).error, /desconhecida/);
    assert.match(parseArgs(['finish', '007', '--skip-verify']).error, /--i-know/);
    assert.equal(parseArgs(['finish', '007', '--skip-verify', '--i-know']).skipVerify, true);
    assert.equal(parseArgs(['finish']).id, null);
    assert.equal(parseArgs(['abort', '007', '--force']).force, true);
    assert.match(parseArgs(['sumir']).error, /Subcomando desconhecido/);
    assert.equal(parseArgs([]).help, true);
  });

  test('cabeçalho da tarefa: leitura e troca de campos sem tocar no corpo', () => {
    const text = taskText({ id: '009', dependsOn: ['006', '014'] });
    assert.deepEqual(parseTask(text), {
      status: 'aberta',
      owner: '',
      role: 'infra',
      dependsOn: ['006', '014'],
      title: 'Tarefa 009 de teste',
    });
    const changed = setTaskFields(text, { status: 'em-andamento', responsavel: 'infra' });
    assert.equal(parseTask(changed).status, 'em-andamento');
    assert.equal(parseTask(changed).owner, 'infra');
    assert.equal(changed.split('---')[2], text.split('---')[2]);
    assert.equal(setTaskFields(changed, { status: 'aberta', responsavel: '' }), text);
  });

  test('tabela alinha as colunas e não deixa espaço no fim', () => {
    assert.equal(
      formatTable([
        ['A', 'BB', 'C'],
        ['aaa', 'b', ''],
      ]),
      'A    BB  C\naaa  b',
    );
  });
});

describe('task:start', () => {
  test('cria worktree e branch, liga o .env.local, instala e marca a tarefa', () => {
    const env = makeRepo();
    const result = run(env.repo, ['start', '1', '--as', 'infra']);
    assert.equal(result.code, EXIT.OK, result.out);
    const dir = env.worktree('001');
    assert.equal(result.out.split('\n').at(-1), `WORKTREE=${dir}`);
    assert.equal(git(dir, 'symbolic-ref', '--short', 'HEAD'), 'task/001');
    assert.equal(git(dir, 'rev-parse', 'HEAD'), git(env.repo, 'rev-parse', 'main'));
    assert.ok(lstatSync(join(dir, '.env.local')).isSymbolicLink());
    assert.equal(readlinkSync(join(dir, '.env.local')), join(env.repo, '.env.local'));
    assert.deepEqual(result.calls.install, [dir]);
    assert.deepEqual(
      { status: taskOf(env, '001').status, owner: taskOf(env, '001').owner },
      { status: 'em-andamento', owner: 'infra' },
    );
    // Nem o worktree nem o link aparecem como sujeira, lá ou no checkout principal.
    assert.equal(git(dir, 'status', '--porcelain'), '');
    assert.equal(git(env.repo, 'status', '--porcelain'), '');
  });

  test('sem .env.local no checkout principal, não cria link', () => {
    const env = makeRepo({ envLocal: false });
    assert.equal(run(env.repo, ['start', '001', '--as', 'infra']).code, EXIT.OK);
    assert.equal(existsSync(join(env.worktree('001'), '.env.local')), false);
  });

  test('recusa tarefa que não está aberta, e de novo depois de iniciada', () => {
    const env = makeRepo({ tasks: [{ id: '001', status: 'em-andamento', owner: 'banco' }] });
    const result = run(env.repo, ['start', '001', '--as', 'infra']);
    assert.equal(result.code, EXIT.REFUSED);
    assert.match(result.out, /em-andamento.*banco/);
    assert.equal(existsSync(env.worktree('001')), false);

    const other = started();
    assert.equal(run(other.repo, ['start', '001', '--as', 'infra']).code, EXIT.REFUSED);
  });

  test('recusa por dependência ainda na fila; dependência concluída (sem arquivo) libera', () => {
    const env = makeRepo({
      tasks: [{ id: '001', dependsOn: ['002', '003'] }, { id: '002' }],
    });
    const result = run(env.repo, ['start', '001', '--as', 'infra']);
    assert.equal(result.code, EXIT.REFUSED);
    assert.match(result.out, /depende de tarefa ainda na fila: 002\./);
    assert.equal(taskOf(env, '001').status, 'aberta');
    assert.equal(result.calls.install.length, 0);

    rmSync(join(env.repo, 'tasks', '002-tarefa-de-teste.md'));
    assert.equal(run(env.repo, ['start', '001', '--as', 'infra']).code, EXIT.OK);
  });

  test('recusa se o branch ou a pasta do worktree já existem', () => {
    const withBranch = makeRepo();
    git(withBranch.repo, 'branch', 'task/001');
    const first = run(withBranch.repo, ['start', '001', '--as', 'infra']);
    assert.equal(first.code, EXIT.REFUSED);
    assert.match(first.out, /branch task\/001 já existe/);

    const withDir = makeRepo();
    mkdirSync(withDir.worktree('001'), { recursive: true });
    const second = run(withDir.repo, ['start', '001', '--as', 'infra']);
    assert.equal(second.code, EXIT.REFUSED);
    assert.match(second.out, /worktree .* já existe/);
    assert.equal(taskOf(withDir, '001').status, 'aberta');
  });

  test('instalação que falha desfaz worktree e branch e deixa a tarefa aberta', () => {
    const env = makeRepo();
    const result = run(env.repo, ['start', '001', '--as', 'infra'], { install: () => 1 });
    assert.equal(result.code, EXIT.INSTALL);
    assert.equal(existsSync(env.worktree('001')), false);
    assert.equal(git(env.repo, 'branch', '--list', 'task/001'), '');
    assert.equal(taskOf(env, '001').status, 'aberta');
  });

  test('tarefa que não existe na fila sai com erro de uso', () => {
    const env = makeRepo();
    assert.equal(run(env.repo, ['start', '404', '--as', 'infra']).code, EXIT.ERROR);
  });
});

describe('task:finish', () => {
  test('caminho feliz: verifica, avança a main por fast-forward, envia e limpa', () => {
    const env = started();
    const dir = env.worktree('001');
    commitIn(dir, 'app.txt', 'quatro\n', 'feat: quatro (task 001)');
    const tip = git(dir, 'rev-parse', 'HEAD');
    // Arquivos ignorados (node_modules, o link do .env.local) não impedem a remoção.
    mkdirSync(join(dir, 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'x', 'index.js'), '');

    const result = run(env.repo, ['finish', '001']);
    assert.equal(result.code, EXIT.OK, result.out);
    assert.deepEqual(result.calls.verify, [dir]);
    assert.equal(git(env.repo, 'rev-parse', 'main'), tip);
    assert.equal(git(env.remote, 'rev-parse', 'main'), tip);
    assert.equal(git(env.repo, 'rev-list', '--merges', '--count', 'main'), '0');
    assert.equal(existsSync(dir), false);
    assert.equal(git(env.repo, 'branch', '--list', 'task/001'), '');
    assert.equal(taskOf(env, '001'), null);
    assert.equal(git(env.repo, 'status', '--porcelain'), '');
    assert.doesNotMatch(git(env.repo, 'worktree', 'list'), /task-001/);
  });

  test('chamado de dentro do worktree, descobre a tarefa pelo branch', () => {
    const env = started();
    const dir = env.worktree('001');
    commitIn(dir, 'app.txt', 'quatro\n', 'feat: quatro (task 001)');
    const result = run(dir, ['finish']);
    assert.equal(result.code, EXIT.OK, result.out);
    assert.match(result.out, /diretório atual deixou de existir/);
    assert.equal(taskOf(env, '001'), null);
    assert.equal(run(env.repo, ['finish']).code, EXIT.ERROR);
  });

  test('com a main avançada, faz o rebase e mantém o histórico linear', () => {
    const env = started();
    const dir = env.worktree('001');
    commitIn(dir, 'app.txt', 'quatro\n', 'feat: quatro (task 001)');
    writeFileSync(join(env.repo, 'outro.txt'), 'de outra tarefa\n');
    git(env.repo, 'add', 'outro.txt');
    git(env.repo, 'commit', '--quiet', '-m', 'feat: outra tarefa (task 002)');
    const mainBefore = git(env.repo, 'rev-parse', 'main');

    const result = run(env.repo, ['finish', '001']);
    assert.equal(result.code, EXIT.OK, result.out);
    assert.equal(git(env.repo, 'rev-parse', 'main~1'), mainBefore);
    assert.equal(git(env.repo, 'log', '-1', '--format=%s', 'main'), 'feat: quatro (task 001)');
    assert.equal(git(env.repo, 'rev-list', '--merges', '--count', 'main'), '0');
    assert.equal(git(env.remote, 'rev-parse', 'main'), git(env.repo, 'rev-parse', 'main'));
  });

  test('lockfile mudou na main: reinstala no worktree antes de verificar', () => {
    const env = started();
    const dir = env.worktree('001');
    commitIn(dir, 'app.txt', 'quatro\n', 'feat: quatro (task 001)');
    commitIn(env.repo, 'pnpm-lock.yaml', 'nova: 1\n', 'build: dependência (task 002)');
    const result = run(env.repo, ['finish', '001']);
    assert.equal(result.code, EXIT.OK, result.out);
    assert.deepEqual(result.calls.install, [dir]);
  });

  test('a main anda durante a verificação: repete rebase e verificação uma vez', () => {
    const env = started();
    const dir = env.worktree('001');
    commitIn(dir, 'app.txt', 'quatro\n', 'feat: quatro (task 001)');
    let verifications = 0;
    const result = run(env.repo, ['finish', '001'], {
      verify: () => {
        verifications += 1;
        if (verifications === 1) {
          writeFileSync(join(env.repo, 'outro.txt'), 'x\n');
          git(env.repo, 'add', 'outro.txt');
          git(env.repo, 'commit', '--quiet', '-m', 'feat: no meio (task 002)');
        }
        return 0;
      },
    });
    assert.equal(result.code, EXIT.OK, result.out);
    assert.equal(verifications, 2);
    assert.match(result.out, /a main andou no meio do caminho/);
    assert.equal(git(env.repo, 'log', '-1', '--format=%s', 'main'), 'feat: quatro (task 001)');
  });

  test('a main anda de novo na segunda tentativa: para com o código próprio, sem perder nada', () => {
    const env = started();
    const dir = env.worktree('001');
    commitIn(dir, 'app.txt', 'quatro\n', 'feat: quatro (task 001)');
    let n = 0;
    const result = run(env.repo, ['finish', '001'], {
      verify: () => {
        n += 1;
        writeFileSync(join(env.repo, `outro-${n}.txt`), 'x\n');
        git(env.repo, 'add', '.');
        git(env.repo, 'commit', '--quiet', '-m', `feat: no meio ${n} (task 002)`);
        return 0;
      },
    });
    assert.equal(result.code, EXIT.NOT_FF);
    assert.equal(n, 2);
    assert.ok(existsSync(dir));
    assert.equal(taskOf(env, '001').status, 'em-andamento');
    assert.equal(git(env.repo, 'log', '-1', '--format=%s', 'main'), 'feat: no meio 2 (task 002)');
  });

  test('conflito no rebase: para com o rebase em andamento e a main intacta', () => {
    const env = started();
    const dir = env.worktree('001');
    writeFileSync(join(dir, 'app.txt'), 'um\nDOIS da tarefa\ntrês\n');
    git(dir, 'commit', '--quiet', '-am', 'feat: dois (task 001)');
    writeFileSync(join(env.repo, 'app.txt'), 'um\nDOIS da main\ntrês\n');
    git(env.repo, 'commit', '--quiet', '-am', 'feat: dois (task 002)');
    const mainBefore = git(env.repo, 'rev-parse', 'main');

    const result = run(env.repo, ['finish', '001']);
    assert.equal(result.code, EXIT.CONFLICT);
    assert.match(result.out, /git rebase --continue/);
    assert.equal(result.calls.verify.length, 0);
    assert.equal(git(env.repo, 'rev-parse', 'main'), mainBefore);
    assert.equal(taskOf(env, '001').status, 'em-andamento');
    // Rodar de novo com o rebase pela metade continua parando no mesmo código.
    assert.equal(run(env.repo, ['finish', '001']).code, EXIT.CONFLICT);

    // Resolvido o conflito, o finish termina.
    writeFileSync(join(dir, 'app.txt'), 'um\nDOIS dos dois\ntrês\n');
    git(dir, 'add', 'app.txt');
    git(dir, '-c', 'core.editor=true', 'rebase', '--continue');
    assert.equal(run(env.repo, ['finish', '001']).code, EXIT.OK);
    assert.match(readFileSync(join(env.repo, 'app.txt'), 'utf8'), /DOIS dos dois/);
  });

  test('verificação falhando: a main não muda e o worktree fica', () => {
    const env = started();
    const dir = env.worktree('001');
    commitIn(dir, 'app.txt', 'quatro\n', 'feat: quatro (task 001)');
    const mainBefore = git(env.repo, 'rev-parse', 'main');
    const result = run(env.repo, ['finish', '001'], { verify: () => 1 });
    assert.equal(result.code, EXIT.VERIFY);
    assert.equal(git(env.repo, 'rev-parse', 'main'), mainBefore);
    assert.equal(git(env.remote, 'rev-parse', 'main'), mainBefore);
    assert.ok(existsSync(dir));
    assert.equal(taskOf(env, '001').status, 'em-andamento');
  });

  test('--skip-verify --i-know pula a verificação e avisa', () => {
    const env = started();
    commitIn(env.worktree('001'), 'app.txt', 'quatro\n', 'feat: quatro (task 001)');
    assert.equal(run(env.repo, ['finish', '001', '--skip-verify']).code, EXIT.ERROR);
    const result = run(env.repo, ['finish', '001', '--skip-verify', '--i-know']);
    assert.equal(result.code, EXIT.OK, result.out);
    assert.equal(result.calls.verify.length, 0);
    assert.match(result.out, /AVISO: verificação PULADA/);
  });

  test('worktree sujo: para antes de qualquer coisa', () => {
    const env = started();
    const dir = env.worktree('001');
    commitIn(dir, 'app.txt', 'quatro\n', 'feat: quatro (task 001)');
    writeFileSync(join(dir, 'solto.txt'), 'não commitado\n');
    const mainBefore = git(env.repo, 'rev-parse', 'main');
    const result = run(env.repo, ['finish', '001']);
    assert.equal(result.code, EXIT.DIRTY);
    assert.match(result.out, /solto\.txt/);
    assert.equal(result.calls.verify.length, 0);
    assert.equal(git(env.repo, 'rev-parse', 'main'), mainBefore);
    assert.ok(existsSync(join(dir, 'solto.txt')));
  });

  test('checkout principal sujo ou fora da main: para sem tocar em nada', () => {
    const env = started();
    const dir = env.worktree('001');
    commitIn(dir, 'app.txt', 'quatro\n', 'feat: quatro (task 001)');
    const tip = git(dir, 'rev-parse', 'HEAD');
    const mainBefore = git(env.repo, 'rev-parse', 'main');

    appendFileSync(join(env.repo, 'CHANGELOG.md'), '- Edição de outro agente.\n');
    const dirty = run(env.repo, ['finish', '001']);
    assert.equal(dirty.code, EXIT.REFUSED);
    assert.match(dirty.out, /alterações não commitadas[\s\S]*CHANGELOG\.md/);
    assert.equal(dirty.calls.verify.length, 0);
    assert.equal(git(dir, 'rev-parse', 'HEAD'), tip);
    assert.equal(git(env.repo, 'rev-parse', 'main'), mainBefore);
    assert.match(readFileSync(join(env.repo, 'CHANGELOG.md'), 'utf8'), /Edição de outro agente/);

    git(env.repo, 'checkout', '--quiet', '--', 'CHANGELOG.md');
    git(env.repo, 'checkout', '--quiet', '-b', 'passeio');
    const away = run(env.repo, ['finish', '001']);
    assert.equal(away.code, EXIT.REFUSED);
    assert.match(away.out, /está em "passeio", não na main/);
    assert.equal(git(dir, 'rev-parse', 'HEAD'), tip);
  });

  test('push falhando (remoto inexistente): main local avançada, limpeza feita, código próprio', () => {
    const env = started();
    const dir = env.worktree('001');
    commitIn(dir, 'app.txt', 'quatro\n', 'feat: quatro (task 001)');
    const tip = git(dir, 'rev-parse', 'HEAD');
    git(env.repo, 'remote', 'set-url', 'origin', join(env.repo, '..', 'nao-existe.git'));

    const result = run(env.repo, ['finish', '001']);
    assert.equal(result.code, EXIT.PUSH);
    assert.match(result.out, /PUSH PENDENTE/);
    assert.match(result.out, new RegExp(`git -C ${env.repo} push origin main`));
    assert.equal(git(env.repo, 'rev-parse', 'main'), tip);
    assert.equal(existsSync(dir), false);
    assert.equal(git(env.repo, 'branch', '--list', 'task/001'), '');
    assert.equal(taskOf(env, '001'), null);
    assert.equal(git(env.repo, 'status', '--porcelain'), '');
  });

  test('tarefa sem worktree é recusada', () => {
    const env = makeRepo();
    assert.equal(run(env.repo, ['finish', '001']).code, EXIT.REFUSED);
  });
});

describe('CHANGELOG.md com merge=union', () => {
  test('duas tarefas acrescentam linha no mesmo ponto e o rebase fica com as duas', () => {
    const env = makeRepo({ tasks: [{ id: '001' }, { id: '002' }] });
    for (const id of ['001', '002']) {
      assert.equal(run(env.repo, ['start', id, '--as', 'infra']).code, EXIT.OK);
      commitIn(
        env.worktree(id),
        'CHANGELOG.md',
        `- Entrega da tarefa ${id}.\n`,
        `feat: entrega (task ${id})`,
      );
    }
    assert.equal(run(env.repo, ['finish', '001']).code, EXIT.OK);
    const second = run(env.repo, ['finish', '002']);
    assert.equal(second.code, EXIT.OK, second.out);
    assert.equal(
      readFileSync(join(env.repo, 'CHANGELOG.md'), 'utf8'),
      `${CHANGELOG}- Entrega da tarefa 001.\n- Entrega da tarefa 002.\n`,
    );
    assert.equal(git(env.repo, 'rev-list', '--merges', '--count', 'main'), '0');
  });

  test('sem o atributo, a mesma situação é conflito (o teste acima prova o driver)', () => {
    const env = makeRepo({ tasks: [{ id: '001' }, { id: '002' }] });
    writeFileSync(join(env.repo, '.gitattributes'), '');
    git(env.repo, 'commit', '--quiet', '-am', 'chore: sem união (task 000)');
    for (const id of ['001', '002']) {
      assert.equal(run(env.repo, ['start', id, '--as', 'infra']).code, EXIT.OK);
      commitIn(
        env.worktree(id),
        'CHANGELOG.md',
        `- Entrega da tarefa ${id}.\n`,
        `feat: entrega (task ${id})`,
      );
    }
    assert.equal(run(env.repo, ['finish', '001']).code, EXIT.OK);
    assert.equal(run(env.repo, ['finish', '002']).code, EXIT.CONFLICT);
  });
});

describe('task:abort', () => {
  test('worktree limpo com commit fora da main: recusa sem --force e não apaga nada', () => {
    const env = started();
    const dir = env.worktree('001');
    commitIn(dir, 'app.txt', 'quatro\n', 'feat: quatro (task 001)');
    const tip = git(dir, 'rev-parse', 'HEAD');
    const result = run(env.repo, ['abort', '001']);
    assert.equal(result.code, EXIT.DIRTY, result.out);
    assert.match(result.out, /1 commit\(s\) que não estão na main/);
    assert.ok(existsSync(dir));
    assert.equal(git(env.repo, 'rev-parse', 'task/001'), tip);
    assert.equal(taskOf(env, '001').status, 'em-andamento');
  });

  test('--force confirmado apaga o branch com commits e imprime como recuperar', () => {
    const env = started();
    const dir = env.worktree('001');
    commitIn(dir, 'app.txt', 'quatro\n', 'feat: quatro (task 001)');
    const tip = git(dir, 'rev-parse', '--short', 'HEAD');
    let prompt = '';
    const result = run(env.repo, ['abort', '001', '--force'], {
      isTTY: true,
      ask: (text) => {
        prompt = text;
        return 'abortar 001';
      },
    });
    assert.equal(result.code, EXIT.OK, result.out);
    assert.match(prompt, /1 commit\(s\) fora da main/);
    assert.match(result.out, new RegExp(`git branch task/001 ${tip}`));
    assert.equal(existsSync(dir), false);
    assert.equal(git(env.repo, 'branch', '--list', 'task/001'), '');
  });

  test('worktree limpo sem commits próprios: remove worktree e branch e devolve a tarefa a aberta', () => {
    const env = started();
    const dir = env.worktree('001');
    const mainBefore = git(env.repo, 'rev-parse', 'main');
    const result = run(env.repo, ['abort', '001']);
    assert.equal(result.code, EXIT.OK, result.out);
    assert.equal(existsSync(dir), false);
    assert.equal(git(env.repo, 'branch', '--list', 'task/001'), '');
    assert.equal(git(env.repo, 'rev-parse', 'main'), mainBefore);
    assert.deepEqual(
      { status: taskOf(env, '001').status, owner: taskOf(env, '001').owner },
      { status: 'aberta', owner: '' },
    );
    // A tarefa pode recomeçar.
    assert.equal(run(env.repo, ['start', '001', '--as', 'infra']).code, EXIT.OK);
  });

  test('worktree sujo sem --force: recusa e não apaga nada', () => {
    const env = started();
    const dir = env.worktree('001');
    writeFileSync(join(dir, 'solto.txt'), 'trabalho\n');
    const result = run(env.repo, ['abort', '001']);
    assert.equal(result.code, EXIT.DIRTY);
    assert.ok(existsSync(join(dir, 'solto.txt')));
    assert.equal(taskOf(env, '001').status, 'em-andamento');
  });

  test('--force sem terminal é recusado; com confirmação errada também', () => {
    const env = started();
    const dir = env.worktree('001');
    writeFileSync(join(dir, 'solto.txt'), 'trabalho\n');
    const noTty = run(env.repo, ['abort', '001', '--force']);
    assert.equal(noTty.code, EXIT.REFUSED);
    assert.match(noTty.out, /terminal interativo/);
    const wrong = run(env.repo, ['abort', '001', '--force'], { isTTY: true, ask: () => 'sim' });
    assert.equal(wrong.code, EXIT.REFUSED);
    assert.ok(existsSync(join(dir, 'solto.txt')));
    assert.equal(taskOf(env, '001').status, 'em-andamento');
  });

  test('--force com a confirmação digitada apaga o worktree sujo', () => {
    const env = started();
    const dir = env.worktree('001');
    writeFileSync(join(dir, 'solto.txt'), 'trabalho\n');
    let prompt = '';
    const result = run(env.repo, ['abort', '001', '--force'], {
      isTTY: true,
      ask: (text) => {
        prompt = text;
        return 'abortar 001';
      },
    });
    assert.equal(result.code, EXIT.OK, result.out);
    assert.match(prompt, /Digite "abortar 001"/);
    assert.equal(existsSync(dir), false);
    assert.equal(taskOf(env, '001').status, 'aberta');
  });
});

describe('task:path e task:list', () => {
  test('path imprime o checkout principal, também de dentro de um worktree', () => {
    const env = started();
    assert.equal(run(env.repo, ['path']).out, env.repo);
    assert.equal(run(env.worktree('001'), ['path']).out, env.repo);
  });

  test('list mostra status, papel, dependências pendentes e worktree', () => {
    const env = makeRepo({
      tasks: [{ id: '001' }, { id: '002', dependsOn: ['001', '000'] }],
    });
    run(env.repo, ['start', '001', '--as', 'infra']);
    const lines = run(env.worktree('001'), ['list']).out.split('\n');
    assert.match(
      lines[0],
      /^TAREFA\s+STATUS\s+PAPEL\s+RESPONSÁVEL\s+DEPENDE DE\s+WORKTREE\s+TÍTULO$/,
    );
    assert.match(lines[1], /^001\s+em-andamento\s+infra\s+infra\s+-\s+sim\s+Tarefa 001 de teste$/);
    assert.match(lines[2], /^002\s+aberta\s+infra\s+-\s+001\s+-\s+Tarefa 002 de teste$/);
  });
});

// ---------------------------------------------------------------------------------------------
// Janela de contrato (specs/002, ADR 0022): a tarefa 010 é a janela; 011 e 012 são tarefas dela.

const WINDOW_TASKS = [
  { id: '010' },
  { id: '011', janela: '010', dependsOn: ['010'] },
  { id: '012', janela: '010', dependsOn: ['010', '011'] },
];

/** Repositório com a janela 010 aberta (worktree e branch) e as tarefas dela na fila. */
function windowEnv(tasks = WINDOW_TASKS) {
  const env = makeRepo({ tasks });
  assert.equal(run(env.repo, ['start', '010', '--as', 'arquiteto']).code, EXIT.OK);
  return env;
}

function setTask(env, id, fields) {
  const file = join(env.repo, 'tasks', `${id}-tarefa-de-teste.md`);
  writeFileSync(file, setTaskFields(readFileSync(file, 'utf8'), fields));
}

function addRelato(env, id) {
  appendFileSync(
    join(env.repo, 'tasks', `${id}-tarefa-de-teste.md`),
    '\n## Relato\n\n- Commits, verificação e linha sugerida para o changelog.\n',
  );
}

/** Commit de uma tarefa no worktree da janela, com caminho explícito (diretório compartilhado). */
function commitMember(env, id) {
  const dir = env.worktree('010');
  const file = `tarefa-${id}.txt`;
  writeFileSync(join(dir, file), `trabalho da ${id}\n`);
  git(dir, 'add', file);
  git(dir, 'commit', '--quiet', '-m', `feat: trabalho (task ${id})`, '--', file);
}

/** Entra na janela, commita, relata e termina: a tarefa fica "pronta". */
function memberReady(env, id) {
  assert.equal(run(env.repo, ['start', id, '--as', 'infra', '--join', '010']).code, EXIT.OK);
  commitMember(env, id);
  addRelato(env, id);
  const result = run(env.repo, ['finish', id]);
  assert.equal(result.code, EXIT.OK, result.out);
  return result;
}

describe('janela de contrato: partes puras', () => {
  test('argumentos: --join só no start e com número válido', () => {
    assert.equal(parseArgs(['start', '11', '--as', 'infra', '--join', '10']).join, '010');
    assert.equal(parseArgs(['start', '11', '--as', 'infra', '--join=010']).join, '010');
    assert.equal(parseArgs(['start', '11', '--as', 'infra']).join, null);
    assert.match(parseArgs(['start', '11', '--as', 'infra', '--join']).error, /janela inválido/);
    assert.match(parseArgs(['start', '11', '--as', 'infra', '--join', 'x']).error, /inválido/);
    assert.match(parseArgs(['finish', '11', '--join', '10']).error, /desconhecida/);
    assert.match(parseArgs(['abort', '11', '--join', '10']).error, /desconhecida/);
  });

  test('cabeçalho: campo janela normalizado, vazio quando ausente; status pronta', () => {
    assert.equal(parseTask(taskText({ id: '011', janela: '10' })).window, '010');
    assert.equal(parseTask(taskText({ id: '011' })).window, '');
    assert.equal(parseTask(taskText({ id: '011', janela: 'abc' })).window, '');
    assert.equal(parseTask(taskText({ id: '011', status: 'pronta' })).status, 'pronta');
    const text = taskText({ id: '011', janela: '010' });
    const changed = setTaskFields(text, { status: 'pronta' });
    assert.equal(parseTask(changed).window, '010');
    assert.equal(changed.split('---')[2], text.split('---')[2]);
  });

  test('commit cita a tarefa só no fim do título, com ou sem zeros', () => {
    assert.equal(citesTask('feat: x (task 011)', '011'), true);
    assert.equal(citesTask('feat: x (task 11)', '011'), true);
    assert.equal(citesTask('feat: x (task 0110)', '011'), false);
    assert.equal(citesTask('feat: (task 011) no meio', '011'), false);
    assert.equal(citesTask('feat: x (tarefa 011)', '011'), false);
  });
});

describe('janela de contrato: task:start --join', () => {
  test('entra na janela: só marca a tarefa; sem worktree, sem branch e sem install', () => {
    const env = windowEnv();
    const mainBefore = git(env.repo, 'rev-parse', 'main');
    const result = run(env.repo, ['start', '011', '--as', 'interface', '--join', '10']);
    assert.equal(result.code, EXIT.OK, result.out);
    assert.equal(result.out.split('\n').at(-1), `WORKTREE=${env.worktree('010')}`);
    assert.match(result.out, /aviso: a tarefa é do papel "infra" .* "interface"/);
    assert.equal(result.calls.install.length, 0);
    assert.equal(existsSync(env.worktree('011')), false);
    assert.equal(git(env.repo, 'branch', '--list', 'task/011'), '');
    assert.deepEqual(
      { status: taskOf(env, '011').status, owner: taskOf(env, '011').owner },
      { status: 'em-andamento', owner: 'interface' },
    );
    assert.equal(git(env.repo, 'rev-parse', 'main'), mainBefore);
    assert.equal(git(env.repo, 'status', '--porcelain'), '');
    assert.equal(git(env.worktree('010'), 'status', '--porcelain'), '');
    assert.doesNotMatch(git(env.repo, 'worktree', 'list'), /task-011/);
  });

  test('recusa tarefa que não está aberta', () => {
    const env = windowEnv();
    setTask(env, '011', { status: 'bloqueada' });
    const result = run(env.repo, ['start', '011', '--as', 'infra', '--join', '010']);
    assert.equal(result.code, EXIT.REFUSED);
    assert.match(result.out, /está "bloqueada"/);
    assert.equal(taskOf(env, '011').status, 'bloqueada');

    assert.equal(run(env.repo, ['start', '011', '--as', 'infra', '--join', '010']).code, 2);
    setTask(env, '011', { status: 'aberta' });
    assert.equal(run(env.repo, ['start', '011', '--as', 'infra', '--join', '010']).code, EXIT.OK);
    // Já em andamento: não entra de novo.
    assert.equal(run(env.repo, ['start', '011', '--as', 'infra', '--join', '010']).code, 2);
  });

  test('recusa quando o cabeçalho não traz a janela pedida, e diz o que encontrou', () => {
    const env = windowEnv([
      { id: '010' },
      { id: '011' },
      { id: '012', janela: '020' },
      { id: '020' },
    ]);
    const none = run(env.repo, ['start', '011', '--as', 'infra', '--join', '010']);
    assert.equal(none.code, EXIT.REFUSED);
    assert.match(none.out, /não é da janela 010: .*ausente ou vazio/);
    const other = run(env.repo, ['start', '012', '--as', 'infra', '--join', '010']);
    assert.equal(other.code, EXIT.REFUSED);
    assert.match(other.out, /não é da janela 010: .*"janela: 020"/);
    assert.equal(taskOf(env, '011').status, 'aberta');
    assert.equal(taskOf(env, '012').status, 'aberta');
  });

  test('recusa quando a janela não foi aberta, ou não está em andamento', () => {
    const closed = makeRepo({ tasks: WINDOW_TASKS });
    const result = run(closed.repo, ['start', '011', '--as', 'infra', '--join', '010']);
    assert.equal(result.code, EXIT.REFUSED);
    assert.match(result.out, /janela 010 não foi aberta/);
    assert.equal(taskOf(closed, '011').status, 'aberta');

    // Só o branch, sem worktree, também não é janela aberta.
    git(closed.repo, 'branch', 'task/010');
    assert.equal(run(closed.repo, ['start', '011', '--as', 'infra', '--join', '010']).code, 2);

    const blocked = windowEnv();
    setTask(blocked, '010', { status: 'bloqueada' });
    const second = run(blocked.repo, ['start', '011', '--as', 'infra', '--join', '010']);
    assert.equal(second.code, EXIT.REFUSED);
    assert.match(second.out, /janela 010 não está em andamento: a tarefa 010 está "bloqueada"/);

    const orphan = windowEnv();
    rmSync(join(orphan.repo, 'tasks', '010-tarefa-de-teste.md'));
    const third = run(orphan.repo, ['start', '011', '--as', 'infra', '--join', '010']);
    assert.equal(third.code, EXIT.REFUSED);
    assert.match(third.out, /falta tasks\/010-\*\.md/);
  });

  test('recusa a própria janela como tarefa da janela', () => {
    const env = makeRepo({ tasks: [{ id: '010', janela: '010' }] });
    const result = run(env.repo, ['start', '010', '--as', 'infra', '--join', '010']);
    assert.equal(result.code, EXIT.REFUSED);
    assert.match(result.out, /é a própria janela/);
    assert.equal(taskOf(env, '010').status, 'aberta');
  });

  test('dependência: a janela e tarefa pronta da janela atendem; o resto da fila não', () => {
    const env = windowEnv([
      ...WINDOW_TASKS,
      { id: '013', janela: '010', dependsOn: ['010', '030', '099'] },
      { id: '030' },
    ]);
    // 012 depende da 011, que ainda está aberta e depois em andamento.
    const open = run(env.repo, ['start', '012', '--as', 'infra', '--join', '010']);
    assert.equal(open.code, EXIT.REFUSED);
    assert.match(open.out, /ainda não atendida: 011 \(aberta\)/);
    assert.equal(run(env.repo, ['start', '011', '--as', 'infra', '--join', '010']).code, EXIT.OK);
    const running = run(env.repo, ['start', '012', '--as', 'infra', '--join', '010']);
    assert.equal(running.code, EXIT.REFUSED);
    assert.match(running.out, /011 \(em-andamento\)/);
    assert.equal(taskOf(env, '012').status, 'aberta');

    // Com a 011 pronta, a 012 entra (a dependência da própria janela nunca segura).
    commitMember(env, '011');
    addRelato(env, '011');
    assert.equal(run(env.repo, ['finish', '011']).code, EXIT.OK);
    assert.equal(run(env.repo, ['start', '012', '--as', 'infra', '--join', '010']).code, EXIT.OK);

    // Tarefa de fora da janela ainda na fila segura; dependência já removida da fila (099) não.
    const outside = run(env.repo, ['start', '013', '--as', 'infra', '--join', '010']);
    assert.equal(outside.code, EXIT.REFUSED);
    assert.match(outside.out, /ainda não atendida: 030 \(aberta\)\./);
    // Tarefa pronta de OUTRA janela também não atende.
    setTask(env, '030', { status: 'pronta', janela: '020' });
    assert.equal(run(env.repo, ['start', '013', '--as', 'infra', '--join', '010']).code, 2);
    rmSync(join(env.repo, 'tasks', '030-tarefa-de-teste.md'));
    assert.equal(run(env.repo, ['start', '013', '--as', 'infra', '--join', '010']).code, EXIT.OK);
  });

  test('sem --join, tarefa com janela é recusada e não abre worktree próprio', () => {
    const env = windowEnv();
    const result = run(env.repo, ['start', '011', '--as', 'infra']);
    assert.equal(result.code, EXIT.REFUSED);
    assert.match(result.out, /faz parte da janela 010.*--join 010/);
    assert.equal(result.calls.install.length, 0);
    assert.equal(existsSync(env.worktree('011')), false);
    assert.equal(git(env.repo, 'branch', '--list', 'task/011'), '');
    assert.equal(taskOf(env, '011').status, 'aberta');
  });

  test('tarefa de fora que depende de tarefa pronta continua esperando', () => {
    const env = windowEnv([...WINDOW_TASKS, { id: '040', dependsOn: ['011'] }]);
    memberReady(env, '011');
    const result = run(env.repo, ['start', '040', '--as', 'infra']);
    assert.equal(result.code, EXIT.REFUSED);
    assert.match(result.out, /depende de tarefa ainda na fila: 011\./);
  });
});

describe('janela de contrato: task:finish da tarefa da janela', () => {
  test('marca pronta sem rebase, verificação, push nem limpeza; avisa quando a janela fecha', () => {
    const env = windowEnv();
    const dir = env.worktree('010');
    assert.equal(run(env.repo, ['start', '011', '--as', 'infra', '--join', '010']).code, EXIT.OK);
    commitMember(env, '011');
    addRelato(env, '011');
    // Alteração pendente de outro agente no worktree compartilhado não impede.
    writeFileSync(join(dir, 'de-outro-agente.txt'), 'pendente\n');
    // A main andou: o finish da tarefa da janela não faz rebase.
    commitIn(env.repo, 'app.txt', 'de fora\n', 'feat: de fora (task 002)');
    const mainBefore = git(env.repo, 'rev-parse', 'main');
    const remoteBefore = git(env.remote, 'rev-parse', 'main');
    const tip = git(dir, 'rev-parse', 'HEAD');

    const result = run(env.repo, ['finish', '011']);
    assert.equal(result.code, EXIT.OK, result.out);
    assert.equal(result.calls.verify.length, 0);
    assert.equal(result.calls.install.length, 0);
    assert.deepEqual(
      { status: taskOf(env, '011').status, owner: taskOf(env, '011').owner },
      { status: 'pronta', owner: 'infra' },
    );
    assert.equal(git(env.repo, 'rev-parse', 'main'), mainBefore);
    assert.equal(git(env.remote, 'rev-parse', 'main'), remoteBefore);
    assert.equal(git(dir, 'rev-parse', 'HEAD'), tip);
    assert.ok(existsSync(join(dir, 'de-outro-agente.txt')));
    assert.match(result.out, /^\s+011\s+pronta\s+infra$/m);
    assert.match(result.out, /^\s+012\s+aberta\s+-$/m);
    assert.equal(result.out.split('\n').at(-1), 'Janela 010 ainda aberta: falta(m) 012.');

    // Pronta não termina de novo.
    assert.equal(run(env.repo, ['finish', '011']).code, EXIT.REFUSED);

    const last = memberReady(env, '012');
    assert.equal(
      last.out.split('\n').at(-1),
      'Janela 010 pronta para fechar: acrescente o CHANGELOG.md (task 010) e rode pnpm task:finish 010',
    );
  });

  test('recusa sem commit citando a tarefa, e sem a seção de relato', () => {
    const env = windowEnv();
    assert.equal(run(env.repo, ['start', '011', '--as', 'infra', '--join', '010']).code, EXIT.OK);
    addRelato(env, '011');
    // Commit da janela ou de outra tarefa não conta.
    commitIn(env.worktree('010'), 'app.txt', 'contrato\n', 'feat: contrato (task 010)');
    commitMember(env, '012');
    const noCommit = run(env.repo, ['finish', '011']);
    assert.equal(noCommit.code, EXIT.REFUSED);
    assert.match(
      noCommit.out,
      /Nenhum commit em main\.\.task\/010 .*"\(task 011\)".*falta commitar/,
    );
    assert.equal(taskOf(env, '011').status, 'em-andamento');

    assert.equal(run(env.repo, ['start', '012', '--as', 'infra', '--join', '010']).code, 2);
    setTask(env, '012', { status: 'em-andamento', responsavel: 'infra' });
    const noReport = run(env.repo, ['finish', '012']);
    assert.equal(noReport.code, EXIT.REFUSED);
    assert.match(noReport.out, /Falta a seção "## Relato"/);
    assert.equal(taskOf(env, '012').status, 'em-andamento');
  });

  test('recusa tarefa que não está em andamento e janela que não está aberta', () => {
    const env = windowEnv();
    commitMember(env, '011');
    addRelato(env, '011');
    const open = run(env.repo, ['finish', '011']);
    assert.equal(open.code, EXIT.REFUSED);
    assert.match(open.out, /está "aberta"; só fica "pronta" a tarefa "em-andamento"/);

    const closed = makeRepo({
      tasks: [{ id: '010' }, { id: '011', janela: '010', status: 'em-andamento', owner: 'infra' }],
    });
    const result = run(closed.repo, ['finish', '011']);
    assert.equal(result.code, EXIT.REFUSED);
    assert.match(result.out, /janela 010 não tem worktree/);
    assert.equal(taskOf(closed, '011').status, 'em-andamento');
  });
});

describe('janela de contrato: task:finish da janela', () => {
  test('recusa antes de qualquer passo enquanto houver tarefa que não esteja pronta', () => {
    const env = windowEnv();
    const dir = env.worktree('010');
    commitIn(dir, 'app.txt', 'contrato\n', 'feat: contrato (task 010)');
    memberReady(env, '011');
    assert.equal(run(env.repo, ['start', '012', '--as', 'banco', '--join', '010']).code, EXIT.OK);
    const tip = git(dir, 'rev-parse', 'HEAD');
    const mainBefore = git(env.repo, 'rev-parse', 'main');

    const result = run(env.repo, ['finish', '010']);
    assert.equal(result.code, EXIT.REFUSED);
    assert.match(result.out, /janela 010 tem tarefa que não está "pronta"/);
    assert.match(result.out, /^\s+012\s+em-andamento\s+banco$/m);
    assert.doesNotMatch(result.out, /^\s+011\s/m);
    assert.equal(result.calls.verify.length, 0);
    assert.equal(git(dir, 'rev-parse', 'HEAD'), tip);
    assert.equal(git(env.repo, 'rev-parse', 'main'), mainBefore);
    assert.equal(taskOf(env, '010').status, 'em-andamento');
    assert.equal(taskOf(env, '011').status, 'pronta');
    // De dentro do worktree da janela, sem número, é a mesma recusa.
    assert.equal(run(dir, ['finish']).code, EXIT.REFUSED);
  });

  test('com todas prontas: finish normal e remove os arquivos de todas as tarefas da janela', () => {
    const env = windowEnv([...WINDOW_TASKS, { id: '050' }, { id: '051', janela: '020' }]);
    const dir = env.worktree('010');
    commitIn(dir, 'app.txt', 'contrato\n', 'feat: contrato (task 010)');
    memberReady(env, '011');
    memberReady(env, '012');
    commitIn(dir, 'CHANGELOG.md', '- Janela 010.\n', 'docs: changelog da janela (task 010)');
    commitIn(env.repo, 'outro.txt', 'x\n', 'feat: de fora (task 002)');
    const mainBefore = git(env.repo, 'rev-parse', 'main');

    const result = run(env.repo, ['finish', '010']);
    assert.equal(result.code, EXIT.OK, result.out);
    assert.deepEqual(result.calls.verify, [dir]);
    assert.match(result.out, /arquivos das tarefas da janela removidos da fila: 011, 012/);
    assert.equal(git(env.repo, 'rev-list', '--count', `${mainBefore}..main`), '4');
    assert.equal(git(env.repo, 'rev-list', '--merges', '--count', 'main'), '0');
    assert.equal(git(env.remote, 'rev-parse', 'main'), git(env.repo, 'rev-parse', 'main'));
    assert.equal(existsSync(dir), false);
    assert.equal(git(env.repo, 'branch', '--list', 'task/010'), '');
    assert.equal(taskOf(env, '010'), null);
    assert.equal(taskOf(env, '011'), null);
    assert.equal(taskOf(env, '012'), null);
    // Tarefa sem janela e tarefa de outra janela ficam na fila.
    assert.equal(taskOf(env, '050').status, 'aberta');
    assert.equal(taskOf(env, '051').status, 'aberta');
    assert.equal(git(env.repo, 'status', '--porcelain'), '');
  });

  test('worktree da janela sujo segura o fechamento, mesmo com todas prontas', () => {
    const env = windowEnv();
    memberReady(env, '011');
    memberReady(env, '012');
    writeFileSync(join(env.worktree('010'), 'solto.txt'), 'pendente\n');
    const result = run(env.repo, ['finish', '010']);
    assert.equal(result.code, EXIT.DIRTY);
    assert.equal(taskOf(env, '011').status, 'pronta');
  });

  test('verificação falhando no fechamento: nada chega à main e as tarefas continuam prontas', () => {
    const env = windowEnv();
    memberReady(env, '011');
    memberReady(env, '012');
    const mainBefore = git(env.repo, 'rev-parse', 'main');
    const result = run(env.repo, ['finish', '010'], { verify: () => 1 });
    assert.equal(result.code, EXIT.VERIFY);
    assert.equal(git(env.repo, 'rev-parse', 'main'), mainBefore);
    assert.equal(taskOf(env, '010').status, 'em-andamento');
    assert.equal(taskOf(env, '011').status, 'pronta');
    assert.equal(taskOf(env, '012').status, 'pronta');
  });

  test('push negado: código próprio, e os arquivos de todas as tarefas da janela saem', () => {
    const env = windowEnv();
    const dir = env.worktree('010');
    memberReady(env, '011');
    memberReady(env, '012');
    const tip = git(dir, 'rev-parse', 'HEAD');
    git(env.repo, 'remote', 'set-url', 'origin', join(env.repo, '..', 'nao-existe.git'));

    const result = run(env.repo, ['finish', '010']);
    assert.equal(result.code, EXIT.PUSH);
    assert.match(result.out, /PUSH PENDENTE/);
    assert.match(result.out, /arquivos das tarefas da janela removidos da fila: 011, 012/);
    assert.equal(git(env.repo, 'rev-parse', 'main'), tip);
    assert.equal(existsSync(dir), false);
    assert.equal(taskOf(env, '010'), null);
    assert.equal(taskOf(env, '011'), null);
    assert.equal(taskOf(env, '012'), null);
  });
});

describe('janela de contrato: task:abort', () => {
  test('tarefa da janela sem commit: volta a aberta e o worktree da janela não é tocado', () => {
    const env = windowEnv();
    const dir = env.worktree('010');
    assert.equal(run(env.repo, ['start', '011', '--as', 'infra', '--join', '010']).code, EXIT.OK);
    commitIn(dir, 'app.txt', 'contrato\n', 'feat: contrato (task 010)');
    writeFileSync(join(dir, 'solto.txt'), 'pendente de alguém\n');
    const tip = git(dir, 'rev-parse', 'HEAD');

    const result = run(env.repo, ['abort', '011']);
    assert.equal(result.code, EXIT.OK, result.out);
    assert.deepEqual(
      { status: taskOf(env, '011').status, owner: taskOf(env, '011').owner },
      { status: 'aberta', owner: '' },
    );
    assert.ok(existsSync(join(dir, 'solto.txt')));
    assert.equal(git(dir, 'rev-parse', 'HEAD'), tip);
    assert.equal(git(env.repo, 'rev-parse', 'task/010'), tip);
    assert.equal(taskOf(env, '010').status, 'em-andamento');
    // Pode entrar de novo.
    assert.equal(run(env.repo, ['start', '011', '--as', 'infra', '--join', '010']).code, EXIT.OK);
  });

  test('tarefa da janela com commit no branch: recusa e aponta o abort da janela', () => {
    const env = windowEnv();
    assert.equal(run(env.repo, ['start', '011', '--as', 'infra', '--join', '010']).code, EXIT.OK);
    commitMember(env, '011');
    const result = run(env.repo, ['abort', '011']);
    assert.equal(result.code, EXIT.REFUSED);
    assert.match(result.out, /1 commit\(s\) "\(task 011\)".*task:abort 010 --force/);
    assert.equal(taskOf(env, '011').status, 'em-andamento');
    // --force na tarefa da janela não muda a recusa (nem pede confirmação).
    assert.equal(run(env.repo, ['abort', '011', '--force']).code, EXIT.REFUSED);
    assert.ok(existsSync(join(env.worktree('010'), 'tarefa-011.txt')));
  });

  test('janela com commits: recusa sem --force e não mexe nas tarefas dela', () => {
    const env = windowEnv();
    memberReady(env, '011');
    const result = run(env.repo, ['abort', '010']);
    assert.equal(result.code, EXIT.DIRTY);
    assert.ok(existsSync(env.worktree('010')));
    assert.equal(taskOf(env, '010').status, 'em-andamento');
    assert.equal(taskOf(env, '011').status, 'pronta');
  });

  test('janela abortada com --force: as tarefas em andamento e prontas voltam a aberta', () => {
    const env = windowEnv([
      ...WINDOW_TASKS,
      { id: '013', janela: '010', status: 'bloqueada', owner: 'banco' },
      { id: '050', status: 'em-andamento', owner: 'banco' },
    ]);
    memberReady(env, '011');
    assert.equal(run(env.repo, ['start', '012', '--as', 'infra', '--join', '010']).code, EXIT.OK);
    const result = run(env.repo, ['abort', '010', '--force'], {
      isTTY: true,
      ask: () => 'abortar 010',
    });
    assert.equal(result.code, EXIT.OK, result.out);
    assert.match(result.out, /tarefas da janela devolvidas a "aberta": 011, 012/);
    assert.equal(existsSync(env.worktree('010')), false);
    assert.equal(git(env.repo, 'branch', '--list', 'task/010'), '');
    for (const id of ['010', '011', '012']) {
      assert.deepEqual(
        { status: taskOf(env, id).status, owner: taskOf(env, id).owner },
        { status: 'aberta', owner: '' },
      );
    }
    // Bloqueada da janela e tarefa de fora ficam como estavam.
    assert.equal(taskOf(env, '013').status, 'bloqueada');
    assert.equal(taskOf(env, '050').status, 'em-andamento');
  });

  test('janela limpa e sem commits: aborta sem --force e devolve as tarefas dela', () => {
    const env = windowEnv();
    assert.equal(run(env.repo, ['start', '011', '--as', 'infra', '--join', '010']).code, EXIT.OK);
    const result = run(env.repo, ['abort', '010']);
    assert.equal(result.code, EXIT.OK, result.out);
    assert.equal(taskOf(env, '010').status, 'aberta');
    assert.equal(taskOf(env, '011').status, 'aberta');
    assert.equal(taskOf(env, '012').status, 'aberta');
  });
});

describe('janela de contrato: task:list', () => {
  test('coluna JANELA, worktree da janela e dependência pronta marcada', () => {
    const env = windowEnv([...WINDOW_TASKS, { id: '040', dependsOn: ['011', '000'] }]);
    memberReady(env, '011');
    const lines = run(env.repo, ['list']).out.split('\n');
    assert.match(
      lines[0],
      /^TAREFA\s+STATUS\s+PAPEL\s+RESPONSÁVEL\s+JANELA\s+DEPENDE DE\s+WORKTREE\s+TÍTULO$/,
    );
    assert.match(lines[1], /^010\s+em-andamento\s+infra\s+arquiteto\s+-\s+-\s+sim\s+Tarefa 010/);
    assert.match(lines[2], /^011\s+pronta\s+infra\s+infra\s+010\s+010\s+task-010\s+Tarefa 011/);
    assert.match(
      lines[3],
      /^012\s+aberta\s+infra\s+-\s+010\s+010, 011 \(pronta\)\s+task-010\s+Tarefa 012/,
    );
    assert.match(lines[4], /^040\s+aberta\s+infra\s+-\s+-\s+011 \(pronta\)\s+-\s+Tarefa 040/);
  });

  test('janela ainda não aberta: a tarefa dela não mostra worktree', () => {
    const env = makeRepo({ tasks: WINDOW_TASKS });
    const lines = run(env.repo, ['list']).out.split('\n');
    assert.match(lines[2], /^011\s+aberta\s+infra\s+-\s+010\s+010\s+-\s+Tarefa 011/);
  });
});
