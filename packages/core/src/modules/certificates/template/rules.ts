// Listas de permissões da higienização do template (spec 015, "Higienização"; ADR 0026).
// Nomes em minúsculas, como o analisador os entrega e o navegador os ajusta no SVG.

import { IMAGE_VARIANT_WIDTHS } from '../../images/rules.ts';

/** Regras de recusa do template (`rule` de cada problema, spec 015). */
export const CERTIFICATE_TEMPLATE_RULES = [
  'parse_error',
  'too_large',
  'element_not_allowed',
  'attribute_not_allowed',
  'url_not_allowed',
  'css_not_allowed',
  'image_not_found',
  'unknown_key',
  'unclosed_key',
  'key_in_attribute',
  'missing_required_key',
] as const;
export type CertificateTemplateRule = (typeof CERTIFICATE_TEMPLATE_RULES)[number];

/** Tamanho máximo do template, em bytes UTF-8 (RNF-03: 768 KiB, com as imagens embutidas). */
export const CERTIFICATE_TEMPLATE_MAX_BYTES = 768 * 1024;

/** Elementos HTML aceitos fora de um `<svg>`. */
export const HTML_ELEMENTS: ReadonlySet<string> = new Set([
  'html',
  'head',
  'body',
  'title',
  'meta',
  'style',
  'div',
  'span',
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'small',
  'sub',
  'sup',
  'blockquote',
  'section',
  'header',
  'footer',
  'main',
  'article',
  'figure',
  'figcaption',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'colgroup',
  'col',
  'img',
  'a',
  'svg',
]);

/** Elementos de desenho aceitos dentro de um `<svg>`. */
export const SVG_ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'defs',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
]);

/** Elementos HTML sem conteúdo nem marca de fechamento. */
export const VOID_ELEMENTS: ReadonlySet<string> = new Set(['br', 'hr', 'img', 'col', 'meta']);

/** Atributos aceitos em qualquer elemento HTML. */
export const GLOBAL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'class',
  'id',
  'style',
  'title',
  'lang',
  'dir',
]);

/** Elementos de tabela e os atributos próprios deles. */
export const TABLE_ELEMENTS: ReadonlySet<string> = new Set([
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'colgroup',
  'col',
]);
export const TABLE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'colspan',
  'rowspan',
  'width',
  'height',
  'align',
  'valign',
]);

/** Atributos próprios de alguns elementos HTML. */
export const ELEMENT_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  img: new Set(['src', 'alt', 'width', 'height']),
  a: new Set(['href']),
};

/** Atributos aceitos nos elementos SVG: os globais sem `title` e `dir`, e os de apresentação. */
export const SVG_ATTRIBUTES: ReadonlySet<string> = new Set([
  'class',
  'id',
  'style',
  'lang',
  'xmlns',
  'version',
  'viewbox',
  'preserveaspectratio',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'fx',
  'fy',
  'dx',
  'dy',
  'rotate',
  'd',
  'points',
  'transform',
  'offset',
  'gradientunits',
  'gradienttransform',
  'spreadmethod',
  'clippathunits',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'stroke-miterlimit',
  'opacity',
  'stop-color',
  'stop-opacity',
  'clip-path',
  'clip-rule',
  'color',
  'display',
  'visibility',
  'shape-rendering',
  'vector-effect',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'word-spacing',
  'text-decoration',
]);

/** Único valor aceito em `xmlns`. */
export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** Imagem embutida aceita em `img src` e em `url()` do CSS. */
export const DATA_IMAGE_PATTERN =
  /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i;

/** Fonte embutida aceita em `url()` do CSS. */
export const DATA_FONT_PATTERN = /^data:font\/(?:woff2|woff|ttf|otf);base64,[A-Za-z0-9+/]+={0,2}$/i;

/** Caminho de entrega de uma imagem da instalação (spec 029). */
export const INSTALLATION_IMAGE_PATTERN =
  /^\/api\/v1\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(\d{1,5})\.webp$/i;

/** Larguras que existem como variante de imagem. */
export const INSTALLATION_IMAGE_WIDTHS: ReadonlySet<number> = new Set(IMAGE_VARIANT_WIDTHS);

/** `a href` aceito além da palavra-chave da URL de validação: `https:` sem caractere de controle. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: recusa justamente os caracteres de controle.
export const HTTPS_LINK_PATTERN = /^https:\/\/[^\s\u0000-\u001f\u007f]+$/i;

/** Referência local em atributo de apresentação do SVG: `url(#id)`. */
export const SVG_LOCAL_URL_PATTERN = /url\(\s*#[A-Za-z_][\w.-]*\s*\)/gi;

/** Regras `@` aceitas no CSS. */
export const CSS_AT_RULES: ReadonlySet<string> = new Set([
  'font-face',
  'media',
  'page',
  'supports',
  'keyframes',
]);

/**
 * Funções CSS recusadas: as que carregam recurso (`image-set` e afins aceitam texto como
 * endereço, sem `url()`), as que executam código (`expression`) e `attr()`, que traria para o
 * CSS o valor de um atributo.
 */
export const CSS_FORBIDDEN_FUNCTIONS: ReadonlySet<string> = new Set([
  'expression',
  'url',
  'src',
  'image',
  'image-set',
  '-webkit-image-set',
  'cross-fade',
  '-webkit-cross-fade',
  'element',
  '-moz-element',
  'paint',
  'attr',
]);

/** Propriedades CSS recusadas (comportamento ativo de navegadores antigos). */
export const CSS_FORBIDDEN_PROPERTIES: ReadonlySet<string> = new Set(['behavior', '-moz-binding']);
