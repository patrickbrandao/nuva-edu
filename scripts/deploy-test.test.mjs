// Testa o `scripts/deploy-test.sh` (spec 031, "pnpm deploy:test") sem tocar em servidor nenhum:
// `ssh`, `docker`, `git` e `curl` são dublês postos na frente do PATH. No modo `SSH_EXEC`, o
// dublê do ssh roda o comando "remoto" nesta máquina, contra uma pasta temporária.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const script = join(root, 'scripts', 'deploy-test.sh');
const BACKEND = 'admin-api,classroom-api,worker';
const SECRET = 'segredo-que-nunca-aparece';

// Segredos exigidos pelo Compose desde a Fase 1 (spec 031, "Segredos exigidos").
const TEST_ENV_LOCAL = `POSTGRES_PASSWORD=${SECRET}
SESSION_SECRET=${SECRET}-${SECRET}
ADMIN_EMAIL=admin@escola.test
ADMIN_PASSWORD=${SECRET}
NUVA_DOMAIN=opencode.tmsoft.com.br
TRAEFIK_NETWORK=network_public
TRAEFIK_NETWORK_EXTERNAL=true
TRAEFIK_ENTRYPOINTS=websecure
TRAEFIK_CERTRESOLVER=letsencrypt
NUVA_PUBLIC_SCHEME=https
NUVA_PUBLIC_PORT=
NUVA_IMAGE_TAG=main
NUVA_POSTGRES_PUBLISH=false
`;

const DOUBLES = {
  ssh: `#!/bin/bash
echo "ssh $*" >> "$DOUBLE_DIR/log"
n=$(($(cat "$DOUBLE_DIR/ssh.count" 2>/dev/null || echo 0) + 1))
echo "$n" > "$DOUBLE_DIR/ssh.count"
cat > "$DOUBLE_DIR/ssh.stdin.$n"
if [ -n "\${SSH_EXEC:-}" ]; then
  while [ $# -gt 0 ] && [[ "$1" != *@* ]]; do shift; done
  shift
  bash -c "$*" < "$DOUBLE_DIR/ssh.stdin.$n"
  exit $?
fi
if grep -aq 'nuva-deploy: conferência' "$DOUBLE_DIR/ssh.stdin.$n"; then
  printf '%s' "\${SSH_PREFLIGHT_OUT:-}"
  exit "\${SSH_PREFLIGHT_STATUS:-0}"
fi
if grep -aq 'nuva-deploy: publicação' "$DOUBLE_DIR/ssh.stdin.$n"; then
  exit "\${SSH_DEPLOY_STATUS:-0}"
fi
exit 0
`,
  // Volumes: VOLUME_OWNER responde por qualquer nome (o caso antigo); VOLUMES="nome=projeto ..."
  // cria volumes por nome, guardados em $DOUBLE_DIR/volumes para o `compose run` da migração.
  docker: `#!/bin/bash
echo "docker $*" >> "$DOUBLE_DIR/log"
vols="$DOUBLE_DIR/volumes"
if [ ! -d "$vols" ]; then
  mkdir -p "$vols"
  for pair in \${VOLUMES:-}; do printf '%s' "\${pair#*=}" > "$vols/\${pair%%=*}"; done
fi
volume="\${POSTGRES_VOLUME_NAME:-nuva-edu-postgres-data}"
if [ "$1" = compose ]; then
  for arg in "$@"; do
    case "$arg" in
      config)
        printf 'name: nuva-edu\\nservices:\\n  postgres:\\n    volumes:\\n      - source: postgres_data\\n        target: /var/lib/postgresql\\nvolumes:\\n  postgres_data:\\n    name: %s\\n' "$volume"
        exit 0
        ;;
      run) printf nuva-edu > "$vols/$volume"; exit "\${RUN_STATUS:-0}" ;;
    esac
  done
fi
case "$1 $2" in
  'volume inspect')
    if [ -z "\${VOLUME_OWNER:-}" ]; then
      [ -f "$vols/$3" ] || exit 1
      [[ "$*" == *--format* ]] && cat "$vols/$3" && echo
      exit 0
    fi
    ;;
  'volume rm') rm -f "$vols/$3" ;;
esac
case "$1 $2" in
  'manifest inspect')
    for name in \${MISSING_IMAGES:-}; do
      if [[ "$3" == */nuva-edu-$name:* ]]; then
        echo "no such manifest: docker.io/$3" >&2
        exit 1
      fi
    done
    echo '{}'
    ;;
  'volume inspect')
    [ -n "\${VOLUME_OWNER:-}" ] || exit 1
    [[ "$*" == *--format* ]] && echo "$VOLUME_OWNER"
    ;;
  'compose version') [[ "$*" == *--short* ]] && echo 5.6.0 ;;
  'version --format') echo 29.9.0 ;;
esac
exit 0
`,
  git: `#!/bin/bash
echo "git $*" >> "$DOUBLE_DIR/log"
case "$1" in
  rev-parse)
    case "$2" in
      HEAD) echo "\${GIT_HEAD:-1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" ;;
      main) echo "\${GIT_MAIN:-1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" ;;
      origin/main) echo "\${GIT_ORIGIN:-1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" ;;
    esac
    ;;
  diff) exit "\${GIT_DIFF_STATUS:-0}" ;;
esac
exit 0
`,
  curl: `#!/bin/bash
echo "curl $*" >> "$DOUBLE_DIR/log"
exit "\${CURL_STATUS:-0}"
`,
};

