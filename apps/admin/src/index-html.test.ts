import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import viteConfig from '../vite.config.ts?raw';

describe('index.html', () => {
  it('recebe o script do tema pelo plugin de @nuva-edu/ui, sem cópia feita à mão', () => {
    expect(viteConfig).toContain("import { themeBootPlugin } from '@nuva-edu/ui/theme-boot'");
    expect(viteConfig).toMatch(/plugins: \[[^\]]*themeBootPlugin\(\)/);
    expect(html).not.toContain('localStorage');
  });

  it('declara o idioma e não depende de CDN externa', () => {
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).not.toMatch(/(src|href)="https?:/);
  });
});
