// Testa o `scripts/volume-migrate.sh` (spec 031, "Volumes"). A matriz de condições roda com um
// dublê do `docker`; o caminho completo roda também no Docker de verdade, só com volumes e um
// projeto descartáveis (`nuva-t134-*`), nunca com o `postgres-data` nem com o projeto `nuva-edu`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const script = join(root, 'scripts', 'volume-migrate.sh');

const temps = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** Forma normalizada do `docker compose config`, só com o que o script lê. */
function composeConfigYaml({ project = 'nuva-edu', volume = 'nuva-edu-postgres-data' } = {}) {
  return `name: ${project}
services:
  admin-api:
    volumes:
      - source: outro
        target: /var/lib/postgresql
        type: volume
  postgres:
    image: postgres:18-alpine
    user: postgres
    volumes:
      - type: volume
        source: postgres_data
        target: /var/lib/postgresql
        volume: {}
volumes:
  outro:
    name: nao-e-este
  postgres_data:
    name: ${volume}
`;
}

// Volumes do dublê: um arquivo por volume em $DOUBLE_DIR/volumes, com o projeto do rótulo.
const DOCKER = `#!/bin/bash
echo "docker $*" >> "$DOUBLE_DIR/log"
vols="$DOUBLE_DIR/volumes"
if [ "$1" = compose ]; then
  for arg in "$@"; do
    case "$arg" in
      config) cat "$DOUBLE_DIR/config.yml"; exit "\${CONFIG_STATUS:-0}" ;;
      stop) exit "\${STOP_STATUS:-0}" ;;
      run)
        project="$(sed -n 's/^name: //p' "$DOUBLE_DIR/config.yml")"
        to="$(sed -n '/^  postgres_data:/,$ s/^    name: //p' "$DOUBLE_DIR/config.yml")"
        printf '%s' "$project" > "$vols/$to"
        exit "\${RUN_STATUS:-0}"
        ;;
    esac
  done
  exit 0
fi
case "$1 $2" in
  'volume inspect')
    [ -f "$vols/$3" ] || exit 1
    [[ "$*" == *--format* ]] && cat "$vols/$3" && echo
    exit 0
    ;;
  'volume rm') rm -f "$vols/$3" ;;
  'ps -q') printf '%s' "\${IN_USE:-}" ;;
esac
exit 0
`;

function sandbox({ config = composeConfigYaml(), volumes = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'nuva-volume-'));
  temps.push(dir);
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'volumes'));
  writeFileSync(join(dir, 'bin', 'docker'), DOCKER);
  chmodSync(join(dir, 'bin', 'docker'), 0o755);
  writeFileSync(join(dir, 'log'), '');
  writeFileSync(join(dir, 'config.yml'), config);
  for (const [name, owner] of Object.entries(volumes)) {
    writeFileSync(join(dir, 'volumes', name), owner);
  }
  return dir;
}

function run(args, { dir = sandbox(), env = {} } = {}) {
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { PATH: `${join(dir, 'bin')}:/usr/bin:/bin`, HOME: dir, DOUBLE_DIR: dir, ...env },
  });
  const log = readFileSync(join(dir, 'log'), 'utf8').split('\n').filter(Boolean);
  const volume = (name) =>
    existsSync(join(dir, 'volumes', name))
      ? readFileSync(join(dir, 'volumes', name), 'utf8')
      : null;
  return { ...result, dir, log, volume, output: `${result.stdout}\n${result.stderr}` };
}

const COMPOSE = ['--', '--env-file', '.env', '--env-file', '.env.local'];
const changes = (result) =>
  result.log.filter((line) => / (stop|run|rm|down|create|kill|restart|prune)\b/.test(line));

test('imprime o nome declarado para /var/lib/postgresql do postgres, lido do compose', () => {
  const result = run(['--print-name', '--no-interpolate', ...COMPOSE]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'nuva-edu-postgres-data\n');
  assert.ok(
    result.log.includes(
      'docker compose --env-file .env --env-file .env.local config --no-interpolate',
    ),
  );
  // Mesma leitura com a ordem de chaves do compose sem --no-interpolate (type antes de source).
  const plain = run(['--print-name', ...COMPOSE], {
    dir: sandbox({
      config: composeConfigYaml().replace('      - type: volume\n        source', '      - source'),
    }),
  });
  assert.equal(plain.stdout, 'nuva-edu-postgres-data\n');
});