const temps = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'nuva-deploy-'));
  temps.push(dir);
  mkdirSync(join(dir, 'bin'));
  for (const [name, body] of Object.entries(DOUBLES)) {
    writeFileSync(join(dir, 'bin', name), body);
    chmodSync(join(dir, 'bin', name), 0o755);
  }
  writeFileSync(join(dir, 'log'), '');
  writeFileSync(
    join(dir, 'env.local'),
    'NUVA_DEPLOY_SSH_USER=deploy\nNUVA_DEPLOY_SSH_HOST=teste.exemplo.invalid\nNUVA_DEPLOY_SSH_PORT=2222\n',
  );
  return dir;
}

/** Roda o script com os dublês. `env` controla os dublês; `envLocal` troca o .env.local local. */
function run(args, { env = {}, dir = sandbox(), envLocal } = {}) {
  if (envLocal !== undefined) writeFileSync(join(dir, 'env.local'), envLocal);
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${join(dir, 'bin')}:/usr/bin:/bin`,
      HOME: dir,
      DOUBLE_DIR: dir,
      NUVA_DEPLOY_ENV_FILE: join(dir, 'env.local'),
      ...env,
    },
  });
  const log = readFileSync(join(dir, 'log'), 'utf8').split('\n').filter(Boolean);
  return { ...result, dir, log, output: `${result.stdout}\n${result.stderr}` };
}

const calls = (result, command) => result.log.filter((line) => line.startsWith(`${command} `));
const PREFLIGHT_OK =
  'ADMIN_HOST=edu-admin.teste.invalid\nCLASSROOM_HOST=classroom.teste.invalid\nREDE=network_public\nDOCKER=29.9.0\nCOMPOSE=5.6.0\n';

function deployFiles() {
  const result = spawnSync('bash', [script, '--list-files'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\n').filter(Boolean);
}

const FORBIDDEN = /(^|\/)\.env\.local|^tasks\/|^tmp\/|^specs\/|\/src\/|\.(ts|tsx|mjs|js|sql|sh)$/;

test('a lista de envio só tem arquivos Compose e o .env versionado', () => {
  const files = deployFiles();
  assert.ok(files.includes('.env'));
  assert.ok(files.includes('docker-compose.yml'));
  for (const file of files) {
    assert.doesNotMatch(file, FORBIDDEN, file);
    assert.match(file, /^(\.env|docker-compose\.yml|[\w/-]+\/docker-compose\.yml)$/, file);
    assert.ok(existsSync(join(root, file)), `${file} não existe`);
  }
  // Tudo o que o compose da raiz inclui precisa ir junto, senão o servidor não resolve o projeto.
  const included = [
    ...readFileSync(join(root, 'docker-compose.yml'), 'utf8').matchAll(/- path: (\S+)/g),
  ].map((match) => match[1]);
  for (const path of included) assert.ok(files.includes(path), `${path} fora da lista de envio`);
});

test('sem NUVA_DEPLOY_SSH_* para com erro claro e não chama ninguém', () => {
  const result = run(['main'], { envLocal: 'NUVA_DEPLOY_SSH_USER=deploy\nPOSTGRES_PASSWORD=x\n' });
  assert.equal(result.status, 10);
  assert.match(result.stderr, /NUVA_DEPLOY_SSH_HOST NUVA_DEPLOY_SSH_PORT/);
  assert.doesNotMatch(result.stderr, /falta definir:.*NUVA_DEPLOY_SSH_USER/);
  assert.deepEqual(result.log, []);
});

test('as variáveis de acesso também vêm do ambiente', () => {
  const result = run(['main', '--dry-run'], {
    envLocal: '',
    env: {
      NUVA_DEPLOY_SSH_USER: 'outro',
      NUVA_DEPLOY_SSH_HOST: 'h.exemplo.invalid',
      NUVA_DEPLOY_SSH_PORT: '22',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /outro@h\.exemplo\.invalid porta 22/);
});

test('imagem inexistente para antes de tocar no servidor, com código próprio', () => {
  const result = run(['sha-abc1234'], { env: { MISSING_IMAGES: 'admin classroom' } });
  assert.equal(result.status, 12);
  assert.match(result.stderr, /imagem não encontrada para a etiqueta sha-abc1234: admin classroom/);
  assert.match(result.stderr, /--only/);
  assert.equal(calls(result, 'docker manifest').length, 5);
  assert.deepEqual(calls(result, 'ssh'), []);
  assert.deepEqual(calls(result, 'curl'), []);
});

test('--only publica só o pedido e não exige as imagens dos sites', () => {
  const result = run(['main', '--only', BACKEND], {
    env: { MISSING_IMAGES: 'admin classroom', SSH_PREFLIGHT_OUT: PREFLIGHT_OK },
  });
  assert.equal(result.status, 0, result.output);
  assert.equal(calls(result, 'docker manifest').length, 3);
  const deploy = readFileSync(join(result.dir, 'ssh.stdin.3'), 'utf8');
  assert.match(deploy, /^SERVICES='admin-api classroom-api worker'$/m);
  assert.match(deploy, /^export NUVA_IMAGE_TAG='main'$/m);
  assert.deepEqual(
    calls(result, 'curl').map((line) => line.split(' ').at(-1)),
    ['https://edu-admin.teste.invalid/healthz', 'https://classroom.teste.invalid/healthz'],
  );
  assert.match(result.stdout, /deploy parcial/);
});

test('--only de um site não exige a imagem da admin-api; serviço desconhecido é recusado', () => {
  const site = run(['main', '--only', 'admin', '--dry-run'], {
    env: { MISSING_IMAGES: 'admin-api classroom-api worker classroom' },
  });
  assert.equal(site.status, 0, site.output);
  const unknown = run(['main', '--only', 'postgres,traefik']);
  assert.equal(unknown.status, 2);
  assert.deepEqual(unknown.log, []);
});

test('.env.local remoto ausente: para com as instruções, sem enviar nem criar nada', () => {
  const result = run(['main'], { env: { SSH_PREFLIGHT_STATUS: '42' } });
  assert.equal(result.status, 14);
  assert.equal(calls(result, 'ssh').length, 1);
  for (const name of [
    'POSTGRES_PASSWORD=',
    'NUVA_DOMAIN=opencode.tmsoft.com.br',
    'TRAEFIK_NETWORK=network_public',
    'TRAEFIK_NETWORK_EXTERNAL=true',
    'TRAEFIK_ENTRYPOINTS=websecure',
    'TRAEFIK_CERTRESOLVER=letsencrypt',
    'NUVA_PUBLIC_SCHEME=https',
    'NUVA_PUBLIC_PORT=',
    'NUVA_IMAGE_TAG=',
    'NUVA_POSTGRES_PUBLISH=false',
  ]) {
    assert.ok(result.stderr.includes(name), `instrução sem ${name}`);
  }
  // A única conexão foi a conferência, que não escreve.
  const preflight = readFileSync(join(result.dir, 'ssh.stdin.1'), 'utf8');
  assert.doesNotMatch(
    preflight,
    /mkdir|touch|tee |rm |mv |cp |docker (run|stop|rm|restart)|>\s*[^/&\s]/,
  );
});

test('pasta ausente, .env.local inválido, volume alheio e falha de ssh têm códigos próprios', () => {
  for (const [remote, expected, sshCalls] of [
    ['41', 14, 1],
    ['44', 15, 1],
    ['45', 16, 1],
    ['46', 16, 1],
    ['255', 13, 1],
  ]) {
    const result = run(['main'], { env: { SSH_PREFLIGHT_STATUS: remote } });
    assert.equal(result.status, expected, `remoto ${remote}`);
    assert.equal(calls(result, 'ssh').length, sshCalls);
  }
  const failed = run(['main'], {
    env: { SSH_PREFLIGHT_OUT: PREFLIGHT_OK, SSH_DEPLOY_STATUS: '47' },
  });
  assert.equal(failed.status, 17);
  assert.deepEqual(calls(failed, 'curl'), []);
  const unhealthy = run(['main'], { env: { SSH_PREFLIGHT_OUT: PREFLIGHT_OK, CURL_STATUS: '22' } });
  assert.equal(unhealthy.status, 18);
});

test('--dry-run mostra arquivos e comandos remotos sem conectar', () => {
  const result = run(['sha-abc1234', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls(result, 'ssh'), []);
  assert.deepEqual(calls(result, 'curl'), []);
  for (const file of deployFiles()) assert.ok(result.stdout.includes(`  ${file}\n`), file);
  assert.match(
    result.stdout,
    /ssh -o BatchMode=yes -o ForwardAgent=no .*-p 2222 deploy@teste\.exemplo\.invalid/,
  );
  assert.match(result.stdout, /tar -xf - --no-same-owner -C \/opt\/nuva-edu/);
  assert.match(
    result.stdout,
    /docker compose -p nuva-edu -f docker-compose\.yml --env-file \.env --env-file \.env\.local "\$@"/,
  );
  assert.match(result.stdout, /compose pull --quiet --include-deps \$SERVICES/);
  assert.match(result.stdout, /compose up -d --no-build --wait --wait-timeout 120 \$SERVICES/);
  assert.match(result.stdout, /^export NUVA_IMAGE_TAG='sha-abc1234'$/m);
  assert.doesNotMatch(result.stdout, /--profile|docker-compose\.dev\.yml|--build\b/);
  assert.doesNotMatch(
    result.stdout,
    /system prune|docker (stop|restart|rm|kill)|network (rm|create|connect|disconnect)|volume (rm|prune)|down\b/,
  );
});

test('sem etiqueta usa sha-<7> do HEAD e exige HEAD = main = origin/main', () => {
  const ok = run(['--dry-run']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^Etiqueta: sha-1111111$/m);
  const behind = run(['--dry-run'], {
    env: { GIT_ORIGIN: '2222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  });
  assert.equal(behind.status, 11);
  assert.deepEqual(calls(behind, 'docker'), []);
  const dirty = run(['main', '--dry-run'], { env: { GIT_DIFF_STATUS: '1' } });
  assert.equal(dirty.status, 11);
});

test('argumentos inválidos saem com código 2', () => {
  for (const args of [['--nope'], ['a', 'b'], ['main', '--dir', 'relativa'], ['tag com espaço']]) {
    assert.equal(run(args).status, 2, args.join(' '));
  }
});

test('deploy completo: três conexões, só os arquivos da lista e nunca o .env.local', () => {
  const dir = sandbox();
  const remote = join(dir, 'remote');
  mkdirSync(remote);
  writeFileSync(join(remote, '.env.local'), TEST_ENV_LOCAL);
  const result = run(['sha-abc1234', '--dir', remote], { dir, env: { SSH_EXEC: '1' } });
  assert.equal(result.status, 0, result.output);

  const ssh = calls(result, 'ssh');
  assert.equal(ssh.length, 3);
  for (const line of ssh) {
    assert.match(line, /-o BatchMode=yes -o ForwardAgent=no/);
    assert.match(line, /-p 2222 deploy@teste\.exemplo\.invalid /);
  }

  // O que de fato atravessou a conexão de envio.
  const listed = spawnSync('tar', ['-tf', join(dir, 'ssh.stdin.2')], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  const sent = listed.stdout.split('\n').filter(Boolean);
  assert.deepEqual(sent.toSorted(), deployFiles().toSorted());
  for (const file of sent) assert.doesNotMatch(file, FORBIDDEN, file);

  // O .env.local do "servidor" continua como estava, e o .env chegou.
  assert.equal(readFileSync(join(remote, '.env.local'), 'utf8'), TEST_ENV_LOCAL);
  assert.equal(
    readFileSync(join(remote, '.env'), 'utf8'),
    readFileSync(join(root, '.env'), 'utf8'),
  );
  assert.deepEqual(readdirSync(join(remote, 'apps')).toSorted(), [
    'admin',
    'admin-api',
    'classroom',
    'classroom-api',
    'worker',
  ]);

  // No "servidor", todo docker compose é do projeto nuva-edu, sem perfil e sem build.
  const compose = calls(result, 'docker').filter(
    (line) => / compose -p /.test(line) && !/ config /.test(line),
  );
  const prefix =
    'docker compose -p nuva-edu -f docker-compose.yml --env-file .env --env-file .env.local ';
  const all = 'admin-api classroom-api worker admin classroom';
  assert.deepEqual(compose.slice(0, 2), [
    `${prefix}pull --quiet --include-deps ${all}`,
    `${prefix}up -d --no-build --wait --wait-timeout 120 ${all}`,
  ]);
  for (const line of calls(result, 'docker')) {
    assert.doesNotMatch(
      line,
      /prune|--profile| stop| restart| rm | down|network (rm|create|connect)/,
    );
  }

  assert.deepEqual(
    calls(result, 'curl').map((line) => line.split(' ').at(-1)),
    [
      'https://edu-admin.opencode.tmsoft.com.br/healthz',
      'https://classroom.opencode.tmsoft.com.br/healthz',
      'https://edu-admin.opencode.tmsoft.com.br/config.json',
      'https://classroom.opencode.tmsoft.com.br/config.json',
    ],
  );
  assert.match(result.stdout, /etiqueta publicada: sha-abc1234/);
  assert.ok(!result.output.includes(SECRET), 'o segredo do .env.local apareceu na saída');

  // Idempotente: a segunda execução repete os mesmos comandos e termina igual.
  const again = run(['sha-abc1234', '--dir', remote], { dir, env: { SSH_EXEC: '1' } });
  assert.equal(again.status, 0, again.output);
  assert.equal(readFileSync(join(remote, '.env.local'), 'utf8'), TEST_ENV_LOCAL);
});

test('a conferência remota recusa .env.local impróprio e volume de outro projeto', () => {
  const attempt = (envLocal, env = {}) => {
    const dir = sandbox();
    const remote = join(dir, 'remote');
    mkdirSync(remote);
    if (envLocal !== null) writeFileSync(join(remote, '.env.local'), envLocal);
    return run(['main', '--dir', remote], { dir, env: { SSH_EXEC: '1', ...env } });
  };

  const missing = attempt(null);
  assert.equal(missing.status, 14);
  assert.deepEqual(readdirSync(join(missing.dir, 'remote')), []);

  const bad = attempt(
    TEST_ENV_LOCAL.replace('TRAEFIK_NETWORK_EXTERNAL=true', 'TRAEFIK_NETWORK_EXTERNAL=false')
      .replace('NUVA_PUBLIC_PORT=\n', 'NUVA_PUBLIC_PORT=8080\n')
      .concat('COMPOSE_PROFILES=traefik\n'),
  );
  assert.equal(bad.status, 15);
  assert.match(bad.stderr, /PROBLEMA: TRAEFIK_NETWORK_EXTERNAL precisa ser 'true'/);
  assert.match(bad.stderr, /PROBLEMA: NUVA_PUBLIC_PORT/);
  assert.match(bad.stderr, /PROBLEMA: COMPOSE_PROFILES/);
  assert.ok(!bad.output.includes(SECRET));
  assert.equal(calls(bad, 'ssh').length, 1);
  assert.deepEqual(readdirSync(join(bad.dir, 'remote')), ['.env.local']);

  const foreign = attempt(TEST_ENV_LOCAL, { VOLUME_OWNER: 'outro-projeto' });
  assert.equal(foreign.status, 16);
  assert.match(foreign.stderr, /outro-projeto/);
  assert.equal(calls(foreign, 'ssh').length, 1);

  const own = attempt(TEST_ENV_LOCAL, { VOLUME_OWNER: 'nuva-edu' });
  assert.equal(own.status, 0, own.output);
});

// --- a configuração que o servidor resolveria ---------------------------------------------------

const hasCompose = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;

test('no servidor, o compose resolve hosts, rede externa, TLS e nenhuma porta publicada', {
  skip: hasCompose ? false : 'docker compose indisponível',
}, () => {
  // Só o que o script envia, mais o .env.local que o humano cria: sem código-fonte nenhum.
  const dir = mkdtempSync(join(tmpdir(), 'nuva-deploy-config-'));
  temps.push(dir);
  for (const file of deployFiles()) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(root, file), join(dir, file));
  }
  writeFileSync(join(dir, '.env.local'), TEST_ENV_LOCAL);
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(POSTGRES_|NUVA_|TRAEFIK_|SMTP_|COMPOSE_)/.test(name),
    ),
  );
  const result = spawnSync(
    'docker',
    [
      'compose',
      ...['-p', 'nuva-edu', '-f', 'docker-compose.yml'],
      ...['--env-file', '.env', '--env-file', '.env.local'],
      ...['config', '--format', 'json'],
    ],
    { cwd: dir, encoding: 'utf8', env: { ...clean, NUVA_IMAGE_TAG: 'sha-abc1234' } },
  );
  assert.equal(result.status, 0, result.stderr);
  const { services, networks } = JSON.parse(result.stdout);

  // Sem perfil: nem Traefik próprio nem Mailpit.
  assert.deepEqual(Object.keys(services).toSorted(), [
    'admin',
    'admin-api',
    'classroom',
    'classroom-api',
    'migrate',
    'postgres',
    'worker',
  ]);
  assert.equal(networks.public.name, 'network_public');
  assert.equal(networks.public.external, true);
  assert.equal(networks.internal.name, 'nuva-edu-internal');

  for (const [name, service] of Object.entries(services)) {
    assert.equal(service.ports, undefined, `${name} publica porta`);
    assert.equal(service.network_mode, undefined, `${name} usa network_mode`);
  }
  for (const app of ['admin-api', 'classroom-api', 'worker', 'admin', 'classroom']) {
    assert.equal(services[app].image, `tmsoftbrasil/nuva-edu-${app}:sha-abc1234`);
  }
  assert.equal(services.migrate.image, 'tmsoftbrasil/nuva-edu-admin-api:sha-abc1234');
  assert.deepEqual(Object.keys(services.worker.networks), ['internal']);
  assert.deepEqual(Object.keys(services.postgres.networks), ['internal']);

  const routers = {
    'admin-api': ['nuva-edu-admin-api', 'edu-admin.opencode.tmsoft.com.br'],
    admin: ['nuva-edu-admin', 'edu-admin.opencode.tmsoft.com.br'],
    'classroom-api': ['nuva-edu-classroom-api', 'classroom.opencode.tmsoft.com.br'],
    classroom: ['nuva-edu-classroom', 'classroom.opencode.tmsoft.com.br'],
  };
  for (const [name, [router, host]] of Object.entries(routers)) {
    const labels = services[name].labels;
    assert.equal(labels['traefik.enable'], 'true');
    assert.equal(labels['traefik.docker.network'], 'network_public');
    assert.ok(labels[`traefik.http.routers.${router}.rule`].startsWith(`Host(\`${host}\`)`));
    assert.equal(labels[`traefik.http.routers.${router}.entrypoints`], 'websecure');
    assert.equal(labels[`traefik.http.routers.${router}.tls.certresolver`], 'letsencrypt');
    assert.ok(Object.keys(services[name].networks).includes('public'));
  }
  const stream = 'traefik.http.routers.nuva-edu-classroom-stream';
  assert.equal(services['classroom-api'].labels[`${stream}.tls.certresolver`], 'letsencrypt');
  assert.equal(services['classroom-api'].labels[`${stream}.entrypoints`], 'websecure');

  // URLs públicas sem porta e em https, nos sites (config.json) e nos backends.
  for (const name of ['admin', 'classroom', 'admin-api', 'classroom-api', 'worker']) {
    assert.equal(services[name].environment.NUVA_PUBLIC_SCHEME, 'https', name);
    assert.equal(services[name].environment.NUVA_PUBLIC_PORT, '', name);
  }
});

