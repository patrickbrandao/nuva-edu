// Validação do template do certificado (spec 015, "Template" e "Higienização"; ADR 0026).
// Lista de permissões com recusa: devolve todos os problemas e nunca corrige o HTML.

import { checkCss } from './css.ts';
import {
  CERTIFICATE_QRCODE_KEY,
  CERTIFICATE_TEMPLATE_REQUIRED_KEYS,
  CERTIFICATE_TEMPLATE_VALIDATION_KEYS,
  type CertificateTemplateKey,
  scanKeywords,
} from './keywords.ts';
import { parseTemplateHtml, type TemplateAttribute, type TemplateNode } from './parse.ts';
import { type CertificateTemplateProblem, LineMap, ProblemList } from './problems.ts';
import {
  CERTIFICATE_TEMPLATE_MAX_BYTES,
  DATA_IMAGE_PATTERN,
  ELEMENT_ATTRIBUTES,
  GLOBAL_ATTRIBUTES,
  HTML_ELEMENTS,
  HTTPS_LINK_PATTERN,
  INSTALLATION_IMAGE_PATTERN,
  INSTALLATION_IMAGE_WIDTHS,
  SVG_ATTRIBUTES,
  SVG_ELEMENTS,
  SVG_LOCAL_URL_PATTERN,
  SVG_NAMESPACE,
  TABLE_ATTRIBUTES,
  TABLE_ELEMENTS,
} from './rules.ts';

/** Imagem da instalação citada no template (`/api/v1/images/<id>/<largura>.webp`). */
export interface CertificateTemplateImageRef {
  /** UUID da imagem, em minúsculas. */
  id: string;
  /** Largura da variante. */
  width: number;
  /** Caminho exatamente como o preenchimento o procura em `images`. */
  path: string;
}

export interface CertificateTemplateValidation {
  /** Verdadeiro quando não há nenhum problema. */
  valid: boolean;
  /** Todos os problemas, na ordem do documento (até `CERTIFICATE_TEMPLATE_MAX_PROBLEMS`). */
  problems: CertificateTemplateProblem[];
  /** Verdadeiro quando havia mais problemas do que o máximo devolvido. */
  truncated: boolean;
  /** Ids das imagens da instalação citadas, sem repetição: quem salva confere se existem. */
  imageIds: string[];
  /** Cada variante citada, sem repetição: o worker carrega estas para o preenchimento. */
  images: CertificateTemplateImageRef[];
  /** Palavras-chave usadas, sem repetição, na ordem da primeira ocorrência. */
  keys: CertificateTemplateKey[];
  /** Verdadeiro quando o template usa `{{certificado.qrcode}}` (o worker gera o SVG). */
  usesQrCode: boolean;
}

interface Context {
  svg: boolean;
  style: boolean;
  title: boolean;
}

/** Resultado interno: a validação e a árvore lida, que o preenchimento serializa. */
export interface TemplateAnalysis extends CertificateTemplateValidation {
  children: TemplateNode[];
}

const URL_VALIDATION_ONLY = /^\{\{\s*certificado\.url_validacao\s*\}\}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: procura justamente o caractere NUL.
const NUL_PATTERN = /\u0000/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

class Analyzer {
  readonly lines: LineMap;
  readonly problems: ProblemList;
  readonly keys = new Set<CertificateTemplateKey>();
  readonly images = new Map<string, CertificateTemplateImageRef>();

  constructor(source: string) {
    this.lines = new LineMap(source);
    this.problems = new ProblemList(this.lines);
  }

  visit(nodes: readonly TemplateNode[], context: Context): void {
    for (const node of nodes) {
      if (node.kind === 'text') {
        this.text(node.value, node.offset, context);
        continue;
      }
      const name = node.name.toLowerCase();
      const allowed = context.svg ? SVG_ELEMENTS.has(name) : HTML_ELEMENTS.has(name);
      if (!allowed) {
        this.problems.add(
          'element_not_allowed',
          context.svg
            ? `Elemento <${node.name}> não é aceito dentro de <svg>.`
            : `Elemento <${node.name}> não é aceito.`,
          node.offset,
        );
        continue;
      }
      const inSvg = context.svg || name === 'svg';
      if (name === 'meta') {
        this.meta(node.attributes, node.offset);
      } else {
        for (const attribute of node.attributes) {
          this.attribute(name, attribute, inSvg);
        }
      }
      this.visit(node.children, {
        svg: inSvg,
        style: name === 'style',
        title: name === 'title',
      });
    }
  }

