// Content-Security-Policy dos sites (specs 031 e 033): gerada por proxy/lighttpd/csp.mjs no build
// da imagem, a partir do index.html que o Vite produziu.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { THEME_BOOT_SCRIPT } from '../packages/ui/src/theme/boot.ts';
import { buildPolicy, inlineScripts, lighttpdSnippet, scriptHash } from '../proxy/lighttpd/csp.mjs';

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
  // API e SSE na mesma origem; imagens da origem, `data:` e `blob:` (prévia do ImagePicker, só
  // em img-src); fontes e estilos da origem.
  assert.deepEqual(directives['connect-src'], ["'self'"]);
  assert.deepEqual(directives['img-src'], ["'self'", 'data:', 'blob:']);
  assert.deepEqual(directives['font-src'], ["'self'"]);
  assert.deepEqual(directives['style-src'], ["'self'"]);
  assert.deepEqual(directives['frame-ancestors'], ["'none'"]);
  // As demais diretivas não mudam: a lista completa, na ordem, sem `blob:` fora de img-src.
  assert.deepEqual(directives['media-src'], ["'self'"]);
  assert.deepEqual(directives['manifest-src'], ["'self'"]);
  assert.deepEqual(directives['base-uri'], ["'self'"]);
  assert.deepEqual(directives['form-action'], ["'self'"]);
  assert.deepEqual(Object.keys(directives), [
    'default-src',
    'script-src',
    'style-src',
    'img-src',
    'font-src',
    'connect-src',
    'media-src',
    'manifest-src',
    'base-uri',
    'form-action',
    'frame-ancestors',
  ]);
  assert.equal(policy.match(/blob:/g).length, 1);
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

test('o trecho do lighttpd define var.nuva_csp numa linha, com aspas duplas por fora', () => {
  const lines = lighttpdSnippet(html).trim().split('\n');
  assert.match(lines[0], /^# Gerado no build/);
  assert.equal(lines[1], `var.nuva_csp = "${buildPolicy(html)}"`);
  assert.equal(lines.length, 2);
  // Nada na política fecha a string nem escapa dentro dela.
  assert.doesNotMatch(buildPolicy(html), /["\\]/);
});

test('linha de comando: lê o index.html e escreve o trecho; sem arquivo, sai com 1', () => {
  const script = resolve(root, 'proxy/lighttpd/csp.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'nuva-csp-'));
  try {
    const file = join(dir, 'index.html');
    writeFileSync(file, html);
    const ok = spawnSync(process.execPath, [script, file], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout, lighttpdSnippet(html));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const missing = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Uso:/);
});

test('o lighttpd inclui o arquivo gerado e as duas imagens o geram do dist', () => {
  const conf = read('proxy/lighttpd/lighttpd.conf');
  assert.match(conf, /^include "\/etc\/lighttpd\/nuva-csp\.conf"$/m);
  // No bloco que entrega o index.html (o `else` final), junto dos outros cabeçalhos dele.
  const spa = conf.slice(conf.lastIndexOf('\nelse {'));
  assert.match(spa, /"Content-Security-Policy" => var\.nuva_csp\n/);
  // Nenhuma política escrita à mão: a única fonte é o arquivo gerado.
  assert.equal(conf.match(/Content-Security-Policy"/g).length, 1);
  assert.doesNotMatch(conf, /default-src|script-src|sha256-/);
  for (const app of ['admin', 'classroom']) {
    const dockerfile = read(`apps/${app}/Dockerfile`);
    assert.ok(
      dockerfile.includes(
        `node proxy/lighttpd/csp.mjs apps/${app}/dist/index.html > /app/nuva-csp.conf`,
      ),
      `${app}: gera a política no build`,
    );
    assert.ok(
      dockerfile.includes('COPY --from=build /app/nuva-csp.conf /etc/lighttpd/nuva-csp.conf'),
      `${app}: copia a política para a imagem final`,
    );
  }
});
