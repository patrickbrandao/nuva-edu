import type { Connect, Plugin } from 'vite';
import { RUNTIME_CONFIG_PATH, type RuntimeConfig } from './runtime-config';

/*
 * Só para `vite dev` e `vite preview`: responde `/config.json` como o Nginx do site faz em
 * produção (spec 031, "Configuração de execução dos sites"). Nada daqui entra no `dist/` nem na
 * imagem: o plugin não emite arquivo e este módulo só é importado pelo `vite.config.ts`.
 */

type Env = Record<string, string | undefined>;

/** Mesmas variáveis e padrões de `proxy/nginx/40-nuva-config.sh`. */
export function devRuntimeConfig(env: Env): Required<RuntimeConfig> {
  const domain = env.NUVA_DOMAIN || 'localhost';
  const scheme = env.NUVA_PUBLIC_SCHEME || 'http';
  const adminHost = env.NUVA_ADMIN_HOST || `edu-admin.${domain}`;
  const classroomHost = env.NUVA_CLASSROOM_HOST || `classroom.${domain}`;
  // Porta definida e vazia vale "sem porta"; a padrão do esquema também não aparece na URL.
  const port = env.NUVA_PUBLIC_PORT ?? '8080';
  const standard = scheme === 'https' ? '443' : '80';
  const suffix = port && port !== standard ? `:${port}` : '';
  return {
    app: 'classroom',
    adminUrl: `${scheme}://${adminHost}${suffix}`,
    classroomUrl: `${scheme}://${classroomHost}${suffix}`,
  };
}

export function devRuntimeConfigPlugin(env: Env = process.env): Plugin {
  const serve: Connect.NextHandleFunction = (request, response, next) => {
    if (request.url?.split('?')[0] !== RUNTIME_CONFIG_PATH) return next();
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.end(JSON.stringify(devRuntimeConfig(env)));
  };
  return {
    name: 'nuva-dev-runtime-config',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
  };
}
