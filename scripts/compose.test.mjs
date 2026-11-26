// Confere o padrão dos contêineres (spec 031) lendo o `docker compose config`. Não sobe nada:
// só precisa do comando `docker compose`; sem ele, os testes são pulados.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { DEV_COMPOSE_FILES } from './dev.mjs';

const root = resolve(import.meta.dirname, '..');
const hasCompose = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
const skip = hasCompose ? false : 'docker compose indisponível';

const APPS = ['admin-api', 'classroom-api', 'worker', 'admin', 'classroom'];
const MB = 1024 * 1024;
const PROFILES = ['traefik', 'mailpit', 'oauth-mock'];

/** Segredos exigidos (spec 031, "Segredos exigidos"), com valores só do teste. */
const SECRETS = {
  POSTGRES_PASSWORD: 'senha-so-do-teste',
  SESSION_SECRET: 'segredo-de-sessao-so-do-teste-com-32-ou-mais',
  ADMIN_EMAIL: 'admin@escola.test',
  ADMIN_PASSWORD: 'senha-do-admin-so-do-teste',
};
const SECRET_NAMES = Object.keys(SECRETS);

/** Só o `.env` versionado, mais o que o teste definir: o `.env.local` da máquina não entra. */
function compose(env = {}, args = ['config', '--format', 'json']) {
  const clean = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !/^(POSTGRES_|NUVA_|TRAEFIK_|SMTP_|COMPOSE_|OAUTH_MOCK_|ADMIN_|SESSION_SECRET$)/.test(name),
    ),
  );
  return spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      '.env',
      ...PROFILES.flatMap((profile) => ['--profile', profile]),
      ...args,
    ],
    { cwd: root, encoding: 'utf8', env: { ...clean, ...env } },
  );
}

function config(env = {}) {
  const result = compose({ ...SECRETS, ...env });
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
  assert.match(text, /- path: scripts\/oauth-mock\/docker-compose\.yml/);
  for (const name of [...APPS, 'migrate', 'postgres', 'traefik', 'mailpit', 'oauth-mock']) {
    assert.ok(services[name], `serviço ${name} ausente`);
  }
});

test('sem cada segredo exigido o compose falha citando a variável e o .env.local', { skip }, () => {
  for (const name of SECRET_NAMES) {
    for (const value of [undefined, '']) {
      const env = { ...SECRETS };
      if (value === undefined) delete env[name];
      else env[name] = value;
      const result = compose(env);
      assert.notEqual(result.status, 0, `${name}=${value ?? '(ausente)'}`);
      assert.match(result.stderr, new RegExp(`defina ${name} em \\.env\\.local`), name);
    }
  }
});

