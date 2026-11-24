import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Em produção o proxy reverso entrega `/api` e `/healthz` do mesmo host à classroom-api
// (spec 031). Em desenvolvimento o Vite faz esse papel; a porta padrão é a da classroom-api
// na spec 031 e `NUVA_CLASSROOM_API_URL` aponta para outro endereço.
const classroomApi = process.env.NUVA_CLASSROOM_API_URL ?? 'http://127.0.0.1:3000';
const proxy = {
  '/api': { target: classroomApi, changeOrigin: true },
  '/healthz': { target: classroomApi, changeOrigin: true },
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5312, strictPort: true, proxy },
  preview: { host: '127.0.0.1', port: 5312, strictPort: true, proxy },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
