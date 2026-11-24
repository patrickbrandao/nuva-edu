#!/usr/bin/env node
// Gera o trecho do lighttpd com a Content-Security-Policy de um site (specs 031 e 033).
//
//   node proxy/lighttpd/csp.mjs apps/admin/dist/index.html > nuva-csp.conf
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
 * Nada externo entra; o que não está listado cai em `default-src 'none'`.
 */
const BASE_POLICY = [
  ['default-src', "'none'"],
  ['script-src', "'self'"],
  ['style-src', "'self'"],
  ['img-src', "'self'", 'data:', 'blob:'],
  ['font-src', "'self'"],
  ['connect-src', "'self'"],
  ['media-src', "'self'"],
  ['manifest-src', "'self'"],
  ['base-uri', "'self'"],
  ['form-action', "'self'"],
  ['frame-ancestors', "'none'"],
];

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

/** A política completa para o HTML dado, numa linha só. */
export function buildPolicy(html) {
  const hashes = [...new Set(inlineScripts(html).map(scriptHash))];
  return BASE_POLICY.map(([directive, ...sources]) =>
    [directive, ...sources, ...(directive === 'script-src' ? hashes : [])].join(' '),
  ).join('; ');
}

/**
 * Arquivo incluído pelo `lighttpd.conf`: define `var.nuva_csp`, usada no bloco de cabeçalhos da
 * rota que entrega o `index.html`.
 */
export function lighttpdSnippet(html) {
  const policy = buildPolicy(html);
  // O valor vai entre aspas duplas na configuração do lighttpd, onde a barra invertida escapa.
  if (/["\\\n\r]/.test(policy)) {
    throw new Error(`Política com caractere que o lighttpd interpretaria: ${policy}`);
  }
  return [
    '# Gerado no build da imagem por proxy/lighttpd/csp.mjs a partir do index.html. Não edite.',
    `var.nuva_csp = "${policy}"`,
    '',
  ].join('\n');
}

if (import.meta.main) {
  const [file] = process.argv.slice(2);
  if (!file) {
    console.error('Uso: node proxy/lighttpd/csp.mjs <caminho do index.html>');
    process.exit(1);
  }
  process.stdout.write(lighttpdSnippet(readFileSync(file, 'utf8')));
}
