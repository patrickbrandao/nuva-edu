// Confere o serviço `oauth-mock` contra o padrão de contêiner da spec 031, pelo `docker compose
// config` (não sobe nada). Enquanto a raiz não o inclui (tarefa 157), um compose temporário o
// inclui com as duas redes. Sem `docker compose`, os testes são pulados.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const file = resolve(import.meta.dirname, 'docker-compose.yml');
const hasCompose = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;
const skip = hasCompose ? false : 'docker compose indisponível';
const MB = 1024 * 1024;

function config(env = {}, profiles = ['oauth-mock']) {
  const dir = mkdtempSync(join(tmpdir(), 'oauth-mock-compose-'));
  try {
    const root = join(dir, 'docker-compose.yml');
    writeFileSync(
      root,
      `name: oauth-mock-test\ninclude:\n  - path: ${JSON.stringify(file)}\nnetworks:\n  internal: {}\n  public: {}\n`,
    );
    const clean = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) => !/^(NUVA_|TRAEFIK_|OAUTH_MOCK_|COMPOSE_)/.test(name),
      ),
    );
    const result = spawnSync(
      'docker',
      [
        'compose',
        '-f',
        root,
        ...profiles.flatMap((p) => ['--profile', p]),
        'config',
        '--format',
        'json',
      ],
      { encoding: 'utf8', env: { ...clean, ...env } },
    );
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).services;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('oauth-mock segue o padrão de contêiner da spec 031', { skip }, () => {
  const service = config()['oauth-mock'];
  assert.equal(service.image, 'node:26-slim');
  assert.deepEqual(service.profiles, ['oauth-mock']);
  assert.equal(service.read_only, true);
  assert.deepEqual(service.tmpfs, ['/run', '/tmp']);
  assert.equal(Number(service.deploy.resources.limits.cpus), 1);
  assert.equal(Number(service.deploy.resources.limits.memory), 64 * MB);
  assert.deepEqual(service.ulimits.nofile, { soft: 4096, hard: 4096 });
  assert.deepEqual(service.cap_drop, ['ALL']);
  assert.deepEqual(service.security_opt, ['no-new-privileges:true']);
  assert.equal(service.user, 'node');
  assert.equal(service.restart, 'unless-stopped');
  assert.equal(service.ports, undefined, 'não publica porta: entra pelo proxy');
  assert.equal(service.environment.PORT, undefined, 'PORT fica fora do Compose');
  assert.match(service.healthcheck.test.join(' '), /127\.0\.0\.1:8080\/healthz/);
  assert.equal(service.logging.driver, 'json-file');
  assert.ok(service.logging.options['max-size']);
  assert.deepEqual(Object.keys(service.networks).sort(), ['internal', 'public']);
  // Só o servidor, montado só para leitura.
  assert.deepEqual(
    service.volumes.map((volume) => [volume.type, volume.target, volume.read_only]),
    [['bind', '/app/server.mjs', true]],
  );
  assert.equal(
    service.labels['traefik.http.services.nuva-edu-oauth-mock.loadbalancer.server.port'],
    '8080',
  );
});

test('fora do perfil oauth-mock o serviço não existe', { skip }, () => {
  assert.equal(config({}, [])['oauth-mock'], undefined);
});

test('emissor e host derivam de NUVA_OAUTH_MOCK_URL e NUVA_DOMAIN', { skip }, () => {
  const rule = (services) =>
    services['oauth-mock'].labels['traefik.http.routers.nuva-edu-oauth-mock.rule'];
  const local = config();
  assert.equal(
    local['oauth-mock'].environment.OAUTH_MOCK_PUBLIC_URL,
    'http://oauth-mock.localhost:8080',
  );
  assert.equal(rule(local), 'Host(`oauth-mock.localhost`)');

  const custom = config({
    NUVA_DOMAIN: 'escola.test',
    NUVA_OAUTH_MOCK_URL: 'https://oauth-mock.escola.test',
    NUVA_OAUTH_MOCK_MEMORY: '96m',
    TRAEFIK_CERTRESOLVER: 'letsencrypt',
  });
  const service = custom['oauth-mock'];
  assert.equal(service.environment.OAUTH_MOCK_PUBLIC_URL, 'https://oauth-mock.escola.test');
  assert.equal(rule(custom), 'Host(`oauth-mock.escola.test`)');
  assert.equal(Number(service.deploy.resources.limits.memory), 96 * MB);
  assert.equal(
    service.labels['traefik.http.routers.nuva-edu-oauth-mock.tls.certresolver'],
    'letsencrypt',
  );
});
