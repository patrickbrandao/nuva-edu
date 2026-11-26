// A vigia de CSP (support/csp.ts) é a prova dos testes dos players: ela precisa de fato registrar
// a violação do documento do classroom e não registrar a de um `iframe` de provedor. Para isso,
// uma página temporária do próprio classroom recebe uma política que proíbe o que a aula usa.
import { expect, test } from '@playwright/test';
import { collectCsp, watchCsp } from '../support/csp.ts';
import { CLASSROOM_URL } from '../support/env.ts';

test('a vigia registra a violação do documento e ignora a do iframe', async ({ page }) => {
  // Página entregue pelo próprio teste no endereço do classroom, com política proibitiva.
  await page.route(`${CLASSROOM_URL}/csp-proibido`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      headers: { 'content-security-policy': "default-src 'none'; script-src 'none'" },
      body: `<!doctype html><title>proibido</title>
        <iframe src="https://example.test/dentro"></iframe>
        <img src="${CLASSROOM_URL}/favicon.ico">`,
    });
  });
  const watch = await watchCsp(page);
  await page.goto(`${CLASSROOM_URL}/csp-proibido`);
  await expect(page.locator('iframe')).toBeVisible();
  await page.waitForTimeout(500);
  await collectCsp(page, watch);

  const directives = watch.violations.map((item) => item.directive);
  expect(directives).toContain('frame-src');
  expect(directives).toContain('img-src');
  expect(watch.consoleErrors.join('\n')).toMatch(/Content Security Policy/);

  // A política deixa de proibir: nada novo é registrado, e o assert passa numa página limpa.
  const clean = await page.context().newPage();
  const cleanWatch = await watchCsp(clean);
  await clean.goto(CLASSROOM_URL);
  await clean.getByRole('heading', { level: 1 }).waitFor();
  await collectCsp(clean, cleanWatch);
  cleanWatch.assertClean();
});
