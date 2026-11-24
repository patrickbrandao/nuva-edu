// Confere o padrão dos contêineres (spec 031) lendo o `docker compose config`. Não sobe nada:
// só precisa do comando `docker compose`; sem ele, os testes são pulados.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const hasCompose = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
const skip = hasCompose ? false : 'docker compose indisponível';

const APPS = ['admin-api', 'classroom-api', 'worker', 'admin', 'classroom'];
const MB = 1024 * 1024;

/** Só o `.env` versionado, mais o que o teste definir: o `.env.local` da máquina não entra. */
function compose(env = {}, args = ['config', '--format', 'json']) {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(POSTGRES_|NUVA_|TRAEFIK_|SMTP_|COMPOSE_)/.test(name),
    ),
  );
  return spawnSync(
    'docker',
    ['compose', '--env-file', '.env', '--profile', 'traefik', '--profile', 'mailpit', ...args],
    { cwd: root, encoding: 'utf8', env: { ...clean, ...env } },
  );
}

function config(env = {}) {
  const result = compose({ POSTGRES_PASSWORD: 'senha-so-do-teste', ...env });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('o compose da raiz só inclui os composes de cada sistema', { skip }, () => {
  const text = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8');
  const keys = [...text.matchAll(/^([a-z][\w-]*):/gm)].map((match) => match[1]);
  assert.deepEqual(keys, ['name', 'include', 'networks']);
  for (const app of APPS) {
    assert.match(text, new RegExp(`- path: apps/${app}/docker-compose\\.yml`));
  }
  const { services } = config();
  for (const name of [...APPS, 'migrate', 'postgres', 'traefik', 'mailpit']) {
    assert.ok(services[name], `serviço ${name} ausente`);
  }
});

test('sem POSTGRES_PASSWORD o compose falha citando a variável', { skip }, () => {
  const result = compose();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /POSTGRES_PASSWORD/);
});

test('todo contêiner tem raiz somente leitura, tmpfs, limites, nofile e rotação de log', {
  skip,
}, () => {
  for (const [name, service] of Object.entries(config().services)) {
    assert.equal(service.read_only, true, `${name}: read_only`);
    // Uma entrada pode trazer opções de montagem: `/run:uid=101,gid=101`.
    const mounts = (service.tmpfs ?? []).map((entry) => entry.split(':')[0]);
    assert.ok(mounts.includes('/run'), `${name}: /run em tmpfs`);
    assert.ok(mounts.includes('/tmp'), `${name}: /tmp em tmpfs`);
    const limits = service.deploy?.resources?.limits ?? {};
    assert.ok(Number(limits.cpus) > 0, `${name}: limite de CPU`);
    assert.ok(Number(limits.memory) > 0, `${name}: limite de memória`);
    assert.ok(service.ulimits?.nofile?.hard >= 4096, `${name}: ulimits.nofile`);
    assert.equal(service.logging?.driver, 'json-file', `${name}: driver de log`);
    assert.ok(service.logging?.options?.['max-size'], `${name}: max-size do log`);
  }
});

