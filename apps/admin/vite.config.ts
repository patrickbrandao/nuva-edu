import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Em produção o proxy reverso entrega `/api` e `/healthz` do mesmo host à admin-api (spec 031).
// Em desenvolvimento o Vite faz esse papel; a porta padrão é a da admin-api na spec 031.
const adminApi = process.env.NUVA_ADMIN_API_URL ?? 'http://127.0.0.1:3000';
const proxy = {
  '/api': { target: adminApi, changeOrigin: true },
  '/healthz': { target: adminApi, changeOrigin: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5311, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 5311, strictPort: true, proxy },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
