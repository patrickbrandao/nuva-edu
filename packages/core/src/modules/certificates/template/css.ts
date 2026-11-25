// Validação do CSS do template (spec 015, "Higienização", linha CSS) com `css-tree`.
// Nomes de regra, propriedade e função são decodificados (escapes CSS) antes da comparação.

import * as csstree from 'css-tree';
import { hasKeywordMarker } from './keywords.ts';
import type { ProblemList } from './problems.ts';
import {
  CSS_AT_RULES,
  CSS_FORBIDDEN_FUNCTIONS,
  CSS_FORBIDDEN_PROPERTIES,
  DATA_FONT_PATTERN,
  DATA_IMAGE_PATTERN,
} from './rules.ts';

/** Onde o CSS está: num `<style>` (folha inteira) ou num atributo `style` (declarações). */
export type CssKind = 'stylesheet' | 'declarations';

/** Linha e coluna (a partir de 1) do primeiro caractere do CSS no documento. */
export interface CssOrigin {
  line: number;
  column: number;
}

function decodeName(name: string): string {
  return csstree.ident.decode(name).toLowerCase();
}

/** Tira o prefixo de "hack" de navegador antigo (`*behavior`, `_behavior`). */
function propertyName(raw: string): string {
  return decodeName(raw).replace(/^[*_]+/, '');
}

/**
 * Confere um trecho de CSS e acrescenta os problemas a `problems`. Não altera nada.
 * Erro de sintaxe é `parse_error`; o resto é `css_not_allowed` ou `url_not_allowed`.
 */
export function checkCss(
  css: string,
  kind: CssKind,
  origin: CssOrigin,
  problems: ProblemList,
): void {
  if (hasKeywordMarker(css)) {
    problems.addAt(
      'css_not_allowed',
      'Palavra-chave dentro de CSS não é aceita: use-a no texto do documento.',
      origin.line,
      origin.column,
    );
    return;
  }
  if (/<\/style/i.test(css)) {
    problems.addAt('parse_error', 'CSS com "</style" dentro.', origin.line, origin.column);
    return;
  }

  let syntaxErrors = 0;
  const ast = csstree.parse(css, {
    context: kind === 'stylesheet' ? 'stylesheet' : 'declarationList',
    positions: true,
    parseCustomProperty: true,
    line: origin.line,
    column: origin.column,
    onParseError(error) {
      syntaxErrors += 1;
      const located = error as unknown as { line?: number; column?: number };
      problems.addAt(
        'parse_error',
        `Erro de sintaxe no CSS: ${error.message}.`,
        located.line ?? origin.line,
        located.column ?? origin.column,
      );
    },
  });

  csstree.walk(ast, (node) => {
    const start = node.loc?.start ?? origin;
    const add = (rule: 'css_not_allowed' | 'url_not_allowed', message: string) =>
      problems.addAt(rule, message, start.line, start.column);

    switch (node.type) {
      case 'Atrule': {
        const name = decodeName(node.name);
        if (!CSS_AT_RULES.has(name)) {
          add('css_not_allowed', `Regra @${name} não é aceita.`);
        }
        break;
      }
      case 'Declaration': {
        const name = propertyName(node.property);
        if (CSS_FORBIDDEN_PROPERTIES.has(name)) {
          add('css_not_allowed', `Propriedade ${name} não é aceita.`);
        }
        break;
      }
      case 'Function': {
        const name = decodeName(node.name);
        if (CSS_FORBIDDEN_FUNCTIONS.has(name)) {
          add('css_not_allowed', `Função ${name}() não é aceita.`);
        }
        break;
      }
      case 'Url': {
        // Vale também para o `src` do `@font-face`: só `data:`, nunca endereço.
        const value = node.value.trim();
        if (!DATA_IMAGE_PATTERN.test(value) && !DATA_FONT_PATTERN.test(value)) {
          add(
            'url_not_allowed',
            'url() só aceita imagem (PNG, JPEG, WebP, GIF) ou fonte (WOFF2, WOFF, TTF, OTF) em data: base64.',
          );
        }
        break;
      }
      case 'Raw': {
        if (syntaxErrors === 0 && node.value.replace(/[\s;]/g, '') !== '') {
          add('css_not_allowed', 'Trecho de CSS não reconhecido.');
        }
        break;
      }
      default:
        break;
    }
  });
}