  private text(value: string, offset: number, context: Context): void {
    if (context.style) {
      checkCss(value, 'stylesheet', this.lines.at(offset), this.problems);
      return;
    }
    for (const token of scanKeywords(value)) {
      if (token.kind === 'text') {
        continue;
      }
      const at = offset + token.index;
      if (token.kind === 'key') {
        if (token.key === CERTIFICATE_QRCODE_KEY && (context.svg || context.title)) {
          this.problems.add(
            'key_in_attribute',
            '{{certificado.qrcode}} só é aceito no texto do documento, fora de <svg> e de <title>.',
            at,
          );
          continue;
        }
        this.keys.add(token.key);
      } else {
        this.keyError(token, at);
      }
    }
  }

  private keyError(
    token: { kind: 'unknown'; raw: string } | { kind: 'unclosed' },
    at: number,
  ): void {
    if (token.kind === 'unclosed') {
      this.problems.add('unclosed_key', '"{{" sem "}}" depois.', at);
    } else if (token.raw.slice(2, -2).trim() === '') {
      this.problems.add('unknown_key', 'Palavra-chave vazia.', at);
    } else {
      this.problems.add('unknown_key', `Palavra-chave desconhecida: ${token.raw}.`, at);
    }
  }

  private meta(attributes: readonly TemplateAttribute[], offset: number): void {
    const charset = attributes.find((attribute) => attribute.name === 'charset');
    if (charset === undefined) {
      this.problems.add('element_not_allowed', '<meta> só é aceito com charset.', offset);
    } else if (!/^utf-8$/i.test(charset.value.trim())) {
      this.problems.add('attribute_not_allowed', '<meta charset> só aceita utf-8.', charset.offset);
    }
    for (const attribute of attributes) {
      if (attribute.name !== 'charset') {
        this.problems.add(
          'attribute_not_allowed',
          `<meta> só aceita charset; ${attribute.name} não é aceito.`,
          attribute.offset,
        );
      }
    }
  }

  private isAllowedAttribute(element: string, name: string, inSvg: boolean): boolean {
    if (inSvg) {
      return SVG_ATTRIBUTES.has(name);
    }
    return (
      GLOBAL_ATTRIBUTES.has(name) ||
      (TABLE_ELEMENTS.has(element) && TABLE_ATTRIBUTES.has(name)) ||
      ELEMENT_ATTRIBUTES[element]?.has(name) === true
    );
  }

  private attribute(element: string, attribute: TemplateAttribute, inSvg: boolean): void {
    const { name, value, offset } = attribute;
    if (name.startsWith('on')) {
      this.problems.add(
        'attribute_not_allowed',
        `Atributo de evento ${name} não é aceito em <${element}>.`,
        offset,
      );
      return;
    }
    if (!this.isAllowedAttribute(element, name, inSvg)) {
      const message =
        inSvg && (name === 'href' || name === 'xlink:href')
          ? `${name} não é aceito em SVG.`
          : `Atributo ${name} não é aceito em <${element}>.`;
      this.problems.add('attribute_not_allowed', message, offset);
      return;
    }
    if (name === 'style') {
      checkCss(value, 'declarations', this.lines.at(offset), this.problems);
      return;
    }

    const keys = this.attributeKeys(value, offset, inSvg);
    if (inSvg) {
      this.svgValue(name, value, offset);
    } else if (name === 'href') {
      if (URL_VALIDATION_ONLY.test(value.trim())) {
        this.keys.add('certificado.url_validacao');
      } else if (!HTTPS_LINK_PATTERN.test(value)) {
        this.problems.add(
          'url_not_allowed',
          'Link só com https:// ou exatamente {{certificado.url_validacao}}.',
          offset,
        );
      } else {
        this.addKeys(keys);
      }
    } else if (name === 'src') {
      this.imageSource(value, offset);
    } else {
      this.addKeys(keys);
    }
  }

  /** Palavras-chave de um atributo; os erros de sintaxe e o QR já são registrados aqui. */
  private attributeKeys(value: string, offset: number, inSvg: boolean): CertificateTemplateKey[] {
    const keys: CertificateTemplateKey[] = [];
    for (const token of scanKeywords(value)) {
      if (token.kind === 'text') {
        continue;
      }
      if (token.kind !== 'key') {
        this.keyError(token, offset);
      } else if (token.key === CERTIFICATE_QRCODE_KEY) {
        this.problems.add(
          'key_in_attribute',
          '{{certificado.qrcode}} vira marcação e não é aceito em atributo.',
          offset,
        );
      } else if (inSvg) {
        this.problems.add(
          'key_in_attribute',
          'Palavra-chave em atributo de SVG não é aceita: use-a no texto.',
          offset,
        );
      } else {
        keys.push(token.key);
      }
    }
    return keys;
  }

