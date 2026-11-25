import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MENU_STORAGE_KEY } from '../config';
import ptBR from '../locales/pt-BR.json';
import {
  apiRoutes,
  findAlert,
  jsonResponse,
  META,
  renderApp,
  unavailableResponse,
} from '../test/renderApp';
import { ACCENT_VARIABLE, DEFAULT_SOURCE_CODE_URL } from './brand';
import { NAV_GROUPS, PENDING_PAGES } from './navigation';

/** API simulada com `/api/v1/meta` alterado; o resto responde o padrão (vitrine vazia). */
const withMeta = (overrides: Partial<typeof META>) =>
  apiRoutes({ 'GET /api/v1/meta': () => jsonResponse({ ...META, ...overrides }) });

describe('casca do classroom', () => {
  it('mostra a barra superior, o menu da spec 006, o conteúdo e o rodapé', async () => {
    renderApp('/');

    const menu = screen.getByRole('navigation', { name: ptBR.shell.menu });
    for (const group of Object.values(ptBR.menu.groups)) {
      expect(within(menu).getByRole('list', { name: group })).toBeTruthy();
    }
    const links = within(menu).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(
      NAV_GROUPS.flatMap((group) => group.items.map((item) => item.path)),
    );
    expect(links.map((link) => link.textContent)).toEqual(Object.values(ptBR.menu.items));
    expect(within(menu).getByRole('link', { current: 'page' }).textContent).toBe(
      ptBR.menu.items.showcase,
    );

    expect(screen.getByRole('link', { name: ptBR.shell.skipToContent }).getAttribute('href')).toBe(
      '#conteudo',
    );
    expect(screen.getByRole('main').id).toBe('conteudo');
    expect(screen.getByRole('group', { name: ptBR.theme.group })).toBeTruthy();
    expect(screen.getByRole('link', { name: ptBR.shell.signIn }).getAttribute('href')).toBe(
      '/entrar',
    );

    // o nome da escola vem de /api/v1/meta
    expect(await screen.findByRole('link', { name: 'Escola Aurora' })).toBeTruthy();
  });

  const sourceLink = () =>
    within(screen.getByRole('contentinfo')).getByRole('link', {
      name: new RegExp(ptBR.footer.source),
    });
  const accent = () => document.documentElement.style.getPropertyValue(ACCENT_VARIABLE);
  const logoAlt = `Logotipo de ${META.schoolName}`;

  it('tem o link "Código-fonte" no rodapé (AGPL-3.0), no repositório padrão até o /meta responder', () => {
    renderApp('/', () => new Promise<Response>(() => {}));
    expect(sourceLink().getAttribute('href')).toBe(DEFAULT_SOURCE_CODE_URL);
    expect(sourceLink().getAttribute('rel')).toBe('noreferrer');
  });

  it('aponta o link "Código-fonte" para o sourceCodeUrl do /meta', async () => {
    const sourceCodeUrl = 'https://git.escola.test/aurora/nuva-edu';
    renderApp('/', withMeta({ sourceCodeUrl }));
    await waitFor(() => expect(sourceLink().getAttribute('href')).toBe(sourceCodeUrl));
  });

  it('mantém o repositório padrão se o /meta falhar ou trouxer endereço que não é http(s)', async () => {
    const failed = renderApp('/', async () => unavailableResponse());
    await findAlert();
    expect(sourceLink().getAttribute('href')).toBe(DEFAULT_SOURCE_CODE_URL);
    failed.unmount();

    renderApp('/', withMeta({ sourceCodeUrl: 'javascript:alert(1)' }));
    await screen.findByRole('link', { name: META.schoolName });
    expect(sourceLink().getAttribute('href')).toBe(DEFAULT_SOURCE_CODE_URL);
  });

  it('sem logotipo, a marca mostra só o nome da escola', async () => {
    renderApp('/');
    const brand = await screen.findByRole('link', { name: META.schoolName });
    expect(brand.querySelector('img')).toBeNull();
  });

  it('com logotipo, a marca mostra a imagem com texto alternativo e o mesmo nome acessível', async () => {
    const logoUrl = '/api/v1/images/0190a1b2-logo';
    renderApp('/', withMeta({ logoUrl }));

    const logo = await screen.findByAltText(logoAlt);
    expect(logo.getAttribute('src')).toBe(logoUrl);
    // o nome acessível do link continua sendo só o nome da escola
    const brand = screen.getByRole('link', { name: META.schoolName });
    expect(brand.contains(logo)).toBe(true);

    // imagem que não carrega: volta a mostrar só o nome
    fireEvent.error(logo);
    expect(screen.queryByAltText(logoAlt)).toBeNull();
    expect(screen.getByRole('link', { name: META.schoolName })).toBeTruthy();
  });

  it('sem cor de destaque, não define a variável e vale o padrão de @nuva-edu/ui', async () => {
    renderApp('/');
    await screen.findByRole('link', { name: META.schoolName });
    expect(accent()).toBe('');
  });

  it('com cor de destaque, aplica o valor na variável --minui-accent', async () => {
    renderApp('/', withMeta({ accentColor: '#0A7CFF' }));
    await waitFor(() => expect(accent()).toBe('#0A7CFF'));
  });

  it.each(['#0a7', 'red', '#0A7CFF; background: url(https://x.test)', '0A7CFF'])(
    'ignora a cor de destaque fora do formato #RRGGBB (%s)',
    async (accentColor) => {
      renderApp('/', withMeta({ accentColor }));
      await screen.findByRole('link', { name: META.schoolName });
      expect(accent()).toBe('');
    },
  );

  it('troca o tema e guarda a escolha em nuva-theme', async () => {
    const user = userEvent.setup();
    renderApp('/');

    await user.click(screen.getByRole('button', { name: ptBR.theme.dark.hint }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('nuva-theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: ptBR.theme.light.hint }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    await user.click(screen.getByRole('button', { name: ptBR.theme.system.hint }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('nuva-theme')).toBeNull();
  });

  it('abre a gaveta do menu, fecha com Esc e devolve o foco ao botão', async () => {
    const user = userEvent.setup();
    renderApp('/');

    const toggle = screen.getByRole('button', { name: ptBR.shell.openMenu });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(toggle);
    const drawer = screen.getByRole('dialog', { name: ptBR.shell.menu });
    expect(drawer.id).toBe(toggle.getAttribute('aria-controls'));
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(
      within(drawer).getByRole('button', { name: ptBR.shell.closeMenu }),
    );
    // o resto da página fica inerte: o foco não sai da gaveta
    expect(screen.getByRole('main').parentElement?.hasAttribute('inert')).toBe(true);
    expect(toggle.closest('header')?.hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');

    // o Tab dá a volta dentro da gaveta, sem chegar ao link "Ir para o conteúdo"
    const close = within(drawer).getByRole('button', { name: ptBR.shell.closeMenu });
    const lastLink = within(drawer).getAllByRole('link').at(-1);
    const skip = screen.getByText(ptBR.shell.skipToContent).closest('a');
    expect(skip?.closest('[inert]')).not.toBeNull();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(lastLink);
    await user.tab();
    expect(document.activeElement).toBe(close);
    // a volta completa passa só por controles da gaveta
    for (let step = 0; step < within(drawer).getAllByRole('link').length + 2; step += 1) {
      await user.tab();
      expect(drawer.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByRole('main').parentElement?.hasAttribute('inert')).toBe(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('fecha a gaveta pelo fundo e pelo botão de fechar', async () => {
    const user = userEvent.setup();
    renderApp('/');
    const toggle = screen.getByRole('button', { name: ptBR.shell.openMenu });

    await user.click(toggle);
    await user.click(screen.getByTestId('menu-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(toggle);

    await user.click(toggle);
    const drawer = screen.getByRole('dialog', { name: ptBR.shell.menu });
    await user.click(within(drawer).getByRole('button', { name: ptBR.shell.closeMenu }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it('em tela larga recolhe o menu e lembra a escolha em nuva-classroom-menu', async () => {
    window.innerWidth = 1440;
    const user = userEvent.setup();
    const first = renderApp('/');

    await user.click(screen.getByRole('button', { name: ptBR.shell.collapseMenu }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(MENU_STORAGE_KEY)).toBe('collapsed');
    const expand = screen.getByRole('button', { name: ptBR.shell.expandMenu });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    // recolhido, o menu continua com os nomes dos itens
    expect(screen.getByRole('link', { name: ptBR.menu.items.forum })).toBeTruthy();

    first.unmount();
    renderApp('/');
    await user.click(screen.getByRole('button', { name: ptBR.shell.expandMenu }));
    expect(localStorage.getItem(MENU_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: ptBR.shell.collapseMenu })).toBeTruthy();
  });

  it('navega pelo menu, pela trilha, pela marca e pelos botões sem recarregar a página', async () => {
    window.innerWidth = 1440;
    const user = userEvent.setup();
    const { router } = renderApp('/');
    const path = () => router.state.location.pathname;
    // um <a> comum pediria a página ao servidor; o roteador cancela o clique e troca a rota
    const clicks: boolean[] = [];
    const onClick = (event: MouseEvent) => clicks.push(event.defaultPrevented);
    window.addEventListener('click', onClick);

    const menu = screen.getByRole('navigation', { name: ptBR.shell.menu });
    await user.click(within(menu).getByRole('link', { name: ptBR.menu.items.plans }));
    await waitFor(() => expect(path()).toBe('/planos'));
    expect(within(menu).getByRole('link', { current: 'page' }).textContent).toBe(
      ptBR.menu.items.plans,
    );

    const trail = screen.getByRole('navigation', { name: ptBR.shell.breadcrumb });
    await user.click(within(trail).getByRole('link', { name: ptBR.home.title }));
    await waitFor(() => expect(path()).toBe('/'));

    await user.click(screen.getByRole('link', { name: ptBR.shell.signIn }));
    await waitFor(() => expect(path()).toBe('/entrar'));

    await user.click(await screen.findByRole('link', { name: 'Escola Aurora' }));
    await waitFor(() => expect(path()).toBe('/'));

    // "Notificações" existe no menu e na barra superior; aqui é o botão da barra
    const toggle = screen.getByRole('button', { name: ptBR.shell.collapseMenu });
    const topbar = within(toggle.closest('header') as HTMLElement);
    await user.click(topbar.getByRole('link', { name: ptBR.shell.notifications }));
    await waitFor(() => expect(path()).toBe('/notificacoes'));

    await user.click(await screen.findByRole('link', { name: ptBR.common.backHome }));
    await waitFor(() => expect(path()).toBe('/'));

    await user.click(screen.getByRole('link', { name: ptBR.home.catalog.action }));
    await waitFor(() => expect(path()).toBe('/cadastro'));

    const footer = screen.getByRole('contentinfo');
    await user.click(within(footer).getByRole('link', { name: ptBR.pages.terms }));
    await waitFor(() => expect(path()).toBe('/termos'));

    window.removeEventListener('click', onClick);
    expect(clicks).toEqual(Array(8).fill(true));
  });

  it('leva um item ainda sem tela à página "em construção", com trilha e título', async () => {
    const user = userEvent.setup();
    renderApp('/');

    await user.click(screen.getByRole('button', { name: ptBR.shell.openMenu }));
    await user.click(screen.getByRole('link', { name: ptBR.menu.items.forum }));

    expect(
      await screen.findByRole('heading', { level: 1, name: ptBR.menu.items.forum }),
    ).toBeTruthy();
    expect(screen.getByText(ptBR.construction.title)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('main')));

    const trail = screen.getByRole('navigation', { name: ptBR.shell.breadcrumb });
    expect(within(trail).getByRole('link', { name: ptBR.home.title })).toBeTruthy();
    expect(within(trail).getByText(ptBR.menu.items.forum).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(await screen.findByText(`Página: ${ptBR.menu.items.forum}`)).toBeTruthy();
    await waitFor(() => expect(document.title).toBe(`${ptBR.menu.items.forum} · Escola Aurora`));
  });

  it('abre todas as rotas do menu por endereço direto', async () => {
    // as telas ainda por construir mostram "em construção"
    for (const item of PENDING_PAGES) {
      const view = renderApp(item.path);
      expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
      expect(screen.getByText(ptBR.construction.title)).toBeTruthy();
      view.unmount();
    }
    // as já construídas (fora a vitrine) exigem login: cada uma tem o próprio teste
    const built = NAV_GROUPS.flatMap((group) => group.items).filter(
      (item) => item.path !== '/' && !PENDING_PAGES.some((page) => page.path === item.path),
    );
    expect(built.map((item) => item.path)).toEqual([
      '/inicio',
      '/meus-cursos',
      '/meus-ebooks',
      '/anotacoes',
      '/progresso',
      '/conta',
    ]);
    for (const item of built) {
      const view = renderApp(item.path);
      await waitFor(() => expect(view.router.state.location.pathname).toBe('/entrar'));
      expect(screen.queryByText(ptBR.construction.title)).toBeNull();
      view.unmount();
    }
  });

  it('mostra "não encontrado" em endereço desconhecido', async () => {
    renderApp('/nao-existe');
    expect(
      await screen.findByRole('heading', { level: 1, name: ptBR.notFound.title }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: ptBR.common.backHome }).getAttribute('href')).toBe('/');
  });

  it('o "Entrar" leva o endereço atual como destino', async () => {
    renderApp('/planos?x=1');
    const link = await screen.findByRole('link', { name: ptBR.shell.signIn });
    expect(link.getAttribute('href')).toBe('/entrar?destino=%2Fplanos%3Fx%3D1');
  });
});
