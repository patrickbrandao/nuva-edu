// Fumaça dos dois sites: abrem, mostram o que vem de `/api/v1/meta`, trocam de tema e cabem em
// 360 px. Seletores só por papel e nome acessível: a casca dos sites troca de componentes sem
// quebrar estes testes.
import { expect, type Locator, type Page, test } from '@playwright/test';
import { ADMIN_URL, CLASSROOM_URL } from '../support/env.ts';

const SITES = [
  { site: 'admin', url: ADMIN_URL, title: /Painel/ },
  { site: 'classroom', url: CLASSROOM_URL, title: /Vitrine/ },
] as const;

/** Valores que nenhuma instalação tem: se aparecem na página, vieram da resposta da API. */
const FAKE_META = { schoolName: 'Escola Fumaça', version: '97.98.99' };

/** Nomes tolerantes: a casca pode trocar "Menu principal" por "Menu" sem quebrar a fumaça. */
const MENU = /^Menu/;
const OPEN_MENU = /^Abrir o menu/;

/** Opção do seletor de tema, seja ela botão de alternância ou opção de grupo. */
function themeOption(page: Page, name: string): Locator {
  const group = page.getByRole('group', { name: 'Tema da página' });
  const radios = page.getByRole('radiogroup', { name: 'Tema da página' });
  return group
    .getByRole('button', { name, exact: true })
    .or(radios.getByRole('radio', { name, exact: true }));
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'largura do conteúdo não passa da largura da janela').toBeLessThanOrEqual(client);
}

for (const { site, url, title } of SITES) {
  test.describe(`site ${site}`, () => {
    test('abre e mostra a escola e a versão que a API informa', async ({ page }) => {
      const metaResponse = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/api/v1/meta',
      );
      await page.goto(url);
      await expect(page).toHaveTitle(title);

      const response = await metaResponse;
      expect(response.status(), `GET ${url}/api/v1/meta feito pela página`).toBe(200);
      const meta = await response.json();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('contentinfo')).toContainText(`Versão ${meta.version}`);
      await expect(page.getByText(meta.schoolName, { exact: true }).first()).toBeVisible();
    });

    test('o que aparece vem de /api/v1/meta, não de valor fixo no site', async ({ page }) => {
      await page.route('**/api/v1/meta', async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.fulfill({ response, json: { ...(await response.json()), ...FAKE_META } });
      });
      await page.goto(url);
      await expect(page.getByRole('contentinfo')).toContainText(`Versão ${FAKE_META.version}`);
      await expect(page.getByText(FAKE_META.schoolName, { exact: true }).first()).toBeVisible();
    });

    test('troca de tema e mantém a escolha depois de recarregar', async ({ page }) => {
      const html = page.locator('html');
      await page.goto(url);
      // Sem escolha salva, o tema segue o sistema: nenhum data-theme.
      await expect(html).not.toHaveAttribute('data-theme');

      for (const [name, theme] of [
        ['Tema escuro', 'dark'],
        ['Tema claro', 'light'],
      ] as const) {
        await themeOption(page, name).click();
        await expect(html).toHaveAttribute('data-theme', theme);
        await page.reload();
        await expect(html).toHaveAttribute('data-theme', theme);
        await expect(themeOption(page, name)).toBeVisible();
      }

      await themeOption(page, 'Usar o tema do sistema').click();
      await expect(html).not.toHaveAttribute('data-theme');
      await page.reload();
      await expect(html).not.toHaveAttribute('data-theme');
    });

    test('a 360 px não há rolagem horizontal', async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 740 });
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  });
}

test('classroom a 360 px: o menu vira gaveta', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(CLASSROOM_URL);
  const menu = page.getByRole('navigation', { name: MENU });
  const drawer = page.getByRole('dialog', { name: MENU });

  // Fechada: o menu não ocupa a tela; só o botão que o abre.
  await expect(page.getByRole('button', { name: OPEN_MENU })).toBeVisible();
  await expect(menu).toBeHidden();

  await page.getByRole('button', { name: OPEN_MENU }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Vitrine', exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: OPEN_MENU })).toBeVisible();
});

test('classroom em tela larga: o menu fica à vista, sem gaveta', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(CLASSROOM_URL);
  await expect(page.getByRole('navigation', { name: MENU })).toBeVisible();
  await expect(page.getByRole('button', { name: OPEN_MENU })).toBeHidden();
});
