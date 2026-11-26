import { renderLegacyMarkdown, renderMarkdownToHtml } from '@nuva-edu/core/markdown';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Accordion,
  type LinkComponent,
  Markdown,
  MarkdownPreview,
  ProductCard,
  ProductCardList,
  ProgressBar,
  SortableList,
  type SortableListLabels,
  safeMarkdownUrl,
  Tabs,
} from '../../index';
import { expectNoAxeViolations } from '../../test/axe';
import markdownSource from './Markdown.tsx?raw';

const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/**
 * Assinatura estrutural (elementos, atributos e texto), indiferente a ordem e entidades. O
 * contêiner do componente e os textos só para leitores de tela ficam de fora: eles são da
 * exibição, não do HTML persistido.
 */
function structure(node: ParentNode): string[] {
  return [...node.querySelectorAll('*')]
    .filter((element) => !element.classList.contains('minui-sr-only'))
    .filter((element) => !element.classList.contains('minui-markdown'))
    .map((element) => {
      const attributes = [...element.attributes]
        .map((attribute) => `${attribute.name}=${attribute.value}`)
        .sort()
        .join(',');
      const clone = element.cloneNode(true) as Element;
      for (const hidden of clone.querySelectorAll('.minui-sr-only')) hidden.remove();
      return `${element.tagName.toLowerCase()}[${attributes}]{${clone.textContent ?? ''}}`;
    });
}

/** A mesma assinatura do HTML saneado, lido por um analisador independente do componente. */
function structureOfHtml(html: string): string[] {
  const document = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  return structure(document.body.firstElementChild ?? document.body);
}

const MARKDOWN_HTML =
  'Texto com **negrito**, *itálico* e `código`.\n\n- um\n- dois\n\n1. primeiro\n\n> citação\n\n[site](https://example.com) e [e-mail](mailto:a@example.com)\n\n![foto](https://example.com/foto.png)';