// --- migração do volume do banco (spec 031, "Volumes") -------------------------------------------

function remoteRun(args, env = {}) {
  const dir = sandbox();
  const remote = join(dir, 'remote');
  mkdirSync(remote);
  writeFileSync(join(remote, '.env.local'), TEST_ENV_LOCAL);
  return run([...args, '--dir', remote], { dir, env: { SSH_EXEC: '1', ...env } });
}
const changed = (result) =>
  calls(result, 'docker').filter((line) => / (stop|run|volume rm) /.test(line));

test('o volume do banco vem do docker compose config local, não de nome fixo', () => {
  const result = run(['main', '--dry-run'], { env: { POSTGRES_VOLUME_NAME: 'qualquer-nome' } });
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /^Volume do banco: qualquer-nome$/m);
  assert.match(result.stdout, /^POSTGRES_VOLUME='qualquer-nome'$/m);
  assert.ok(
    calls(result, 'docker').includes(
      'docker compose -p nuva-edu -f docker-compose.yml --env-file .env config --no-interpolate',
    ),
  );
});

test('sem --migrate-volume e com migração necessária, para com a instrução e nada enviado', () => {
  const result = remoteRun(['sha-abc1234'], { VOLUMES: 'postgres-data=nuva-edu' });
  assert.equal(result.status, 19, result.output);
  assert.match(
    result.stderr,
    /PROBLEMA: é preciso copiar postgres-data para nuva-edu-postgres-data/,
  );
  assert.match(result.stderr, /pnpm deploy:test sha-abc1234 --migrate-volume/);
  assert.equal(calls(result, 'ssh').length, 1);
  assert.deepEqual(changed(result), []);
  assert.deepEqual(readdirSync(join(result.dir, 'remote')), ['.env.local']);
});

