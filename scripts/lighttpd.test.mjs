// Configuração do lighttpd dos sites (spec 031): lê `proxy/lighttpd/lighttpd.conf` e confere os
// caminhos reservados, a reserva da SPA, os cabeçalhos e o que a raiz somente leitura exige.
// Com NUVA_TEST_DOCKER=1 (teste lento, fora do `verify`), valida a sintaxe com `lighttpd -tt`
// num contêiner descartável; o build das duas imagens faz a mesma conferência sempre.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const confPath = resolve(root, 'proxy/lighttpd/lighttpd.conf');
const conf = readFileSync(confPath, 'utf8');
// Sem os comentários: o que o lighttpd realmente lê.
const active = conf
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

/** Pares `"chave" => "valor"` de uma lista do lighttpd, na ordem. */
function pairs(block) {
  return [...block.matchAll(/"([^"]*)"\s*=>\s*(?:"([^"]*)"|([\w.]+))/g)].map(
    ([, key, text, variable]) => [key, text ?? variable],
  );
}

/** Corpo de `nome = ( ... )`. */
function list(name) {
  const start = active.indexOf(`${name} = (`);
  assert.notEqual(start, -1, `${name} ausente`);
  return active.slice(start, active.indexOf('\n)', start));
}

/** Os blocos condicionais de cabeçalhos, na ordem: [condição, cabeçalhos]. */
function headerBlocks() {
  const found = [];
  const pattern = /^(?:else )?(\$HTTP\["url"\] (?:==|=~) "[^"]*" |else )\{([\s\S]*?)\n\}/gm;
  for (const [, condition, body] of active.matchAll(pattern)) {
    found.push([condition.trim(), Object.fromEntries(pairs(body))]);
  }
  return found;
}

test('porta 8080, sem troca de usuário, sem pid e sem gravar fora do tmpfs', () => {
  assert.match(active, /^server\.port = 8080$/m);
  assert.match(active, /^server\.document-root = "\/srv\/nuva\/site"$/m);
  // O `USER` do Dockerfile já é o usuário sem privilégio.
  assert.doesNotMatch(active, /server\.(username|groupname|chroot|pid-file)/);
  // Erros na saída de erro (o padrão); nenhum arquivo de log.
  assert.doesNotMatch(active, /server\.errorlog|accesslog|mod_accesslog/);
  // Tudo o que o lighttpd grava fica em /tmp, que é tmpfs nos composes.
  assert.match(active, /^server\.upload-dirs = \( "\/tmp" \)$/m);
  assert.match(active, /^deflate\.cache-dir = "\/tmp\/[\w-]+"$/m);
  // Sem a versão no cabeçalho `Server`.
  assert.match(active, /^server\.tag = "lighttpd"$/m);
});

test('só os módulos usados; nada de CGI, proxy, listagem ou autenticação', () => {
  const modules = active.match(/^server\.modules = \(([^)]*)\)$/m)[1];
  assert.deepEqual(
    [...modules.matchAll(/"(mod_\w+)"/g)].map((match) => match[1]),
    ['mod_rewrite', 'mod_setenv', 'mod_deflate'],
  );
  assert.doesNotMatch(active, /cgi|proxy\.|dir-listing|auth\.|ssi\.|webdav|status\./);
});

