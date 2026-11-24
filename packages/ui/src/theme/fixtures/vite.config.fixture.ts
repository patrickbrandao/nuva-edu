// Faz o papel do `vite.config.ts` de um site: importa a entrada sem CSS nem JSX pelo nome
// do pacote. Carregado por boot.test.ts com o carregador de configuração do próprio Vite.
import { THEME_BOOT_SCRIPT, themeBootPlugin } from '@nuva-edu/ui/theme-boot';

export default {
  plugins: [themeBootPlugin()],
  define: { __THEME_BOOT__: JSON.stringify(THEME_BOOT_SCRIPT) },
};
