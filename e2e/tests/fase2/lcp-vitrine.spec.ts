// Spec 006, RNF-04: em conexão 4G simulada, a vitrine tem LCP abaixo de 2,5 s. A vitrine medida é
// a real, com cursos publicados e capas enviadas pelo admin (o preparo é pela API); a rede é a do
// CDP (`Network.emulateNetworkConditions`), no perfil "Regular 4G" do Lighthouse (1,6 Mbps de
// descida, 750 Kbps de subida, 150 ms de latência), e o LCP vem do `PerformanceObserver` de
// `largest-contentful-paint`, instalado antes de qualquer script da página. O teste não corrige o
// site: se o limite estoura, a falha é do `web-classroom`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { ADMIN_URL, CLASSROOM_URL } from '../../support/env.ts';
import { adminCall, adminPage, runTag, videoUrl } from '../../support/fase2.ts';

/** Limite da spec 006, RNF-04: LCP abaixo de 2,5 s. */
const LCP_LIMIT_MS = 2500;

/** "Regular 4G" do Lighthouse, em bytes/s e segundos (unidades do CDP). */
const NETWORK_4G = {
  latency: 0.15,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};

const TAG = runTag();
const COURSE = `Vitrine LCP e2e ${TAG}`;

/** Capa real 16:9 (640×360, 269 KB), gerada para o e2e: gradiente com título, como a de um curso. */
const COVER = readFileSync(resolve(import.meta.dirname, '..', '..', 'fixtures', 'capa.png'));

const BOUNDARY = 'capa-lcp-e2e';

/** Capa enviada como o admin faz: multipart com a finalidade `product_cover`. */
async function uploadCover(admin: Page): Promise<string> {
  const disposition = (name: string, file = false) =>
    `Content-Disposition: form-data; name="${name}"${file ? '; filename="capa.png"\r\nContent-Type: image/png' : ''}\r\n\r\n`;
  const body = Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\n${disposition('purpose')}product_cover\r\n`),
    Buffer.from(`--${BOUNDARY}\r\n${disposition('file', true)}`),
    COVER,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ]);
  const session = await admin.request.get(`${ADMIN_URL}/api/v1/session`);
  expect(session.status(), 'GET /api/v1/session do admin').toBe(200);
  const { csrfToken } = (await session.json()) as { csrfToken: string };
  const sent = await admin.request.post(`${ADMIN_URL}/api/v1/images`, {
    headers: {
      'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      'x-csrf-token': csrfToken,
    },
    data: body,
  });
  expect(sent.status(), `envio da capa: ${await sent.text()}`).toBe(201);
  const image = (await sent.json()) as { id: string };
  return image.id;
}

/** Dois cursos publicados com capa: a primeira fileira da vitrine tem imagem (o elemento do LCP). */
async function createCatalogWithCovers(admin: Page): Promise<void> {
  for (const index of [1, 2]) {
    const coverImageId = await uploadCover(admin);
    const course = await adminCall<{ id: string }>(admin, 'POST', '/api/v1/courses', {
      title: `${COURSE} ${index}`,
      summary: 'Curso com capa para a medição do LCP da vitrine.',
      accessMode: 'open',
      coverImageId,
    });
    // Publicar exige ao menos uma aula publicada (spec 009); a URL fictícia nunca é aberta aqui.
    const module = await adminCall<{ id: string }>(
      admin,
      'POST',
      `/api/v1/courses/${course.id}/modules`,
      { title: 'Módulo da vitrine' },
    );
    const lesson = await adminCall<{ id: string; version: number }>(
      admin,
      'POST',
      `/api/v1/modules/${module.id}/lessons`,
      { title: 'Aula de apresentação', videoUrl: videoUrl(`${TAG}-${index}`), durationSeconds: 3 },
    );
    await adminCall(admin, 'PATCH', `/api/v1/lessons/${lesson.id}`, {
      status: 'published',
      version: lesson.version,
    });
    await adminCall(admin, 'POST', `/api/v1/courses/${course.id}/publish`, undefined, 200);
  }
}

test('vitrine com capas tem LCP abaixo de 2,5 s em 4G simulada', async ({ browser }) => {
  const admin = await adminPage(browser);
  await createCatalogWithCovers(admin);
  await admin.context().close();

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  // O observador precisa existir antes do primeiro desenho; `buffered` recupera o que já passou.
  await page.addInitScript(() => {
    const state = { lcp: 0, element: '' };
    Object.assign(window, { __lcp: state });
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        state.lcp = entry.startTime;
        const element = (entry as PerformanceEntry & { element?: Element }).element;
        state.element = element ? `${element.tagName} ${element.getAttribute('src') ?? ''}` : '';
      }
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });
  });

  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { ...NETWORK_4G, offline: false });
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  await page.goto(`${CLASSROOM_URL}/`, { waitUntil: 'load' });
  const products = page.getByRole('list', { name: 'Produtos da vitrine' });
  await expect(products.getByRole('listitem').first()).toBeVisible();
  // Espera a capa realmente decodificada: `<img>` presente não significa pintada, e o LCP dela
  // só entra no observador depois do desenho.
  await page.waitForFunction(() =>
    [...document.querySelectorAll('ul[aria-label="Produtos da vitrine"] img')].some(
      (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
    ),
  );

  // O LCP só é final quando a página esconde ou o usuário interage; trazer outra aba à frente
  // fecha a contagem sem navegar para fora da vitrine.
  const other = await context.newPage();
  await other.goto('about:blank');
  await other.bringToFront();
  await page.waitForFunction(() => {
    const state = (window as unknown as { __lcp: { lcp: number } }).__lcp;
    return state.lcp > 0;
  });
  const measured = await page.evaluate(() => {
    const state = (window as unknown as { __lcp: { lcp: number; element: string } }).__lcp;
    return { ...state };
  });
  await context.close();

  console.log(
    `LCP da vitrine (4G simulada: 150 ms, 1,6 Mbps, sem cache): ${Math.round(measured.lcp)} ms — ${measured.element}`,
  );
  expect(measured.lcp, 'a vitrine registrou um maior desenho de conteúdo').toBeGreaterThan(0);
  expect(measured.element, 'o maior desenho de conteúdo é uma capa da vitrine').toContain('IMG');
  expect(
    measured.lcp,
    `LCP ${Math.round(measured.lcp)} ms na vitrine com capas, em 4G simulada (spec 006, RNF-04)`,
  ).toBeLessThan(LCP_LIMIT_MS);
});
