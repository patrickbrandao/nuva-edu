import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ptBR from '../locales/pt-BR.json';
import { expectNoAxeViolations } from '../test/axe';
import { BUNDLE, COURSE, EBOOK } from '../test/catalog';
import {
  apiRoutes,
  findAlert,
  jsonResponse,
  makeSession,
  problemResponse,
  queryAlert,
  renderApp,
  unavailableResponse,
} from '../test/renderApp';

const COURSE_URL = 'GET /api/v1/catalog/course/react-do-zero';
const title = (name: string) => screen.findByRole('heading', { level: 1, name });
const accessPanel = () => within(screen.getByRole('region', { name: ptBR.product.access.title }));
const content = (selector: string) =>
  document.head.querySelector(selector)?.getAttribute('content');

describe('página do produto', () => {
  it('curso pago abre sem login, com descrição, programa, preço e bloqueio', async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(
      '/cursos/react-do-zero',
      apiRoutes({ [COURSE_URL]: () => jsonResponse(COURSE) }),
    );

    expect(await title(COURSE.title)).toBeTruthy();
    expect(screen.getByText(COURSE.summary as string)).toBeTruthy();

    // descrição em Markdown higienizado: o HTML bruto não vira elemento
    expect(screen.getByText('React').tagName).toBe('STRONG');
    expect(document.querySelector('main script')).toBeNull();

    // programa na ordem de `position`, com o primeiro módulo aberto
    const modules = screen.getAllByRole('button', { name: /aula/ });
    expect(modules.map((button) => button.getAttribute('aria-expanded'))).toEqual([
      'true',
      'false',
    ]);
    expect(modules[0]?.textContent).toContain('Primeiros passos');
    expect(modules[0]?.textContent).toContain('2 aulas · 1 h 40 min');
    const first = within(screen.getByRole('region', { name: /Primeiros passos/ }));
    const lessons = first.getAllByRole('listitem');
    expect(lessons.map((lesson) => lesson.textContent)).toEqual([
      `Boas-vindas ao curso${ptBR.product.sample}10 min`,
      'Seu primeiro componente1 h 30 min',
    ]);
    const closed = () => screen.getByText('useState na prática').closest('[hidden]');
    expect(closed()).not.toBeNull();
    await user.click(modules[1] as HTMLElement);
    expect(closed()).toBeNull();

    // preço, bloqueio e validade; a compra entra pela cesta (Fase 3), pedindo login ao visitante
    const panel = accessPanel();
    expect(panel.getByText(/^R\$\s197,00$/)).toBeTruthy();
    expect(panel.getByText(ptBR.product.locked)).toBeTruthy();
    expect(panel.getByText('Acesso por 365 dias')).toBeTruthy();
    expect(panel.getByRole('link', { name: ptBR.sales.buy.add }).getAttribute('href')).toBe(
      '/entrar?destino=%2Fcursos%2Freact-do-zero',
    );
    expect(panel.queryByRole('button')).toBeNull();

    // detalhes
    expect(screen.getByText('Bruno Lima')).toBeTruthy();
    expect(screen.getByText('2 módulos · 3 aulas · 3 h 20 min')).toBeTruthy();
    expect(screen.getByText('22 de novembro de 2026')).toBeTruthy();

    // visitante: só a rota pública do catálogo, nenhuma que exige login
    expect(calls.some((call) => call.path === '/api/v1/courses/react-do-zero')).toBe(false);

    // título, descrição e Open Graph próprios (ADR 0018), com a capa na prévia de link
    await waitFor(() => expect(document.title).toBe(`${COURSE.title} · Escola Aurora`));
    expect(content('meta[name="description"]')).toBe(COURSE.summary);
    expect(content('meta[property="og:title"]')).toBe(document.title);
    expect(content('meta[property="og:description"]')).toBe(COURSE.summary);
    expect(content('meta[property="og:image"]')).toBe(
      new URL(COURSE.cover?.largeUrl as string, window.location.href).href,
    );

    await expectNoAxeViolations();
  });

  it('curso gratuito leva o visitante ao login, com o caminho de volta', async () => {
    renderApp(
      '/cursos/react-do-zero',
      apiRoutes({
        [COURSE_URL]: () =>
          jsonResponse({ ...COURSE, accessMode: 'open', priceCents: null, accessDays: null }),
      }),
    );
    await title(COURSE.title);
    const panel = accessPanel();
    expect(panel.getByText(ptBR.product.free)).toBeTruthy();
    expect(panel.queryByText(ptBR.product.locked)).toBeNull();
    expect(panel.getByRole('link', { name: ptBR.product.access.signIn }).getAttribute('href')).toBe(
      '/entrar?destino=%2Fcursos%2Freact-do-zero',
    );
  });

  it('quem já tem o acesso a um curso pago vê o caminho até ele, sem bloqueio', async () => {
    const { calls } = renderApp(
      '/cursos/react-do-zero',
      apiRoutes({
        [COURSE_URL]: () => jsonResponse(COURSE),
        'GET /api/v1/courses/react-do-zero': () =>
          jsonResponse({
            access: { allowed: true, reason: null, expiresAt: '2027-03-12T12:00:00Z' },
          }),
      }),
      { session: makeSession() },
    );
    await title(COURSE.title);
    expect(
      await screen.findByText('Você tem acesso a este produto até 12 de março de 2027.'),
    ).toBeTruthy();
    const panel = accessPanel();
    expect(panel.queryByText(ptBR.product.locked)).toBeNull();
    expect(
      panel.getByRole('link', { name: ptBR.product.access.openCourse }).getAttribute('href'),
    ).toBe('/meus-cursos/react-do-zero');
    expect(calls.some((call) => call.path === '/api/v1/courses/react-do-zero')).toBe(true);
  });

  it('aluno sem direito (ou com a consulta de acesso em falha) continua vendo o bloqueio', async () => {
    const first = renderApp(
      '/cursos/react-do-zero',
      apiRoutes({
        [COURSE_URL]: () => jsonResponse(COURSE),
        'GET /api/v1/courses/react-do-zero': () =>
          jsonResponse({
            access: { allowed: false, reason: 'no_entitlement', expiresAt: null },
          }),
      }),
      { session: makeSession() },
    );
    await title(COURSE.title);
    await waitFor(() =>
      expect(first.calls.some((call) => call.path === '/api/v1/courses/react-do-zero')).toBe(true),
    );
    expect(accessPanel().getByText(ptBR.product.locked)).toBeTruthy();
    expect(
      accessPanel().getByRole('button', {
        name: ptBR.sales.buy.addNamed.replace('{{title}}', COURSE.title),
      }),
    ).toBeTruthy();
    first.unmount();

    // rota de acesso ainda inexistente na API: vale o que é público
    renderApp('/cursos/react-do-zero', apiRoutes({ [COURSE_URL]: () => jsonResponse(COURSE) }), {
      session: makeSession(),
    });
    await title(COURSE.title);
    expect(accessPanel().getByText(ptBR.product.locked)).toBeTruthy();
    expect(queryAlert()).toBeNull();
  });

  it('pacote lista os itens, sem link para o item privado, e mostra a economia', async () => {
    renderApp(
      '/pacotes/trilha-front-end',
      apiRoutes({ 'GET /api/v1/catalog/bundle/trilha-front-end': () => jsonResponse(BUNDLE) }),
    );
    await title(BUNDLE.title);

    const items = screen
      .getByRole('heading', { level: 2, name: ptBR.product.items })
      .closest('section') as HTMLElement;
    expect(within(items).getByRole('link', { name: 'React do zero' }).getAttribute('href')).toBe(
      '/cursos/react-do-zero',
    );
    expect(within(items).getByText('Apostila interna')).toBeTruthy();
    expect(within(items).getAllByRole('link')).toHaveLength(1);
    expect(
      within(items).getByText(/itens custam R\$\s394,00: economia de R\$\s97,00/),
    ).toBeTruthy();

    const panel = accessPanel();
    expect(panel.getByText(/^R\$\s297,00$/)).toBeTruthy();
    expect(panel.getByText(ptBR.product.locked)).toBeTruthy();
    expect(panel.getByText(ptBR.product.validity.lifetime)).toBeTruthy();
    expect(panel.getByRole('link', { name: ptBR.sales.buy.add }).getAttribute('href')).toBe(
      '/entrar?destino=%2Fpacotes%2Ftrilha-front-end',
    );

    // sem resumo, a descrição da página sai do tipo e do título
    await waitFor(() => expect(document.title).toBe(`${BUNDLE.title} · Escola Aurora`));
    expect(content('meta[name="description"]')).toBe(BUNDLE.summary);
    expect(document.head.querySelector('meta[property="og:image"]')).toBeNull();
    await expectNoAxeViolations();
  });

  it('ebook gratuito mostra autor e páginas, e leva o aluno aos seus ebooks', async () => {
    renderApp(
      '/ebooks/guia-de-git',
      apiRoutes({
        'GET /api/v1/catalog/ebook/guia-de-git': () => jsonResponse(EBOOK),
        'GET /api/v1/ebooks/guia-de-git': () =>
          jsonResponse({ access: { allowed: true, reason: null, expiresAt: null } }),
      }),
      { session: makeSession() },
    );
    await title(EBOOK.title);
    expect(screen.getByText('Carla Dias')).toBeTruthy();
    expect(screen.getByText('48 páginas')).toBeTruthy();
    expect(await screen.findByText(ptBR.product.access.granted)).toBeTruthy();
    expect(
      accessPanel().getByRole('link', { name: ptBR.product.access.openEbook }).getAttribute('href'),
    ).toBe('/meus-ebooks');
    await waitFor(() =>
      expect(content('meta[name="description"]')).toBe(
        'Conheça o ebook Guia de Git: descrição e preço.',
      ),
    );
    await expectNoAxeViolations();
  });

  it('produto privado, em rascunho ou inexistente (404) mostra "não encontrado"', async () => {
    renderApp(
      '/cursos/secreto',
      apiRoutes({ 'GET /api/v1/catalog/course/secreto': () => problemResponse(404, 'not_found') }),
    );
    expect(await title(ptBR.product.notFoundTitle)).toBeTruthy();
    expect(screen.getByText(ptBR.product.notFoundText)).toBeTruthy();
    expect(screen.getByRole('link', { name: ptBR.common.backHome }).getAttribute('href')).toBe('/');
    expect(queryAlert()).toBeNull();
    await waitFor(() =>
      expect(document.title).toBe(`${ptBR.product.notFoundTitle} · Escola Aurora`),
    );
  });

  it('falha do servidor mostra o erro e tenta de novo', async () => {
    const user = userEvent.setup();
    let fail = true;
    renderApp(
      '/cursos/react-do-zero',
      apiRoutes({ [COURSE_URL]: () => (fail ? unavailableResponse() : jsonResponse(COURSE)) }),
    );
    const alert = await findAlert();
    expect(within(alert).getByText(ptBR.product.errorTitle)).toBeTruthy();
    expect(within(alert).getByText('Código da requisição: req-teste-1')).toBeTruthy();
    fail = false;
    await user.click(within(alert).getByRole('button', { name: ptBR.common.retry }));
    expect(await title(COURSE.title)).toBeTruthy();
  });
});
