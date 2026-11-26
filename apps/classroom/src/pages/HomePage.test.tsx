import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PRIORITY_COVERS } from '../catalog/CatalogCard';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { BUNDLE_ITEM, COURSE_ITEM, EBOOK_ITEM } from '../test/catalog';
import {
  apiRoutes,
  EMPTY_CATALOG,
  findAlert,
  inMain,
  jsonResponse,
  META,
  makeSession,
  queryAlert,
  renderApp,
  unavailableResponse,
} from '../test/renderApp';

const CATALOG = '/api/v1/catalog';
const PAGE = { items: [COURSE_ITEM, EBOOK_ITEM, BUNDLE_ITEM], nextCursor: null };
const withCatalog = (body: unknown = PAGE) =>
  apiRoutes({ [`GET ${CATALOG}`]: () => jsonResponse(body) });

const list = () => screen.findByRole('list', { name: ptBR.home.catalog.list });
const card = async (title: string) =>
  (await screen.findByRole('heading', { level: 3, name: title })).closest('article') as HTMLElement;
/** Consultas feitas à vitrine, como `URLSearchParams`. */
const catalogQueries = (calls: { path: string; search: string }[]) =>
  calls.filter((call) => call.path === CATALOG).map((call) => new URLSearchParams(call.search));

