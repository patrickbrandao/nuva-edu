import { describe, expect, it } from 'vitest';
import {
  assertMarkdownWithinLimit,
  countMarkdownCharacters,
  isDomainError,
  MARKDOWN_ALLOWED_ELEMENTS,
  MARKDOWN_BODY_MAX_LENGTH,
  type MarkdownRenderOptions,
  renderLegacyMarkdown,
  renderMarkdown,
  renderMarkdownToHtml,
} from '../../src/index.ts';
import { inspectHtml } from './inspect-html.ts';

// ADR 0027 e spec 017, RF-05/RNF-02: o HTML persistido vem deste pipeline, nunca de HTML bruto
// interpretado. Os mesmos casos alimentam a paridade com a interface (tarefa 627): a prévia usa
// o mesmo módulo e precisa produzir exatamente a mesma string.

const NEW_TAB = 'target="_blank" rel="nofollow noopener noreferrer"';

function html(markdown: string, options?: MarkdownRenderOptions): string {
  return renderMarkdownToHtml(markdown, options);
}

describe('Markdown: elementos da lista comum', () => {
  it('negrito, itálico e código inline', () => {
    expect(html('**negrito** _itálico_ `código`')).toBe(
      '<p><strong>negrito</strong> <em>itálico</em> <code>código</code></p>',
    );
  });

  it('listas ordenadas e não ordenadas, com o início da ordenada', () => {
    expect(html('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
    expect(html('5. cinco\n6. seis')).toBe('<ol start="5">\n<li>cinco</li>\n<li>seis</li>\n</ol>');
  });

  it('citação, código em bloco e quebra de linha', () => {
    expect(html('> citação\n> mais')).toBe('<blockquote>\n<p>citação\nmais</p>\n</blockquote>');
    expect(html('```js\nalert(1)\n```')).toBe('<pre><code>alert(1)\n</code></pre>');
    expect(html('linha1  \nlinha2')).toBe('<p>linha1<br>\nlinha2</p>');
  });

  it('título, tabela e linha horizontal não entram na lista', () => {
    expect(html('# título\n\ntexto')).toBe('título\n<p>texto</p>');
    expect(html('---\n')).toBe('');
    expect(html('|a|b|\n|-|-|\n|1|2|')).toBe('<p>|a|b|\n|-|-|\n|1|2|</p>');
  });

  it('classe de linguagem do bloco de código não vira atributo', () => {
    expect(html('```js\nx\n```')).not.toContain('class');
  });
});

describe('Markdown: HTML bruto nunca é interpretado', () => {
  it.each([
    '<script>alert(1)</script>texto',
    'texto <script>alert(1)</script> fim',
    '<b>negrito</b> & <img src=x onerror=alert(1)>',
    '<div onclick="alert(1)">x</div>',
    '<style>*{color:red}</style>ok',
    '<iframe src="https://x.test"></iframe>fim',
    '<a href="jAvascript:alert(1)">x</a>',
    '<img src="https://x.test/i.png" alt="oi">',
    '<input value=x>y',
    '<!-- comentário -->z',
    '<form action="https://x.test"><button>ok</button></form>',
  ])('a marcação aparece como texto, sem elemento: %s', (markdown) => {
    const result = html(markdown);
    expect(result).not.toMatch(/<(script|img|div|style|iframe|a|input|form|button|b)\b/);
    expect(result).not.toContain('<!--');
    // O texto digitado continua visível, com os sinais de menor escapados.
    expect(result).toContain('&#x3C;');
  });

  it('o HTML dentro de código é só texto', () => {
    expect(html('`código com <script>`')).toBe('<p><code>código com &#x3C;script></code></p>');
    expect(html('```\n<img src=x onerror=alert(1)>\n```')).toBe(
      '<pre><code>&#x3C;img src=x onerror=alert(1)>\n</code></pre>',
    );
  });
});

describe('Markdown: links', () => {
  it('https recebe nova aba e nofollow noopener noreferrer', () => {
    expect(html('[clique](https://example.com/a?b=1&c=2)')).toBe(
      `<p><a href="https://example.com/a?b=1&#x26;c=2" ${NEW_TAB}>clique</a></p>`,
    );
  });

  it.each(['[a](http://x.test)', '<http://x.test>', '[a](mailto:a@b.test)', '<a@b.test>'])(
    'http e mailto também são aceitos: %s',
    (markdown) => {
      const result = html(markdown);
      expect(result).toContain('<a href="');
      expect(result).toContain(NEW_TAB);
    },
  );

  it('o esquema em maiúsculas é normalizado, sem perder a caixa do caminho', () => {
    expect(html('[a](HTTPS://example.com)')).toBe(
      `<p><a href="https://example.com" ${NEW_TAB}>a</a></p>`,
    );
    expect(html('[a](HtTpS://example.com/x?B=C#D)')).toBe(
      `<p><a href="https://example.com/x?B=C#D" ${NEW_TAB}>a</a></p>`,
    );
  });

  it.each([
    ['javascript', '[x](javascript:alert(1))'],
    ['javascript em maiúsculas', '[x](jAvAsCrIpT:alert(1))'],
    ['javascript com tabulação inicial', '[x](\tjavascript:alert(1))'],
    ['javascript com entidade', '[x](jav&#x61;script:alert(1))'],
    ['javascript com espaço', '[x]( javascript:alert(1))'],
    ['data', '[x](data:text/html,<b>y</b>)'],
    ['vbscript', '[x](vbscript:msgbox(1))'],
    ['file', '[x](file:///etc/passwd)'],
    ['ftp', '[x](ftp://x.test/a)'],
    ['tel', '[x](tel:+551199999)'],
    ['relativo', '[x](/relativo)'],
    ['protocolo relativo', '[x](//example.com/x)'],
    ['sem autoridade', '[x](https:foo)'],
    ['mailto sem endereço', '[x](mailto:)'],
    ['âncora', '[x](#ancora)'],
    ['consulta', '[x](?q=1)'],
  ])('URL proibida não gera link ativo: %s', (_label, markdown) => {
    const result = html(markdown);
    expect(result).not.toContain('<a');
    expect(result).not.toContain('href');
    expect(result).toContain('x');
  });

  it('o texto e as ênfases do link proibido permanecem', () => {
    expect(html('[**negrito** e _itálico_](javascript:alert(1))')).toBe(
      '<p><strong>negrito</strong> e <em>itálico</em></p>',
    );
    expect(html('- item com [x](javascript:alert(1))\n- outro')).toBe(
      '<ul>\n<li>item com x</li>\n<li>outro</li>\n</ul>',
    );
  });

  it('o título do link não vira atributo', () => {
    expect(html('[link](https://x.test "título")')).toBe(
      `<p><a href="https://x.test" ${NEW_TAB}>link</a></p>`,
    );
  });

  it('link por referência passa pela mesma conferência de URL', () => {
    expect(html('[ref][a]\n\n[a]: https://x.test/ok')).toBe(
      `<p><a href="https://x.test/ok" ${NEW_TAB}>ref</a></p>`,
    );
    expect(html('[ref][a]\n\n[a]: javascript:alert(1)')).toBe('<p>ref</p>');
  });
});

describe('Markdown: imagens externas', () => {
  it('https aparece com alt, carga preguiçosa e sem referência', () => {
    expect(html('![alt](https://example.com/i.png)')).toBe(
      '<p><img src="https://example.com/i.png" alt="alt" loading="lazy" referrerpolicy="no-referrer"></p>',
    );
  });

  it('aceita esquema em maiúsculas e consulta na URL', () => {
    expect(html('![a](HTTPS://x.test/i.png)')).toContain('src="https://x.test/i.png"');
    expect(html('![a](https://x.test/i.png?x=1&y=2)')).toContain(
      'src="https://x.test/i.png?x=1&#x26;y=2"',
    );
  });

  it('imagem por referência segue a mesma regra', () => {
    expect(html('![img][b]\n\n[b]: https://x.test/i.png')).toContain(
      '<img src="https://x.test/i.png" alt="img"',
    );
    expect(html('![img][b]\n\n[b]: http://x.test/i.png')).toBe('<p>img</p>');
  });

  it.each([
    ['http', '![alt](http://x.test/i.png)'],
    ['data', '![alt](data:image/png;base64,AAA)'],
    ['javascript', 'texto ![alt](javascript:alert(1)) fim'],
    ['relativa', '![alt](/local.png)'],
    ['protocolo relativo', '![alt](//x.test/i.png)'],
    ['sem autoridade', '![alt](https:foo.png)'],
    ['vazia', '![decorativa]()'],
  ])('URL fora do https absoluto é descartada, com o alt preservado: %s', (_label, markdown) => {
    const result = html(markdown);
    expect(result).not.toContain('<img');
    expect(result).not.toContain('src=');
  });

  it('o texto alternativo não cria elemento: o `img` sai com o alt literal', () => {
    const markdown = '![a<script>b](https://x.test/i.png)';
    const result = html(markdown);
    const tree = inspectHtml(result);
    expect(tree.elements.map((element) => element.name)).toEqual(['p', 'img']);
    const image = tree.elements[1];
    expect(image?.attributes.find((attribute) => attribute.name === 'alt')?.value).toBe(
      'a<script>b',
    );
    // Nenhum elemento nasce do atributo: `<` entre aspas é texto para qualquer analisador HTML.
    expect(tree.elements.some((element) => element.name === 'script')).toBe(false);
  });
});

describe('Markdown: conteúdo anterior à ADR 0027', () => {
  it('renderiza o Markdown antigo sem imagem externa, preservando o alt', () => {
    expect(renderLegacyMarkdown('![alt](https://x.test/i.png)')).toBe('<p>alt</p>');
    expect(renderLegacyMarkdown('**negrito** e [a](https://x.test)')).toBe(
      `<p><strong>negrito</strong> e <a href="https://x.test" ${NEW_TAB}>a</a></p>`,
    );
  });

  it('HTML antigo aparece como texto, nunca como elemento', () => {
    expect(renderLegacyMarkdown('<b>negrito</b>')).toBe('<p>&#x3C;b>negrito&#x3C;/b></p>');
  });

  it('o modo legado é o mesmo que `legacy: true`', () => {
    const markdown = 'texto ![a](https://x.test/i.png) e [b](/relativo) <i>html</i>';
    expect(renderLegacyMarkdown(markdown)).toBe(html(markdown, { legacy: true }));
  });

  it('a imagem permitida na escrita nova não aparece na leitura antiga', () => {
    const markdown = '![alt](https://x.test/i.png)';
    expect(html(markdown)).toContain('<img');
    expect(renderLegacyMarkdown(markdown)).not.toContain('<img');
  });
});

describe('Markdown: limites e erros', () => {
  it('conta pontos de código, não unidades UTF-16', () => {
    expect(countMarkdownCharacters('abc')).toBe(3);
    expect(countMarkdownCharacters('😀😀')).toBe(2);
    expect(countMarkdownCharacters('áéí')).toBe(3);
  });

  it('aceita o corpo no limite do fórum e recusa um caractere a mais', () => {
    expect(
      assertMarkdownWithinLimit('a'.repeat(MARKDOWN_BODY_MAX_LENGTH), MARKDOWN_BODY_MAX_LENGTH),
    ).toHaveLength(MARKDOWN_BODY_MAX_LENGTH);
    try {
      assertMarkdownWithinLimit('a'.repeat(MARKDOWN_BODY_MAX_LENGTH + 1), MARKDOWN_BODY_MAX_LENGTH);
      expect.unreachable('devia recusar');
    } catch (error) {
      expect(isDomainError(error)).toBe(true);
      expect((error as { code: string }).code).toBe('markdown_too_long');
      expect((error as { status: number }).status).toBe(422);
    }
  });

  it('cada recurso passa o próprio limite: chamado usa 10.000', () => {
    // Spec 023, RNF-02: a mensagem do chamado é menor que o corpo do fórum, mas a regra é a mesma.
    expect(() => assertMarkdownWithinLimit('a'.repeat(10_000), 10_000)).not.toThrow();
    expect(() => assertMarkdownWithinLimit('a'.repeat(10_001), 10_000)).toThrow(
      /mais de 10\.000 caracteres/,
    );
  });

  it('o limite conta emoji como um caractere', () => {
    expect(() => assertMarkdownWithinLimit('😀'.repeat(20_000), 20_000)).not.toThrow();
    expect(() => assertMarkdownWithinLimit('😀'.repeat(20_001), 20_000)).toThrow();
  });

  it('Markdown que não é texto é recusado', () => {
    expect(() => assertMarkdownWithinLimit(null, 10)).toThrow();
    expect(() => assertMarkdownWithinLimit(42, 10)).toThrow();
  });

  it('um corpo de 20.000 caracteres renderiza sem erro', () => {
    const markdown = `**${'a'.repeat(19_996)}**`;
    expect(html(markdown)).toContain('<strong>');
  });
});

describe('Markdown: API de gravação e determinismo', () => {
  it('renderMarkdown devolve o par body_md/body_html', () => {
    expect(renderMarkdown('**a**')).toEqual({
      markdown: '**a**',
      html: '<p><strong>a</strong></p>',
    });
  });

  it('a mesma entrada produz exatamente a mesma string, em chamadas repetidas', () => {
    const markdown =
      '# t\n\n> citação\n\n- [a](https://x.test)\n- ![i](https://x.test/i.png)\n\n```js\nx\n```';
    const first = html(markdown);
    expect(html(markdown)).toBe(first);
    expect(renderLegacyMarkdown(markdown)).toBe(renderLegacyMarkdown(markdown));
  });

  it('entrada vazia gera HTML vazio', () => {
    expect(html('')).toBe('');
    expect(renderLegacyMarkdown('')).toBe('');
  });
});

describe('Markdown: o HTML persistido obedece à lista comum', () => {
  // A interface (tarefa 627) converte este HTML em elementos React: nenhum elemento ou atributo
  // fora da lista pode chegar lá. A conferência lê a string com `htmlparser2`, o mesmo analisador
  // que a validação do template de certificado usa — o que está gravado é o que a tela recebe.
  const cases = [
    '**negrito** _itálico_ `código`',
    'texto <script>alert(1)</script> fim',
    '[a](https://x.test/a?b=1&c=2)',
    '[a](javascript:alert(1))',
    '[a](/relativo)',
    '![alt](https://x.test/i.png)',
    '![alt](http://x.test/i.png)',
    '- a\n- b\n\n> citação\n\n```js\nx\n```',
    '1. um\n2. dois',
    '![a<script>b](https://x.test/i.png)',
    '<div onclick="alert(1)">x</div><iframe src="https://x.test"></iframe>',
  ];

  it.each(cases)('só elementos, atributos e protocolos previstos: %s', (markdown) => {
    const tree = inspectHtml(html(markdown));
    for (const element of tree.elements) {
      expect(MARKDOWN_ALLOWED_ELEMENTS as readonly string[]).toContain(element.name);
      for (const attribute of element.attributes) {
        expect(POLICY_ATTRIBUTES[element.name] ?? []).toContain(attribute.name);
      }
    }
    for (const url of tree.urls) {
      expect(url.protocol).toMatch(/^(https?|mailto)$/);
    }
  });

  it.each(cases)('o conteúdo anterior segue a mesma regra, sem imagem: %s', (markdown) => {
    const tree = inspectHtml(renderLegacyMarkdown(markdown));
    for (const element of tree.elements) {
      expect(element.name).not.toBe('img');
      for (const attribute of element.attributes) {
        expect(POLICY_ATTRIBUTES[element.name] ?? []).toContain(attribute.name);
      }
    }
  });

  it('o texto escrito em HTML não vira elemento nem comentário', () => {
    const tree = inspectHtml(html('<b>negrito</b><!-- x -->'));
    expect(tree.elements.map((element) => element.name)).toEqual(['p']);
    expect(tree.text).toContain('<b>negrito</b>');
    expect(tree.text).toContain('<!-- x -->');
  });
});

/** Atributos permitidos por elemento, espelho da política (a lista é conferida no teste acima). */
const POLICY_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'target', 'rel'],
  img: ['src', 'alt', 'loading', 'referrerpolicy'],
  ol: ['start'],
};
