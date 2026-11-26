// Content-Security-Policy dos sites (specs 031 e 033): gerada por proxy/lighttpd/csp.mjs no build
// da imagem, a partir do index.html que o Vite produziu.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  resolveVideoSource,
  vimeoEmbedUrl,
} from '../packages/ui/src/components/learning/video/source.ts';
import { THEME_BOOT_SCRIPT } from '../packages/ui/src/theme/boot.ts';
import {
  buildPolicy,
  inlineScripts,
  lighttpdSnippet,
  PLAYER_SOURCES,
  SITES,
  scriptHash,
} from '../proxy/lighttpd/csp.mjs';

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

/** A política em `{ diretiva: [fontes] }`, na ordem em que foi escrita. */
const parsePolicy = (policy) =>
  Object.fromEntries(
    policy.split('; ').map((part) => {
      const [name, ...sources] = part.split(' ');
      return [name, sources];
    }),
  );

/**
 * A fonte de CSP aceita a URL? Só as formas que a política usa: `'self'` (nunca casa com URL
 * externa), esquema (`https:`, `blob:`) e origem `https://host`, com `*.` no rótulo inteiro, que
 * exige ao menos um subdomínio (CSP3, "host-source").
 */
function sourceAllows(source, raw) {
  const url = new URL(raw);
  if (source.startsWith("'")) return false;
  if (/^[a-z][a-z0-9+.-]*:$/.test(source)) return url.protocol === source;
  const [, scheme, host] = /^([a-z]+):\/\/([^/:]+)$/.exec(source) ?? [];
  assert.ok(host, `fonte em forma não prevista: ${source}`);
  if (url.protocol !== `${scheme}:` || url.port !== '') return false;
  return host.startsWith('*.') ? url.hostname.endsWith(host.slice(1)) : url.hostname === host;
}

const allows = (directives, directive, url) =>
  (directives[directive] ?? directives['default-src']).some((source) => sourceAllows(source, url));

test('só os scripts inline entram, com o texto exato', () => {
  assert.deepEqual(inlineScripts(html), [THEME_BOOT_SCRIPT]);
  assert.deepEqual(inlineScripts('<script src="/a.js"></script><SCRIPT SRC=/b.js></SCRIPT>'), []);
  assert.deepEqual(inlineScripts('<script type="module">\n  a();\n</script>'), ['\n  a();\n']);
  // `data-src` não é `src`: o script continua inline.
  assert.deepEqual(inlineScripts('<script data-src="x">b()</script>'), ['b()']);
});

