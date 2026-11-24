// Content-Security-Policy dos sites (specs 031 e 033): gerada por proxy/nginx/csp.mjs no build
// da imagem, a partir do index.html que o Vite produziu.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { THEME_BOOT_SCRIPT } from '../packages/ui/src/theme/boot.ts';
import { buildPolicy, inlineScripts, nginxSnippet, scriptHash } from '../proxy/nginx/csp.mjs';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

/** Como o Vite deixa o index.html: o script do tema no começo do <head>, o resto por arquivo. */
const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <script>${THEME_BOOT_SCRIPT}</script>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

const sha = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

test('só os scripts inline entram, com o texto exato', () => {
  assert.deepEqual(inlineScripts(html), [THEME_BOOT_SCRIPT]);
  assert.deepEqual(inlineScripts('<script src="/a.js"></script><SCRIPT SRC=/b.js></SCRIPT>'), []);
  assert.deepEqual(inlineScripts('<script type="module">\n  a();\n</script>'), ['\n  a();\n']);
  // `data-src` não é `src`: o script continua inline.
  assert.deepEqual(inlineScripts('<script data-src="x">b()</script>'), ['b()']);
});

test('o hash do script do tema entra em script-src, sem unsafe-inline', () => {
  const policy = buildPolicy(html);
  const directives = Object.fromEntries(
    policy.split('; ').map((part) => {
      const [name, ...sources] = part.split(' ');
      return [name, sources];
    }),
  );
  assert.equal(scriptHash(THEME_BOOT_SCRIPT), sha(THEME_BOOT_SCRIPT));
  assert.deepEqual(directives['script-src'], ["'self'", sha(THEME_BOOT_SCRIPT)]);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
  assert.deepEqual(directives['default-src'], ["'none'"]);
  // API e SSE na mesma origem; imagens da origem e `data:`; fontes e estilos da origem.
  assert.deepEqual(directives['connect-src'], ["'self'"]);
  assert.deepEqual(directives['img-src'], ["'self'", 'data:']);
  assert.deepEqual(directives['font-src'], ["'self'"]);
  assert.deepEqual(directives['style-src'], ["'self'"]);
  assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
  // Nada externo: nenhuma origem com esquema ou curinga.
  assert.doesNotMatch(policy, /https?:|\*/);
});

test('script trocado muda o hash; script repetido não duplica', () => {
  const other = html.replace(THEME_BOOT_SCRIPT, 'alert(1)');
  assert.ok(buildPolicy(other).includes(sha('alert(1)')));
  assert.ok(!buildPolicy(other).includes(sha(THEME_BOOT_SCRIPT)));
  const twice = buildPolicy('<script>a()</script><script>a()</script>');
  assert.equal(twice.split(sha('a()')).length, 2);
  // Sem script inline, só a própria origem.
  assert.match(buildPolicy('<script src="/a.js"></script>'), /script-src 'self';/);
});

test('o trecho do Nginx é um add_header numa linha, com aspas duplas por fora', () => {
  const lines = nginxSnippet(html).trim().split('\n');
  assert.match(lines[0], /^# Gerado no build/);
  assert.equal(lines[1], `add_header Content-Security-Policy "${buildPolicy(html)}" always;`);
  assert.equal(lines.length, 2);
});

test('linha de comando: lê o index.html e escreve o trecho; sem arquivo, sai com 1', () => {
  const script = resolve(root, 'proxy/nginx/csp.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'nuva-csp-'));
  try {
    const file = join(dir, 'index.html');
    writeFileSync(file, html);
    const ok = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, nginxSnippet(html));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const missing = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Uso:/);
});

test('o Nginx inclui o arquivo gerado e as duas imagens o geram do dist', () => {
  const conf = read('proxy/nginx/nginx.conf');
  // Na rota que entrega o index.html, junto dos outros cabeçalhos dela.
  const spa = conf.slice(conf.indexOf('location / {'));
  assert.match(spa, /include \/etc\/nginx\/nuva-csp\.conf;/);
  // Nenhum Content-Security-Policy escrito à mão: a única fonte é o arquivo gerado.
  assert.doesNotMatch(conf, /add_header Content-Security-Policy/);
  for (const app of ['admin', 'classroom']) {
    const dockerfile = read(`apps/${app}/Dockerfile`);
    assert.ok(
      dockerfile.includes(
        `node proxy/nginx/csp.mjs apps/${app}/dist/index.html > /app/nuva-csp.conf`,
      ),
      `${app}: gera a política no build`,
    );
    assert.ok(
      dockerfile.includes('COPY --from=build /app/nuva-csp.conf /etc/nginx/nuva-csp.conf'),
      `${app}: copia a política para a imagem final`,
    );
  }
});
