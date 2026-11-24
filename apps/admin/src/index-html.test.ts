import { THEME_BOOT_SCRIPT } from '@nuva-edu/ui';
import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';

describe('index.html', () => {
  it('aplica o tema salvo antes da primeira pintura, com o script de @nuva-edu/ui', () => {
    expect(html).toContain(`<script>${THEME_BOOT_SCRIPT}</script>`);
  });

  it('declara o idioma e não depende de CDN externa', () => {
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).not.toMatch(/(src|href)="https?:/);
  });
});
