import { THEME_BOOT_SCRIPT } from '@nuva-edu/ui';
import { expect, it } from 'vitest';
import html from '../index.html?raw';

it('aplica o tema salvo antes da primeira pintura, com o script de @nuva-edu/ui', () => {
  expect(html).toContain(`<script>${THEME_BOOT_SCRIPT}</script>`);
});

it('declara o idioma e as metas que cada página preenche', () => {
  expect(html).toContain('<html lang="pt-BR">');
  for (const meta of ['name="description"', 'property="og:title"', 'property="og:description"']) {
    expect(html).toContain(`<meta ${meta}`);
  }
});