test('as APIs recebem os segredos que exigem; os sites não recebem nenhum', { skip }, () => {
  // Pelo `environment`, que vale por cima do `env_file`. O worker e o migrate não os exigem, mas
  // podem recebê-los do `.env.local` da máquina pelo `env_file`: por isso não entram na conta.
  const { services } = config();
  for (const name of SECRET_NAMES) {
    assert.equal(services['admin-api'].environment[name], SECRETS[name], `admin-api: ${name}`);
  }
  assert.equal(services['classroom-api'].environment.SESSION_SECRET, SECRETS.SESSION_SECRET);
  for (const site of ['admin', 'classroom']) {
    assert.equal(services[site].env_file, undefined, `${site}: env_file`);
    for (const name of SECRET_NAMES) {
      assert.equal(services[site].environment?.[name], undefined, `${site}: ${name}`);
    }
  }
  // O texto dos composes: `${VAR:?}` só nos serviços da spec 031, "Segredos exigidos".
  const required = (file) =>
    [...readFileSync(resolve(root, file), 'utf8').matchAll(/\$\{(\w+):\?/g)].map((m) => m[1]);
  const count = (list, name) => list.filter((item) => item === name).length;
  const admin = required('apps/admin-api/docker-compose.yml');
  // migrate e admin-api exigem a senha do banco; só a admin-api, os da Fase 1.
  assert.equal(count(admin, 'POSTGRES_PASSWORD'), 2);
  for (const name of ['SESSION_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD']) {
    assert.equal(count(admin, name), 1, `admin-api: ${name}`);
  }
  assert.deepEqual(required('apps/classroom-api/docker-compose.yml').sort(), [
    'POSTGRES_PASSWORD',
    'SESSION_SECRET',
  ]);
  assert.deepEqual(required('apps/worker/docker-compose.yml'), ['POSTGRES_PASSWORD']);
  for (const site of ['admin', 'classroom']) {
    assert.deepEqual(required(`apps/${site}/docker-compose.yml`), [], site);
  }
});

test('o provedor simulado entra pelo perfil oauth-mock e fica desligado sem as variáveis', {
  skip,
}, () => {
  const { services } = config();
  assert.deepEqual(services['oauth-mock'].profiles, ['oauth-mock']);
  assert.equal(
    services['oauth-mock'].labels['traefik.http.routers.nuva-edu-oauth-mock.rule'],
    'Host(`oauth-mock.localhost`)',
  );
  // Sem NUVA_OAUTH_MOCK_URL (o `.env` versionado não a define), as APIs recebem vazio: desligado.
  assert.doesNotMatch(readFileSync(resolve(root, '.env'), 'utf8'), /^\s*NUVA_OAUTH_MOCK_/m);
  for (const api of ['admin-api', 'classroom-api']) {
    assert.equal(services[api].environment.NUVA_OAUTH_MOCK_URL, '', api);
    assert.equal(services[api].environment.NUVA_OAUTH_MOCK_INTERNAL_URL, '', api);
  }
  // Com as variáveis do `pnpm dev:up`, as duas APIs apontam para o simulador.
  const mock = config({
    NUVA_OAUTH_MOCK_URL: 'http://oauth-mock.localhost:8080',
    NUVA_OAUTH_MOCK_INTERNAL_URL: 'http://oauth-mock:8080',
  }).services;
  for (const api of ['admin-api', 'classroom-api']) {
    assert.equal(mock[api].environment.NUVA_OAUTH_MOCK_URL, 'http://oauth-mock.localhost:8080');
    assert.equal(mock[api].environment.NUVA_OAUTH_MOCK_INTERNAL_URL, 'http://oauth-mock:8080');
  }
  assert.equal(
    mock['oauth-mock'].environment.OAUTH_MOCK_PUBLIC_URL,
    'http://oauth-mock.localhost:8080',
  );
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
    worker: { memory: 640, nofile: 4096 },
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

test('worker: 640 MB por padrão e /tmp de 128 MB para o Chromium do certificado', { skip }, () => {
  // Variável vazia no ambiente: vale o padrão do compose, não o do .env.
  const { services } = config({ NUVA_WORKER_MEMORY: '' });
  assert.equal(Number(services.worker.deploy.resources.limits.memory), 640 * MB);
  assert.equal(services.worker.read_only, true);
  assert.deepEqual(services.worker.tmpfs, ['/run', '/tmp:size=128m']);
  // Só o worker abre um navegador; os demais seguem o tmpfs padrão.
  for (const name of ['admin-api', 'classroom-api']) {
    assert.deepEqual(services[name].tmpfs, ['/run', '/tmp'], name);
  }
});

test('postgres, traefik e mailpit seguem o padrão completo e os limites da spec', { skip }, () => {
  const { services } = config();
  const expected = {
    postgres: { memory: 1024, nofile: 65536 },
    traefik: { memory: 128, nofile: 65536 },
    mailpit: { memory: 64, nofile: 4096 },
  };
  for (const [name, want] of Object.entries(expected)) {
    const service = services[name];
    assert.equal(Number(service.deploy.resources.limits.memory), want.memory * MB, name);
    assert.equal(Number(service.deploy.resources.limits.cpus), 1, name);
    assert.deepEqual(service.ulimits.nofile, { soft: want.nofile, hard: want.nofile }, name);
    assert.deepEqual(service.cap_drop, ['ALL'], `${name}: cap_drop`);
    // Nenhum dos três precisa de capacidade de volta (provado na tarefa 053).
    assert.equal(service.cap_add, undefined, `${name}: cap_add`);
    assert.deepEqual(service.security_opt, ['no-new-privileges:true'], `${name}: security_opt`);
    assert.equal(service.restart, 'unless-stopped', `${name}: restart`);
    assert.ok(service.healthcheck?.test?.length > 0, `${name}: healthcheck`);
  }
  // Sem root, a entrada da imagem do Postgres não precisa de CHOWN nem de SETUID/SETGID; em troca,
  // o usuário tem de conseguir criar /run/postgresql no tmpfs.
  assert.equal(services.postgres.user, 'postgres');
  assert.ok(services.postgres.tmpfs.includes('/run:mode=1777'), 'postgres: /run gravável');
  assert.deepEqual(services.mailpit.healthcheck.test, ['CMD', '/mailpit', 'readyz']);
  // Portas publicadas: todas acima de 1024; o Mailpit só no próprio hospedeiro. O banco só publica
  // com o arquivo de desenvolvimento (teste próprio, abaixo).
  assert.equal(services.postgres.ports, undefined, 'postgres: não publica porta');
  for (const name of ['traefik', 'mailpit']) {
    for (const port of services[name].ports) {
      assert.ok(Number(port.published) > 1024, `${name}: porta ${port.published}`);
      assert.ok(Number(port.target) > 1024, `${name}: porta interna ${port.target}`);
      if (name !== 'traefik') {
        assert.equal(port.host_ip, '127.0.0.1', `${name}: só em 127.0.0.1`);
      }
    }
  }
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
  assert.equal(
    label('admin-api', 'admin-stream', 'rule'),
    'Host(`painel.escola.test`) && Path(`/api/v1/stream`)',
  );
  assert.equal(label('admin', 'admin', 'rule'), 'Host(`painel.escola.test`)');
  assert.equal(label('classroom', 'classroom', 'rule'), 'Host(`aulas.escola.test`)');

  // As APIs ganham dos sites, e o SSE ganha da API.
  assert.ok(
    Number(label('admin-api', 'admin-api', 'priority')) >
      Number(label('admin', 'admin', 'priority')),
  );
  for (const [service, stream, api] of [
    ['admin-api', 'admin-stream', 'admin-api'],
    ['classroom-api', 'classroom-stream', 'classroom-api'],
  ]) {
    assert.equal(label(service, stream, 'priority'), '30', stream);
    assert.ok(
      Number(label(service, stream, 'priority')) > Number(label(service, api, 'priority')),
      `${stream} ganha de ${api}`,
    );
  }

  for (const [service, router] of [
    ['admin-api', 'admin-api'],
    ['admin-api', 'admin-stream'],
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

test('os dois fluxos SSE têm roteador próprio, sem middleware, compressão ou buffer', {
  skip,
}, () => {
  const { services } = config({
    NUVA_ADMIN_HOST: 'painel.escola.test',
    NUVA_CLASSROOM_HOST: 'aulas.escola.test',
  });
  const routers = [
    ...new Set(
      Object.values(services).flatMap((service) =>
        Object.keys(service.labels ?? {})
          .map((key) => /^traefik\.http\.routers\.(nuva-edu-[\w-]+)\./.exec(key)?.[1])
          .filter(Boolean),
      ),
    ),
  ].sort();
  assert.deepEqual(routers, [
    'nuva-edu-admin',
    'nuva-edu-admin-api',
    'nuva-edu-admin-stream',
    'nuva-edu-classroom',
    'nuva-edu-classroom-api',
    'nuva-edu-classroom-stream',
    'nuva-edu-oauth-mock',
  ]);

  for (const [service, name, host] of [
    ['admin-api', 'nuva-edu-admin-stream', 'painel.escola.test'],
    ['classroom-api', 'nuva-edu-classroom-stream', 'aulas.escola.test'],
  ]) {
    const labels = services[service].labels;
    const prefix = `traefik.http.routers.${name}`;
    // Regra exata: um host e um caminho, sem `PathPrefix` e sem pegar outras rotas da API.
    assert.equal(labels[`${prefix}.rule`], `Host(\`${host}\`) && Path(\`/api/v1/stream\`)`, name);
    assert.equal(labels[`${prefix}.priority`], '30', name);
    assert.equal(labels[`${prefix}.service`], `nuva-edu-${service}`, name);
    // Nada de middleware no fluxo: nem `compress`, nem `buffering`, nem limite, nem cabeçalho.
    // É a regra da spec 031 para quem acrescentar middleware aos roteadores das APIs.
    assert.deepEqual(
      Object.keys(labels)
        .filter((key) => key.startsWith(`${prefix}.`))
        .sort(),
      ['entrypoints', 'priority', 'rule', 'service'].map((key) => `${prefix}.${key}`),
      name,
    );
  }

  // Hoje nenhum roteador tem middleware nem tempo próprio; o fluxo fica de fora quando houver.
  for (const [service, value] of Object.entries(services)) {
    for (const key of Object.keys(value.labels ?? {})) {
      assert.doesNotMatch(key, /\.middlewares$|timeout/i, `${service}: ${key}`);
    }
  }
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
    'traefik.http.routers.nuva-edu-admin-stream.tls.certresolver',
    'traefik.http.routers.nuva-edu-admin.tls.certresolver',
    'traefik.http.routers.nuva-edu-classroom-api.tls.certresolver',
    'traefik.http.routers.nuva-edu-classroom-stream.tls.certresolver',
    'traefik.http.routers.nuva-edu-classroom.tls.certresolver',
    'traefik.http.routers.nuva-edu-oauth-mock.tls.certresolver',
  ]);
  assert.ok(withTls.every(([, value]) => value === 'letsencrypt'));
});

test('com Traefik externo, as aplicações entram na rede dele e não publicam porta', {
  skip,
}, () => {
  const result = compose(
    {
      ...SECRETS,
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
  const { services } = config({
    NUVA_ADMIN_HOST: 'painel.escola.test',
    // Segredos presentes na interpolação não podem chegar aos sites.
    SESSION_SECRET: 'segredo-so-do-teste',
    ADMIN_PASSWORD: 'segredo-so-do-teste',
    SMTP_PASSWORD: 'segredo-so-do-teste',
  });
  for (const site of ['admin', 'classroom']) {
    const environment = services[site].environment;
    assert.deepEqual(Object.keys(environment).sort(), [
      'NUVA_ADMIN_HOST',
      'NUVA_CLASSROOM_HOST',
      'NUVA_PUBLIC_PORT',
      'NUVA_PUBLIC_SCHEME',
    ]);
    assert.equal(environment.NUVA_ADMIN_HOST, 'painel.escola.test');
    assert.equal(services[site].env_file, undefined, `${site}: env_file`);
    assert.equal(environment.POSTGRES_PASSWORD, undefined, `${site}: POSTGRES_PASSWORD`);
    assert.doesNotMatch(JSON.stringify(services[site]), /so-do-teste/, `${site}: segredo`);
    assert.deepEqual(
      Object.keys(services[site].networks),
      ['public'],
      `${site}: só a rede do proxy`,
    );
    assert.match(
      services[site].healthcheck.test.join(' '),
      /127\.0\.0\.1:8080\/config\.json/,
      site,
    );
  }
});

// Spec 031, "Padrão dos hosts": a mesma expressão nos rótulos do Traefik e no ambiente dos sites.
function hosts(env) {
  const { services } = config(env);
  const rule = (service, router) =>
    services[service].labels[`traefik.http.routers.nuva-edu-${router}.rule`].match(
      /^Host\(`([^`]*)`\)/,
    )[1];
  const admin = new Set([
    rule('admin', 'admin'),
    rule('admin-api', 'admin-api'),
    services.admin.environment.NUVA_ADMIN_HOST,
    services.classroom.environment.NUVA_ADMIN_HOST,
  ]);
  const classroom = new Set([
    rule('classroom', 'classroom'),
    rule('classroom-api', 'classroom-api'),
    rule('classroom-api', 'classroom-stream'),
    services.admin.environment.NUVA_CLASSROOM_HOST,
    services.classroom.environment.NUVA_CLASSROOM_HOST,
  ]);
  assert.equal(admin.size, 1, `host do admin diverge: ${[...admin].join(', ')}`);
  assert.equal(classroom.size, 1, `host do classroom diverge: ${[...classroom].join(', ')}`);
  return { admin: [...admin][0], classroom: [...classroom][0] };
}

test('os hosts dos sites derivam de NUVA_DOMAIN quando não são informados', { skip }, () => {
  // Com o `.env` versionado (NUVA_DOMAIN=localhost e nenhum host fixo).
  assert.deepEqual(hosts(), { admin: 'edu-admin.localhost', classroom: 'classroom.localhost' });
  assert.deepEqual(hosts({ NUVA_DOMAIN: 'escola.test' }), {
    admin: 'edu-admin.escola.test',
    classroom: 'classroom.escola.test',
  });
  // Vazio vale como ausente, nos dois níveis da interpolação.
  assert.deepEqual(hosts({ NUVA_DOMAIN: '', NUVA_ADMIN_HOST: '', NUVA_CLASSROOM_HOST: '' }), {
    admin: 'edu-admin.localhost',
    classroom: 'classroom.localhost',
  });
  // Host explícito ganha do domínio; o outro continua derivado.
  assert.deepEqual(hosts({ NUVA_DOMAIN: 'escola.test', NUVA_ADMIN_HOST: 'painel.outra.test' }), {
    admin: 'painel.outra.test',
    classroom: 'classroom.escola.test',
  });
});

test('o .env versionado não fixa os hosts: o padrão vem de NUVA_DOMAIN', () => {
  // As APIs e o worker leem o `.env` por `env_file`; um host fixo ali ganharia do NUVA_DOMAIN
  // definido no `.env.local` e separaria as URLs das APIs do roteamento do proxy.
  const text = readFileSync(resolve(root, '.env'), 'utf8');
  assert.match(text, /^NUVA_DOMAIN=localhost$/m);
  assert.doesNotMatch(text, /^\s*NUVA_(ADMIN|CLASSROOM)_HOST=/m);
});

const published = (services) =>
  Object.entries(services)
    .filter(([, service]) => service.ports?.length > 0)
    .map(([name]) => name)
    .sort();

test('sem o arquivo de desenvolvimento, o Postgres não publica porta', { skip }, () => {
  // Com os perfis do desenvolvimento, só o proxy e a tela do Mailpit publicam (o simulador entra
  // pelo proxy).
  assert.deepEqual(published(config().services), ['mailpit', 'traefik']);
  // Como no servidor de testes: sem perfil, com o Traefik que já existe lá.
  const result = spawnSync(
    'docker',
    ['compose', '--env-file', '.env', 'config', '--format', 'json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...SECRETS,
        TRAEFIK_NETWORK: 'network_public',
        TRAEFIK_NETWORK_EXTERNAL: 'true',
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(published(JSON.parse(result.stdout).services), []);
});

test('com o docker-compose.dev.yml, o Postgres publica só em 127.0.0.1', { skip }, () => {
  const result = compose({ ...SECRETS, NUVA_POSTGRES_PORT: '54329' }, [
    ...DEV_COMPOSE_FILES.flatMap((file) => ['-f', file]),
    'config',
    '--format',
    'json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const { name, services } = JSON.parse(result.stdout);
  assert.equal(name, 'nuva-edu');
  assert.deepEqual(published(services), ['mailpit', 'postgres', 'traefik']);
  assert.equal(services.postgres.ports.length, 1);
  const [port] = services.postgres.ports;
  assert.equal(port.host_ip, '127.0.0.1');
  assert.equal(port.published, '54329');
  assert.equal(port.target, 5432);
  // O arquivo de desenvolvimento só acrescenta a porta do banco.
  const text = readFileSync(resolve(root, 'docker-compose.dev.yml'), 'utf8');
  const keys = [...text.matchAll(/^ {0,4}([a-z][\w-]*):/gm)].map((match) => match[1]);
  assert.deepEqual(keys, ['services', 'postgres', 'ports']);
});

test('nenhum serviço recebe PORT no environment', { skip }, () => {
  // PORT fica fora do Compose (spec 031): a porta interna é fixa, e o healthcheck e o proxy contam
  // com ela. Vale também com a variável presente na interpolação.
  for (const env of [{}, { PORT: '3001' }]) {
    for (const [name, service] of Object.entries(config(env).services)) {
      assert.equal(service.environment?.PORT, undefined, `${name}: PORT no environment`);
    }
  }
});

test('volumes nomeados com o prefixo do projeto; o do banco é o que a migração lê', {
  skip,
}, () => {
  const { name, services, volumes } = config();
  assert.equal(name, 'nuva-edu');
  // O nome do volume do banco vem do config (a tarefa 135 o troca) e é o mesmo que o
  // scripts/volume-migrate.sh e o deploy:test leem.
  const mount = services.postgres.volumes.find((item) => item.target === '/var/lib/postgresql');
  assert.equal(mount?.type, 'volume');
  const postgresVolume = volumes[mount.source].name;
  const printed = spawnSync(
    'bash',
    [
      'scripts/volume-migrate.sh',
      '--print-name',
      '--no-interpolate',
      '--',
      ...['-p', 'nuva-edu', '-f', 'docker-compose.yml', '--env-file', '.env'],
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(printed.stdout.trim(), postgresVolume);
  // Todo volume tem nome fixo com o prefixo do projeto (spec 031, "Volumes"); o nome antigo do
  // banco (`postgres-data`) não é mais aceito desde a migração da tarefa 135.
  for (const [key, volume] of Object.entries(volumes)) {
    assert.match(volume.name, /^nuva-edu-/, `volume ${key}: ${volume.name}`);
  }
  assert.equal(postgresVolume, 'nuva-edu-postgres-data');
  assert.equal(volumes.traefik_letsencrypt.name, 'nuva-edu-traefik-acme');
});
