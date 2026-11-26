import { Parser } from 'htmlparser2';
import { markdownUrlProtocol } from '../../src/index.ts';

// Leitura do HTML saneado por um analisador independente do pipeline (o mesmo `htmlparser2` da
// validação do template de certificado). Serve para afirmar o que está gravado: elementos,
// atributos, comentários e protocolos, sem confiar na saída do próprio conversor.

export interface InspectedElement {
  name: string;
  attributes: { name: string; value: string }[];
}

export interface InspectedHtml {
  elements: InspectedElement[];
  /** Todo o texto, sem marcação. */
  text: string;
  /** Endereços ativos (`href` e `src`), com o protocolo em minúsculas. */
  urls: { name: string; value: string; protocol: string | null }[];
  /** Quantos comentários o HTML tem; a política não permite nenhum. */
  comments: number;
}

export function inspectHtml(html: string): InspectedHtml {
  const elements: InspectedElement[] = [];
  let text = '';
  let comments = 0;
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        elements.push({
          name,
          attributes: Object.entries(attributes).map(([key, value]) => ({ name: key, value })),
        });
      },
      ontext(value) {
        text += value;
      },
      oncomment() {
        comments += 1;
      },
    },
    { decodeEntities: true, lowerCaseAttributeNames: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();

  const urls = elements.flatMap((element) =>
    element.attributes
      .filter((attribute) => attribute.name === 'href' || attribute.name === 'src')
      .map((attribute) => ({
        name: attribute.name,
        value: attribute.value,
        protocol: markdownUrlProtocol(attribute.value),
      })),
  );
  return { elements, text, urls, comments };
}