test('as aplicações seguem o padrão completo e os limites da spec', { skip }, () => {
  const { services } = config();
  const expected = {
    migrate: { memory: 256, nofile: 4096 },
    'admin-api': { memory: 384, nofile: 65536 },
    'classroom-api': { memory: 512, nofile: 65536 },
    worker: { memory: 384, nofile: 4096 },
    admin: { memory: 64, nofile: 4096 },
    classroom: { memory: 64, nofile: 4096 },
  };
  for (const [name, want] of Object.entries(expected)) {
    const service = services[name];
    assert.equal(Number(service.deploy.resources.limits.memory), want.memory * MB, name);
    assert.equal(Number(service.deploy.resources.limits.cpus), 1, name);
    assert.deepEqual(service.ulimits.nofile, { soft: want.nofile, hard: want.nofile }, name);
    assert.deepEqual(service.cap_drop, ['ALL'], `${name}: cap_drop`);
    assert.deepEqual(service.security_opt, ['no-new-privileges:true'], `${name}: security_opt`);
    assert.equal(service.ports, undefined, `${name}: não publica porta`);
    if (name === 'migrate') {
      assert.equal(service.restart, 'no');
    } else {
      assert.equal(service.restart, 'unless-stopped', `${name}: restart`);
      assert.ok(service.healthcheck?.test?.length > 0, `${name}: healthcheck`);
    }
  }
  // RNF-02: o perfil padrão cabe em 3 GB.
  const total = ['postgres', ...Object.keys(expected)]
    .map((name) => Number(services[name].deploy.resources.limits.memory))
    .reduce((sum, value) => sum + value, 0);
  assert.ok(total <= 3 * 1024 * MB, `soma dos limites de memória: ${total / MB} MB`);
});

test('migrations rodam até o fim antes das APIs e do worker', { skip }, () => {
  const { services } = config();
  assert.equal(services.migrate.image, services['admin-api'].image);
  assert.deepEqual(services.migrate.command.slice(-2), ['/app/database/postgres/src/cli.ts', 'up']);
  assert.equal(services.migrate.depends_on.postgres.condition, 'service_healthy');
  for (const name of ['admin-api', 'classroom-api', 'worker']) {
    const depends = services[name].depends_on;
    assert.equal(depends.migrate.condition, 'service_completed_successfully', name);
    assert.equal(depends.postgres.condition, 'service_healthy', name);
    // Dentro da rede do Compose o banco é postgres:5432, seja qual for a porta do hospedeiro.
    assert.equal(services[name].environment.POSTGRES_HOST, 'postgres', name);
    assert.equal(services[name].environment.NUVA_POSTGRES_PORT, '5432', name);
    // A porta interna é sempre 3000: PORT não é definida no Compose (spec 031).
    assert.equal(services[name].environment.PORT, undefined, name);
    const port = `traefik.http.services.nuva-edu-${name}.loadbalancer.server.port`;
    assert.equal(services[name].labels?.[port] ?? '3000', '3000', name);
    assert.match(services[name].healthcheck.test.join(' '), /127\.0\.0\.1:3000\/healthz/, name);
  }
  assert.ok(Number.parseInt(services.worker.stop_grace_period, 10) > 30, 'worker: mais de 30 s');
});

test('o proxy entrega /api, /mcp e /healthz às APIs e o resto aos sites', { skip }, () => {
  const { services } = config({
    NUVA_ADMIN_HOST: 'painel.escola.test',
    NUVA_CLASSROOM_HOST: 'aulas.escola.test',
    TRAEFIK_ENTRYPOINTS: 'websecure',
  });
  const label = (service, router, key) =>
    services[service].labels[`traefik.http.routers.nuva-edu-${router}.${key}`];

  assert.equal(
    label('admin-api', 'admin-api', 'rule'),
    'Host(`painel.escola.test`) && (PathPrefix(`/api/`) || PathPrefix(`/mcp`) || Path(`/healthz`))',
  );
  assert.equal(
    label('classroom-api', 'classroom-api', 'rule'),
    'Host(`aulas.escola.test`) && (PathPrefix(`/api/`) || Path(`/healthz`))',
  );
  assert.equal(
    label('classroom-api', 'classroom-stream', 'rule'),
    'Host(`aulas.escola.test`) && Path(`/api/v1/stream`)',
  );
  assert.equal(label('admin', 'admin', 'rule'), 'Host(`painel.escola.test`)');
  assert.equal(label('classroom', 'classroom', 'rule'), 'Host(`aulas.escola.test`)');

  // As APIs ganham dos sites, e o SSE ganha da API.
  assert.ok(
    Number(label('admin-api', 'admin-api', 'priority')) >
      Number(label('admin', 'admin', 'priority')),
  );
  assert.ok(
    Number(label('classroom-api', 'classroom-stream', 'priority')) >
      Number(label('classroom-api', 'classroom-api', 'priority')),
  );

  for (const [service, router] of [
    ['admin-api', 'admin-api'],
    ['classroom-api', 'classroom-api'],
    ['classroom-api', 'classroom-stream'],
    ['admin', 'admin'],
    ['classroom', 'classroom'],
  ]) {
    assert.equal(label(service, router, 'entrypoints'), 'websecure', router);
    assert.equal(services[service].labels['traefik.enable'], 'true');
    assert.ok('public' in services[service].networks, `${service}: rede do proxy`);
  }
  // Nenhuma regra cita as sondas internas; o worker nem entra na rede do proxy.
  const rules = Object.values(services).flatMap((service) =>
    Object.entries(service.labels ?? {}).filter(([key]) => key.endsWith('.rule')),
  );
  for (const [key, rule] of rules) {
    assert.doesNotMatch(rule, /metrics|readyz/, key);
  }
  assert.deepEqual(Object.keys(services.worker.networks), ['internal']);
  assert.equal(services.worker.labels, undefined);
});

