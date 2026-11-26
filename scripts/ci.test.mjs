// Confere o essencial dos fluxos do GitHub Actions (specs 031, "Publicação de imagens", e 032,
// "CI") lendo os YAML: gatilhos, ordem verify → imagens, imagens e plataformas, ações fixadas
// por SHA, segredos e NUVA_VERSION. Não substitui o `actionlint` nem a execução real.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';

const root = resolve(import.meta.dirname, '..');
const workflowsDir = resolve(root, '.github', 'workflows');

const read = (path) => readFileSync(resolve(root, path), 'utf8');
const load = (path) => parse(read(path));
const workflowFiles = readdirSync(workflowsDir).filter((file) => /\.ya?ml$/.test(file));
const workflows = Object.fromEntries(
  workflowFiles.map((file) => [file, load(`.github/workflows/${file}`)]),
);

const APPS = ['admin-api', 'classroom-api', 'worker', 'admin', 'classroom'];
const BACKENDS = ['admin-api', 'classroom-api', 'worker'];
// Abre uma expressão do Actions, montada em partes para o lint não a tomar por template.
const OPEN = '$' + '{{';
const SECRETS = ['DOCKERHUB_USERNAME', 'DOCKERHUB_TOKEN'];

const verify = workflows['verify.yml'];
const images = workflows['images.yml'];
const release = workflows['release.yml'];
const security = workflows['security.yml'];

/** Todos os passos de um fluxo, com o nome do job. */
function stepsOf(workflow) {
  return Object.entries(workflow.jobs).flatMap(([job, definition]) =>
    (definition.steps ?? []).map((step) => ({ job, ...step })),
  );
}

const runText = (workflow) =>
  stepsOf(workflow)
    .map((step) => step.run ?? '')
    .join('\n');

test('os quatro fluxos existem e têm o nome da spec', () => {
  assert.deepEqual(workflowFiles.sort(), [
    'images.yml',
    'release.yml',
    'security.yml',
    'verify.yml',
  ]);
  for (const [file, workflow] of Object.entries(workflows)) {
    assert.equal(`${workflow.name}.yml`, file);
  }
});

