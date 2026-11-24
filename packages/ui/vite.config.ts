import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// O Vite daqui serve só o catálogo (index.html + catalog/) e os testes.
// Os sites consomem o código-fonte do pacote direto, pelo `exports` do package.json.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5310, strictPort: true },
  preview: { host: '127.0.0.1', port: 5310, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
