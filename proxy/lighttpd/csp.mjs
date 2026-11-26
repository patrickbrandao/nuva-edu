#!/usr/bin/env node
// Gera o trecho do lighttpd com a Content-Security-Policy de um site (specs 031 e 033).
//
//   node proxy/lighttpd/csp.mjs admin apps/admin/dist/index.html > nuva-csp.conf
//   node proxy/lighttpd/csp.mjs classroom apps/classroom/dist/index.html > nuva-csp.conf
//
// O primeiro argumento é o site: os dois aceitam imagens `https:` do Markdown saneado (ADR 0027);
// o classroom soma as origens dos players de vídeo (`PLAYER_SOURCES`, abaixo).
//
// Roda no build da imagem, sobre o `index.html` que o Vite acabou de gerar: cada <script> inline
// (hoje, o do tema: `THEME_BOOT_SCRIPT` de @nuva-edu/ui) entra na política pelo seu hash, e por
// isso `script-src` não precisa de `unsafe-inline`. Mudou o script, mudou o hash, sem ninguém
// copiar nada à mão.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Tudo o que os sites usam vem da própria origem: a API e o SSE (`connect-src`), as imagens
 * regravadas pela API (`img-src`, mais `data:` para ícones embutidos no CSS e `blob:` para a prévia
 * do `ImagePicker`, feita com `URL.createObjectURL` antes do envio), fontes e estilos.
 *
 * A única origem externa da base é `https:` em `img-src`: as imagens do Markdown saneado
 * (ADR 0027) apontam para o host que o autor escreveu, e a exibição não as busca nem as regrava
 * pelo servidor. É só imagem, e só `https`: `script-src`, `frame-src`, `connect-src` e o resto
 * continuam fechados. O que não está listado cai em `default-src 'none'`.
 */
const BASE_POLICY = [
  ['default-src', "'none'"],
  ['script-src', "'self'"],
  ['style-src', "'self'"],
  ['img-src', "'self'", 'data:', 'blob:', 'https:'],
  ['font-src', "'self'"],
  ['connect-src', "'self'"],
  ['media-src', "'self'"],
  ['manifest-src', "'self'"],
  ['base-uri', "'self'"],
  ['form-action', "'self'"],
  ['frame-ancestors', "'none'"],
];

/** Os sites que têm política: o nome é o da pasta em `apps/`. */
export const SITES = ['admin', 'classroom'];

/**
 * O que o `VideoPlayer` de @nuva-edu/ui usa fora da própria origem (spec 009, "Vídeo e links
 * externos"; ADR 0025). Só o classroom toca vídeo; o admin edita a URL da aula sem prévia.
 * Cada origem aqui tem um uso no player; `scripts/csp.test.mjs` confere a lista contra o código
 * dele. Provedor novo na tabela da 009 entra aqui e lá.
 *
 * - `script-src`: a IFrame API do YouTube (`/iframe_api`, que carrega o resto de
 *   `www.youtube.com/s/player/`). É o único script externo; `@vimeo/player` e `hls.js` vão no bundle.
 * - `frame-src`: o `iframe` de cada provedor. YouTube pelo host sem cookie; o Panda usa um
 *   subdomínio por conta (`player-vz-*.tv.pandavideo.com.br`), e a CSP só aceita curinga no rótulo
 *   inteiro.
 * - `connect-src`: o `hls.js` busca a lista e os segmentos HLS por `fetch`; HLS só da Bunny.
 * - `media-src`: `https:` para `.mp4` e `.webm` de qualquer host no `<video>` nativo (cobre também
 *   o HLS nativo da Bunny no Safari); `blob:` porque o `hls.js` liga o vídeo por `MediaSource`.
 * - `worker-src`: o `hls.js` cria o worker de demux a partir de um `blob:`.
 *
 * Bunny e Panda falam por `postMessage` com o `iframe`: não precisam de `connect-src`.
 */
export const PLAYER_SOURCES = [
  ['script-src', 'https://www.youtube.com'],
  ['connect-src', 'https://*.b-cdn.net'],
  ['media-src', 'https:', 'blob:'],
  [
    'frame-src',
    'https://www.youtube-nocookie.com',
    'https://player.vimeo.com',
    'https://iframe.mediadelivery.net',
    'https://*.tv.pandavideo.com.br',
  ],
  ['worker-src', 'blob:'],
];

const EXTRA_SOURCES = { admin: [], classroom: PLAYER_SOURCES };

/** Diretivas do site, na ordem: as da base com as origens a mais, depois as que só o site tem. */
function siteDirectives(site) {
  if (!SITES.includes(site)) {
    throw new Error(`Site desconhecido: ${site} (use ${SITES.join(' ou ')})`);
  }
  const extra = new Map(EXTRA_SOURCES[site].map(([directive, ...sources]) => [directive, sources]));
  const directives = BASE_POLICY.map(([directive, ...sources]) => {
    const more = extra.get(directive) ?? [];
    extra.delete(directive);
    return [directive, ...sources, ...more];
  });
  return [...directives, ...[...extra].map(([directive, sources]) => [directive, ...sources])];
}

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/** Conteúdo de cada <script> sem `src` do HTML, exatamente como o navegador o recebe. */
export function inlineScripts(html) {
  const found = [];
  for (const [, attributes, content] of html.matchAll(SCRIPT_TAG)) {
    if (!/(^|\s)src\s*=/i.test(attributes) && content.length > 0) {
      found.push(content);
    }
  }
  return found;
}

/** Fonte de CSP para um script inline: `'sha256-<base64>'`. */
export function scriptHash(content) {
  return `'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`;
}

/** A política completa do site para o HTML dado, numa linha só. */
export function buildPolicy(html, site) {
  const hashes = [...new Set(inlineScripts(html).map(scriptHash))];
  return siteDirectives(site)
    .map(([directive, ...sources]) =>
      [directive, ...sources, ...(directive === 'script-src' ? hashes : [])].join(' '),
    )
    .join('; ');
}

/**
 * Arquivo incluído pelo `lighttpd.conf`: define `var.nuva_csp`, usada no bloco de cabeçalhos da
 * rota que entrega o `index.html`.
 */
export function lighttpdSnippet(html, site) {
  const policy = buildPolicy(html, site);
  // O valor vai entre aspas duplas na configuração do lighttpd, onde a barra invertida escapa.
  if (/["\\\n\r]/.test(policy)) {
    throw new Error(`Política com caractere que o lighttpd interpretaria: ${policy}`);
  }
  return [
    `# Gerado no build da imagem por proxy/lighttpd/csp.mjs (${site}) a partir do index.html. Não edite.`,
    `var.nuva_csp = "${policy}"`,
    '',
  ].join('\n');
}

if (import.meta.main) {
  const [site, file] = process.argv.slice(2);
  if (!SITES.includes(site) || !file) {
    console.error(`Uso: node proxy/lighttpd/csp.mjs <${SITES.join('|')}> <caminho do index.html>`);
    process.exit(1);
  }
  process.stdout.write(lighttpdSnippet(readFileSync(file, 'utf8'), site));
}