test('admin: o hash do script do tema entra em script-src, sem unsafe-inline, e só imagem externa', () => {
  const policy = buildPolicy(html, 'admin');
  const directives = parsePolicy(policy);
  assert.equal(scriptHash(THEME_BOOT_SCRIPT), sha(THEME_BOOT_SCRIPT));
  assert.deepEqual(directives['script-src'], ["'self'", sha(THEME_BOOT_SCRIPT)]);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
  assert.deepEqual(directives['default-src'], ["'none'"]);
  // API e SSE na mesma origem; imagens da origem, `data:`, `blob:` (prévia do ImagePicker, só
  // em img-src) e `https:` para as imagens do Markdown (ADR 0027); fontes e estilos da origem.
  assert.deepEqual(directives['connect-src'], ["'self'"]);
  assert.deepEqual(directives['img-src'], ["'self'", 'data:', 'blob:', 'https:']);
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
  // Nada externo de origem: nenhum host, curinga ou esquema fora do `https:` de img-src.
  assert.doesNotMatch(policy, /\*|https?:\/\//);
  assert.equal(policy.match(/https:/g).length, 1);
});

test('Markdown: `https:` só em img-src; script, frame e conexão seguem fechados', () => {
  // Imagem do Markdown saneado (ADR 0027): URL absoluta `https`, de qualquer host, sem o servidor
  // buscar nem regravar. A política aceita; quem recusa o resto é o saneador, não a CSP.
  for (const site of SITES) {
    const directives = parsePolicy(buildPolicy(html, site));
    for (const image of [
      'https://images.example.com/foto.png',
      'https://cdn.example.org:8443/a/b.webp?w=800',
      'https://user-images.githubusercontent.com/1/x.svg',
    ]) {
      assert.ok(allows(directives, 'img-src', image), `${site}: img-src recusa ${image}`);
    }
    // `http` (descartado pelo saneador) e esquemas de execução continuam fora.
    for (const url of [
      'http://images.example.com/foto.png',
      'javascript:alert(1)',
      'ftp://images.example.com/foto.png',
    ]) {
      assert.ok(!allows(directives, 'img-src', url), `${site}: img-src aceita ${url}`);
    }
    // O esquema `https:` abre só imagem (e mídia, no classroom, desde a Fase 2).
    const open = Object.entries(directives)
      .filter(([, sources]) => sources.includes('https:'))
      .map(([directive]) => directive);
    assert.deepEqual(open, site === 'admin' ? ['img-src'] : ['img-src', 'media-src'], site);
    // A mesma URL externa não passa em script, estilo, fonte, conexão, frame, worker nem form.
    for (const directive of [
      'script-src',
      'style-src',
      'font-src',
      'connect-src',
      'frame-src',
      'worker-src',
      'manifest-src',
      'form-action',
      'base-uri',
    ]) {
      assert.ok(
        !allows(directives, directive, 'https://images.example.com/foto.png'),
        `${site}: ${directive} aceita imagem externa`,
      );
    }
  }
});

test('script trocado muda o hash; script repetido não duplica', () => {
  for (const site of SITES) {
    const other = html.replace(THEME_BOOT_SCRIPT, 'alert(1)');
    assert.ok(buildPolicy(other, site).includes(sha('alert(1)')));
    assert.ok(!buildPolicy(other, site).includes(sha(THEME_BOOT_SCRIPT)));
    const twice = buildPolicy('<script>a()</script><script>a()</script>', site);
    assert.equal(twice.split(sha('a()')).length, 2);
  }
  // Sem script inline, só a própria origem (no classroom, mais a IFrame API do YouTube).
  assert.match(buildPolicy('<script src="/a.js"></script>', 'admin'), /script-src 'self';/);
  assert.match(
    buildPolicy('<script src="/a.js"></script>', 'classroom'),
    /script-src 'self' https:\/\/www\.youtube\.com;/,
  );
});

test('site desconhecido ou ausente não gera política', () => {
  assert.deepEqual(SITES, ['admin', 'classroom']);
  assert.throws(() => buildPolicy(html), /Site desconhecido/);
  assert.throws(() => buildPolicy(html, 'worker'), /Site desconhecido/);
  assert.throws(() => lighttpdSnippet(html, ''), /Site desconhecido/);
});

test('classroom: a política é a do admin mais as origens dos players, e nada além', () => {
  const admin = parsePolicy(buildPolicy(html, 'admin'));
  const classroom = parsePolicy(buildPolicy(html, 'classroom'));
  const policy = buildPolicy(html, 'classroom');
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
  // A lista inteira, escrita por extenso: origem nova na política quebra aqui.
  assert.deepEqual(classroom, {
    'default-src': ["'none'"],
    'script-src': ["'self'", 'https://www.youtube.com', sha(THEME_BOOT_SCRIPT)],
    'style-src': ["'self'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", 'https://*.b-cdn.net'],
    'media-src': ["'self'", 'https:', 'blob:'],
    'manifest-src': ["'self'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'frame-src': [
      'https://www.youtube-nocookie.com',
      'https://player.vimeo.com',
      'https://iframe.mediadelivery.net',
      'https://*.tv.pandavideo.com.br',
    ],
    'worker-src': ['blob:'],
  });
  // As diretivas da base ficam na ordem da base; as do player vêm depois.
  assert.deepEqual(Object.keys(classroom).slice(0, Object.keys(admin).length), Object.keys(admin));
  // A diferença para o admin é exatamente PLAYER_SOURCES.
  const difference = [];
  for (const [directive, sources] of Object.entries(classroom)) {
    const more = sources.filter((source) => !(admin[directive] ?? []).includes(source));
    if (more.length > 0) difference.push([directive, ...more]);
  }
  const byName = (a, b) => a[0].localeCompare(b[0]);
  assert.deepEqual(difference.sort(byName), PLAYER_SOURCES.toSorted(byName));
  // Curinga só no rótulo inteiro do host e só onde o provedor usa subdomínio por conta; nunca `*`
  // sozinho nem esquema aberto fora de img-src (imagens do Markdown, ADR 0027) e media-src
  // (`.mp4`/`.webm` de qualquer host, spec 009).
  for (const [directive, sources] of Object.entries(classroom)) {
    for (const source of sources) {
      assert.notEqual(source, '*', directive);
      assert.doesNotMatch(source, /^http:/, directive);
      if (source === 'https:') assert.ok(['img-src', 'media-src'].includes(directive), directive);
      if (source === 'blob:') assert.ok(['img-src', 'media-src', 'worker-src'].includes(directive));
      if (source === 'data:') assert.equal(directive, 'img-src');
    }
  }
});

test('classroom: cada origem que o VideoPlayer usa passa na política; as vizinhas, não', () => {
  const directives = parsePolicy(buildPolicy(html, 'classroom'));
  const video = (file) => read(`packages/ui/src/components/learning/video/${file}`);
  const used = new Set();
  const frame = (url) => {
    const source = directives['frame-src'].find((item) => sourceAllows(item, url));
    assert.ok(source, `frame-src recusa ${url}`);
    used.add(`frame-src ${source}`);
  };

  // YouTube: o endereço do script e o host do iframe estão escritos no adaptador (JSX, que o
  // Node não importa): lidos do fonte, para a política acompanhar o que o player monta.
  const youtube = video('youtube.tsx');
  const [, apiUrl] = /YOUTUBE_API_URL = '([^']+)'/.exec(youtube) ?? [];
  assert.ok(apiUrl, 'youtube.tsx declara YOUTUBE_API_URL');
  assert.ok(allows(directives, 'script-src', apiUrl), `script-src recusa ${apiUrl}`);
  // O resto da API vem da mesma origem (`/s/player/...`).
  assert.ok(allows(directives, 'script-src', new URL('/s/player/x/www-widgetapi.js', apiUrl).href));
  const [, embedBase] = /new URL\(`(https:\/\/[^/`$]+)\/embed\/\$\{id\}`\)/.exec(youtube) ?? [];
  assert.ok(embedBase, 'youtube.tsx monta o iframe em <host>/embed/<id>');
  assert.deepEqual(resolveVideoSource('youtube', 'https://youtu.be/dQw4w9WgXcQ'), {
    kind: 'youtube',
    id: 'dQw4w9WgXcQ',
  });
  frame(`${embedBase}/embed/dQw4w9WgXcQ`);
  // Fora dos comentários, o código do player só escreve estas origens (as demais saem da URL da
  // aula, conferida por `resolveVideoSource`), e só o adaptador do YouTube cria <script>.
  const written = new Set();
  const files = readdirSync(resolve(root, 'packages/ui/src/components/learning/video')).filter(
    (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
  );
  assert.ok(files.includes('youtube.tsx') && files.includes('source.ts'));
  for (const file of files) {
    const code = video(file).replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm, '');
    for (const [origin] of code.matchAll(/https?:\/\/[A-Za-z0-9.-]+/g)) written.add(origin);
    if (file !== 'youtube.tsx') assert.doesNotMatch(code, /createElement\(\s*'script'/, file);
  }
  assert.deepEqual([...written].sort(), [
    'https://iframe.mediadelivery.net',
    'https://player.vimeo.com',
    'https://www.youtube-nocookie.com',
    'https://www.youtube.com',
  ]);

  // Vimeo, Bunny e Panda: o endereço do iframe é o que `resolveVideoSource` devolve.
  const vimeo = resolveVideoSource('vimeo', 'https://vimeo.com/76979871/abc123');
  assert.equal(vimeo.kind, 'vimeo');
  assert.equal(vimeo.embedUrl, vimeoEmbedUrl('https://player.vimeo.com/video/76979871?h=abc123'));
  frame(vimeo.embedUrl);
  const bunny = resolveVideoSource('bunny', 'https://iframe.mediadelivery.net/embed/123/abc-def');
  assert.equal(bunny.kind, 'bunny');
  frame(bunny.embedUrl);
  const panda = resolveVideoSource(
    'panda',
    'https://player-vz-1a2b3c4d-e5f.tv.pandavideo.com.br/embed/?v=abc',
  );
  assert.equal(panda.kind, 'panda');
  frame(panda.embedUrl);
  // Toda origem de frame-src tem um provedor que a usa.
  assert.deepEqual(
    [...used].sort(),
    directives['frame-src'].map((source) => `frame-src ${source}`).sort(),
  );

  // HLS da Bunny: `hls.js` busca por fetch (connect-src), liga o vídeo por MediaSource
  // (media-src blob:) e cria o worker de um blob (worker-src); o Safari toca direto (media-src).
  const hls = resolveVideoSource('bunny', 'https://vz-abc123-def.b-cdn.net/guid/playlist.m3u8');
  assert.deepEqual(hls, { kind: 'native', url: hls.url, hls: true });
  assert.ok(allows(directives, 'connect-src', hls.url));
  assert.ok(allows(directives, 'media-src', hls.url));
  assert.ok(allows(directives, 'media-src', 'blob:https://classroom.example.com/1b2c'));
  assert.ok(allows(directives, 'worker-src', 'blob:https://classroom.example.com/1b2c'));
  assert.match(video('native.tsx'), /import\('hls\.js'\)/);

  // `.mp4` e `.webm` de qualquer host https, pelo <video> nativo: media-src, sem connect-src.
  for (const url of ['https://cdn.example.com/aula.mp4', 'https://videos.example.org/a/b.webm']) {
    assert.deepEqual(resolveVideoSource('file', url), { kind: 'native', url, hls: false });
    assert.ok(allows(directives, 'media-src', url));
    assert.ok(!allows(directives, 'connect-src', url));
  }

  // O que o player não monta, a política não aceita: `.m3u8` de outro host vira `link` e não tem
  // connect-src; iframe só dos hosts exatos; script só de www.youtube.com.
  const foreign = 'https://cdn.example.com/live/playlist.m3u8';
  assert.equal(resolveVideoSource('bunny', foreign).kind, 'link');
  assert.equal(resolveVideoSource('file', foreign).kind, 'link');
  assert.ok(!allows(directives, 'connect-src', foreign));
  for (const url of [
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://vimeo.com/76979871',
    'https://evil.mediadelivery.net/embed/1/a',
    'https://tv.pandavideo.com.br/embed/?v=abc',
    'https://pandavideo.com.br/embed/?v=abc',
    'https://player-vz-1.tv.pandavideo.com.br.example.com/embed/?v=abc',
    'https://example.com/',
    'http://player.vimeo.com/video/1',
  ]) {
    assert.ok(!allows(directives, 'frame-src', url), `frame-src aceita ${url}`);
  }
  for (const url of [
    'https://youtube.com/iframe_api',
    'https://www.youtube-nocookie.com/iframe_api',
    'https://s.ytimg.com/x.js',
    'https://player.vimeo.com/api/player.js',
    'https://cdn.jsdelivr.net/npm/hls.js',
    'blob:https://classroom.example.com/1b2c',
  ]) {
    assert.ok(!allows(directives, 'script-src', url), `script-src aceita ${url}`);
  }
  assert.ok(!allows(directives, 'connect-src', 'https://b-cdn.net/x.m3u8'));
  // Imagem externa de qualquer `https` passa (Markdown, ADR 0027); `http` e outro esquema não.
  assert.ok(allows(directives, 'img-src', 'https://i.ytimg.com/vi/x/hq.jpg'));
  assert.ok(!allows(directives, 'img-src', 'http://i.ytimg.com/vi/x/hq.jpg'));

  // No admin, nada disso passa: sem frame-src nem worker-src, vale `default-src 'none'`.
  const admin = parsePolicy(buildPolicy(html, 'admin'));
  for (const [directive, url] of [
    ['frame-src', `${embedBase}/embed/dQw4w9WgXcQ`],
    ['frame-src', vimeo.embedUrl],
    ['script-src', apiUrl],
    ['connect-src', hls.url],
    ['media-src', 'https://cdn.example.com/aula.mp4'],
    ['worker-src', 'blob:https://edu-admin.example.com/1b2c'],
  ]) {
    assert.ok(!allows(admin, directive, url), `admin: ${directive} aceita ${url}`);
  }
});

test('o admin não monta player nem iframe: a política dele não precisa de origem externa', () => {
  const files = readdirSync(resolve(root, 'apps/admin/src'), { recursive: true }).filter(
    (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file),
  );
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.doesNotMatch(
      read(`apps/admin/src/${file}`),
      /<iframe\b|<video\b|\bVideoPlayer\b/,
      `apps/admin/src/${file}: prévia de vídeo no admin exige rever a CSP (proxy/lighttpd/csp.mjs)`,
    );
  }
});

test('o trecho do lighttpd define var.nuva_csp numa linha, com aspas duplas por fora', () => {
  for (const site of SITES) {
    const lines = lighttpdSnippet(html, site).trim().split('\n');
    assert.match(lines[0], /^# Gerado no build/);
    assert.ok(lines[0].includes(`(${site})`));
    assert.equal(lines[1], `var.nuva_csp = "${buildPolicy(html, site)}"`);
    assert.equal(lines.length, 2);
    // Nada na política fecha a string nem escapa dentro dela.
    assert.doesNotMatch(buildPolicy(html, site), /["\\]/);
  }
});

test('linha de comando: recebe o site e o index.html; sem um dos dois, sai com 1', () => {
  const script = resolve(root, 'proxy/lighttpd/csp.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'nuva-csp-'));
  try {
    const file = join(dir, 'index.html');
    writeFileSync(file, html);
    for (const site of SITES) {
      const ok = spawnSync(process.execPath, [script, site, file], { encoding: 'utf8' });
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(ok.stdout, lighttpdSnippet(html, site));
    }
    // A forma antiga (só o arquivo) e site desconhecido não geram nada.
    for (const args of [[], [file], ['classroom'], ['worker', file]]) {
      const bad = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
      assert.equal(bad.status, 1, args.join(' '));
      assert.equal(bad.stdout, '');
      assert.match(bad.stderr, /Uso:/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
        `node proxy/lighttpd/csp.mjs ${app} apps/${app}/dist/index.html > /app/nuva-csp.conf`,
      ),
      `${app}: gera a política no build`,
    );
    assert.ok(
      dockerfile.includes('COPY --from=build /app/nuva-csp.conf /etc/lighttpd/nuva-csp.conf'),
      `${app}: copia a política para a imagem final`,
    );
  }
});