test('migra: para só o postgres, copia pelo compose run e nunca apaga o antigo', () => {
  const result = run(COMPOSE, { dir: sandbox({ volumes: { 'postgres-data': 'nuva-edu' } }) });
  assert.equal(result.status, 0, result.output);
  assert.equal(result.volume('nuva-edu-postgres-data'), 'nuva-edu');
  assert.equal(result.volume('postgres-data'), 'nuva-edu');
  const prefix = 'docker compose --env-file .env --env-file .env.local';
  const [stop, run_] = changes(result);
  assert.equal(stop, `${prefix} stop postgres`);
  assert.equal(
    run_,
    `${prefix} run --rm --no-deps -T --entrypoint sh -v postgres-data:/nuva-volume-origem:ro postgres -c cp -a /nuva-volume-origem/. /var/lib/postgresql/ && diff -r /nuva-volume-origem /var/lib/postgresql`,
  );
  assert.equal(changes(result).length, 2);
  assert.ok(result.log.some((line) => line === 'docker ps -q --filter volume=postgres-data'));
  assert.doesNotMatch(result.log.join('\n'), /volume rm/);
  assert.match(result.stdout, /docker volume rm postgres-data/);
});

test('segunda execução não faz nada', () => {
  const dir = sandbox({ volumes: { 'postgres-data': 'nuva-edu' } });
  assert.equal(run(COMPOSE, { dir }).status, 0);
  writeFileSync(join(dir, 'log'), '');
  const again = run(COMPOSE, { dir });
  assert.equal(again.status, 0, again.output);
  assert.match(again.stdout, /já existe/);
  assert.deepEqual(changes(again), []);
});

test('não migra volume de outro projeto nem sem rótulo', () => {
  for (const owner of ['outro-projeto', '']) {
    const result = run(COMPOSE, { dir: sandbox({ volumes: { 'postgres-data': owner } }) });
    assert.equal(result.status, 0, result.output);
    assert.match(result.stdout, /outro projeto/);
    assert.deepEqual(changes(result), []);
    assert.equal(result.volume('nuva-edu-postgres-data'), null);
  }
});

test('não sobrescreve volume novo existente, nem de outro projeto', () => {
  for (const owner of ['nuva-edu', 'outro-projeto']) {
    const result = run(COMPOSE, {
      dir: sandbox({ volumes: { 'postgres-data': 'nuva-edu', 'nuva-edu-postgres-data': owner } }),
    });
    assert.equal(result.status, 0, result.output);
    assert.match(result.stdout, /já existe/);
    assert.deepEqual(changes(result), []);
    assert.equal(result.volume('nuva-edu-postgres-data'), owner);
  }
});

test('nada a fazer quando o compose ainda declara o nome antigo ou não há volume antigo', () => {
  const same = run(COMPOSE, {
    dir: sandbox({
      config: composeConfigYaml({ volume: 'postgres-data' }),
      volumes: { 'postgres-data': 'nuva-edu' },
    }),
  });
  assert.equal(same.status, 0);
  assert.match(same.stdout, /ainda declara/);
  assert.deepEqual(changes(same), []);
  const none = run(COMPOSE);
  assert.equal(none.status, 0);
  assert.deepEqual(changes(none), []);
});

test('--check diz se é preciso migrar (3) sem parar nem copiar nada', () => {
  const needed = run(['--check', ...COMPOSE], {
    dir: sandbox({ volumes: { 'postgres-data': 'nuva-edu' } }),
  });
  assert.equal(needed.status, 3, needed.output);
  assert.deepEqual(changes(needed), []);
  assert.equal(run(['--check', ...COMPOSE]).status, 0);
});

test('projeto do compose diferente do esperado: recusa sem tocar em nada', () => {
  const result = run(COMPOSE, {
    dir: sandbox({
      config: composeConfigYaml({ project: 'outro' }),
      volumes: { 'postgres-data': 'outro' },
    }),
  });
  assert.equal(result.status, 5);
  assert.deepEqual(changes(result), []);
});

test('volume antigo ainda em uso depois de parar o postgres: não copia', () => {
  const result = run(COMPOSE, {
    dir: sandbox({ volumes: { 'postgres-data': 'nuva-edu' } }),
    env: { IN_USE: 'abc123\n' },
  });
  assert.equal(result.status, 4, result.output);
  assert.deepEqual(
    changes(result).map((line) => line.split(' ').at(-1)),
    ['postgres'],
  );
  assert.equal(result.volume('nuva-edu-postgres-data'), null);
});

