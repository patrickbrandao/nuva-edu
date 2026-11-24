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
import { EXIT, formatTable, parseArgs, parseTask, runTask, setTaskFields } from './task.mjs';

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

function taskText({ id, status = 'aberta', owner = '', dependsOn = [] }) {
  return `---\nid: ${id}\nstatus: ${status}\nresponsavel:${owner ? ` ${owner}` : ''}\nfase: 0\npapel: infra\ndepende-de: [${dependsOn.join(', ')}]\n---\n\n# Tarefa ${id} de teste\n\nCorpo.\n`;
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
