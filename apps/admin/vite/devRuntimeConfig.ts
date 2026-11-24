import type { Connect, Plugin } from 'vite';

/*
 * `/config.json` fora do contêiner (specs 006 e 031).
 *
 * Em produção o arquivo é gerado na subida do contêiner (proxy/nginx/40-nuva-config.sh) e
 * servido pelo Nginx. No `vite dev` e no `vite preview` ele não existe, e o Vite devolveria o
 * index.html nesse caminho. Este plugin responde o mesmo formato, montado das mesmas variáveis
 * e dos mesmos padrões. É só um middleware: não grava arquivo, então nada vai para o `dist/`
 * nem para a imagem.
 */

type Env = Record<string, string | undefined>;

export interface DevRuntimeConfig {
  app: 'admin' | 'classroom';
  adminUrl: string;
  classroomUrl: string;
}

const HOST = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/;

function check(name: string, value: string, pattern: RegExp): string {
  if (!pattern.test(value)) throw new Error(`config.json de desenvolvimento: ${name} inválida`);
  return value;
}

/** Mesmas variáveis, padrões e regra de porta do `40-nuva-config.sh`. */
export function buildDevRuntimeConfig(app: DevRuntimeConfig['app'], env: Env): DevRuntimeConfig {
  const domain = env.NUVA_DOMAIN || 'localhost';
  const adminHost = check('NUVA_ADMIN_HOST', env.NUVA_ADMIN_HOST || `edu-admin.${domain}`, HOST);
  const classroomHost = check(
    'NUVA_CLASSROOM_HOST',
    env.NUVA_CLASSROOM_HOST || `classroom.${domain}`,
    HOST,
  );
  const scheme = check('NUVA_PUBLIC_SCHEME', env.NUVA_PUBLIC_SCHEME || 'http', /^https?$/);
  // Porta vazia é válida (sem porta na URL); só a variável ausente cai no padrão 8080.
  const port = check('NUVA_PUBLIC_PORT', env.NUVA_PUBLIC_PORT ?? '8080', /^[0-9]{0,5}$/);

  const standard = scheme === 'http' ? '80' : '443';
  const suffix = port !== '' && port !== standard ? `:${port}` : '';
  return {
    app,
    adminUrl: `${scheme}://${adminHost}${suffix}`,
    classroomUrl: `${scheme}://${classroomHost}${suffix}`,
  };
}

/**
 * Responde `GET /config.json` no servidor de desenvolvimento e no de preview. Variável fora do
 * formato impede a subida do servidor, com a variável citada, como no contêiner.
 */
export function devRuntimeConfigPlugin(app: DevRuntimeConfig['app'], env: Env): Plugin {
  const install = (middlewares: Connect.Server) => {
    const body = JSON.stringify(buildDevRuntimeConfig(app, env), null, 2);
    middlewares.use((req, res, next) => {
      const isConfig = req.url?.split('?')[0] === '/config.json';
      if (!isConfig || (req.method !== 'GET' && req.method !== 'HEAD')) {
        next();
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  };
  return {
    name: 'nuva-dev-runtime-config',
    apply: 'serve',
    configureServer: (server) => install(server.middlewares),
    configurePreviewServer: (server) => install(server.middlewares),
  };
}