test('cópia que falha remove só o volume novo, criado nesta execução', () => {
  const result = run(COMPOSE, {
    dir: sandbox({ volumes: { 'postgres-data': 'nuva-edu' } }),
    env: { RUN_STATUS: '1' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /não foi alterado/);
  assert.equal(result.volume('nuva-edu-postgres-data'), null);
  assert.equal(result.volume('postgres-data'), 'nuva-edu');
  assert.deepEqual(
    result.log.filter((line) => line.includes('volume rm')),
    ['docker volume rm nuva-edu-postgres-data'],
  );
});

test('opção desconhecida e nome inválido saem com 2', () => {
  assert.equal(run(['--nada']).status, 2);
  assert.equal(run(['--from', 'a b', ...COMPOSE]).status, 2);
});

// --- Docker de verdade, só com nomes descartáveis -------------------------------------------

const IMAGE = 'postgres:18-alpine';
const dockerReady =
  spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' }).status === 0 &&
  spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;

test('no Docker: copia os dados para o volume novo e deixa o antigo intacto', {
  skip: dockerReady ? false : `docker ou a imagem ${IMAGE} indisponível`,
  timeout: 180_000,
}, () => {
  const id = `nuva-t134-${process.pid}-${Date.now().toString(36)}`;
  const from = `${id}-antigo`;
  const to = `${id}-novo`;
  const dir = mkdtempSync(join(tmpdir(), 'nuva-volume-docker-'));
  temps.push(dir);
  // Mesmas restrições do postgres do projeto: usuário postgres, raiz só leitura, sem capacidades.
  writeFileSync(
    join(dir, 'compose.yml'),
    `name: ${id}
services:
  postgres:
    image: ${IMAGE}
    user: postgres
    environment:
      POSTGRES_PASSWORD: so-do-teste
    volumes:
      - data:/var/lib/postgresql
    read_only: true
    tmpfs:
      - /run:mode=1777
      - /tmp
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 1s
      retries: 60
volumes:
  data:
    name: \${VOL}
`,
  );
  const sh = (command, args, vol) =>
    spawnSync(command, args, { cwd: dir, encoding: 'utf8', env: { ...process.env, VOL: vol } });
  const compose = (vol, ...args) => {
    const result = sh('docker', ['compose', '-f', 'compose.yml', ...args], vol);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  const migrate = () =>
    sh('bash', [script, '--from', from, '--project', id, '--', '-f', 'compose.yml'], to);
  const files = (volume) =>
    spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--user',
        'postgres',
        '--entrypoint',
        'sh',
        '-v',
        `${volume}:/v:ro`,
        IMAGE,
        '-c',
        'cd /v && find . -type f | sort | xargs md5sum',
      ],
      { encoding: 'utf8' },
    ).stdout;
  try {
    compose(from, 'up', '-d', '--wait');
    compose(
      from,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-c',
      "create table t (x text); insert into t values ('dado-de-teste');",
    );

    const result = migrate();
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    // O postgres foi parado pelo script antes da cópia.
    assert.equal(compose(from, 'ps', '-q', '--status', 'running'), '');

    const labels = JSON.parse(
      spawnSync('docker', ['volume', 'inspect', to, '--format', '{{json .Labels}}'], {
        encoding: 'utf8',
      }).stdout,
    );
    assert.equal(labels['com.docker.compose.project'], id);
    const before = files(from);
    assert.ok(before.length > 0);
    assert.equal(files(to), before);

    compose(to, 'up', '-d', '--wait');
    const rows = compose(
      to,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-tAc',
      'select x from t',
    );
    assert.equal(rows.trim(), 'dado-de-teste');
    compose(to, 'stop');

    // A origem continua lá, igual, e a segunda execução não faz nada.
    assert.equal(files(from), before);
    const again = migrate();
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /já existe/);
  } finally {
    sh('docker', ['compose', '-f', 'compose.yml', 'down', '--volumes'], to);
    sh('docker', ['compose', '-f', 'compose.yml', 'down', '--volumes'], from);
    spawnSync('docker', ['volume', 'rm', '-f', from, to], { stdio: 'ignore' });
  }
});
