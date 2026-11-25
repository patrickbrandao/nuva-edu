import { describe, expect, it } from 'vitest';
import { isDomainError } from '../src/errors/domain-error.ts';
import {
  CERTIFICATE_EMPTY_IMAGE,
  CERTIFICATE_PREVIEW_CODE,
  CERTIFICATE_TEMPLATE_KEYS,
  CERTIFICATE_TEMPLATE_MAX_BYTES,
  CERTIFICATE_TEMPLATE_MAX_PROBLEMS,
  CERTIFICATE_TEMPLATE_MODEL_HTML,
  type CertificateTemplateRule,
  type CertificateTemplateValues,
  certificatePreviewData,
  certificateTemplateInvalid,
  certificateTemplateReference,
  certificateTemplateValues,
  certificateValidationUrl,
  escapeCertificateHtml,
  fillCertificateTemplate,
  formatCertificateCode,
  formatCertificateDateLong,
  formatCertificateDateShort,
  isCertificateTemplateKey,
  validateCertificateTemplate,
} from '../src/modules/certificates/template/index.ts';

const REQUIRED =
  '<p>{{aluno.nome}} {{curso.titulo}} {{certificado.codigo}} {{certificado.url_validacao}}</p>';
const IMAGE_ID = '019aa3f2-7b1c-7e55-9a10-5299822472aa';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const QR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 29 29" shape-rendering="crispEdges">' +
  '<path fill="#ffffff" d="M0 0h29v29H0z"/><path stroke="#000000" d="M4 4.5h7m1 0h1"/></svg>\n';

/** Template mínimo válido com `body` acrescentado. */
function template(body: string): string {
  return `${REQUIRED}\n${body}`;
}

function rulesOf(html: string): CertificateTemplateRule[] {
  return validateCertificateTemplate(html).problems.map((problem) => problem.rule);
}

const VALUES: CertificateTemplateValues = {
  'aluno.nome': 'Ana Souza',
  'curso.titulo': 'Curso de Teste',
  'curso.carga_horaria': '12',
  'curso.instrutor': 'Bruno',
  'certificado.data_conclusao': '25 de novembro de 2026',
  'certificado.data_conclusao_curta': '25/11/2026',
  'certificado.data_emissao': '25 de novembro de 2026',
  'certificado.codigo': 'ABCD-EFGH-JKMN',
  'certificado.url_validacao': 'https://classroom.example.test/certificados/ABCD-EFGH-JKMN',
  'escola.nome': 'Escola',
  'assinatura.nome': 'Carla',
  'assinatura.cargo': 'Diretora',
};