test('com --migrate-volume, copia antes do up, só do projeto, sem apagar o antigo', () => {
  const result = remoteRun(['sha-abc1234', '--migrate-volume'], {
    VOLUMES: 'postgres-data=nuva-edu',
  });
  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /migração de volume: postgres-data para nuva-edu-postgres-data/);
  const prefix =
    'docker compose -p nuva-edu -f docker-compose.yml --env-file .env --env-file .env.local';
  const docker = calls(result, 'docker');
  const pull = docker.findIndex((line) => line.startsWith(`${prefix} pull `));
  const stop = docker.indexOf(`${prefix} stop postgres`);
  const copy = docker.findIndex((line) => line.startsWith(`${prefix} run --rm --no-deps `));
  const up = docker.findIndex((line) => line.startsWith(`${prefix} up -d `));
  assert.ok(pull >= 0 && pull < stop && stop < copy && copy < up, docker.join('\n'));
  assert.equal(readFileSync(join(result.dir, 'volumes', 'postgres-data'), 'utf8'), 'nuva-edu');
  assert.equal(
    readFileSync(join(result.dir, 'volumes', 'nuva-edu-postgres-data'), 'utf8'),
    'nuva-edu',
  );
  assert.ok(!docker.some((line) => / volume rm /.test(line)));
  // O script de migração não é gravado no servidor.
  assert.ok(
    !readdirSync(join(result.dir, 'remote'), { recursive: true }).some((f) => f.endsWith('.sh')),
  );
});

