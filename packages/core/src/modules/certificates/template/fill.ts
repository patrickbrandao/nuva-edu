// Preenchimento do template (spec 015, "Template" e "PDF"): valida de novo, troca as
// palavras-chave com escape HTML, põe o SVG do QR e troca as imagens da instalação por `data:`.
//
// A saída é a árvore validada serializada de novo (marcação canônica, sem comentários), não o
// texto original com trocas: o Chromium lê exatamente o que a validação conferiu.

import {
  CERTIFICATE_QRCODE_KEY,
  CERTIFICATE_TEMPLATE_KEYS,
  type CertificateTemplateValues,
  scanKeywords,
} from './keywords.ts';
import type { TemplateElement, TemplateNode } from './parse.ts';
import { certificateTemplateInvalid } from './problems.ts';
import { DATA_IMAGE_PATTERN, INSTALLATION_IMAGE_PATTERN, VOID_ELEMENTS } from './rules.ts';
import { analyzeTemplate } from './validate.ts';

export interface FillCertificateTemplateOptions {
  /** SVG do QR da URL de validação (`qrcode`), exigido quando o template usa `certificado.qrcode`. */
  qrSvg?: string | undefined;
  /**
   * Imagens da instalação já em `data:image/...;base64,`, pelo caminho citado no template
   * (`CertificateTemplateImageRef.path`). Caminho ausente vira um espaço vazio.
   */
  images?: Readonly<Record<string, string>> | undefined;
}

export interface FilledCertificateTemplate {
  /** Documento HTML completo, pronto para o `setContent` do worker. */
  html: string;
  /** Caminhos de imagem citados e não recebidos em `images` (o worker avisa no log). */
  missingImages: string[];
}

/** GIF transparente de 1×1: o lugar da imagem apagada fica vazio, com o tamanho declarado. */
export const CERTIFICATE_EMPTY_IMAGE =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapa `&`, `<`, `>`, `"` e `'` (spec 015: todo valor, no texto e nos atributos). */
export function escapeCertificateHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

function assertValues(values: CertificateTemplateValues): void {
  for (const key of CERTIFICATE_TEMPLATE_KEYS) {
    if (key !== CERTIFICATE_QRCODE_KEY && typeof values[key] !== 'string') {
      throw new TypeError(`fillCertificateTemplate: falta o valor de ${key}.`);
    }
  }
}

/** Valida o SVG do QR com as mesmas regras e devolve a marcação canônica dele. */
function canonicalQrSvg(qrSvg: string): string {
  const analysis = analyzeTemplate(qrSvg, { requireKeys: false });
  const elements = analysis.children.filter(
    (node) => node.kind === 'element' || node.value.trim() !== '',
  );
  const [svg] = elements;
  if (
    !analysis.valid ||
    analysis.keys.length > 0 ||
    elements.length !== 1 ||
    svg?.kind !== 'element' ||
    svg.name !== 'svg'
  ) {
    throw new TypeError('fillCertificateTemplate: qrSvg não é um único <svg> de desenho.');
  }
  return new Serializer({}, '', {}).nodes([svg], false);
}

class Serializer {
  readonly missingImages = new Set<string>();
  readonly #values: Partial<CertificateTemplateValues>;
  readonly #qrMarkup: string;
  readonly #images: Readonly<Record<string, string>>;

  constructor(
    values: Partial<CertificateTemplateValues>,
    qrMarkup: string,
    images: Readonly<Record<string, string>>,
  ) {
    this.#values = values;
    this.#qrMarkup = qrMarkup;
    this.#images = images;
  }