  private addKeys(keys: readonly CertificateTemplateKey[]): void {
    for (const key of keys) {
      this.keys.add(key);
    }
  }

  private svgValue(name: string, value: string, offset: number): void {
    if (name === 'xmlns') {
      if (value !== SVG_NAMESPACE) {
        this.problems.add('attribute_not_allowed', `xmlns só aceita ${SVG_NAMESPACE}.`, offset);
      }
      return;
    }
    if (value.includes('\\')) {
      this.problems.add(
        'attribute_not_allowed',
        `Barra invertida (escape CSS) não é aceita no atributo ${name}.`,
        offset,
      );
      return;
    }
    if (/url\s*\(/i.test(value.replace(SVG_LOCAL_URL_PATTERN, ''))) {
      this.problems.add(
        'url_not_allowed',
        `No atributo ${name}, url() só aceita referência local (url(#id)).`,
        offset,
      );
    }
  }

  private imageSource(value: string, offset: number): void {
    if (DATA_IMAGE_PATTERN.test(value)) {
      return;
    }
    const match = INSTALLATION_IMAGE_PATTERN.exec(value);
    const width = match === null ? Number.NaN : Number(match[2]);
    if (match?.[1] === undefined || !INSTALLATION_IMAGE_WIDTHS.has(width)) {
      this.problems.add(
        'url_not_allowed',
        'Imagem só em data:image (PNG, JPEG, WebP ou GIF, base64) ou /api/v1/images/<id>/<largura>.webp.',
        offset,
      );
      return;
    }
    const id = match[1].toLowerCase();
    const path = `/api/v1/images/${id}/${width}.webp`;
    if (!this.images.has(path)) {
      this.images.set(path, { id, width, path });
    }
  }

  requireKeys(): void {
    for (const key of CERTIFICATE_TEMPLATE_REQUIRED_KEYS) {
      if (!this.keys.has(key)) {
        this.problems.addAt('missing_required_key', `Falta a palavra-chave {{${key}}}.`, 1, 1);
      }
    }
    if (!CERTIFICATE_TEMPLATE_VALIDATION_KEYS.some((key) => this.keys.has(key))) {
      this.problems.addAt(
        'missing_required_key',
        'Falta {{certificado.url_validacao}} ou {{certificado.qrcode}}: o certificado precisa ser conferível.',
        1,
        1,
      );
    }
  }
}

/** Análise completa. `requireKeys` desligado serve para o SVG do QR, que não leva palavra-chave. */
export function analyzeTemplate(html: string, options: { requireKeys: boolean }): TemplateAnalysis {
  const analyzer = new Analyzer(html);
  const { problems } = analyzer;
  let children: TemplateNode[] = [];

  if (Buffer.byteLength(html, 'utf8') > CERTIFICATE_TEMPLATE_MAX_BYTES) {
    problems.addAt(
      'too_large',
      `O template passa de ${CERTIFICATE_TEMPLATE_MAX_BYTES / 1024} KiB (com as imagens embutidas).`,
      1,
      1,
    );
  } else {
    const nul = NUL_PATTERN.exec(html);
    if (nul !== null) {
      problems.add('parse_error', 'Caractere nulo (U+0000) no template.', nul.index);
    }
    const surrogate = LONE_SURROGATE.exec(html);
    if (surrogate !== null) {
      problems.add('parse_error', 'Texto que não é UTF-8 válido.', surrogate.index);
    }
    children = parseTemplateHtml(html, problems).children;
    analyzer.visit(children, { svg: false, style: false, title: false });
    if (options.requireKeys) {
      analyzer.requireKeys();
    }
  }

  const images = [...analyzer.images.values()];
  return {
    valid: problems.items.length === 0,
    problems: problems.items,
    truncated: problems.truncated,
    imageIds: [...new Set(images.map((image) => image.id))],
    images,
    keys: [...analyzer.keys],
    usesQrCode: analyzer.keys.has(CERTIFICATE_QRCODE_KEY),
    children,
  };
}

/**
 * Valida o template (spec 015): elementos, atributos, links, imagens, CSS, palavras-chave,
 * obrigatórias e tamanho. Devolve todos os problemas, com `rule`, `message`, `line` e `column`,
 * e os ids das imagens da instalação citadas (quem salva confere se existem e não estão
 * ocultas; ausente é `image_not_found`, regra que esta função não produz por não ver o banco).
 * Nunca corrige o HTML.
 */
export function validateCertificateTemplate(html: string): CertificateTemplateValidation {
  const { children: _children, ...validation } = analyzeTemplate(html, { requireKeys: true });
  return validation;
}
