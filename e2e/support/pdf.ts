// Texto de um PDF, para conferir o que o certificado traz sem dependência nova. Cobre o que o
// Chromium gera (Skia): objetos soltos, fluxos com FlateDecode, fontes Type0 com Identity-H e
// ToUnicode. Não é um leitor de PDF geral: serve às asserções do e2e.
import { inflateSync } from 'node:zlib';

interface PdfObject {
  dict: string;
  stream: Buffer | null;
}

function parseObjects(pdf: Buffer): Map<number, PdfObject> {
  const text = pdf.toString('latin1');
  const objects = new Map<number, PdfObject>();
  const header = /(\d+)\s+0\s+obj\b/g;
  for (let match = header.exec(text); match; match = header.exec(text)) {
    const start = match.index + match[0].length;
    const end = text.indexOf('endobj', start);
    if (end === -1) break;
    const body = text.slice(start, end);
    const streamAt = body.search(/\bstream\r?\n/);
    let dict = body;
    let stream: Buffer | null = null;
    if (streamAt !== -1) {
      dict = body.slice(0, streamAt);
      const dataStart = start + streamAt + (body.slice(streamAt).startsWith('stream\r\n') ? 8 : 7);
      const length = /\/Length\s+(\d+)(?!\s+0\s+R)/.exec(dict);
      const dataEnd = length ? dataStart + Number(length[1]) : text.lastIndexOf('endstream', end);
      let raw = pdf.subarray(dataStart, dataEnd);
      if (/\/FlateDecode/.test(dict)) {
        try {
          raw = inflateSync(raw);
        } catch {
          raw = Buffer.alloc(0);
        }
      }
      stream = raw;
    }
    objects.set(Number(match[1]), { dict, stream });
    header.lastIndex = end;
  }
  return objects;
}

/** Código (hexadecimal) → texto, a partir de um CMap ToUnicode. */
function parseCMap(cmap: string): Map<string, string> {
  const map = new Map<string, string>();
  const utf16 = (hex: string) => {
    let out = '';
    for (let i = 0; i + 4 <= hex.length; i += 4) {
      out += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16));
    }
    return out;
  };
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of (block[1] ?? '').matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set((pair[1] ?? '').toUpperCase(), utf16(pair[2] ?? ''));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1] ?? '';
    for (const range of body.matchAll(
      /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]+>|\[[^\]]*\])/g,
    )) {
      const from = Number.parseInt(range[1] ?? '0', 16);
      const to = Number.parseInt(range[2] ?? '0', 16);
      const width = (range[1] ?? '').length;
      const target = range[3] ?? '';
      if (target.startsWith('[')) {
        const items = [...target.matchAll(/<([0-9A-Fa-f]+)>/g)].map((item) => item[1] ?? '');
        items.forEach((item, offset) => {
          map.set((from + offset).toString(16).toUpperCase().padStart(width, '0'), utf16(item));
        });
      } else {
        const base = target.slice(1, -1);
        const last = Number.parseInt(base.slice(-4), 16);
        for (let code = from; code <= to; code += 1) {
          const unicode = base.slice(0, -4) + (last + code - from).toString(16).padStart(4, '0');
          map.set(code.toString(16).toUpperCase().padStart(width, '0'), utf16(unicode));
        }
      }
    }
  }
  return map;
}

/** Texto visível do PDF, na ordem dos fluxos de conteúdo, com uma quebra por bloco de texto. */
export function pdfText(pdf: Buffer): string {
  const objects = parseObjects(pdf);
  // nome do recurso de fonte (/F3) → mapa do ToUnicode da fonte
  const fonts = new Map<string, Map<string, string>>();
  const cmapOf = (fontRef: number): Map<string, string> | undefined => {
    const font = objects.get(fontRef);
    const ref = font && /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(font.dict);
    const cmap = ref && objects.get(Number(ref[1]))?.stream;
    return cmap ? parseCMap(cmap.toString('latin1')) : undefined;
  };
  for (const { dict } of objects.values()) {
    const block = /\/Font\s*<<([^>]*)>>/.exec(dict);
    for (const entry of (block?.[1] ?? '').matchAll(/\/([^\s/<>]+)\s+(\d+)\s+0\s+R/g)) {
      const map = cmapOf(Number(entry[2]));
      if (map) fonts.set(entry[1] ?? '', map);
    }
  }

  const decode = (hex: string, map: Map<string, string> | undefined) => {
    if (!map) return '';
    const width = [...map.keys()][0]?.length ?? 4;
    let out = '';
    for (let i = 0; i + width <= hex.length; i += width) {
      out += map.get(hex.slice(i, i + width).toUpperCase()) ?? '';
    }
    return out;
  };

  let text = '';
  for (const { stream } of objects.values()) {
    if (!stream) continue;
    const content = stream.toString('latin1');
    if (!/\bBT\b/.test(content) || !/T[jJ]\b/.test(content)) continue;
    let current: Map<string, string> | undefined;
    const tokens =
      /\/([^\s/<>[\]()]+)\s+[-\d.]+\s+Tf|<([0-9A-Fa-f\s]*)>|\bET\b|\bT\*|\bTd\b|\bTD\b/g;
    for (const token of content.matchAll(tokens)) {
      if (token[1] !== undefined) {
        current = fonts.get(token[1]);
      } else if (token[2] !== undefined) {
        text += decode(token[2].replace(/\s+/g, ''), current);
      } else if (token[0] === 'ET') {
        text += '\n';
      } else {
        text += ' ';
      }
    }
  }
  return text;
}

// Espaços, quebras, hífens, formatação e uso privado: o PDF parte as frases em trechos, e o
// hífen entre maiúsculas do código sai com a forma alternativa da Inter, que o mapa da fonte
// leva a um código de uso privado.
const SEPARATORS = /[\s\p{Pd}\p{Cf}\p{Co}]+/gu;

/** Texto do PDF sem separadores, para comparar frases que o PDF parte em trechos. */
export function compactPdfText(pdf: Buffer): string {
  return pdfText(pdf).replace(SEPARATORS, '');
}

/** O mesmo, para o texto esperado. */
export function compact(text: string): string {
  return text.replace(SEPARATORS, '');
}
