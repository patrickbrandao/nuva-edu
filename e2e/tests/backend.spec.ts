// Fumaça dos serviços de backend pelo proxy (specs 031 e 033): o que é público responde e o que
// é interno não vaza.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { ADMIN_URL, CLASSROOM_URL, ROOT_DIR, USES_LOCAL_COMPOSE } from '../support/env.ts';

const HOSTS = [
  { api: 'admin-api', url: ADMIN_URL },
  { api: 'classroom-api', url: CLASSROOM_URL },
] as const;

for (const { api, url } of HOSTS) {
  test.describe(`${api} pelo proxy`, () => {
    test('/healthz responde 200 com status ok', async ({ request }) => {
      const response = await request.get(`${url}/healthz`);
      expect(response.status(), `GET ${url}/healthz`).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'ok' });
    });

    for (const path of ['/readyz', '/metrics']) {
      test(`${path} não é exposto (404)`, async ({ request }) => {
        const response = await request.get(`${url}${path}`);
        expect(response.status(), `GET ${url}${path}`).toBe(404);
      });
    }

    test('/api/v1/meta traz o nome da escola e a versão', async ({ request }) => {
      const response = await request.get(`${url}/api/v1/meta`);
      expect(response.status(), `GET ${url}/api/v1/meta`).toBe(200);
      const meta = await response.json();
      expect(meta.schoolName).toEqual(expect.any(String));
      expect(meta.schoolName).not.toBe('');
      expect(meta.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
}

test('classroom-api: /api/v1/stream sem sessão responde 401', async ({ request }) => {
  const response = await request.get(`${CLASSROOM_URL}/api/v1/stream`, {
    headers: { accept: 'text/event-stream' },
  });
  expect(response.status(), `GET ${CLASSROOM_URL}/api/v1/stream`).toBe(401);
  expect(response.headers()['content-type']).toContain('application/problem+json');
  expect(await response.json()).toMatchObject({ status: 401, code: 'unauthenticated' });
});

// O worker não tem rota no proxy: a saúde dele só se consulta de dentro do contêiner.
test('worker: /healthz responde 200 dentro do contêiner', async () => {
  test.skip(!USES_LOCAL_COMPOSE, 'NUVA_E2E_COMPOSE=0: sem docker compose exec neste ambiente');
  const script =
    "fetch('http://127.0.0.1:3000/healthz').then(async (r) => console.log(r.status, await r.text()))";
  const run = promisify(execFile);
  const { stdout } = await run(
    process.execPath,
    ['scripts/dev.mjs', 'compose', 'exec', '-T', 'worker', 'node', '-e', script],
    { cwd: ROOT_DIR, timeout: 20_000 },
  ).catch((error: Error) => {
    throw new Error(
      `Não consegui consultar o /healthz do worker por "pnpm compose exec worker". O contêiner está no ar? (pnpm compose ps · pnpm dev:up)\n${error.message}`,
    );
  });
  expect(stdout.trim()).toMatch(/^200 /);
  expect(stdout).toMatch(/"status"\s*:\s*"ok"/);
});