test('com --migrate-volume e migração que falha, para com código de publicação', () => {
  const result = remoteRun(['sha-abc1234', '--migrate-volume'], {
    VOLUMES: 'postgres-data=nuva-edu',
    RUN_STATUS: '1',
  });
  assert.equal(result.status, 17, result.output);
  assert.match(
    result.stderr,
    /migração do volume postgres-data para nuva-edu-postgres-data falhou/,
  );
  assert.ok(!calls(result, 'docker').some((line) => / up -d /.test(line)));
  assert.equal(readFileSync(join(result.dir, 'volumes', 'postgres-data'), 'utf8'), 'nuva-edu');
  assert.deepEqual(calls(result, 'curl'), []);
});

test('sem migração necessária o deploy segue igual, com ou sem a opção', () => {
  for (const [env, label] of [
    [{ VOLUMES: 'postgres-data=outro-projeto' }, 'antigo de outro projeto'],
    [{ VOLUMES: 'postgres-data=nuva-edu nuva-edu-postgres-data=nuva-edu' }, 'novo já existe'],
    [{ VOLUMES: 'postgres-data=nuva-edu', POSTGRES_VOLUME_NAME: 'postgres-data' }, 'nome antigo'],
    [{}, 'sem volume'],
  ]) {
    for (const flag of [[], ['--migrate-volume']]) {
      const result = remoteRun(['sha-abc1234', ...flag], env);
      assert.equal(result.status, 0, `${label} ${flag}: ${result.output}`);
      assert.deepEqual(changed(result), [], `${label} ${flag}`);
    }
  }
});

test('só sites: o volume do banco não é conferido nem migrado', () => {
  const result = remoteRun(['sha-abc1234', '--only', 'admin,classroom'], {
    VOLUMES: 'postgres-data=nuva-edu',
  });
  assert.equal(result.status, 0, result.output);
  assert.deepEqual(changed(result), []);
});

test('--dry-run com --migrate-volume mostra a cópia; sem a opção, nada dela', () => {
  const plain = run(['main', '--dry-run']);
  assert.doesNotMatch(plain.stdout, /volume-migrate|stop postgres/);
  const result = run(['main', '--dry-run', '--migrate-volume']);
  assert.equal(result.status, 0, result.output);
  assert.match(
    result.stdout,
    /Com --migrate-volume: copia postgres-data para nuva-edu-postgres-data/,
  );
  assert.match(result.stdout, /bash -c "\$VOLUME_MIGRATE" volume-migrate --from 'postgres-data'/);
  assert.deepEqual(calls(result, 'ssh'), []);
});
