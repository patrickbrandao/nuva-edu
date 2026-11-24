/*
 * Tema antes da primeira pintura.
 *
 * Este arquivo não importa CSS, JSX nem outro módulo: é a entrada `@nuva-edu/ui/theme-boot`,
 * que o `vite.config.ts` de cada site consegue importar (o Node carrega o arquivo direto).
 * Mantenha-o assim: só TypeScript que some ao apagar os tipos, sem `import`.
 */

/** Chave do tema no localStorage. */
export const THEME_STORAGE_KEY = 'nuva-theme';

/**
 * Script para o <head> do index.html de cada site: aplica o tema salvo antes
 * da primeira pintura, para a página não piscar no tema errado.
 */
export const THEME_BOOT_SCRIPT = `try{const t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch{}`;

/** A parte de um plugin do Vite que este arquivo usa (sem depender do pacote `vite`). */
export interface ThemeBootPlugin {
  name: string;
  transformIndexHtml: () => {
    tag: 'script';
    children: string;
    injectTo: 'head-prepend';
  }[];
}

/**
 * Plugin do Vite que põe o `THEME_BOOT_SCRIPT` no começo do <head> do index.html, no
 * servidor de desenvolvimento e no build. Com ele o site não copia o script à mão.
 *
 *   import { themeBootPlugin } from '@nuva-edu/ui/theme-boot';
 *   export default defineConfig({ plugins: [react(), themeBootPlugin()] });
 */
export function themeBootPlugin(): ThemeBootPlugin {
  return {
    name: 'nuva-theme-boot',
    transformIndexHtml: () => [
      { tag: 'script', children: THEME_BOOT_SCRIPT, injectTo: 'head-prepend' },
    ],
  };
}
