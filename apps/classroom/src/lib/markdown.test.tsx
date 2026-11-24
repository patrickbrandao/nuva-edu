import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Markdown, safeHref } from './markdown';

const html = (source: string) => render(<Markdown source={source} />).container.innerHTML;

describe('Markdown restrito', () => {
  it('converte títulos, parágrafos, ênfase, listas, citação, código e linha', () => {
    const { container } = render(
      <Markdown
        source={[
          '# Termos',
          '',
          'Texto com **negrito**, *itálico* e `código`.',
          'Continua no mesmo parágrafo.',
          '',
          '- um',
          '- dois',
          '',
          '1. primeiro',
          '2. segundo',
          '',
          '> citação',
          '',
          '```',
          'bloco <b>de</b> código',
          '```',
          '',
          '---',
          '## Seção',
        ].join('\n')}
      />,
    );
    expect(container.querySelector('h2')?.textContent).toBe('Termos');
    expect(container.querySelector('h3')?.textContent).toBe('Seção');
    expect(container.querySelector('p strong')?.textContent).toBe('negrito');
    expect(container.querySelector('p em')?.textContent).toBe('itálico');
    expect(container.querySelector('p code')?.textContent).toBe('código');
    expect(container.querySelector('p')?.textContent).toContain('Continua no mesmo parágrafo.');
    expect([...container.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual([
      'um',
      'dois',
    ]);
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(container.querySelector('blockquote')?.textContent).toBe('citação');
    expect(container.querySelector('pre code')?.textContent).toBe('bloco <b>de</b> código');
    expect(container.querySelector('pre b')).toBeNull();
    expect(container.querySelector('hr')).not.toBeNull();
  });

  it('não interpreta HTML: marcação aparece como texto', () => {
    const output = html('<script>alert(1)</script> <img src=x onerror=alert(1)> <b>oi</b>');
    expect(output).not.toContain('<script');
    expect(output).not.toContain('<img');
    expect(output).not.toContain('<b>');
    expect(output).toContain('&lt;script&gt;');
  });

  it('só deixa links http(s), mailto e do próprio site', () => {
    const { container } = render(
      <Markdown
        source={[
          '[externo](https://escola.test/a)',
          '[interno](/privacidade)',
          '[email](mailto:dpo@escola.test)',
          '[js](javascript:alert(1))',
          '[dados](data:text/html,oi)',
          '[outro host](//mal.test)',
        ].join('\n\n')}
      />,
    );
    const links = [...container.querySelectorAll('a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://escola.test/a',
      '/privacidade',
      'mailto:dpo@escola.test',
    ]);
    expect(links[0]?.getAttribute('rel')).toBe('noopener nofollow noreferrer');
    expect(container.textContent).toContain('js');
    expect(container.textContent).toContain('outro host');
  });

  it('safeHref recusa esquemas perigosos', () => {
    expect(safeHref(' JavaScript:alert(1)')).toBeNull();
    expect(safeHref('vbscript:x')).toBeNull();
    expect(safeHref('/\\mal.test')).toBeNull();
    expect(safeHref('https://ok.test')).toBe('https://ok.test/');
  });
});
