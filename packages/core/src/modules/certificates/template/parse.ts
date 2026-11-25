// Análise do HTML do template com `htmlparser2`, numa árvore própria com as posições.
//
// A árvore é o que a validação confere e o que o preenchimento serializa de novo: o navegador
// recebe uma marcação canônica (atributos entre aspas, texto escapado, sem comentários), e não
// o texto original. Assim, uma diferença de leitura entre o analisador e o Chromium não abre
// caminho para marcação que a validação não viu.

import { Parser } from 'htmlparser2';
import type { ProblemList } from './problems.ts';

export interface TemplateAttribute {
  /** Nome em minúsculas. */
  name: string;
  /** Valor com as entidades decodificadas, como o navegador o lê. */
  value: string;
  /** Posição do atributo no texto original. */
  offset: number;
}

export interface TemplateElement {
  kind: 'element';
  /** Nome como o analisador o entrega (minúsculas; no SVG, com a caixa ajustada). */
  name: string;
  attributes: TemplateAttribute[];
  children: TemplateNode[];
  offset: number;
}

export interface TemplateText {
  kind: 'text';
  /** Texto com as entidades decodificadas; dentro de `<style>`, o CSS cru. */
  value: string;
  offset: number;
}

export type TemplateNode = TemplateElement | TemplateText;

export interface ParsedTemplate {
  children: TemplateNode[];
}

const DOCTYPE_PATTERN = /^!doctype\s+html\s*$/i;

/** Comentário que o navegador lê do mesmo jeito em qualquer analisador e que não esconde nada. */
function isPlainComment(data: string): boolean {
  return !/[<>]|--|^-|-$/.test(data);
}

/** Lê o HTML. Construções ambíguas viram `parse_error` em `problems`. */
export function parseTemplateHtml(source: string, problems: ProblemList): ParsedTemplate {
  const root: TemplateElement = {
    kind: 'element',
    name: '#root',
    attributes: [],
    children: [],
    offset: 0,
  };
  const stack: TemplateElement[] = [root];
  let pending: { name: string; value: string }[] = [];
  const current = (): TemplateElement => stack[stack.length - 1] ?? root;

  const parser: Parser = new Parser(
    {
      onattribute(name, value) {
        pending.push({ name, value });
      },
      onopentag(name, _attribs, isImplied) {
        const offset = parser.startIndex;
        const tagSource = isImplied ? '' : source.slice(offset, parser.endIndex + 1).toLowerCase();
        const seen = new Set<string>();
        const attributes: TemplateAttribute[] = [];
        let searchFrom = 1 + name.length;
        for (const attribute of pending) {
          const found = tagSource.indexOf(attribute.name, searchFrom);
          const attributeOffset = found === -1 ? offset : offset + found;
          if (found !== -1) {
            searchFrom = found + attribute.name.length;
          }
          if (seen.has(attribute.name)) {
            problems.add(
              'attribute_not_allowed',
              `Atributo ${attribute.name} repetido em <${name}>.`,
              attributeOffset,
            );
            continue;
          }
          seen.add(attribute.name);
          attributes.push({ ...attribute, offset: attributeOffset });
        }
        pending = [];
        const element: TemplateElement = {
          kind: 'element',
          name,
          attributes,
          children: [],
          offset,
        };
        current().children.push(element);
        stack.push(element);
      },
      onclosetag(name) {
        for (let index = stack.length - 1; index > 0; index -= 1) {
          if (stack[index]?.name === name) {
            stack.length = index;
            return;
          }
        }
      },
      ontext(data) {
        if (source.startsWith('<![CDATA[', parser.startIndex)) {
          problems.add('parse_error', 'Seção CDATA não é aceita.', parser.startIndex);
        }
        const siblings = current().children;
        const last = siblings[siblings.length - 1];
        if (last?.kind === 'text') {
          last.value += data;
        } else {
          siblings.push({ kind: 'text', value: data, offset: parser.startIndex });
        }
      },
      oncomment(data) {
        const offset = parser.startIndex;
        if (!source.startsWith('<!--', offset)) {
          problems.add(
            'parse_error',
            'Marcação inválida: só são aceitos comentários na forma <!-- ... -->.',
            offset,
          );
        } else if (
          !isPlainComment(data) ||
          source.slice(offset, parser.endIndex + 1) !== `<!--${data}-->`
        ) {
          problems.add(
            'parse_error',
            'Comentário com "<", ">" ou "--" dentro (comentário condicional ou marcação escondida).',
            offset,
          );
        }
      },
      oncdatastart() {
        problems.add('parse_error', 'Seção CDATA não é aceita.', parser.startIndex);
      },
      onprocessinginstruction(name, data) {
        if (name.toLowerCase() !== '!doctype' || !DOCTYPE_PATTERN.test(data)) {
          problems.add(
            'parse_error',
            'Declaração não aceita: só <!doctype html>.',
            parser.startIndex,
          );
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
  );
  parser.write(source);
  parser.end();
  return { children: root.children };
}
