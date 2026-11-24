import type { ReactNode } from 'react';

/*
 * Markdown restrito (spec 006, "Texto escrito por usuário"; ameaça 5 da spec 033): títulos,
 * parágrafos, negrito, itálico, listas, links, código, citação e linha horizontal. O texto vira
 * elementos React, nunca HTML: uma marcação HTML no texto aparece como texto, e só passam links
 * `http(s)`, `mailto` e caminhos do próprio site (com `rel="noopener nofollow"` nos externos).
 * Por construção não há como injetar marcação, atributo ou script.
 */

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*```/;

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (FENCE.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' });
      index += 1;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index] ?? '')) {
        quote.push(QUOTE.exec(lines[index] ?? '')?.[1] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'quote', text: quote.join(' ') });
      continue;
    }
    const ordered = NUMBERED.test(line);
    if (ordered || BULLET.test(line)) {
      const pattern = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      while (index < lines.length && pattern.test(lines[index] ?? '')) {
        items.push(pattern.exec(lines[index] ?? '')?.[1] ?? '');
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = lines[index] ?? '';
      if (
        !next.trim() ||
        FENCE.test(next) ||
        HEADING.test(next) ||
        QUOTE.test(next) ||
        BULLET.test(next) ||
        NUMBERED.test(next) ||
        RULE.test(next)
      ) {
        break;
      }
      paragraph.push(next.trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }
  return blocks;
}

/** Endereço permitido num link: `http(s)`, `mailto` ou caminho do próprio site. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/\\')) return href;
  if (href.startsWith('#')) return href;
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// Ordem de prioridade: código, link, negrito, itálico.
const INLINE = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_/;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let position = 0;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      nodes.push(rest);
      break;
    }
    if (match.index > 0) nodes.push(rest.slice(0, match.index));
    const key = `${keyPrefix}-${position}`;
    position += 1;
    const [whole, code, label, href, strong1, strong2, em1, em2] = match;
    if (code !== undefined) {
      nodes.push(<code key={key}>{code}</code>);
    } else if (label !== undefined && href !== undefined) {
      const target = safeHref(href);
      const children = renderInline(label, key);
      if (!target) nodes.push(<span key={key}>{children}</span>);
      else if (target.startsWith('/') || target.startsWith('#')) {
        nodes.push(
          <a key={key} href={target}>
            {children}
          </a>,
        );
      } else {
        nodes.push(
          <a key={key} href={target} rel="noopener nofollow noreferrer">
            {children}
          </a>,
        );
      }
    } else if (strong1 !== undefined || strong2 !== undefined) {
      nodes.push(<strong key={key}>{renderInline(strong1 ?? strong2 ?? '', key)}</strong>);
    } else {
      nodes.push(<em key={key}>{renderInline(em1 ?? em2 ?? '', key)}</em>);
    }
    rest = rest.slice(match.index + whole.length);
  }
  return nodes;
}

const HEADING_TAGS = ['h2', 'h3', 'h4'] as const;

interface MarkdownProps {
  source: string;
  /** Nível do maior título do texto: `#` vira `h2` por padrão (a página já tem o `h1`). */
  baseLevel?: 2 | 3;
  className?: string;
}

/** Mostra um texto em Markdown restrito, sem HTML bruto. */
export function Markdown({ source, baseLevel = 2, className }: MarkdownProps) {
  const blocks = parseBlocks(source);
  return (
    <div className={className}>
      {blocks.map((block, index) => {
        const key = `b${index}`;
        switch (block.kind) {
          case 'heading': {
            const Tag =
              HEADING_TAGS[Math.min(block.level - 1 + (baseLevel - 2), HEADING_TAGS.length - 1)] ??
              'h4';
            return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
          }
          case 'list': {
            const Tag = block.ordered ? 'ol' : 'ul';
            return (
              <Tag key={key}>
                {block.items.map((item, itemIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: lista posicional do texto, sem identidade própria
                  <li key={itemIndex}>{renderInline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </Tag>
            );
          }
          case 'quote':
            return (
              <blockquote key={key}>
                <p>{renderInline(block.text, key)}</p>
              </blockquote>
            );
          case 'code':
            return (
              <pre key={key}>
                <code>{block.text}</code>
              </pre>
            );
          case 'rule':
            return <hr key={key} />;
          default:
            return <p key={key}>{renderInline(block.text, key)}</p>;
        }
      })}
    </div>
  );
}