describe('vitrine', () => {
  it('mostra o estado de carregando enquanto a vitrine não responde', async () => {
    const { requests } = renderApp('/', () => new Promise<Response>(() => {}));

    expect(inMain().getByRole('status').textContent).toBe(ptBR.home.catalog.loading);
    expect(screen.getByRole('heading', { level: 1, name: ptBR.home.welcome })).toBeTruthy();
    await waitFor(() => expect(requests).toContain(CATALOG));
    expect(document.title).toBe(`${ptBR.home.title} · ${ptBR.app.name}`);
  });

  it('abre sem login e lista cursos, pacotes e ebooks com preço, totais e bloqueio', async () => {
    const { calls } = renderApp('/', withCatalog());

    expect(await screen.findByRole('heading', { level: 1, name: META.schoolName })).toBeTruthy();
    expect((await list()).children).toHaveLength(3);

    // curso pago: preço na moeda do /meta, bloqueio e validade; a cesta só aparece logado (Fase 3)
    const course = within(await card(COURSE_ITEM.title));
    expect(course.getByRole('link', { name: COURSE_ITEM.title }).getAttribute('href')).toBe(
      '/cursos/react-do-zero',
    );
    expect(course.getByText(/^R\$\s197,00$/)).toBeTruthy();
    expect(course.getByText(ptBR.product.types.course)).toBeTruthy();
    expect(course.getByText(ptBR.product.levels.beginner)).toBeTruthy();
    expect(course.getByText('2 módulos')).toBeTruthy();
    expect(course.getByText('3 aulas')).toBeTruthy();
    expect(course.getByText('3 h 20 min')).toBeTruthy();
    expect(
      course.getByText(new RegExp(`${ptBR.product.locked} · Acesso por 365 dias`)),
    ).toBeTruthy();
    expect(course.getByRole('presentation').getAttribute('src')).toBe(COURSE_ITEM.cover?.url);

    // ebook aberto: "Gratuito", sem bloqueio
    const ebook = within(await card(EBOOK_ITEM.title));
    expect(ebook.getByRole('link').getAttribute('href')).toBe('/ebooks/guia-de-git');
    expect(ebook.getByText(ptBR.product.free)).toBeTruthy();
    expect(ebook.getByText('48 páginas')).toBeTruthy();
    expect(ebook.queryByText(/Acesso liberado/)).toBeNull();

    const bundle = within(await card(BUNDLE_ITEM.title));
    expect(bundle.getByRole('link').getAttribute('href')).toBe('/pacotes/trilha-front-end');
    expect(bundle.getByText('2 itens')).toBeTruthy();
    expect(bundle.getByText(/Acesso vitalício/)).toBeTruthy();

    // sem compra nem cesta dentro da vitrine
    const main = within(screen.getByRole('main'));
    expect(main.queryByRole('button', { name: /compr|cesta|carrinho/i })).toBeNull();
    expect(main.queryByRole('link', { name: /compr|cesta|carrinho/i })).toBeNull();

    // a vitrine é pública: a consulta saiu de um visitante, sem filtro e com o tamanho da página
    const [query] = catalogQueries(calls);
    expect(query?.toString()).toBe('limit=24');
    expect(screen.getByText('3 produtos na lista')).toBeTruthy();

    // título, descrição e Open Graph por página (ADR 0018)
    const description = `Cursos, pacotes e ebooks de ${META.schoolName}.`;
    await waitFor(() => expect(document.title).toBe(`${ptBR.home.title} · ${META.schoolName}`));
    const content = (selector: string) =>
      document.head.querySelector(selector)?.getAttribute('content');
    expect(content('meta[name="description"]')).toBe(description);
    expect(content('meta[property="og:title"]')).toBe(document.title);
    expect(content('meta[property="og:description"]')).toBe(description);

    await expectNoAxeViolations();
  });

  it('vitrine vazia sugere criar conta ao visitante, e não a quem já entrou', async () => {
    const first = renderApp('/');
    expect(await screen.findByText(ptBR.home.catalog.emptyTitle)).toBeTruthy();
    expect(screen.getByRole('link', { name: ptBR.home.catalog.action }).getAttribute('href')).toBe(
      '/cadastro',
    );
    await expectNoAxeViolations();
    first.unmount();

    renderApp('/', withCatalog(EMPTY_CATALOG), { session: makeSession() });
    expect(await screen.findByText(ptBR.home.catalog.emptyTitle)).toBeTruthy();
    await screen.findByRole('button', {
      name: ptBR.shell.accountMenu.replace('{{name}}', 'Ana Souza'),
    });
    expect(screen.queryByRole('link', { name: ptBR.home.catalog.action })).toBeNull();
  });

  it('filtra por tipo, nível e preço, ordena, e leva os filtros ao endereço', async () => {
    const user = userEvent.setup();
    const { calls, router } = renderApp('/', withCatalog());
    await list();

    await user.click(screen.getByRole('button', { name: 'Tipo: Todos os tipos' }));
    await user.click(screen.getByRole('option', { name: ptBR.home.filters.type.course }));
    await waitFor(() => expect(router.state.location.search).toBe('?tipo=curso'));
    expect(screen.getByRole('button', { name: 'Tipo: Cursos' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Nível: Todos os níveis' }));
    await user.click(screen.getByRole('option', { name: ptBR.product.levels.advanced }));
    await user.click(screen.getByRole('button', { name: 'Preço: Gratuitos e pagos' }));
    await user.click(screen.getByRole('option', { name: ptBR.home.filters.price.paid }));
    await user.click(screen.getByRole('button', { name: 'Ordem: Mais recentes' }));
    await user.click(screen.getByRole('option', { name: ptBR.home.filters.sort.priceAsc }));

    await waitFor(() =>
      expect(router.state.location.search).toBe(
        '?tipo=curso&nivel=avancado&preco=pago&ordem=menor-preco',
      ),
    );
    await waitFor(() =>
      expect(catalogQueries(calls).at(-1)?.toString()).toBe(
        'type=course&level=advanced&price=paid&sort=priceCents&limit=24',
      ),
    );

    await user.click(screen.getByRole('button', { name: ptBR.home.filters.clear }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.queryByRole('button', { name: ptBR.home.filters.clear })).toBeNull();
  });

  it('busca por título e resumo depois de uma pausa na digitação', async () => {
    const user = userEvent.setup();
    const { calls, router } = renderApp(
      '/',
      apiRoutes({
        [`GET ${CATALOG}`]: (request) =>
          jsonResponse(new URL(request.url).searchParams.has('q') ? EMPTY_CATALOG : PAGE),
      }),
    );
    await list();

    const field = screen.getByRole('searchbox', { name: ptBR.home.filters.search });
    await user.type(field, 'python');
    await waitFor(() => expect(router.state.location.search).toBe('?q=python'));

    // sem resultado: aviso próprio, com o atalho para limpar
    expect(await screen.findByText(ptBR.home.catalog.noResultsTitle)).toBeTruthy();
    // uma consulta só para a busca inteira, não uma por tecla
    expect(catalogQueries(calls).filter((query) => query.has('q'))).toHaveLength(1);
    expect(screen.queryByText(ptBR.home.catalog.emptyTitle)).toBeNull();
    const empty = screen.getByText(ptBR.home.catalog.noResultsTitle).parentElement as HTMLElement;
    await user.click(within(empty).getByRole('button', { name: ptBR.home.filters.clear }));
    await list();
    expect((field as HTMLInputElement).value).toBe('');
    expect(router.state.location.search).toBe('');
  });

  it('lê os filtros do endereço e ignora valor desconhecido', async () => {
    const { calls } = renderApp(
      '/?tipo=ebook&preco=gratis&ordem=titulo&nivel=mestre&q=git',
      withCatalog(),
    );
    await list();
    expect(catalogQueries(calls)[0]?.toString()).toBe(
      'type=ebook&price=free&q=git&sort=title&limit=24',
    );
    expect(screen.getByRole('button', { name: 'Tipo: Ebooks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nível: Todos os níveis' })).toBeTruthy();
    expect(
      (screen.getByRole('searchbox', { name: ptBR.home.filters.search }) as HTMLInputElement).value,
    ).toBe('git');
  });

  it('só as capas da primeira fileira são pedidas com prioridade; as demais, sob demanda', async () => {
    const user = userEvent.setup();
    const covered = (index: number) => ({
      ...COURSE_ITEM,
      id: `0193a5b2-0000-7000-8000-0000000001${String(index).padStart(2, '0')}`,
      slug: `curso-${index}`,
      title: `Curso ${index}`,
    });
    renderApp(
      '/',
      apiRoutes({
        [`GET ${CATALOG}`]: (request) =>
          new URL(request.url).searchParams.get('cursor') === 'cursor-2'
            ? jsonResponse({ items: [covered(7), covered(8)], nextCursor: null })
            : jsonResponse({
                items: [1, 2, 3, 4, 5, 6].map(covered),
                nextCursor: 'cursor-2',
              }),
      }),
    );
    const covers = async () =>
      within(await list())
        .getAllByRole('presentation')
        .map((image) => [image.getAttribute('loading'), image.getAttribute('fetchpriority')]);

    expect(await covers()).toEqual([
      ...Array(PRIORITY_COVERS).fill(['eager', 'high']),
      ['lazy', null],
      ['lazy', null],
    ]);

    // os itens de "Carregar mais" chegam abaixo da dobra: sem prioridade
    await user.click(screen.getByRole('button', { name: ptBR.home.catalog.more }));
    await card('Curso 8');
    const all = await covers();
    expect(all).toHaveLength(8);
    expect(all.filter(([loading]) => loading === 'eager')).toHaveLength(PRIORITY_COVERS);
    expect(
      all
        .slice(PRIORITY_COVERS)
        .every(([loading, priority]) => loading === 'lazy' && priority === null),
    ).toBe(true);
  });

  it('"Carregar mais" pede a página seguinte pelo cursor', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      '/',
      apiRoutes({
        [`GET ${CATALOG}`]: (request) =>
          new URL(request.url).searchParams.get('cursor') === 'cursor-2'
            ? jsonResponse({ items: [BUNDLE_ITEM], nextCursor: null })
            : jsonResponse({ items: [COURSE_ITEM, EBOOK_ITEM], nextCursor: 'cursor-2' }),
      }),
    );
    expect((await list()).children).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: ptBR.home.catalog.more }));
    await card(BUNDLE_ITEM.title);
    expect((await list()).children).toHaveLength(3);
    expect(catalogQueries(calls).at(-1)?.get('cursor')).toBe('cursor-2');
    expect(screen.queryByRole('button', { name: ptBR.home.catalog.more })).toBeNull();
  });

  it('mostra o erro com o código da requisição e tenta de novo', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp(
      '/',
      apiRoutes({
        [`GET ${CATALOG}`]: () => (fail ? unavailableResponse() : jsonResponse(PAGE)),
      }),
    );

    const alert = await findAlert();
    expect(within(alert).getByText(ptBR.home.catalog.errorTitle)).toBeTruthy();
    expect(within(alert).getByText(ptBR.errors.unavailable)).toBeTruthy();
    expect(within(alert).getByText('Código da requisição: req-teste-1')).toBeTruthy();

    fail = false;
    await user.click(within(alert).getByRole('button', { name: ptBR.common.retry }));
    await card(COURSE_ITEM.title);
    expect(queryAlert()).toBeNull();
  });
});