test('rótulos de TLS só existem com TRAEFIK_CERTRESOLVER preenchido', { skip }, () => {
  const tlsLabels = (services) =>
    Object.values(services).flatMap((service) =>
      Object.entries(service.labels ?? {}).filter(([key]) => /^traefik\..*\.tls/.test(key)),
    );

  assert.deepEqual(tlsLabels(config().services), []);

  const withTls = tlsLabels(config({ TRAEFIK_CERTRESOLVER: 'letsencrypt' }).services);
  assert.deepEqual(withTls.map(([key]) => key).sort(), [
    'traefik.http.routers.nuva-edu-admin-api.tls.certresolver',
    'traefik.http.routers.nuva-edu-admin.tls.certresolver',
    'traefik.http.routers.nuva-edu-classroom-api.tls.certresolver',
    'traefik.http.routers.nuva-edu-classroom-stream.tls.certresolver',
    'traefik.http.routers.nuva-edu-classroom.tls.certresolver',
  ]);
  assert.ok(withTls.every(([, value]) => value === 'letsencrypt'));
});

test('com Traefik externo, as aplicações entram na rede dele e não publicam porta', {
  skip,
}, () => {
  const result = compose(
    {
      POSTGRES_PASSWORD: 'senha-so-do-teste',
      TRAEFIK_NETWORK: 'network_public',
      TRAEFIK_NETWORK_EXTERNAL: 'true',
    },
    ['config', '--format', 'json'],
  );
  assert.equal(result.status, 0, result.stderr);
  const { services, networks } = JSON.parse(result.stdout);
  assert.equal(networks.public.name, 'network_public');
  assert.equal(networks.public.external, true);
  for (const app of APPS) {
    assert.equal(services[app].ports, undefined, app);
  }
  for (const app of ['admin-api', 'classroom-api', 'admin', 'classroom']) {
    assert.equal(services[app].labels['traefik.docker.network'], 'network_public', app);
  }
});

test('os sites recebem só as variáveis do config.json, sem segredo algum', { skip }, () => {
  const { services } = config({ NUVA_ADMIN_HOST: 'painel.escola.test' });
  for (const site of ['admin', 'classroom']) {
    assert.deepEqual(Object.keys(services[site].environment).sort(), [
      'NUVA_ADMIN_HOST',
      'NUVA_CLASSROOM_HOST',
      'NUVA_CURRENCY',
      'NUVA_DOMAIN',
      'NUVA_LOCALE',
      'NUVA_PUBLIC_PORT',
      'NUVA_PUBLIC_SCHEME',
    ]);
    assert.equal(services[site].environment.NUVA_ADMIN_HOST, 'painel.escola.test');
    assert.equal(services[site].env_file, undefined);
  }
});
