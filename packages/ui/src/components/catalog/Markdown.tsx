import type { ComponentProps } from 'react';
import ReactMarkdown, { type Components, defaultUrlTransform } from 'react-markdown';
import '../../styles/tokens.css';
import './catalog.css';

/*
 * Markdown restrito (spec 006; ADR 0025): o texto escrito por usuário (descrição de curso
 * e de aula, notas e, na Fase 4, o fórum) é desenhado por aqui, nunca como HTML.
 *
 * - Sem `rehype-raw`: HTML bruto nunca é interpretado. Ele aparece como o texto que a
 *   pessoa escreveu (`<script>` vira texto, não elemento).
 * - Só os elementos da 006: parágrafo, negrito, itálico, listas, links, código, citação e
 *   quebra de linha. Os demais (título, imagem, tabela, linha horizontal) são desembrulhados:
 *   o elemento some e o texto dele fica.
 * - Link só `https`, `http` e `mailto`, sempre em outra aba com `rel="noopener noreferrer"`.
 *   Endereço com outro protocolo (`javascript:`, `data:`) ou relativo vira texto comum.
 */

/** Elementos que o Markdown pode gerar; o resto é desembrulhado. */
export const MARKDOWN_ELEMENTS = [
  'p',
  'strong',
  'em',
  'ul',
  'ol',
  'li',
  'a',
  'code',
  'pre',
  'blockquote',
  'br',
] as const;

/** Protocolos aceitos nos links. */
export const MARKDOWN_PROTOCOLS = ['https:', 'http:', 'mailto:'] as const;

/** Devolve o endereço se o protocolo é aceito; senão, texto vazio (o link deixa de existir). */
export function safeMarkdownUrl(url: string): string {
  const base = defaultUrlTransform(url);
  if (!base) return '';
  let protocol: string;
  try {
    protocol = new URL(base).protocol;
  } catch {
    // relativo ou malformado: sem protocolo explícito, não vira link
    return '';
  }
  return (MARKDOWN_PROTOCOLS as readonly string[]).includes(protocol) ? base : '';
}

export interface MarkdownProps {
  /** O texto em Markdown. */
  children: string | null | undefined;
  /** Texto lido depois de cada link, que abre em outra aba (ex.: "abre em nova aba"). */
  newTabLabel?: string | undefined;
  className?: string | undefined;
}

type AnchorProps = ComponentProps<'a'> & { node?: unknown };

/** Desenha Markdown restrito, higienizado e sem HTML bruto. */
export function Markdown({ children, newTabLabel, className }: MarkdownProps) {
  const components: Components = {
    a({ node: _node, href, children: text, ...rest }: AnchorProps) {
      if (!href) return <span>{text}</span>;
      return (
        <a {...rest} href={href} target="_blank" rel="noopener noreferrer">
          {text}
          {newTabLabel ? <span className="minui-sr-only"> {newTabLabel}</span> : null}
        </a>
      );
    },
  };
  return (
    <div className={['minui-markdown', className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        allowedElements={MARKDOWN_ELEMENTS}
        unwrapDisallowed
        urlTransform={safeMarkdownUrl}
        components={components}
      >
        {children ?? ''}
      </ReactMarkdown>
    </div>
  );
}