test('toda ação é fixada por SHA de commit, com a versão no comentário', () => {
  let count = 0;
  for (const file of workflowFiles) {
    for (const line of read(`.github/workflows/${file}`).split('\n')) {
      const match = line.match(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/);
      if (!match) {
        continue;
      }
      const [, target, rest] = match;
      if (target.startsWith('./')) {
        continue;
      }
      count += 1;
      assert.match(target, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${file}: ${target} sem SHA`);
      assert.match(rest, /^\s+# v\d+\.\d+\.\d+$/, `${file}: ${target} sem a versão no comentário`);
    }
  }
  assert.ok(count >= 15, `só ${count} usos de ação encontrados`);
});

test('permissões mínimas: nada no topo, cada job declara as suas, escrita só no CodeQL', () => {
  for (const [file, workflow] of Object.entries(workflows)) {
    assert.deepEqual(workflow.permissions, {}, `${file}: permissões no topo`);
    for (const [name, job] of Object.entries(workflow.jobs)) {
      assert.ok(job.permissions, `${file}/${name}: sem permissions`);
      for (const [scope, level] of Object.entries(job.permissions)) {
        const expected = file === 'security.yml' && scope === 'security-events' ? 'write' : 'read';
        assert.equal(level, expected, `${file}/${name}: ${scope}: ${level}`);
      }
    }
  }
});

test('concurrency por ref em todos os fluxos; verify e security cancelam a execução antiga', () => {
  for (const [file, workflow] of Object.entries(workflows)) {
    assert.match(workflow.concurrency.group, /\$\{\{.*github\.ref.*\}\}/, file);
  }
  assert.equal(verify.concurrency['cancel-in-progress'], true);
  assert.equal(security.concurrency['cancel-in-progress'], true);
  // Tag não é cancelada: publicação de release pela metade não pode acontecer.
  assert.equal(release.concurrency['cancel-in-progress'], false);
  assert.match(String(images.concurrency['cancel-in-progress']), /workflow_run/);
});

test('verify: push na main, PR e chamada pelo release; sem segredo nenhum', () => {
  assert.deepEqual(Object.keys(verify.on).sort(), ['pull_request', 'push', 'workflow_call']);
  assert.deepEqual(verify.on.push, { branches: ['main'] });
  assert.ok(!('pull_request_target' in verify.on));
  assert.doesNotMatch(read('.github/workflows/verify.yml'), /\$\{\{\s*secrets\./);
});

test('verify: Node 26, pnpm do packageManager, Chromium, .env.local e verify:full --e2e', () => {
  const steps = verify.jobs.verify.steps;
  const uses = steps.map((step) => step.uses ?? '');
  const pnpm = uses.findIndex((name) => name.startsWith('pnpm/action-setup@'));
  const node = uses.findIndex((name) => name.startsWith('actions/setup-node@'));
  assert.ok(pnpm >= 0 && node > pnpm, 'o pnpm vem antes do setup-node (cache)');
  // Sem `version`: a ação lê o "packageManager" do package.json.
  assert.equal(steps[pnpm].with?.version, undefined);
  assert.match(load('package.json').packageManager, /^pnpm@12\.23\./);
  assert.equal(String(steps[node].with['node-version']), '26');
  assert.equal(steps[node].with.cache, 'pnpm');

  const run = steps.map((step) => step.run ?? '');
  const index = (pattern) => run.findIndex((text) => pattern.test(text));
  const install = index(/pnpm install --frozen-lockfile/);
  const chromium = index(/playwright install --with-deps chromium/);
  const env = index(/POSTGRES_PASSWORD=.*> \.env\.local/s);
  const full = index(/^pnpm verify:full --e2e$/);
  assert.ok(install >= 0 && chromium > install && env >= 0 && full > chromium && full > env);
  // Os segredos exigidos pelo Compose (spec 031, "Segredos exigidos") são sorteados na hora e
  // não vão para o log; nenhum vem dos segredos do GitHub.
  for (const name of ['POSTGRES_PASSWORD', 'SESSION_SECRET', 'ADMIN_PASSWORD']) {
    assert.match(run[env], new RegExp(`'${name}=%s\\\\n' "\\$\\(openssl rand `), name);
  }
  assert.match(run[env], /'ADMIN_EMAIL=admin-%s@example\.com\\n' "\$\(openssl rand /);
  assert.doesNotMatch(run[env], /echo|cat \.env\.local/);
  // O e2e sobe o provedor OAuth simulado (perfil oauth-mock do `pnpm dev:up`).
  assert.ok(
    run.some((text) => /oauth-mock\.localhost.*\/etc\/hosts/.test(text)),
    'oauth-mock.localhost no /etc/hosts',
  );
  assert.ok(verify.jobs.verify['timeout-minutes'] <= 30);
});

test('browsers:worker instala só o headless shell, na versão do @playwright/test do e2e', () => {
  const script = load('package.json').scripts['browsers:worker'];
  assert.equal(script, 'pnpm --filter @nuva-edu/e2e exec playwright install --only-shell chromium');
  // Na máquina do desenvolvedor não instala pacotes do sistema (pediria sudo).
  assert.doesNotMatch(script, /--with-deps/);
});

test('verify: headless shell do worker com cache por versão, antes do verify:full', () => {
  const steps = verify.jobs.verify.steps;
  const run = steps.map((step) => step.run ?? '');
  const index = (pattern) => run.findIndex((text) => pattern.test(text));
  const install = index(/pnpm install --frozen-lockfile/);
  const version = steps.findIndex((step) => step.id === 'playwright');
  const cache = steps.findIndex((step) => step.uses?.startsWith('actions/cache@'));
  const shell = index(/^pnpm browsers:worker --with-deps$/);
  const full = index(/^pnpm verify:full --e2e$/);

  assert.match(run[version], /e2e\/package\.json.*@playwright\/test.*GITHUB_OUTPUT/);
  assert.equal(steps[cache].with.path, '~/.cache/ms-playwright');
  assert.match(steps[cache].with.key, /steps\.playwright\.outputs\.version/);
  assert.match(steps[cache].with.key, /runner\.os/);
  assert.ok(install >= 0 && version > install, 'versão lida depois das dependências');
  assert.ok(cache > version && shell > cache && full > shell, 'cache → headless shell → verify');
});

test('verify: relatórios de tmp/ anexados por 14 dias', () => {
  const upload = verify.jobs.verify.steps.find((step) =>
    step.uses?.startsWith('actions/upload-artifact@'),
  );
  assert.equal(upload.with['retention-days'], 14);
  assert.match(upload.with.path, /tmp\/coverage/);
  assert.match(upload.with.path, /tmp\/playwright/);
});

test('images: só depois do verify verde num push na main, ou chamado pelo release', () => {
  assert.deepEqual(Object.keys(images.on).sort(), ['workflow_call', 'workflow_run']);
  assert.deepEqual(images.on.workflow_run, {
    workflows: [verify.name],
    types: ['completed'],
    branches: ['main'],
  });
  const condition = images.jobs.images.if.replace(/\s+/g, ' ');
  for (const clause of [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'main'",
    'github.event.workflow_run.head_repository.full_name == github.repository',
  ]) {
    assert.ok(condition.includes(clause), `falta a condição: ${clause}`);
  }
  // O código construído é o do commit que o verify aprovou.
  assert.match(images.jobs.images.env.COMMIT, /github\.event\.workflow_run\.head_sha/);
  const checkout = images.jobs.images.steps.find((step) =>
    step.uses?.startsWith('actions/checkout@'),
  );
  assert.equal(checkout.with.ref, `${OPEN} env.COMMIT }}`);
});

test('release: tag vX.Y.Z, verify primeiro, imagens depois com os segredos', () => {
  assert.deepEqual(release.on, { push: { tags: ['v[0-9]+.[0-9]+.[0-9]+'] } });
  assert.equal(release.jobs.verify.uses, './.github/workflows/verify.yml');
  assert.equal(release.jobs.images.uses, './.github/workflows/images.yml');
  assert.deepEqual([release.jobs.images.needs].flat(), ['verify']);
  assert.deepEqual(
    release.jobs.images.secrets,
    Object.fromEntries(SECRETS.map((name) => [name, `\${{ secrets.${name} }}`])),
  );
  assert.deepEqual(Object.keys(images.on.workflow_call.secrets).sort(), [...SECRETS].sort());
});

test('nenhum fluxo publica a partir de PR, e os segredos são só os do Docker Hub', () => {
  for (const file of workflowFiles) {
    const text = read(`.github/workflows/${file}`);
    const used = [...text.matchAll(/\$\{\{\s*secrets\.(\w+)\s*\}\}/g)].map((match) => match[1]);
    for (const name of used) {
      assert.ok(SECRETS.includes(name), `${file}: segredo inesperado ${name}`);
    }
    if (used.length > 0) {
      assert.ok(!('pull_request' in workflows[file].on), `${file}: segredo em fluxo de PR`);
    }
  }
  for (const [file, workflow] of Object.entries(workflows)) {
    const pushes = stepsOf(workflow).filter(
      (step) => step.uses?.startsWith('docker/login-action@') || step.with?.push !== undefined,
    );
    assert.equal(pushes.length > 0, file === 'images.yml', `${file}: login ou push fora do images`);
  }
});

test('images: as cinco imagens, nas duas plataformas, a partir da raiz do repositório', () => {
  const job = images.jobs.images;
  assert.deepEqual(
    job.strategy.matrix.include.map((entry) => entry.app),
    APPS,
  );
  assert.equal(job.env.IMAGE, `tmsoftbrasil/nuva-edu-${OPEN} matrix.app }}`);
  for (const app of APPS) {
    assert.match(
      read(`apps/${app}/docker-compose.yml`),
      new RegExp(`tmsoftbrasil/nuva-edu-${app}:`),
    );
  }
  const builds = job.steps.filter((step) => step.uses?.startsWith('docker/build-push-action@'));
  assert.equal(builds.length, 2);
  const [scan, publish] = builds;
  for (const build of builds) {
    assert.equal(build.with.context, '.');
    assert.equal(build.with.file, `apps/${OPEN} matrix.app }}/Dockerfile`);
    assert.match(build.with['cache-from'], /type=gha/);
  }
  assert.equal(scan.with.platforms, 'linux/amd64');
  assert.equal(scan.with.load, true);
  assert.equal(scan.with.push, undefined);
  assert.equal(publish.with.platforms, 'linux/amd64,linux/arm64');
  assert.equal(publish.with.push, `${OPEN} steps.hub.outputs.publish == 'true' }}`);
  assert.equal(publish.with.tags, `${OPEN} steps.meta.outputs.tags }}`);
  assert.match(publish.with['cache-to'], /type=gha/);
  assert.ok(job.steps.some((step) => step.uses?.startsWith('docker/setup-qemu-action@')));
  assert.ok(job.steps.some((step) => step.uses?.startsWith('docker/setup-buildx-action@')));
});

test('images: NUVA_VERSION nas três imagens de backend e não nas dos sites', () => {
  const job = images.jobs.images;
  const withVersion = job.strategy.matrix.include
    .filter((entry) => entry.nuva_version === true)
    .map((entry) => entry.app);
  assert.deepEqual(withVersion, BACKENDS);
  for (const entry of job.strategy.matrix.include) {
    assert.equal(typeof entry.nuva_version, 'boolean', entry.app);
  }
  const expected = `${OPEN} matrix.nuva_version && format('NUVA_VERSION={0}', steps.meta.outputs.nuva_version) || '' }}`;
  for (const build of job.steps.filter((step) =>
    step.uses?.startsWith('docker/build-push-action@'),
  )) {
    assert.equal(build.with['build-args'], expected);
  }
  // Só os Dockerfiles dos backends declaram o argumento.
  for (const app of APPS) {
    const declares = /^ARG NUVA_VERSION=/m.test(read(`apps/${app}/Dockerfile`));
    assert.equal(declares, BACKENDS.includes(app), `apps/${app}/Dockerfile`);
  }
  const check = job.steps.find((step) => step.name === 'Versão gravada na imagem');
  assert.equal(check.if, 'matrix.nuva_version');
});

test('images: etiquetas e NUVA_VERSION da main e da tag', () => {
  const meta = images.jobs.images.steps.find((step) => step.id === 'meta').run;
  // Tag vX.Y.Z: X.Y.Z, X.Y e latest; NUVA_VERSION=X.Y.Z.
  assert.match(meta, /version="\$\{GITHUB_REF_NAME#v\}"/);
  assert.match(meta, /tags=\("\$version" "\$\{version%\.\*\}" "latest"\)/);
  assert.match(meta, /nuva_version="\$version"/);
  // Push na main: sha-<7> e main; NUVA_VERSION=<versão da raiz>-sha-<7>.
  assert.match(meta, /short="\$\{COMMIT::7\}"/);
  assert.match(meta, /tags=\("sha-\$short" "main"\)/);
  assert.match(meta, /nuva_version="\$\(jq -r \.version package\.json\)-sha-\$short"/);
  assert.match(load('package.json').version, /^\d+\.\d+\.\d+$/);
});

test('images: sem os segredos, aviso na main e falha na tag', () => {
  const job = images.jobs.images;
  const hub = job.steps.find((step) => step.id === 'hub');
  assert.deepEqual(
    hub.env,
    Object.fromEntries(SECRETS.map((name) => [name, `\${{ secrets.${name} }}`])),
  );
  const [present, missing] = hub.run.split('echo "publish=false"');
  assert.match(present, /publish=true/);
  const [onTag, onMain] = missing.split(/^fi$/m);
  assert.match(onTag, /GITHUB_REF_TYPE" = "tag"/);
  assert.match(onTag, /::error /);
  assert.match(onTag, /exit 1/);
  assert.match(onMain, /::warning /);
  assert.match(onMain, /NÃO foi publicada/);
  assert.doesNotMatch(onMain, /exit 1/);
  const login = job.steps.find((step) => step.uses?.startsWith('docker/login-action@'));
  assert.equal(login.if, "steps.hub.outputs.publish == 'true'");
  assert.deepEqual(login.with, {
    username: `${OPEN} secrets.DOCKERHUB_USERNAME }}`,
    password: `${OPEN} secrets.DOCKERHUB_TOKEN }}`,
  });
  // O valor dos segredos nunca é impresso.
  assert.doesNotMatch(runText(images), /echo[^\n]*\$\{?DOCKERHUB_(USERNAME|TOKEN)/);
});

test('images: Trivy falha com alta ou crítica, antes de publicar', () => {
  const steps = images.jobs.images.steps;
  const trivy = steps.findIndex((step) => step.uses?.startsWith('aquasecurity/trivy-action@'));
  const publish = steps.findIndex((step) => step.with?.push !== undefined);
  assert.ok(trivy >= 0 && trivy < publish);
  assert.equal(steps[trivy].with.severity, 'HIGH,CRITICAL');
  assert.equal(String(steps[trivy].with['exit-code']), '1');
  assert.equal(steps[trivy].with['image-ref'], `${OPEN} env.IMAGE }}:exame`);
  assert.equal(steps[trivy]['continue-on-error'], undefined);
});

test('trivy: nenhuma exceção no repositório nem no fluxo', () => {
  const job = images.jobs.images;
  const trivy = job.steps.filter((step) => step.uses?.startsWith('aquasecurity/trivy-action@'));
  assert.equal(trivy.length, 1);
  // Nenhum caminho para exceção: sem arquivo, sem política, sem configuração e sem variável.
  for (const input of [
    'trivyignores',
    'ignore-policy',
    'trivy-config',
    'skip-dirs',
    'skip-files',
    'vuln-type',
  ]) {
    assert.equal(trivy[0].with[input], undefined, `Trivy com ${input}`);
  }
  assert.equal(trivy[0].env, undefined);
  assert.doesNotMatch(read('.github/workflows/images.yml'), /TRIVY_|trivyignore/i);
  // As cinco imagens passam pelo mesmo exame: a matriz só distingue quem recebe NUVA_VERSION.
  for (const item of job.strategy.matrix.include) {
    assert.deepEqual(Object.keys(item).sort(), ['app', 'nuva_version'], item.app);
  }
  // Nem `.trivyignore` (que o Trivy carregaria sozinho) nem `.trivyignore.yaml`, em pasta alguma
  // versionada; `trivy.yaml` também não.
  const found = readdirSync(root, { recursive: true }).filter(
    (name) =>
      !/(^|[\\/])(node_modules|\.git|\.worktrees)([\\/]|$)/.test(name) &&
      /(^|[\\/])(\.trivyignore[^\\/]*|trivy\.ya?ml)$/.test(name),
  );
  assert.deepEqual(found, []);
});

test('images: confere as plataformas e a versão do que foi publicado', () => {
  const published = images.jobs.images.steps.find((step) => step.name === 'Imagem publicada');
  assert.equal(published.if, "steps.hub.outputs.publish == 'true'");
  assert.match(published.run, /imagetools inspect/);
  assert.match(published.run, /linux\/amd64 linux\/arm64/);
  assert.match(published.run, /--pull always/);
});

test('imagens: o estágio final dos backends sai sem npm e com apt-get upgrade, o dos sites com apk upgrade', () => {
  // O Trivy do fluxo `images` acusa o npm embutido em `node:slim` e os pacotes do Alpine
  // anteriores à imagem base (task 097).
  const runtimeOf = (app) => {
    const stages = read(`apps/${app}/Dockerfile`).split(/^FROM /m);
    const last = stages.at(-1);
    assert.match(last, /^\S+ AS runtime$/m, `apps/${app}/Dockerfile: o último estágio é o runtime`);
    // Linhas de continuação unidas e comentários fora: uma instrução por linha.
    return last
      .replace(/\\\n\s*/g, '')
      .split('\n')
      .filter((line) => !line.startsWith('#'));
  };
  for (const app of BACKENDS) {
    const lines = runtimeOf(app);
    const remove = lines.find((line) => /^RUN rm -rf /.test(line));
    assert.ok(remove, `${app}: falta remover o npm`);
    for (const path of [
      '/usr/local/lib/node_modules/npm',
      '/usr/local/lib/node_modules/corepack',
      '/usr/local/bin/npm',
      '/usr/local/bin/npx',
      '/usr/local/bin/corepack',
    ]) {
      assert.ok(remove.split(/\s+/).includes(path), `${app}: ${path}`);
    }
    // A remoção exige root: vem antes da troca para o usuário sem privilégio, que é a última.
    const users = lines.filter((line) => line.startsWith('USER '));
    assert.deepEqual(users, ['USER node'], app);
    assert.ok(lines.indexOf(remove) < lines.indexOf('USER node'), app);
    // Correções do Debian da base a cada build (task 698): `apt-get upgrade` num único RUN, com a
    // lista do apt atualizada antes (no worker, pelo `--with-deps` do Playwright) e apagada
    // depois, também como root.
    const upgrade = lines.find((line) =>
      /^RUN .*apt-get upgrade -y --no-install-recommends /.test(line),
    );
    assert.ok(upgrade, `${app}: falta o apt-get upgrade`);
    const at = upgrade.indexOf('apt-get upgrade');
    const update = Math.max(upgrade.indexOf('apt-get update'), upgrade.indexOf('--with-deps'));
    assert.ok(update !== -1 && update < at, `${app}: falta atualizar a lista do apt antes`);
    assert.ok(upgrade.indexOf('rm -rf /var/lib/apt/lists/*') > at, `${app}: lista do apt fica`);
    assert.ok(lines.indexOf(upgrade) < lines.indexOf('USER node'), app);
    assert.deepEqual(
      lines.filter((line) => line.startsWith('CMD ')),
      ['CMD ["node", "src/main.ts"]'],
    );
  }
  for (const app of APPS.filter((name) => !BACKENDS.includes(name))) {
    const lines = runtimeOf(app);
    const upgrade = lines.indexOf('RUN apk upgrade --no-cache');
    assert.notEqual(upgrade, -1, `${app}: falta o apk upgrade`);
    // Alpine puro, com o lighttpd do próprio Alpine: nenhuma imagem de servidor de terceiros.
    assert.match(read(`apps/${app}/Dockerfile`), /^ARG ALPINE_IMAGE=alpine:\d+\.\d+$/m, app);
    assert.match(lines[0], /^\$\{ALPINE_IMAGE\} AS runtime$/, app);
    assert.doesNotMatch(read(`apps/${app}/Dockerfile`), /nginx/i, app);
    const install = lines.findIndex((line) => / apk add --no-cache lighttpd /.test(line));
    assert.ok(upgrade < install, `${app}: apk upgrade antes de instalar o lighttpd`);
    // O usuário 101 é criado antes do pacote, e a imagem termina nele (sem `USER root`: o
    // Alpine já começa como root).
    assert.match(
      lines[install],
      /^RUN addgroup -S -g 101 nuva && adduser -S .*-u 101 -G nuva /,
      app,
    );
    const users = lines.filter((line) => line.startsWith('USER '));
    assert.deepEqual(users, ['USER 101:101'], app);
    assert.ok(install < lines.indexOf('USER 101:101'), app);
    // A configuração é conferida no build, e a entrada troca o processo pelo lighttpd.
    assert.ok(
      lines.some((line) => line.includes('lighttpd -tt -f /etc/lighttpd/lighttpd.conf')),
      `${app}: falta conferir a configuração no build`,
    );
    assert.ok(lines.includes('ENTRYPOINT ["/usr/local/bin/nuva-entrypoint.sh"]'), app);
    assert.ok(lines.includes('CMD ["lighttpd", "-D", "-f", "/etc/lighttpd/lighttpd.conf"]'), app);
    assert.ok(lines.includes('EXPOSE 8080'), app);
  }
});

test('imagem do worker: Chromium headless shell e Inter no runtime, como root, sem lista do apt', () => {
  // ADR 0026; spec 031, "Dockerfiles".
  const dockerfile = read('apps/worker/Dockerfile');
  const runtime = dockerfile.split(/^FROM /m).at(-1);
  const lines = runtime
    .replace(/\\\n\s*/g, '')
    .split('\n')
    .filter((line) => !line.startsWith('#'));
  assert.ok(lines.includes('ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright'));
  const install = lines.find((line) => /playwright-core\/cli\.js install /.test(line));
  assert.ok(install, 'falta instalar o Chromium');
  // A CLI do `playwright-core` do lockfile, chamada pelo node (a imagem não tem npm nem npx).
  assert.match(install, /^RUN --mount=type=bind,from=deps,source=\/app,target=\/deps /);
  assert.match(
    install,
    / node \/deps\/apps\/worker\/node_modules\/playwright-core\/cli\.js install --with-deps --only-shell chromium /,
  );
  assert.doesNotMatch(install, /\bnpx\b|\bnpm\b/);
  // O ffmpeg que o Playwright baixa junto só grava vídeo: não fica na imagem.
  assert.match(install, / rm -rf \/ms-playwright\/ffmpeg-\* /);
  // Fonte Inter do Debian (licença OFL-1.1 junto, em /usr/share/doc), no mesmo passo que apaga a
  // lista do apt.
  assert.match(install, /apt-get install -y --no-install-recommends fonts-inter-variable/);
  assert.match(install, /apt-get upgrade -y/);
  assert.match(install, /rm -rf \/var\/lib\/apt\/lists\/\* /);
  assert.ok(install.indexOf('fc-cache') > install.indexOf('fonts-inter-variable'));
  // Como root: antes da troca para o usuário sem privilégio.
  assert.ok(lines.indexOf(install) < lines.indexOf('USER node'));
  // Inter como fonte padrão no fontconfig, também para os nomes que o Chromium usa no Linux.
  const conf = /^COPY <<'EOF' \/etc\/fonts\/local\.conf\n([\s\S]*?)\nEOF$/m.exec(runtime);
  assert.ok(conf, 'falta o /etc/fonts/local.conf');
  for (const family of ['Inter', 'Times New Roman', 'Arial', 'serif', 'sans-serif', 'system-ui']) {
    assert.match(
      conf[1],
      new RegExp(
        `<alias binding="same">\\s*<family>${family}</family>\\s*<prefer><family>Inter Variable</family></prefer>`,
      ),
      family,
    );
  }
  assert.ok(runtime.indexOf('local.conf') < runtime.indexOf(install.slice(0, 40)));
});

test('security: push na main e semanal; audit, licenças e CodeQL', () => {
  assert.deepEqual(security.on.push, { branches: ['main'] });
  assert.equal(security.on.schedule.length, 1);
  // Semanal: dia da semana fixo, dia do mês e mês livres.
  assert.match(security.on.schedule[0].cron, /^\d+ \d+ \* \* [0-6]$/);
  assert.match(runText(security), /^pnpm audit --audit-level high$/m);
  assert.match(runText(security), /^pnpm licenses:check$/m);
  assert.equal(load('package.json').scripts['licenses:check'], 'node scripts/check-licenses.mjs');
  const codeql = security.jobs.codeql;
  assert.equal(codeql.permissions['security-events'], 'write');
  assert.ok(codeql.strategy.matrix.language.includes('javascript-typescript'));
  const uses = codeql.steps.map((step) => step.uses ?? '');
  assert.ok(uses.some((name) => name.startsWith('github/codeql-action/init@')));
  assert.ok(uses.some((name) => name.startsWith('github/codeql-action/analyze@')));
});

test('dependabot: semanal para npm, Docker e GitHub Actions', () => {
  const dependabot = load('.github/dependabot.yml');
  assert.equal(dependabot.version, 2);
  const ecosystems = dependabot.updates.map((update) => update['package-ecosystem']);
  for (const ecosystem of ['npm', 'docker', 'github-actions']) {
    assert.ok(ecosystems.includes(ecosystem), `falta ${ecosystem}`);
  }
  for (const update of dependabot.updates) {
    assert.equal(update.schedule.interval, 'weekly', update['package-ecosystem']);
  }
  const docker = dependabot.updates.find((update) => update['package-ecosystem'] === 'docker');
  assert.deepEqual(docker.directories, ['/apps/*']);
});
