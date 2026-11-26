import { describe, expect, it } from 'vitest';
import {
  isAllowedMarkdownImageUrl,
  isAllowedMarkdownLinkUrl,
  MARKDOWN_ALLOWED_ELEMENTS,
  MARKDOWN_BODY_MAX_LENGTH,
  MARKDOWN_IMAGE_ATTRIBUTES,
  MARKDOWN_IMAGE_PROTOCOLS,
  MARKDOWN_LEGACY_ELEMENTS,
  MARKDOWN_LINK_ATTRIBUTES,
  MARKDOWN_LINK_PROTOCOLS,
  markdownSanitizeSchema,
  markdownUrlProtocol,
  normalizeMarkdownUrl,
} from '../../src/index.ts';

// ADR 0027, "Lista comum" e "URLs": a política é uma só, explícita, e é o que a interface repete
// na exibição (tarefa 627). Um elemento, atributo ou protocolo novo só entra com mudança de spec.

describe('política do Markdown: lista de elementos', () => {
  it('é exatamente a lista da ADR 0027, sem título, tabela ou linha horizontal', () => {
    expect([...MARKDOWN_ALLOWED_ELEMENTS]).toEqual([
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
      'img',
    ]);
    for (const forbidden of ['h1', 'h2', 'table', 'hr', 'span', 'div', 'script']) {
      expect(MARKDOWN_ALLOWED_ELEMENTS as readonly string[]).not.toContain(forbidden);
    }
  });

  it('a leitura do conteúdo antigo não tem imagem', () => {
    expect(MARKDOWN_LEGACY_ELEMENTS).not.toContain('img');
    expect(MARKDOWN_LEGACY_ELEMENTS).toHaveLength(MARKDOWN_ALLOWED_ELEMENTS.length - 1);
  });
});

describe('política do Markdown: protocolos e atributos', () => {
  it('links aceitam https, http e mailto; imagens só https', () => {
    expect([...MARKDOWN_LINK_PROTOCOLS]).toEqual(['https', 'http', 'mailto']);
    expect([...MARKDOWN_IMAGE_PROTOCOLS]).toEqual(['https']);
  });

  it('todo link abre em nova aba sem passar referência nem autoridade', () => {
    expect(MARKDOWN_LINK_ATTRIBUTES).toEqual({
      target: '_blank',
      rel: 'nofollow noopener noreferrer',
    });
  });

  it('toda imagem tem carga preguiçosa e pedido sem referência', () => {
    expect(MARKDOWN_IMAGE_ATTRIBUTES).toEqual({
      loading: 'lazy',
      referrerpolicy: 'no-referrer',
    });
  });

  it('o limite do corpo do fórum é o da spec 017', () => {
    expect(MARKDOWN_BODY_MAX_LENGTH).toBe(20_000);
  });
});

describe('política do Markdown: esquema de saneamento', () => {
  it('usa lista explícita, sem herdar atributos do perfil padrão do GitHub', () => {
    const schema = markdownSanitizeSchema();
    expect(schema.attributes?.['*']).toEqual([]);
    expect(schema.ancestors).toEqual({});
    expect(schema.allowComments).toBe(false);
    expect(schema.allowDoctypes).toBe(false);
    expect(schema.tagNames).toEqual([...MARKDOWN_ALLOWED_ELEMENTS]);
    expect(schema.protocols).toEqual({
      href: [...MARKDOWN_LINK_PROTOCOLS],
      src: [...MARKDOWN_IMAGE_PROTOCOLS],
    });
  });

  it('repõe os atributos fixos de link e de imagem', () => {
    const schema = markdownSanitizeSchema();
    expect(schema.required?.a).toEqual({ target: '_blank', rel: 'nofollow noopener noreferrer' });
    expect(schema.required?.img).toEqual({ loading: 'lazy', referrerPolicy: 'no-referrer' });
  });

  it('na leitura antiga, o esquema não tem imagem nem atributos de imagem', () => {
    const schema = markdownSanitizeSchema({ allowImages: false });
    expect(schema.tagNames).toEqual([...MARKDOWN_LEGACY_ELEMENTS]);
    expect(schema.attributes?.img).toBeUndefined();
    expect(schema.protocols?.src).toBeUndefined();
    expect(schema.required?.img).toBeUndefined();
  });
});

