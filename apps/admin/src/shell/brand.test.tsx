import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { jsonResponse, META, renderApp } from '../test/render';
import { ACCENT_CSS_VARIABLE, sourceCodeUrlOf, validAccentColor } from './brand';

const DEFAULT_REPOSITORY = 'https://github.com/patrickbrandao/nuva-edu';
const LOGO_URL = '/api/v1/images/0b6f0c0e-8a43-4c8e-9a51-3f1d2c7e5a10/256';

const accent = () => document.documentElement.style.getPropertyValue(ACCENT_CSS_VARIABLE);
const brandArea = () =>
  screen.getByRole('navigation', { name: 'Menu' }).parentElement as HTMLElement;
const sourceLink = () => screen.getByRole('link', { name: /^Código-fonte/ });

describe('marca da escola vinda do /meta (spec 006, RF-06)', () => {
  it('sem logotipo, mostra só o nome, sem imagem', async () => {
    renderApp('/', () => jsonResponse({ ...META, logoUrl: null }));
    expect(await within(brandArea()).findByText('Escola Aurora')).toBeTruthy();
    expect(within(brandArea()).queryByRole('img')).toBeNull();
  });

  it('com logotipo, mostra a imagem com texto alternativo ao lado do nome', async () => {
    renderApp('/', () => jsonResponse({ ...META, logoUrl: LOGO_URL }));
    const logo = await within(brandArea()).findByRole('img', {
      name: 'Logotipo de Escola Aurora',
    });
    expect(logo.getAttribute('src')).toBe(LOGO_URL);
    expect(within(brandArea()).getByText('Escola Aurora')).toBeTruthy();
    // O nome acessível do menu não muda com o logotipo.
    expect(screen.getByRole('navigation', { name: 'Menu' })).toBeTruthy();
  });

  it('se a imagem do logotipo não carrega, volta ao ícone padrão', async () => {
    renderApp('/', () => jsonResponse({ ...META, logoUrl: LOGO_URL }));
    const logo = await within(brandArea()).findByRole('img');
    fireEvent.error(logo);
    expect(within(brandArea()).queryByRole('img')).toBeNull();
    expect(within(brandArea()).getByText('Escola Aurora')).toBeTruthy();
  });

  it('sem cor de destaque, não define a variável e vale o padrão do pacote de interface', async () => {
    renderApp('/', () => jsonResponse({ ...META, accentColor: null }));
    expect(await within(brandArea()).findByText('Escola Aurora')).toBeTruthy();
    expect(accent()).toBe('');
  });

  it('com cor de destaque, aplica a variável CSS na raiz e a retira ao desmontar', async () => {
    const { unmount } = renderApp('/', () => jsonResponse({ ...META, accentColor: '#0A7F5C' }));
    await waitFor(() => expect(accent()).toBe('#0A7F5C'));
    const brand = within(brandArea()).getByText('Escola Aurora').closest('.minui-adm-brand');
    expect((brand as HTMLElement).style.getPropertyValue('--adm-brand')).toBe('#0A7F5C');
    unmount();
    expect(accent()).toBe('');
  });

  it('aplica a cor também fora da casca, na tela de entrada', async () => {
    renderApp('/entrar', () => jsonResponse({ ...META, accentColor: '#0a7f5c' }));
    await waitFor(() => expect(accent()).toBe('#0a7f5c'));
  });

  it('ignora cor fora do formato #RRGGBB', async () => {
    renderApp('/', () => jsonResponse({ ...META, accentColor: 'red; background: url(//x.test)' }));
    const name = await within(brandArea()).findByText('Escola Aurora');
    expect(accent()).toBe('');
    const brand = name.closest('.minui-adm-brand') as HTMLElement;
    expect(brand.style.getPropertyValue('--adm-brand')).toBe('');
  });

  it('valida o formato da cor', () => {
    expect(validAccentColor('#12abEF')).toBe('#12abEF');
    for (const value of ['#fff', '#12abEF00', '12abEF', '#12abEG', 'red', ' #12abEF', '', null]) {
      expect(validAccentColor(value)).toBeNull();
    }
    expect(validAccentColor(undefined)).toBeNull();
  });
});

describe('link "Código-fonte" vindo do /meta (spec 006, RF-11)', () => {
  it('usa o sourceCodeUrl da escola quando é diferente do padrão', async () => {
    const fork = 'https://git.escola.example/equipe/nuva-edu-modificado';
    renderApp('/', () => jsonResponse({ ...META, sourceCodeUrl: fork }));
    await waitFor(() => expect(sourceLink().getAttribute('href')).toBe(fork));
    expect(sourceLink().getAttribute('target')).toBe('_blank');
  });

  it('aponta para o repositório padrão enquanto o /meta carrega', () => {
    renderApp('/', () => new Promise<Response>(() => {}));
    expect(sourceLink().getAttribute('href')).toBe(DEFAULT_REPOSITORY);
  });

  it('aponta para o repositório padrão quando o /meta falha', async () => {
    renderApp('/', () =>
      jsonResponse({ type: 'about:blank', title: 'Indisponível', status: 503 }, 503),
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(sourceLink().getAttribute('href')).toBe(DEFAULT_REPOSITORY);
  });

  it('só aceita endereço http(s)', () => {
    expect(sourceCodeUrlOf('https://exemplo.test/repo')).toBe('https://exemplo.test/repo');
    expect(sourceCodeUrlOf('http://exemplo.test/repo')).toBe('http://exemplo.test/repo');
    for (const value of ['javascript:alert(1)', 'data:text/html,x', '/repo', '', null, undefined]) {
      expect(sourceCodeUrlOf(value)).toBe(DEFAULT_REPOSITORY);
    }
  });
});
