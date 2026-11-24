import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfigFromFile } from 'vite';
import { describe, expect, it } from 'vitest';
import * as ui from '../index';
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY, themeBootPlugin } from './boot';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

describe('entrada @nuva-edu/ui/theme-boot', () => {
  it('é a mesma chave e o mesmo script do ponto de entrada principal', () => {
    expect(ui.THEME_BOOT_SCRIPT).toBe(THEME_BOOT_SCRIPT);
    expect(ui.THEME_STORAGE_KEY).toBe(THEME_STORAGE_KEY);
    expect(THEME_BOOT_SCRIPT).toContain(`'${THEME_STORAGE_KEY}'`);
  });

  it('o arquivo não importa nada (nem CSS, nem JSX, nem outro módulo)', () => {
    const source = readFileSync(here('./boot.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it('o Node importa a entrada pelo nome do pacote, sem empacotador', () => {
    const script = [
      "const m = await import('@nuva-edu/ui/theme-boot');",
      'process.stdout.write(m.THEME_BOOT_SCRIPT);',
    ].join('');
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: here('../..'),
      encoding: 'utf8',
    });
    expect(output).toBe(THEME_BOOT_SCRIPT);
  });

  it('um vite.config que importa a entrada é carregado pelo Vite', async () => {
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      here('./fixtures/vite.config.fixture.ts'),
    );
    expect(loaded?.config.define?.__THEME_BOOT__).toBe(JSON.stringify(THEME_BOOT_SCRIPT));
    expect(loaded?.config.plugins).toHaveLength(1);
  });

  it('o plugin põe o script no começo do <head>', () => {
    const plugin = themeBootPlugin();
    expect(plugin.name).toBe('nuva-theme-boot');
    expect(plugin.transformIndexHtml()).toEqual([
      { tag: 'script', children: THEME_BOOT_SCRIPT, injectTo: 'head-prepend' },
    ]);
  });

  it('o script aplica o tema salvo em <html> e ignora valor inválido', () => {
    const run = () => new Function(THEME_BOOT_SCRIPT)();
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    run();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(THEME_STORAGE_KEY, 'rosa');
    run();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