test('caminhos das APIs e das sondas ficam fora da reserva da SPA', () => {
  const rules = pairs(list('url.rewrite-if-not-file'));
  // A última regra é a reserva; as anteriores, com destino vazio, são 404 de verdade.
  assert.deepEqual(rules.at(-1), ['', '/index.html']);
  const reserved = rules.slice(0, -1);
  assert.ok(reserved.length > 0);
  for (const [, target] of reserved) {
    assert.equal(target, '');
  }
  const patterns = reserved.map(([pattern]) => new RegExp(pattern));
  const is404 = (url) => patterns.some((pattern) => pattern.test(url));
  for (const url of [
    '/api/',
    '/api/v1/meta',
    '/api/v1/meta?x=1',
    '/mcp',
    '/mcp/sse',
    '/healthz',
    '/healthz?x=1',
    '/readyz',
    '/metrics',
    '/assets/nao-existe.js',
    '/assets/x/y.css',
  ]) {
    assert.ok(is404(url), `${url} cairia no index.html`);
  }
  // Rotas da SPA, inclusive as que só começam parecido.
  for (const url of [
    '/',
    '/alunos',
    '/forum/topico/1?pagina=2',
    '/api',
    '/healthzz',
    '/metricas',
  ]) {
    assert.ok(!is404(url), `${url} deveria cair no index.html`);
  }
  // A pasta /assets/ em si também é 404 (sem isto, o lighttpd responde 403).
  const [[folder, target]] = pairs(list('url.rewrite-once'));
  assert.ok(new RegExp(folder).test('/assets/') && new RegExp(folder).test('/assets/?a=1'));
  assert.ok(!new RegExp(folder).test('/assets/index-abc.js'));
  assert.match(target, /^\/assets\//);
});

test('cabeçalhos por caminho: config.json, assets, 404 das APIs e index.html', () => {
  const blocks = headerBlocks();
  assert.deepEqual(
    blocks.map(([condition]) => condition),
    [
      '$HTTP["url"] == "/config.json"',
      '$HTTP["url"] =~ "^/assets/"',
      '$HTTP["url"] =~ "^/(?:api/|mcp|(?:healthz|readyz|metrics)$)"',
      'else',
    ],
  );
  const [config, assets, reserved, spa] = blocks.map(([, headers]) => headers);
  assert.deepEqual(config, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  assert.deepEqual(assets, {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  // O 404 das APIs e das sondas sai sem cabeçalho do site.
  assert.deepEqual(reserved, {});
  assert.deepEqual(spa, {
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': 'var.nuva_csp',
  });
});

test('tipos de mídia do que os sites servem e compressão só em gzip', () => {
  const types = Object.fromEntries(pairs(list('mimetype.assign')));
  assert.equal(types['.html'], 'text/html');
  assert.equal(types['.js'], 'text/javascript');
  assert.equal(types['.css'], 'text/css');
  assert.equal(types['.json'], 'application/json');
  assert.equal(types['.woff2'], 'font/woff2');
  assert.equal(types['.svg'], 'image/svg+xml');
  assert.equal(types['.webmanifest'], 'application/manifest+json');
  assert.equal(types[''], 'application/octet-stream');
  assert.match(active, /^deflate\.allowed-encodings = \( "gzip" \)$/m);
  assert.match(active, /^deflate\.min-compress-size = 1024$/m);
  const compressed = [...list('deflate.mimetypes').matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  for (const type of ['text/css', 'text/javascript', 'application/json', 'image/svg+xml']) {
    assert.ok(compressed.includes(type), type);
  }
  // Fonte e imagem já são comprimidas.
  assert.ok(!compressed.some((type) => /^(font|image\/(png|jpeg|webp|avif))/.test(type)));
});

test('o /config.json é o atalho para o arquivo gerado na subida, nas duas imagens', () => {
  assert.match(active, /^server\.follow-symlink = "enable"$/m);
  for (const app of ['admin', 'classroom']) {
    const dockerfile = readFileSync(resolve(root, `apps/${app}/Dockerfile`), 'utf8');
    assert.ok(
      dockerfile.includes('ln -s /run/nuva/config.json /srv/nuva/site/config.json'),
      `${app}: atalho do config.json`,
    );
    assert.ok(
      dockerfile.includes(`COPY --from=build /app/apps/${app}/dist /srv/nuva/site`),
      `${app}: raiz do site`,
    );
    assert.ok(dockerfile.includes('COPY proxy/lighttpd/lighttpd.conf /etc/lighttpd/lighttpd.conf'));
  }
  assert.ok(!existsSync(resolve(root, 'proxy/nginx')), 'proxy/nginx não existe mais');
});

const docker = process.env.NUVA_TEST_DOCKER === '1';
test('lighttpd -tt aceita a configuração (contêiner descartável)', {
  skip: docker ? false : 'lento: rode com NUVA_TEST_DOCKER=1',
}, () => {
  const dir = mkdtempSync(join(tmpdir(), 'nuva-lighttpd-'));
  try {
    writeFileSync(join(dir, 'nuva-csp.conf'), 'var.nuva_csp = "default-src \'none\'"\n');
    const image = readFileSync(resolve(root, 'apps/admin/Dockerfile'), 'utf8').match(
      /^ARG ALPINE_IMAGE=(\S+)$/m,
    )[1];
    const result = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '-v',
        `${confPath}:/etc/lighttpd/lighttpd.conf:ro`,
        '-v',
        `${join(dir, 'nuva-csp.conf')}:/etc/lighttpd/nuva-csp.conf:ro`,
        image,
        'sh',
        '-c',
        'apk add --no-cache lighttpd >/dev/null && lighttpd -tt -f /etc/lighttpd/lighttpd.conf 2>&1',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    // Chave desconhecida só gera aviso no `-tt`: aqui ela reprova.
    assert.doesNotMatch(result.stdout + result.stderr, /WARNING|unknown config-key/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
