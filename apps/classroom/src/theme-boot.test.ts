import { THEME_BOOT_SCRIPT } from '@nuva-edu/ui';
import { themeBootPlugin } from '@nuva-edu/ui/theme-boot';
import { expect, it } from 'vitest';
import html from '../index.html?raw';
import viteConfig from '../vite.config.ts?raw';

it('aplica o tema salvo antes da primeira pintura pelo plugin de @nuva-edu/ui', () => {
  expect(viteConfig).toMatch(/plugins: \[[^\]]*themeBootPlugin\(\)[^\]]*\]/);
  expect(themeBootPlugin().transformIndexHtml()).toEqual([
    { tag: 'script', children: THEME_BOOT_SCRIPT, injectTo: 'head-prepend' },
  ]);
  // o script não é mais copiado à mão para o index.html
  expect(html).not.toContain('localStorage');
});

it('declara o idioma e as metas que cada página preenche', () => {
  expect(html).toContain('<html lang="pt-BR">');
  for (const meta of ['name="description"', 'property="og:title"', 'property="og:description"']) {
    expect(html).toContain(`<meta ${meta}`);
  }
});