describe('política do Markdown: endereços', () => {
  it.each([
    ['https://x.test/a', 'https'],
    ['HTTPS://x.test/a', 'https'],
    ['HtTpS://x.test/a', 'https'],
    ['http://x.test/a', 'http'],
    ['mailto:a@b.test', 'mailto'],
    ['MAILTO:a@b.test', 'mailto'],
    ['javascript:alert(1)', 'javascript'],
    [' jAvAsCrIpT:alert(1)', 'javascript'],
    // Tabulação e quebra de linha somem na leitura do navegador: o endereço lido é `javascript:`.
    ['java\tscript:alert(1)', 'javascript'],
    ['java\nscript:alert(1)', 'javascript'],
    // Espaço no meio não forma esquema: é endereço relativo, como no navegador.
    ['java script:alert(1)', null],
    ['data:image/png;base64,AAA', 'data'],
    ['/relativo', null],
    ['//x.test/a', null],
    ['#ancora', null],
    ['', null],
  ])('%s tem protocolo %s', (url, protocol) => {
    expect(markdownUrlProtocol(url)).toBe(protocol);
  });

  it('link só aceita os três protocolos da política', () => {
    expect(isAllowedMarkdownLinkUrl('https://x.test')).toBe(true);
    expect(isAllowedMarkdownLinkUrl('http://x.test')).toBe(true);
    expect(isAllowedMarkdownLinkUrl('mailto:a@b.test')).toBe(true);
    expect(isAllowedMarkdownLinkUrl('mailto:a@b.test?subject=oi')).toBe(true);
    expect(isAllowedMarkdownLinkUrl('HTTPS://x.test')).toBe(true);
    expect(isAllowedMarkdownLinkUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedMarkdownLinkUrl('/relativo')).toBe(false);
    expect(isAllowedMarkdownLinkUrl('//x.test')).toBe(false);
  });

  it('endereço sem destino completo não vira link', () => {
    // O navegador completa `https:foo` para `https://foo/`, mas o HTML gravado é lido por
    // consumidores que não fazem essa correção: sem autoridade, não é link.
    expect(isAllowedMarkdownLinkUrl('https:foo')).toBe(false);
    expect(isAllowedMarkdownLinkUrl('http:foo')).toBe(false);
    expect(isAllowedMarkdownLinkUrl('mailto:')).toBe(false);
    expect(isAllowedMarkdownLinkUrl('mailto:?subject=oi')).toBe(false);
  });

  it('imagem só aceita https absoluto', () => {
    expect(isAllowedMarkdownImageUrl('https://x.test/i.png')).toBe(true);
    expect(isAllowedMarkdownImageUrl('HTTPS://x.test/i.png')).toBe(true);
    expect(isAllowedMarkdownImageUrl('https://x.test/i.png?x=1&y=2')).toBe(true);
    expect(isAllowedMarkdownImageUrl('http://x.test/i.png')).toBe(false);
    expect(isAllowedMarkdownImageUrl('data:image/png;base64,AAA')).toBe(false);
    expect(isAllowedMarkdownImageUrl('//x.test/i.png')).toBe(false);
    expect(isAllowedMarkdownImageUrl('https:foo.png')).toBe(false);
  });

  it('normaliza só o esquema, preservando caminho, consulta e fragmento', () => {
    expect(normalizeMarkdownUrl('HTTPS://x.test/A?B=C#D', 'link')).toBe('https://x.test/A?B=C#D');
    expect(normalizeMarkdownUrl('MAILTO:a@b.test', 'link')).toBe('mailto:a@b.test');
    expect(normalizeMarkdownUrl(' HTTPS://x.test/i.png ', 'image')).toBe('https://x.test/i.png');
    // Espaço no caminho é parte do endereço: apagá-lo mudaria o destino.
    expect(normalizeMarkdownUrl('https://x.test/a b', 'link')).toBe('https://x.test/a b');
    expect(normalizeMarkdownUrl('javascript:alert(1)', 'link')).toBeNull();
    expect(normalizeMarkdownUrl('http://x.test/i.png', 'image')).toBeNull();
  });
});