describe('validação do template: aceite', () => {
  it('o modelo inicial passa na validação, com as 13 palavras-chave e o QR', () => {
    const result = validateCertificateTemplate(CERTIFICATE_TEMPLATE_MODEL_HTML);
    expect(result.problems).toEqual([]);
    expect(result.valid).toBe(true);
    expect([...result.keys].sort()).toEqual([...CERTIFICATE_TEMPLATE_KEYS].sort());
    expect(result.usesQrCode).toBe(true);
    expect(result.imageIds).toEqual([]);
  });

  it('o modelo é A4 paisagem, usa Inter e não cita endereço externo', () => {
    expect(CERTIFICATE_TEMPLATE_MODEL_HTML).toContain('size: A4 landscape');
    expect(CERTIFICATE_TEMPLATE_MODEL_HTML).toContain('font-family: Inter');
    expect(CERTIFICATE_TEMPLATE_MODEL_HTML).not.toMatch(/https?:\/\//);
  });

  it.each([
    ['espaços internos na palavra-chave', '<p>{{ aluno.nome }}</p>'],
    [
      'palavra-chave em title e alt',
      `<img src="${PNG}" alt="{{curso.titulo}}" title="{{aluno.nome}}">`,
    ],
    ['link https', '<a href="https://example.com/a?b=1&amp;c=2">x</a>'],
    ['link https com palavra-chave', '<a href="https://example.com/{{certificado.codigo}}">x</a>'],
    ['link exatamente a URL de validação', '<a href="{{ certificado.url_validacao }}">v</a>'],
    [
      'imagens data: nos quatro tipos',
      ['png', 'jpeg', 'webp', 'gif'].map((t) => `<img src="data:image/${t};base64,AAAA">`).join(''),
    ],
    [
      'tabela com atributos próprios',
      '<table><caption>c</caption><colgroup><col width="10"></colgroup><tr><td colspan="2" align="center" valign="top">x</td></tr></table>',
    ],
    ['listas', '<ul><li>a</li></ul><ol><li>b</li></ol><dl><dt>c</dt><dd>d</dd></dl>'],
    [
      'blocos e texto',
      '<section><header><h2>t</h2></header><article><blockquote><b>a</b><i>b</i><u>c</u><s>d</s><small>e</small><sub>f</sub><sup>g</sup></blockquote></article><footer><hr><br></footer></section><figure><figcaption>x</figcaption></figure>',
    ],
    [
      'SVG de desenho com gradiente e url(#id)',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/></linearGradient><clipPath id="c"><rect width="5" height="5"/></clipPath></defs><g clip-path="url(#c)"><rect fill="url(#g)" width="10" height="10"/><circle cx="1" cy="1" r="1"/><ellipse rx="1" ry="1"/><line x1="0" x2="1"/><polyline points="0,0 1,1"/><polygon points="0,0 1,1 1,0"/><path d="M0 0"/><text x="1" y="1">a<tspan>b</tspan></text></g><radialGradient id="r"/></svg>',
    ],
    [
      'CSS com @media, @page, @supports, @keyframes e @font-face em data:',
      '<style>@page { size: A4 landscape } @media print { p { color: red } } @supports (display: grid) { p { display: grid } } @keyframes k { from { opacity: 0 } } @font-face { font-family: X; src: url(data:font/woff2;base64,AAAA) format("woff2"), local(Arial); } body { background: url("data:image/png;base64,AAAA") }</style>',
    ],
    [
      'style em atributo',
      '<p style="color: red; background-image: url(data:image/gif;base64,R0lGOD==)">x</p>',
    ],
    ['comentário simples', '<!-- comentário sem marcação -->'],
    [
      'documento completo com doctype e meta charset',
      '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>T {{aluno.nome}}</title></head><body>x</body></html>',
    ],
    ['entidade que só vira texto', '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &nbsp;</p>'],
    [
      'propriedade personalizada sem endereço',
      '<style>:root { --cor: #123456 } p { color: var(--cor) }</style>',
    ],
  ])('aceita %s', (_label, body) => {
    expect(validateCertificateTemplate(template(body)).problems).toEqual([]);
  });

  it('aceita o QR sem a URL de validação', () => {
    expect(
      rulesOf(
        '<p>{{aluno.nome}} {{curso.titulo}} {{certificado.codigo}}</p><div>{{certificado.qrcode}}</div>',
      ),
    ).toEqual([]);
  });

  it('devolve as imagens da instalação citadas, sem repetição e com o id em minúsculas', () => {
    const upper = IMAGE_ID.toUpperCase();
    const result = validateCertificateTemplate(
      template(
        `<img src="/api/v1/images/${IMAGE_ID}/480.webp"><img src="/api/v1/images/${upper}/480.webp"><img src="/api/v1/images/${IMAGE_ID}/1280.webp">`,
      ),
    );
    expect(result.problems).toEqual([]);
    expect(result.imageIds).toEqual([IMAGE_ID]);
    expect(result.images).toEqual([
      { id: IMAGE_ID, width: 480, path: `/api/v1/images/${IMAGE_ID}/480.webp` },
      { id: IMAGE_ID, width: 1280, path: `/api/v1/images/${IMAGE_ID}/1280.webp` },
    ]);
  });

  it('aceita exatamente 768 KiB', () => {
    const base = template('<p></p>');
    const html = base.replace(
      '<p></p>',
      `<p>${'a'.repeat(CERTIFICATE_TEMPLATE_MAX_BYTES - Buffer.byteLength(base))}</p>`,
    );
    expect(Buffer.byteLength(html)).toBe(CERTIFICATE_TEMPLATE_MAX_BYTES);
    expect(rulesOf(html)).toEqual([]);
  });
});

describe('validação do template: recusa por elemento', () => {
  it.each([
    '<script>alert(1)</script>',
    '<SCRIPT>alert(1)</SCRIPT>',
    '<ScRiPt src="data:x"></ScRiPt>',
    '<iframe src="https://example.com"></iframe>',
    '<iframe srcdoc="<script>x</script>"></iframe>',
    '<frame src="x">',
    '<object data="x"></object>',
    '<embed src="x">',
    '<applet code="x"></applet>',
    '<link rel="stylesheet" href="https://example.com/a.css">',
    '<base href="https://example.com/">',
    '<form action="https://example.com"><input name="a"></form>',
    '<input value="x">',
    '<button>x</button>',
    '<textarea>x</textarea>',
    '<select><option>x</option></select>',
    '<video src="x"></video>',
    '<audio src="x"></audio>',
    '<picture><source srcset="x"></picture>',
    '<track src="x">',
    '<canvas></canvas>',
    '<template><img src="x"></template>',
    '<noscript><p>x</p></noscript>',
    '<math><mi>x</mi></math>',
    '<xmp><script>x</script></xmp>',
    '<plaintext><script>x</script>',
    '<svg><script>alert(1)</script></svg>',
    '<svg><foreignObject><div>x</div></foreignObject></svg>',
    '<svg><use href="#a"/></svg>',
    '<svg><image href="https://example.com/x.png"/></svg>',
    '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
    '<svg><animateTransform attributeName="transform"/></svg>',
    '<svg><set attributeName="fill" to="red"/></svg>',
    '<svg><style>@import "https://example.com/a.css";</style></svg>',
    '<svg><a href="https://example.com">x</a></svg>',
    '<svg><title>x</title></svg>',
    '<svg><div>x</div></svg>',
    '<meta name="viewport" content="x">',
  ])('recusa %s', (body) => {
    expect(rulesOf(template(body))).toContain('element_not_allowed');
  });

  it('informa linha e coluna do elemento recusado', () => {
    const result = validateCertificateTemplate(`${REQUIRED}\n<p>\n  <script>x</script></p>`);
    expect(result.problems).toEqual([
      {
        rule: 'element_not_allowed',
        message: 'Elemento <script> não é aceito.',
        line: 3,
        column: 3,
      },
    ]);
  });

  it('recusa o template inteiro e lista todos os problemas', () => {
    const result = validateCertificateTemplate(
      template('<script></script><iframe></iframe><p onclick="x">a</p>'),
    );
    expect(result.valid).toBe(false);
    expect(result.problems.map((p) => p.rule)).toEqual([
      'element_not_allowed',
      'element_not_allowed',
      'attribute_not_allowed',
    ]);
  });
});

describe('validação do template: recusa por atributo', () => {
  it.each([
    ['on* em minúsculas', `<img src="${PNG}" onerror="alert(1)">`],
    ['on* em maiúsculas', `<img src="${PNG}" ONERROR="alert(1)">`],
    ['on* misto', '<div OnClick="alert(1)">x</div>'],
    ['on* sem aspas depois de barra', `<img/src="${PNG}"/onerror=alert(1)>`],
    ['on* no body', '<body onload="alert(1)"></body>'],
    ['on* em SVG', '<svg onload="alert(1)"></svg>'],
    ['on* em elemento SVG', '<svg><rect onmouseover="alert(1)"/></svg>'],
    ['srcset', `<img src="${PNG}" srcset="https://example.com/a.png 2x">`],
    ['formaction', '<p formaction="https://example.com">x</p>'],
    ['href em SVG', '<svg><rect href="#a"/></svg>'],
    ['xlink:href em SVG', '<svg><rect xlink:href="https://example.com"/></svg>'],
    ['atributo fora da lista', '<p data-x="1">x</p>'],
    ['target em link', '<a href="https://example.com" target="_blank">x</a>'],
    [
      'meta http-equiv=refresh',
      '<meta charset="utf-8" http-equiv="refresh" content="0;url=https://example.com">',
    ],
    ['meta com charset que não é utf-8', '<meta charset="iso-8859-1">'],
    ['atributo repetido', '<a href="https://example.com" href="javascript:alert(1)">x</a>'],
    ['xmlns estranho', '<svg xmlns="https://example.com/ns"></svg>'],
    ['escape CSS em atributo SVG', '<svg><rect fill="u\\72l(https://example.com)"/></svg>'],
    ['palavra-chave como nome de atributo', '<div {{aluno.nome}}>x</div>'],
  ])('recusa %s', (_label, body) => {
    expect(rulesOf(template(body))).toContain('attribute_not_allowed');
  });
});

describe('validação do template: recusa por endereço', () => {
  it.each([
    ['javascript: em href', '<a href="javascript:alert(1)">x</a>'],
    ['JaVaScRiPt: em href', '<a href="JaVaScRiPt:alert(1)">x</a>'],
    ['javascript: codificado em decimal', '<a href="&#106;avascript:alert(1)">x</a>'],
    [
      'javascript: codificado em hexadecimal e &colon;',
      '<a href="&#x6A;avascript&colon;alert(1)">x</a>',
    ],
    ['javascript: com tabulação codificada', '<a href="java&#9;script:alert(1)">x</a>'],
    ['javascript: com espaço antes', '<a href=" javascript:alert(1)">x</a>'],
    ['http sem s', '<a href="http://example.com">x</a>'],
    ['endereço relativo ao protocolo', '<a href="//example.com">x</a>'],
    ['data: em href', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
    ['https com quebra de linha', '<a href="https://exa&#10;mple.com">x</a>'],
    ['href vazio', '<a href="">x</a>'],
    ['imagem externa', '<img src="https://example.com/a.png">'],
    ['imagem relativa ao protocolo', '<img src="//example.com/a.png">'],
    ['imagem SVG em data:', '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">'],
    ['imagem data: sem base64', '<img src="data:image/png,abc">'],
    ['imagem data: com texto depois', `<img src="${PNG}&quot; onerror=&quot;x">`],
    ['caminho de imagem com consulta', `<img src="/api/v1/images/${IMAGE_ID}/480.webp?x=1">`],
    [
      'caminho de imagem com largura que não existe',
      `<img src="/api/v1/images/${IMAGE_ID}/999.webp">`,
    ],
    ['caminho de imagem sem UUID', '<img src="/api/v1/images/../../admin/480.webp">'],
    ['imagem com palavra-chave', '<img src="{{certificado.url_validacao}}">'],
    ['url() externo em atributo SVG', '<svg><rect fill="url(https://example.com/#a)"/></svg>'],
    ['url() externo no CSS', '<style>body { background: url(https://example.com/a.png) }</style>'],
    [
      'url() relativo ao protocolo no CSS',
      '<style>body { background: url("//example.com/a.png") }</style>',
    ],
    [
      'url() de folha de estilo em data:',
      '<style>body { background: url(data:text/css;base64,AAAA) }</style>',
    ],
    [
      'url() externo no atributo style',
      '<p style="background: url(https://example.com/a.png)">x</p>',
    ],
    [
      '@font-face com fonte externa',
      '<style>@font-face { font-family: X; src: url(https://example.com/x.woff2) }</style>',
    ],
    [
      'url() externo em propriedade personalizada',
      '<style>:root { --x: url(https://example.com/a.png) } body { background: var(--x) }</style>',
    ],
  ])('recusa %s', (_label, body) => {
    expect(rulesOf(template(body))).toContain('url_not_allowed');
  });
});

describe('validação do template: recusa por CSS', () => {
  it.each([
    ['@import com url()', '<style>@import url(https://example.com/a.css);</style>'],
    ['@import com texto', '<style>@import "https://example.com/a.css";</style>'],
    ['@IMPORT em maiúsculas', '<style>@IMPORT "a.css";</style>'],
    ['@import com escape', '<style>@\\69mport "a.css";</style>'],
    ['@namespace', '<style>@namespace svg url(http://www.w3.org/2000/svg);</style>'],
    ['expression()', '<style>p { width: expression(alert(1)) }</style>'],
    ['expression() no atributo style', '<p style="width: expression(alert(1))">x</p>'],
    ['behavior', '<style>p { behavior: url(data:image/png;base64,AAAA) }</style>'],
    ['behavior com hack de asterisco', '<style>p { *behavior: x }</style>'],
    ['behavior com escape', '<style>p { \\62 ehavior: x }</style>'],
    ['-moz-binding', '<style>p { -moz-binding: x }</style>'],
    [
      'image-set() com endereço em texto',
      '<style>p { background: image-set("https://example.com/a.png" 1x) }</style>',
    ],
    [
      '-webkit-image-set()',
      '<p style="background: -webkit-image-set(&quot;https://example.com/a.png&quot; 1x)">x</p>',
    ],
    ['attr()', '<style>p::after { content: attr(title) }</style>'],
    ['palavra-chave no <style>', '<style>p::after { content: "{{aluno.nome}}" }</style>'],
    ['palavra-chave no atributo style', '<p style="color: {{aluno.nome}}">x</p>'],
  ])('recusa %s', (_label, body) => {
    expect(rulesOf(template(body))).toContain('css_not_allowed');
  });

  it.each([
    [
      'url com escape no nome da função',
      '<style>p { background: u\\72l(https://example.com) }</style>',
    ],
    ['CSS com erro de sintaxe', '<style>p { color red }</style>'],
    ['chave de fechamento sobrando', '<style>p { color: red } }</style>'],
  ])('recusa %s como erro de análise', (_label, body) => {
    expect(rulesOf(template(body))).toContain('parse_error');
  });

  it('a linha do problema de CSS é a do documento', () => {
    const result = validateCertificateTemplate(
      `${REQUIRED}\n<style>\np { color: red }\n@import "a.css";\n</style>`,
    );
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatchObject({ rule: 'css_not_allowed', line: 4, column: 1 });
  });
});

describe('validação do template: análise do HTML', () => {
  it.each([
    ['comentário condicional', '<!--[if IE]><script>alert(1)</script><![endif]-->'],
    ['comentário que esconde marcação', '<!-- <img src=x onerror=alert(1)> -->'],
    ['comentário fechado por --!>', '<!-- a --!> b -->'],
    ['comentário vazio estranho', '<!-->'],
    ['comentário com --', '<!-- a -- b -->'],
    ['instrução de processamento', '<?php echo 1; ?>'],
    ['declaração desconhecida', '<!ENTITY x "y">'],
    ['CDATA', '<![CDATA[<script>alert(1)</script>]]>'],
    ['CDATA no SVG', '<svg><![CDATA[x]]></svg>'],
    ['fechamento sem nome', '</ script>'],
    ['doctype antigo', '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN">'],
    ['caractere nulo', '<p>a\u0000b</p>'],
    ['texto que não é UTF-8 válido', '<p>\uD800</p>'],
  ])('recusa %s', (_label, body) => {
    expect(rulesOf(template(body))).toContain('parse_error');
  });

  it('comentário que termina em --!> e libera um script é recusado pelos dois motivos', () => {
    const rules = rulesOf(template('<!-- x --!> <script>alert(1)</script> -->'));
    expect(rules).toContain('element_not_allowed');
  });

  it('recusa acima de 768 KiB sem analisar o resto', () => {
    const html = template(
      `<p>${'é'.repeat(CERTIFICATE_TEMPLATE_MAX_BYTES / 2)}</p><script></script>`,
    );
    expect(validateCertificateTemplate(html).problems).toEqual([
      { rule: 'too_large', message: expect.stringContaining('768 KiB'), line: 1, column: 1 },
    ]);
  });

  it('limita o número de problemas devolvidos', () => {
    const result = validateCertificateTemplate(template('<script></script>'.repeat(500)));
    expect(result.problems).toHaveLength(CERTIFICATE_TEMPLATE_MAX_PROBLEMS);
    expect(result.truncated).toBe(true);
  });
});

describe('validação do template: palavras-chave', () => {
  it.each([
    ['desconhecida', '<p>{{aluno.email}}</p>', 'unknown_key'],
    ['vazia', '<p>{{ }}</p>', 'unknown_key'],
    ['com chaves a mais', '<p>{{{aluno.nome}}}</p>', 'unknown_key'],
    ['com espaço dentro do nome', '<p>{{aluno . nome}}</p>', 'unknown_key'],
    ['desconhecida em atributo', '<p title="{{senha}}">x</p>', 'unknown_key'],
    ['sem fechamento', '<p>{{aluno.nome</p>', 'unclosed_key'],
    ['sem fechamento em atributo', '<p title="{{aluno.nome">x</p>', 'unclosed_key'],
    ['QR em atributo', '<p title="{{certificado.qrcode}}">x</p>', 'key_in_attribute'],
    [
      'QR em href',
      '<a href="https://example.com/{{certificado.qrcode}}">x</a>',
      'key_in_attribute',
    ],
    ['QR no título', '<title>{{certificado.qrcode}}</title>', 'key_in_attribute'],
    ['QR dentro de SVG', '<svg><text>{{certificado.qrcode}}</text></svg>', 'key_in_attribute'],
    [
      'palavra-chave em atributo SVG',
      '<svg><rect fill="{{aluno.nome}}"/></svg>',
      'key_in_attribute',
    ],
  ])('recusa palavra-chave %s', (_label, body, rule) => {
    expect(rulesOf(template(body))).toContain(rule);
  });

  it('chave escrita com entidades conta como palavra-chave (o texto lido é o que vale)', () => {
    expect(rulesOf(template('<p>&#123;&#123;aluno.email}}</p>'))).toEqual(['unknown_key']);
  });

  it.each([
    ['aluno.nome', '<p>{{curso.titulo}} {{certificado.codigo}} {{certificado.qrcode}}</p>'],
    ['curso.titulo', '<p>{{aluno.nome}} {{certificado.codigo}} {{certificado.qrcode}}</p>'],
    ['certificado.codigo', '<p>{{aluno.nome}} {{curso.titulo}} {{certificado.url_validacao}}</p>'],
  ])('recusa template sem %s', (key, html) => {
    const result = validateCertificateTemplate(html);
    expect(result.problems).toEqual([
      {
        rule: 'missing_required_key',
        message: `Falta a palavra-chave {{${key}}}.`,
        line: 1,
        column: 1,
      },
    ]);
  });

  it('recusa template sem URL de validação nem QR', () => {
    expect(rulesOf('<p>{{aluno.nome}} {{curso.titulo}} {{certificado.codigo}}</p>')).toEqual([
      'missing_required_key',
    ]);
  });

  it('palavra-chave em comentário não conta como presente', () => {
    expect(
      rulesOf(
        '<!-- {{aluno.nome}} --><p>{{curso.titulo}} {{certificado.codigo}} {{certificado.qrcode}}</p>',
      ),
    ).toEqual(['missing_required_key']);
  });

  it('reconhece as 13 palavras-chave e nada mais', () => {
    expect(CERTIFICATE_TEMPLATE_KEYS).toHaveLength(13);
    expect(isCertificateTemplateKey('aluno.nome')).toBe(true);
    expect(isCertificateTemplateKey('aluno.email')).toBe(false);
  });
});

describe('preenchimento do template', () => {
  it('troca as palavras-chave e escapa o valor no texto', () => {
    const { html } = fillCertificateTemplate(template(''), {
      ...VALUES,
      'aluno.nome': '<script>alert("x")</script> & \'y\'',
    });
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
    expect(html).not.toContain('<script');
    expect(html).toContain('Curso de Teste');
  });

  it('escapa o valor nos atributos: aspas não abrem atributo novo', () => {
    const { html } = fillCertificateTemplate(
      template('<p title="{{aluno.nome}}" class="{{curso.titulo}}">x</p>'),
      {
        ...VALUES,
        'aluno.nome': '" onmouseover="alert(1)',
        'curso.titulo': "' onclick='alert(1)",
      },
    );
    expect(html).toContain('title="&quot; onmouseover=&quot;alert(1)"');
    expect(html).toContain('class="&#39; onclick=&#39;alert(1)"');
    // Dentro das marcas, fora dos valores entre aspas, não sobra atributo de evento.
    const tags = html.replace(/"[^"]*"/g, '""').match(/<[^>]*>/g) ?? [];
    expect(tags.filter((tag) => /\son\w+=/.test(tag))).toEqual([]);
  });

  it('a URL de validação entra no href', () => {
    const { html } = fillCertificateTemplate(
      template('<a href="{{certificado.url_validacao}}">v</a>'),
      VALUES,
    );
    expect(html).toContain(`<a href="${VALUES['certificado.url_validacao']}">v</a>`);
  });

  it('recusa preencher link com valor que não é http(s)', () => {
    expect(() =>
      fillCertificateTemplate(template('<a href="{{certificado.url_validacao}}">v</a>'), {
        ...VALUES,
        'certificado.url_validacao': 'javascript:alert(1)',
      }),
    ).toThrow(TypeError);
  });

  it('põe o SVG do QR, em marcação canônica', () => {
    const { html } = fillCertificateTemplate(
      '<p>{{aluno.nome}} {{curso.titulo}} {{certificado.codigo}}</p><div>{{certificado.qrcode}}</div>',
      VALUES,
      { qrSvg: QR_SVG },
    );
    expect(html).toContain(
      '<div><svg xmlns="http://www.w3.org/2000/svg" viewbox="0 0 29 29" shape-rendering="crispEdges"><path fill="#ffffff" d="M0 0h29v29H0z"></path>',
    );
  });

  it.each([
    ['ausente', undefined],
    ['com script', '<svg><script>alert(1)</script></svg>'],
    ['com on*', '<svg onload="alert(1)"></svg>'],
    ['que não é SVG', '<p>x</p>'],
    ['com dois elementos', `${QR_SVG}${QR_SVG}`],
    ['com palavra-chave', '<svg><text>{{aluno.nome}}</text></svg>'],
  ])('recusa QR %s', (_label, qrSvg) => {
    expect(() =>
      fillCertificateTemplate(template('<div>{{certificado.qrcode}}</div>'), VALUES, { qrSvg }),
    ).toThrow(TypeError);
  });

  it('troca a imagem da instalação pelo data: recebido; ausente vira espaço vazio', () => {
    const present = `/api/v1/images/${IMAGE_ID}/480.webp`;
    const missing = `/api/v1/images/${IMAGE_ID}/64.webp`;
    const webp = 'data:image/webp;base64,UklGRg==';
    const result = fillCertificateTemplate(
      template(
        `<img src="/api/v1/images/${IMAGE_ID.toUpperCase()}/480.webp" width="10"><img src="${missing}"><img src="${PNG}">`,
      ),
      VALUES,
      { images: { [present]: webp } },
    );
    expect(result.html).toContain(`<img src="${webp}" width="10">`);
    expect(result.html).toContain(`<img src="${CERTIFICATE_EMPTY_IMAGE}">`);
    expect(result.html).toContain(`<img src="${PNG}">`);
    expect(result.missingImages).toEqual([missing]);
  });

  it('não aceita como imagem embutida algo que não é data:image', () => {
    const path = `/api/v1/images/${IMAGE_ID}/480.webp`;
    const result = fillCertificateTemplate(template(`<img src="${path}">`), VALUES, {
      images: { [path]: 'https://example.com/a.png' },
    });
    expect(result.html).toContain(CERTIFICATE_EMPTY_IMAGE);
    expect(result.missingImages).toEqual([path]);
  });

  it('envolve o fragmento em <html><body> e tira os comentários', () => {
    const { html } = fillCertificateTemplate(template('<!-- nota -->'), VALUES);
    expect(html.startsWith('<!DOCTYPE html><html><body><p>Ana Souza')).toBe(true);
    expect(html.endsWith('</body></html>')).toBe(true);
    expect(html).not.toContain('nota');
  });

  it('documento completo mantém a estrutura, o CSS cru e o texto reescapado', () => {
    const { html } = fillCertificateTemplate(
      `<!doctype html><html><head><meta charset="utf-8"><title>{{aluno.nome}}</title><style>p > b { color: red }</style></head><body>${REQUIRED}<p>a &amp; b&nbsp;&lt;i&gt;</p><br></body></html>`,
      { ...VALUES, 'aluno.nome': '</title><script>' },
    );
    expect(html).toBe(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>&lt;/title&gt;&lt;script&gt;</title><style>p > b { color: red }</style></head><body><p>&lt;/title&gt;&lt;script&gt; Curso de Teste ABCD-EFGH-JKMN ${VALUES['certificado.url_validacao']}</p><p>a &amp; b &lt;i&gt;</p><br></body></html>`,
    );
  });

  it('head e body sem html ganham só o <html>', () => {
    const { html } = fillCertificateTemplate(
      `<head><title>t</title></head><body>${REQUIRED}</body>`,
      VALUES,
    );
    expect(html.startsWith('<!DOCTYPE html><html><head>')).toBe(true);
  });

  it('valida de novo e recusa template inválido com certificate_template_invalid', () => {
    let caught: unknown;
    try {
      fillCertificateTemplate(template('<script>alert(1)</script>'), VALUES);
    } catch (error) {
      caught = error;
    }
    expect(isDomainError(caught)).toBe(true);
    if (isDomainError(caught)) {
      expect(caught.code).toBe('certificate_template_invalid');
      expect(caught.status).toBe(422);
      expect(caught.extras).toEqual({
        details: { problems: [expect.objectContaining({ rule: 'element_not_allowed', line: 2 })] },
      });
    }
  });

  it('exige todos os valores de texto', () => {
    const { 'aluno.nome': _removed, ...partial } = VALUES;
    expect(() =>
      fillCertificateTemplate(template(''), partial as unknown as CertificateTemplateValues),
    ).toThrow(TypeError);
  });

  it('escapeCertificateHtml escapa os cinco caracteres', () => {
    expect(escapeCertificateHtml(`&<>"'a`)).toBe('&amp;&lt;&gt;&quot;&#39;a');
  });

  it('certificateTemplateInvalid monta o 422 com details.problems', () => {
    const error = certificateTemplateInvalid([]);
    expect(error.code).toBe('certificate_template_invalid');
    expect(error.extras).toEqual({ details: { problems: [] } });
  });
});

describe('valores das palavras-chave', () => {
  const context = {
    locale: 'pt-BR',
    timeZone: 'America/Sao_Paulo',
    classroomUrl: 'https://classroom.example.test/',
  };

  it('datas por extenso e curta no idioma e no fuso da escola', () => {
    // 01:30 UTC do dia 26 ainda é dia 25 em São Paulo (UTC-3).
    const date = new Date('2026-11-26T01:30:00Z');
    expect(formatCertificateDateLong(date, context)).toBe('25 de novembro de 2026');
    expect(formatCertificateDateShort(date, context)).toBe('25/11/2026');
    expect(formatCertificateDateShort(date, { locale: 'pt-BR', timeZone: 'UTC' })).toBe(
      '26/11/2026',
    );
    expect(formatCertificateDateLong(date, { locale: 'en-US', timeZone: 'UTC' })).toBe(
      'November 26, 2026',
    );
  });

  it('código com hífens e URL de validação', () => {
    expect(formatCertificateCode('abcdefghjkmn')).toBe('ABCD-EFGH-JKMN');
    expect(() => formatCertificateCode('ABC')).toThrow(TypeError);
    expect(certificateValidationUrl('https://c.example.test/', 'ABCDEFGHJKMN')).toBe(
      'https://c.example.test/certificados/ABCD-EFGH-JKMN',
    );
  });

  it('monta os 12 valores de texto a partir dos dados congelados', () => {
    const values = certificateTemplateValues(
      {
        studentName: 'Ana',
        courseTitle: 'Curso',
        hours: 7,
        instructorName: null,
        completedAt: new Date('2026-11-25T12:00:00Z'),
        issuedAt: new Date('2026-11-26T12:00:00Z'),
        code: 'abcd-efgh-jkmn',
        schoolName: 'Escola',
        signerName: null,
        signerRole: 'Diretora',
      },
      context,
    );
    expect(values).toEqual({
      'aluno.nome': 'Ana',
      'curso.titulo': 'Curso',
      'curso.carga_horaria': '7',
      'curso.instrutor': '',
      'certificado.data_conclusao': '25 de novembro de 2026',
      'certificado.data_conclusao_curta': '25/11/2026',
      'certificado.data_emissao': '26 de novembro de 2026',
      'certificado.codigo': 'ABCD-EFGH-JKMN',
      'certificado.url_validacao': 'https://classroom.example.test/certificados/ABCD-EFGH-JKMN',
      'escola.nome': 'Escola',
      'assinatura.nome': '',
      'assinatura.cargo': 'Diretora',
    });
  });

  it('recusa carga horária que não é inteiro não negativo', () => {
    const data = certificatePreviewData({
      now: new Date(),
      schoolName: 'E',
      signerName: null,
      signerRole: null,
    });
    expect(() => certificateTemplateValues({ ...data, hours: 1.5 }, context)).toThrow(TypeError);
    expect(() => certificateTemplateValues({ ...data, hours: -1 }, context)).toThrow(TypeError);
  });

  it('dados de exemplo: sem curso, com curso e com signatário configurado', () => {
    const now = new Date('2026-11-25T12:00:00Z');
    expect(
      certificatePreviewData({ now, schoolName: 'E', signerName: null, signerRole: null }),
    ).toEqual({
      studentName: 'Maria Exemplo da Silva',
      courseTitle: 'Curso de exemplo',
      hours: 12,
      instructorName: 'Nome do instrutor',
      completedAt: now,
      issuedAt: now,
      code: CERTIFICATE_PREVIEW_CODE,
      schoolName: 'E',
      signerName: 'Nome de quem assina',
      signerRole: 'Cargo',
    });
    expect(
      certificatePreviewData({
        now,
        course: { title: 'Meu curso', instructorName: null },
        schoolName: 'E',
        signerName: 'Carla',
        signerRole: 'Diretora',
      }),
    ).toMatchObject({
      courseTitle: 'Meu curso',
      instructorName: null,
      signerName: 'Carla',
      signerRole: 'Diretora',
    });
  });

  it('referência do editor: as 13 palavras-chave com exemplo e obrigatoriedade, e o modelo', () => {
    const reference = certificateTemplateReference({
      ...context,
      now: new Date('2026-11-25T12:00:00Z'),
      schoolName: 'Escola',
      signerName: null,
      signerRole: null,
    });
    expect(reference.modelHtml).toBe(CERTIFICATE_TEMPLATE_MODEL_HTML);
    expect(reference.keys.map((key) => key.key)).toEqual([...CERTIFICATE_TEMPLATE_KEYS]);
    expect(reference.keys.filter((key) => key.required).map((key) => key.key)).toEqual([
      'aluno.nome',
      'curso.titulo',
      'certificado.codigo',
    ]);
    expect(reference.keys.filter((key) => key.requiredOneOf).map((key) => key.key)).toEqual([
      'certificado.url_validacao',
      'certificado.qrcode',
    ]);
    expect(reference.keys.find((key) => key.key === 'aluno.nome')).toMatchObject({
      placeholder: '{{aluno.nome}}',
      example: 'Maria Exemplo da Silva',
    });
    expect(reference.keys.find((key) => key.key === 'certificado.data_conclusao')?.example).toBe(
      '25 de novembro de 2026',
    );
    for (const key of reference.keys) {
      expect(key.description.length).toBeGreaterThan(0);
    }
  });

  it('o modelo preenchido com os dados de exemplo sai sem palavra-chave sobrando', () => {
    const values = certificateTemplateValues(
      certificatePreviewData({
        now: new Date(),
        schoolName: 'Escola',
        signerName: null,
        signerRole: null,
      }),
      context,
    );
    const { html, missingImages } = fillCertificateTemplate(
      CERTIFICATE_TEMPLATE_MODEL_HTML,
      values,
      {
        qrSvg: QR_SVG,
      },
    );
    expect(html).not.toContain('{{');
    expect(html).toContain('Maria Exemplo da Silva');
    expect(missingImages).toEqual([]);
  });
});