  /** Troca as palavras-chave de um valor; `markup` liga o QR (só em texto). */
  #replace(value: string, escaped: boolean, markup: boolean): string {
    let output = '';
    for (const token of scanKeywords(value)) {
      if (token.kind === 'text') {
        output += escaped ? escapeCertificateHtml(token.value) : token.value;
      } else if (token.kind === 'key') {
        const { key } = token;
        if (key === CERTIFICATE_QRCODE_KEY) {
          if (!markup) {
            throw new TypeError('fillCertificateTemplate: QR fora de posição de texto.');
          }
          output += this.#qrMarkup;
        } else {
          const replacement = this.#values[key] ?? '';
          output += escaped ? escapeCertificateHtml(replacement) : replacement;
        }
      } else {
        throw new TypeError('fillCertificateTemplate: palavra-chave inválida após a validação.');
      }
    }
    return output;
  }

  #attributeValue(element: string, name: string, value: string): string {
    if (element === 'img' && name === 'src') {
      if (DATA_IMAGE_PATTERN.test(value)) {
        return value;
      }
      const match = INSTALLATION_IMAGE_PATTERN.exec(value);
      const path =
        match === null ? value : `/api/v1/images/${match[1]?.toLowerCase()}/${match[2]}.webp`;
      const embedded = this.#images[path];
      if (embedded !== undefined && DATA_IMAGE_PATTERN.test(embedded)) {
        return embedded;
      }
      this.missingImages.add(path);
      return CERTIFICATE_EMPTY_IMAGE;
    }
    if (name === 'style') {
      return value;
    }
    const replaced = this.#replace(value, false, false);
    if (element === 'a' && name === 'href' && !/^https?:\/\/[^\s]/i.test(replaced)) {
      throw new TypeError('fillCertificateTemplate: link preenchido não é http(s).');
    }
    return replaced;
  }

  element(node: TemplateElement, inSvg: boolean): string {
    const name = node.name.toLowerCase();
    const svg = inSvg || name === 'svg';
    let output = `<${node.name}`;
    for (const attribute of node.attributes) {
      const value = this.#attributeValue(name, attribute.name, attribute.value);
      output += ` ${attribute.name}="${escapeCertificateHtml(value)}"`;
    }
    output += '>';
    if (!svg && VOID_ELEMENTS.has(name)) {
      return output;
    }
    if (name === 'style') {
      output += node.children.map((child) => (child.kind === 'text' ? child.value : '')).join('');
    } else {
      output += this.nodes(node.children, svg, name === 'title');
    }
    return `${output}</${node.name}>`;
  }

  nodes(nodes: readonly TemplateNode[], inSvg: boolean, inTitle = false): string {
    let output = '';
    for (const node of nodes) {
      output +=
        node.kind === 'text'
          ? this.#replace(node.value, true, !inSvg && !inTitle)
          : this.element(node, inSvg);
    }
    return output;
  }
}

/**
 * Preenche o template para a renderização (worker) ou para o exemplo. Valida de novo e lança
 * `certificate_template_invalid` (422) se o template não passa; lança `TypeError` para valores
 * ausentes ou QR inválido (erro de quem chama). Fragmento é envolvido em `<html><body>`; a saída
 * começa sempre por `<!DOCTYPE html>`.
 */
export function fillCertificateTemplate(
  html: string,
  values: CertificateTemplateValues,
  options: FillCertificateTemplateOptions = {},
): FilledCertificateTemplate {
  assertValues(values);
  const analysis = analyzeTemplate(html, { requireKeys: true });
  if (!analysis.valid) {
    throw certificateTemplateInvalid(analysis.problems);
  }
  let qrMarkup = '';
  if (analysis.usesQrCode) {
    if (options.qrSvg === undefined) {
      throw new TypeError('fillCertificateTemplate: o template usa o QR e qrSvg não veio.');
    }
    qrMarkup = canonicalQrSvg(options.qrSvg);
  }

  const serializer = new Serializer(values, qrMarkup, options.images ?? {});
  const body = serializer.nodes(analysis.children, false);
  const names = new Set(
    analysis.children.flatMap((node) => (node.kind === 'element' ? [node.name] : [])),
  );
  let document: string;
  if (names.has('html')) {
    document = body;
  } else if (names.has('body') || names.has('head')) {
    document = `<html>${body}</html>`;
  } else {
    document = `<html><body>${body}</body></html>`;
  }
  return { html: `<!DOCTYPE html>${document}`, missingImages: [...serializer.missingImages] };
}