describe('Markdown', () => {
  it('desenha o HTML saneado devolvido pela API', async () => {
    const { container } = render(
      <Markdown html={renderMarkdownToHtml(MARKDOWN_HTML)} newTabLabel="(abre em nova aba)" />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('negrito');
    expect(container.querySelector('em')?.textContent).toBe('itálico');
    expect(container.querySelector('code')?.textContent).toBe('código');
    expect(container.querySelectorAll('ul li')).toHaveLength(2);
    expect(container.querySelectorAll('ol li')).toHaveLength(1);
    expect(container.querySelector('blockquote')?.textContent).toContain('citação');
    const link = screen.getByRole('link', { name: /site/ });
    expect(link.getAttribute('href')).toBe('https://example.com');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('nofollow noopener noreferrer');
    expect(within(link).getByText(/abre em nova aba/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /e-mail/ }).getAttribute('href')).toBe(
      'mailto:a@example.com',
    );
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://example.com/foto.png');
    expect(image?.getAttribute('alt')).toBe('foto');
    expect(image?.getAttribute('loading')).toBe('lazy');
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer');
    await expectNoAxeViolations(container);
  });

  it('higieniza de novo o HTML recebido: cargas de XSS não viram elemento nem atributo', () => {
    const pwned = vi.fn();
    (window as unknown as { pwned: () => void }).pwned = pwned;
    const tampered = [
      '<p onclick="window.pwned()">clique</p>',
      '<p><script>window.pwned()</script>fim</p>',
      '<p><img src="https://x.test/i.png" alt="foto" onerror="window.pwned()" style="position:fixed"></p>',
      '<p><a href="javascript:window.pwned()" rel="opener" target="_self">a</a></p>',
      '<p><a href="data:text/html,<b>x</b>" rel="opener">b</a></p>',
      '<p><iframe src="https://x.test"></iframe>fim</p>',
      '<p><style>*{display:none}</style>fim</p>',
      '<p><form action="https://x.test"><input value="x"></form>fim</p>',
    ].join('');
    const { container } = render(<Markdown html={tampered} />);
    for (const selector of [
      'script',
      'iframe',
      'style',
      'form',
      'input',
      '[onclick]',
      '[onerror]',
      '[style]',
      'a[href^="javascript:"]',
      'a[href^="data:"]',
    ]) {
      expect(container.querySelector(selector), selector).toBeNull();
    }
    expect(container.textContent).toContain('clique');
    expect(container.textContent).toContain('fim');
    expect(container.textContent).toContain('a');
    expect(pwned).not.toHaveBeenCalled();
  });

  it('fixa os atributos do link mesmo quando o HTML traz outros', () => {
    const href = 'https://ok.test/a?b=1&amp;c=2';
    const { container } = render(
      <Markdown html={`<p><a href="${href}" rel="opener" target="_self" class="x">ok</a></p>`} />,
    );
    const link = screen.getByRole('link', { name: 'ok' });
    expect(link.getAttribute('href')).toBe('https://ok.test/a?b=1&c=2');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('nofollow noopener noreferrer');
    expect(link.hasAttribute('class')).toBe(false);
    expect(container.querySelectorAll('a')).toHaveLength(1);
  });

  it('imagem fora do https absoluto é descartada e o alt fica como texto', () => {
    const { container } = render(
      <Markdown
        html={
          '<p><img src="http://x.test/i.png" alt="foto"><img src="data:image/png,x" alt="dado"></p>'
        }
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('foto');
    expect(container.textContent).toContain('dado');
  });

  it('imagem decorativa mantém alt vazio; sem alt usa o texto acessível do site', () => {
    const { container } = render(
      <Markdown html={'<p><img src="https://x.test/i.png" alt=""></p>'} />,
    );
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');

    const missing = render(
      <Markdown
        html={'<p><img src="https://x.test/j.png"></p>'}
        missingAltLabel="Imagem sem descrição"
      />,
    );
    expect(missing.container.querySelector('img')?.getAttribute('alt')).toBe(
      'Imagem sem descrição',
    );
    // sem o texto do site, nunca se usa o endereço como alternativa
    const fallback = render(<Markdown html={'<p><img src="https://x.test/k.png"></p>'} />);
    expect(fallback.container.querySelector('img')?.getAttribute('alt')).toBe('');
  });

  it('a prévia é idêntica ao HTML que a API persiste', () => {
    const cases = [
      '**negrito** _itálico_ `código`',
      '[site](https://example.com/a?b=1&c=2) e [e-mail](mailto:a@example.com)',
      '![foto](https://example.com/foto.png)',
      '- a\n- b\n\n> citação\n\n```js\nx\n```',
      '1. um\n2. dois',
      'texto <script>alert(1)</script> fim',
      '[x](javascript:alert(1)) ![i](http://x.test/i.png)',
      MARKDOWN_HTML,
    ];
    for (const markdown of cases) {
      const persisted = renderMarkdownToHtml(markdown);
      const saved = render(<Markdown html={persisted} newTabLabel="(abre em nova aba)" />);
      const preview = render(
        <MarkdownPreview markdown={markdown} newTabLabel="(abre em nova aba)" />,
      );
      expect(preview.container.innerHTML, markdown).toBe(saved.container.innerHTML);
      expect(structure(saved.container), markdown).toEqual(structureOfHtml(persisted));
    }
  });

  it('o Markdown anterior à ADR é desenhado pelo módulo comum, sem imagem externa', async () => {
    const markdown =
      '**negrito** [a](https://x.test) `c`\n\n![foto](https://x.test/i.png)\n\n<b>html</b>';
    const { container } = render(<Markdown newTabLabel="(abre em nova aba)">{markdown}</Markdown>);
    expect(structure(container)).toEqual(structureOfHtml(renderLegacyMarkdown(markdown)));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<b>html</b>');
    expect(container.textContent).toContain('foto');
    await expectNoAxeViolations(container);
  });

  it('não usa escrita direta de HTML no nó', () => {
    expect(markdownSource).not.toContain('dangerouslySetInnerHTML');
    expect(markdownSource).not.toContain('innerHTML');
  });

  it('safeMarkdownUrl aceita só https, http e mailto', () => {
    expect(safeMarkdownUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(safeMarkdownUrl('http://example.com')).toBe('http://example.com');
    expect(safeMarkdownUrl('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeMarkdownUrl('javascript:alert(1)')).toBe('');
    expect(safeMarkdownUrl('vbscript:x')).toBe('');
    expect(safeMarkdownUrl('ftp://example.com')).toBe('');
    expect(safeMarkdownUrl('/relativo')).toBe('');
  });

  it('texto vazio não quebra', () => {
    const { container } = render(<Markdown>{null}</Markdown>);
    expect(container.textContent).toBe('');
    const emptyHtml = render(<Markdown html="" />);
    expect(emptyHtml.container.textContent).toBe('');
  });
});

const sortLabels: SortableListLabels = {
  instructions:
    'Para mover, aperte espaço. Use as setas para cima e para baixo e espaço de novo para soltar. Esc cancela.',
  roleDescription: 'item reordenável',
  handle: (label) => `Mover ${label}`,
  pickedUp: (label, position, total) => `${label} pego, posição ${position} de ${total}.`,
  movedTo: (label, position, total) => `${label} na posição ${position} de ${total}.`,
  dropped: (label, position, total) => `${label} solto na posição ${position} de ${total}.`,
  cancelled: (label, position, total) =>
    `Movimento cancelado. ${label} voltou à posição ${position} de ${total}.`,
};

interface Lesson {
  id: string;
  title: string;
}

const LESSONS: Lesson[] = [
  { id: 'a', title: 'Aula A' },
  { id: 'b', title: 'Aula B' },
  { id: 'c', title: 'Aula C' },
];

function SortableHarness({ onReorder }: { onReorder: (items: Lesson[]) => void }) {
  const [items, setItems] = useState(LESSONS);
  return (
    <SortableList
      aria-label="Aulas do módulo"
      items={items}
      getId={(item) => item.id}
      getLabel={(item) => item.title}
      renderItem={(item) => <span>{item.title}</span>}
      labels={sortLabels}
      onReorder={(next) => {
        setItems(next);
        onReorder(next);
      }}
    />
  );
}

describe('SortableList', () => {
  const original = Element.prototype.getBoundingClientRect;
  beforeEach(() => {
    // o jsdom não calcula layout: cada linha ocupa 40 px, uma embaixo da outra
    Element.prototype.getBoundingClientRect = function rect(this: Element) {
      const row = this.closest('[data-sortable-id]');
      const index = row?.parentElement ? [...row.parentElement.children].indexOf(row) : 0;
      const top = index * 50;
      return {
        x: 0,
        y: top,
        top,
        left: 0,
        width: 300,
        height: 40,
        right: 300,
        bottom: top + 40,
        toJSON: () => ({}),
      } as DOMRect;
    };
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = original;
  });

  const liveRegion = () => document.querySelector('[id^="DndLiveRegion"]');

  it('desenha a lista com alças nomeadas e instruções em pt-BR', async () => {
    const { container } = render(<SortableHarness onReorder={() => {}} />);
    const list = screen.getByRole('list', { name: 'Aulas do módulo' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    const handle = screen.getByRole('button', { name: 'Mover Aula A' });
    expect(handle.getAttribute('aria-roledescription')).toBe('item reordenável');
    const describedBy = handle.getAttribute('aria-describedby');
    expect(describedBy && document.getElementById(describedBy)?.textContent).toBe(
      sortLabels.instructions,
    );
    await expectNoAxeViolations(container);
  });

  it('reordena por teclado (espaço, seta, espaço) e anuncia a posição', async () => {
    const onReorder = vi.fn();
    render(<SortableHarness onReorder={onReorder} />);
    const handle = screen.getByRole('button', { name: 'Mover Aula A' });
    handle.focus();

    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await tick();
    expect(liveRegion()?.textContent).toBe('Aula A pego, posição 1 de 3.');

    fireEvent.keyDown(handle, { code: 'ArrowDown', key: 'ArrowDown' });
    await tick();
    expect(liveRegion()?.textContent).toBe('Aula A na posição 2 de 3.');

    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await tick();
    expect(liveRegion()?.textContent).toBe('Aula A solto na posição 2 de 3.');

    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder.mock.calls[0]?.[0].map((item: Lesson) => item.id)).toEqual(['b', 'a', 'c']);
    const names = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(names).toEqual(['Aula B', 'Aula A', 'Aula C']);
  });

  it('Esc cancela o arrasto sem mudar a ordem', async () => {
    const onReorder = vi.fn();
    render(<SortableHarness onReorder={onReorder} />);
    const handle = screen.getByRole('button', { name: 'Mover Aula B' });
    handle.focus();
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await tick();
    fireEvent.keyDown(handle, { code: 'ArrowDown', key: 'ArrowDown' });
    await tick();
    fireEvent.keyDown(handle, { code: 'Escape', key: 'Escape' });
    await tick();
    expect(liveRegion()?.textContent).toBe('Movimento cancelado. Aula B voltou à posição 2 de 3.');
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('desligada, a alça não pega o item', async () => {
    const onReorder = vi.fn();
    render(
      <SortableList
        items={LESSONS}
        getId={(item) => item.id}
        getLabel={(item) => item.title}
        renderItem={(item) => item.title}
        labels={sortLabels}
        onReorder={onReorder}
        disabled
      />,
    );
    const handle = screen.getByRole('button', { name: 'Mover Aula A' });
    fireEvent.keyDown(handle, { code: 'Space', key: ' ' });
    await tick();
    expect(liveRegion()?.textContent ?? '').toBe('');
  });
});

describe('Accordion', () => {
  const items = [
    { id: 'm1', title: 'Módulo 1', meta: '2 aulas', content: <p>Aulas do módulo 1</p> },
    { id: 'm2', title: 'Módulo 2', meta: '3 aulas', content: <p>Aulas do módulo 2</p> },
  ];

  it('abre e fecha as seções, com aria-expanded e região ligada ao botão', async () => {
    const { container } = render(<Accordion items={items} defaultOpen={['m1']} />);
    const first = screen.getByRole('button', { name: /Módulo 1/ });
    const second = screen.getByRole('button', { name: /Módulo 2/ });
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(second.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('region', { name: /Módulo 1/ }).textContent).toBe('Aulas do módulo 1');
    expect(screen.queryByRole('region', { name: /Módulo 2/ })).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: /Módulo 1/ })).toBeTruthy();

    fireEvent.click(second);
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(first.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('false');
    await expectNoAxeViolations(container);
  });

  it('com multiple desligado, abrir uma fecha as outras', () => {
    const onOpenChange = vi.fn();
    render(
      <Accordion items={items} defaultOpen={['m1']} multiple={false} onOpenChange={onOpenChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Módulo 2/ }));
    expect(onOpenChange).toHaveBeenLastCalledWith(['m2']);
    expect(screen.getByRole('button', { name: /Módulo 1/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('controlado, segue a propriedade open', () => {
    const onOpenChange = vi.fn();
    render(<Accordion items={items} open={[]} onOpenChange={onOpenChange} headingLevel={2} />);
    const first = screen.getByRole('button', { name: /Módulo 1/ });
    fireEvent.click(first);
    expect(onOpenChange).toHaveBeenCalledWith(['m1']);
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('heading', { level: 2, name: /Módulo 1/ })).toBeTruthy();
  });
});

describe('Tabs', () => {
  const tabs = [
    { id: 'notas', label: 'Notas', content: <p>Minhas notas</p> },
    { id: 'comentarios', label: 'Comentários', count: 4, content: <p>Comentários da aula</p> },
    { id: 'materiais', label: 'Materiais', content: <p>Arquivos</p> },
  ];

  it('mostra a aba selecionada e troca por clique', async () => {
    const onChange = vi.fn();
    const { container } = render(<Tabs tabs={tabs} label="Seções da aula" onChange={onChange} />);
    expect(screen.getByRole('tablist', { name: 'Seções da aula' })).toBeTruthy();
    const notas = screen.getByRole('tab', { name: 'Notas' });
    expect(notas.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Notas' }).textContent).toBe('Minhas notas');
    await expectNoAxeViolations(container);

    fireEvent.click(screen.getByRole('tab', { name: /Comentários/ }));
    expect(onChange).toHaveBeenCalledWith('comentarios');
    expect(screen.getByRole('tabpanel').textContent).toBe('Comentários da aula');
    expect(screen.queryByText('Minhas notas')).toBeNull();
  });

  it('setas, Home e End movem o foco e a seleção; só a aba ativa entra no Tab', () => {
    render(<Tabs tabs={tabs} label="Seções da aula" defaultValue="notas" />);
    const [notas, comentarios, materiais] = screen.getAllByRole('tab');
    if (!notas || !comentarios || !materiais) throw new Error('abas');
    expect(notas.tabIndex).toBe(0);
    expect(comentarios.tabIndex).toBe(-1);
    notas.focus();
    fireEvent.keyDown(notas, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(comentarios);
    expect(comentarios.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(comentarios, { key: 'End' });
    expect(document.activeElement).toBe(materiais);
    fireEvent.keyDown(materiais, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(notas);
    fireEvent.keyDown(notas, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(materiais);
    fireEvent.keyDown(materiais, { key: 'Home' });
    expect(document.activeElement).toBe(notas);
  });

  it('controlada, segue a propriedade value', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={tabs} label="Seções" value="materiais" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Notas' }));
    expect(onChange).toHaveBeenCalledWith('notas');
    expect(screen.getByRole('tabpanel').textContent).toBe('Arquivos');
  });
});

describe('ProgressBar', () => {
  it('expõe o valor em aria-valuenow e limita a 0–100', async () => {
    const { container, rerender } = render(
      <ProgressBar
        value={33.4}
        label="Progresso do curso"
        valueText="1 de 3 aulas"
        caption="33%"
      />,
    );
    const bar = screen.getByRole('progressbar', { name: 'Progresso do curso' });
    expect(bar.getAttribute('aria-valuenow')).toBe('33');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuetext')).toBe('1 de 3 aulas');
    expect(screen.getByText('33%')).toBeTruthy();
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('33%');
    await expectNoAxeViolations(container);

    rerender(<ProgressBar value={140} label="Progresso do curso" />);
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    rerender(<ProgressBar value={Number.NaN} label="Progresso do curso" />);
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });
});

const RouterLink: LinkComponent = ({ href, ...rest }) => (
  <a {...rest} href={href} data-router="sim" />
);

describe('ProductCard', () => {
  it('mostra capa, título com link, nível, totais, preço e selo', async () => {
    const { container } = render(
      <ProductCardList aria-label="Cursos">
        <ProductCard
          key="c1"
          title="Fotografia básica"
          href="/cursos/fotografia"
          coverUrl="https://example.com/capa.webp"
          summary="Do zero ao primeiro ensaio."
          level="Iniciante"
          totals={['4 módulos', '12 aulas']}
          price="R$ 97,00"
          badge="Novo"
          linkComponent={RouterLink}
        />
        <ProductCard
          key="c2"
          title="Edição"
          href="/cursos/edicao"
          free
          freeLabel="Gratuito"
          price="R$ 10,00"
        />
      </ProductCardList>,
    );
    const list = screen.getByRole('list', { name: 'Cursos' });
    expect(list.getAttribute('data-layout')).toBe('grid');
    const link = screen.getByRole('link', { name: 'Fotografia básica' });
    expect(link.getAttribute('href')).toBe('/cursos/fotografia');
    expect(link.getAttribute('data-router')).toBe('sim');
    expect(screen.getByRole('heading', { level: 3, name: 'Fotografia básica' })).toBeTruthy();
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
    expect(screen.getByText('Iniciante')).toBeTruthy();
    expect(screen.getByText('12 aulas')).toBeTruthy();
    expect(screen.getByText('R$ 97,00')).toBeTruthy();
    expect(screen.getByText('Novo')).toBeTruthy();
    expect(screen.getByText('Gratuito')).toBeTruthy();
    expect(screen.queryByText('R$ 10,00')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('em lista, com progresso e ação, sem capa', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <ProductCard
        title="Fotografia básica"
        href="/meus-cursos/fotografia"
        layout="list"
        headingLevel={2}
        progress={{ value: 25, label: 'Progresso', valueText: '3 de 12 aulas', caption: '3 de 12' }}
        meta="Acesso até 12/03/2027"
        badge="Acesso vencido"
        badgeTone="warning"
        action={
          <button type="button" onClick={onClick}>
            Continuar
          </button>
        }
      />,
    );
    const card = container.querySelector('article');
    expect(card?.getAttribute('data-layout')).toBe('list');
    expect(container.querySelector('img')).toBeNull();
    expect(
      screen.getByRole('progressbar', { name: 'Progresso' }).getAttribute('aria-valuenow'),
    ).toBe('25');
    expect(screen.getByText('Acesso até 12/03/2027')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('capa com `loading="lazy"` por padrão e prioritária com `coverPriority`', () => {
    const { container } = render(
      <>
        <ProductCard title="Padrão" href="/cursos/a" coverUrl="https://example.com/a.webp" />
        <ProductCard
          title="Prioritária"
          href="/cursos/b"
          coverUrl="https://example.com/b.webp"
          coverPriority
        />
        <ProductCard title="Sem capa" href="/cursos/c" coverPriority />
      </>,
    );
    const covers = container.querySelectorAll('img');
    expect(covers).toHaveLength(2);
    const [lazy, eager] = covers;
    expect(lazy?.getAttribute('loading')).toBe('lazy');
    expect(lazy?.hasAttribute('fetchpriority')).toBe(false);
    expect(eager?.getAttribute('loading')).toBe('eager');
    expect(eager?.getAttribute('fetchpriority')).toBe('high');
    for (const cover of covers) {
      // 16:9 declarado na imagem reserva o espaço antes de ela chegar
      expect(
        Number(cover.getAttribute('width')) / Number(cover.getAttribute('height')),
      ).toBeCloseTo(16 / 9);
    }
  });
});
