// Tarefa 065: a Content-Security-Policy do classroom abriu as origens dos players (spec 009,
// tabela de provedores) e nenhuma aula pode registrar violação dela. Um curso aberto reúne uma
// aula por forma de entrega: YouTube, Vimeo, Bunny por `iframe` e por `.m3u8` de `*.b-cdn.net`,
// Panda e `file` com `.mp4`. As URLs dos provedores são exemplos públicos já usados nos testes do
// `VideoPlayer`; nenhuma é de uma escola real, então o que se exige é o pedido sair sem a política
// o barrar — `securitypolicyviolation` dispara antes da rede —, não que o vídeo toque. Só o `.mp4`
// é real: o próprio teste serve `fixtures/aula.webm` sob esse nome (o admin classifica pela
// extensão e nunca busca a URL), e ele toca até o fim.
//
// O que vem de dentro do `iframe` do provedor (scripts, imagens, avisos de vídeo inexistente) não é
// do classroom e não conta: a vigia (support/csp.ts) escuta só o documento principal.
import { expect, type Page, type Request, test } from '@playwright/test';
import { collectCsp, watchCsp } from '../../support/csp.ts';
import { ADMIN_URL, CLASSROOM_URL } from '../../support/env.ts';
import {
  adminCall,
  adminPage,
  learningPath,
  mp4Url,
  runTag,
  studentPage,
} from '../../support/fase2.ts';

const TAG = runTag();
const COURSE = `Players CSP e2e ${TAG}`;

/** Cada aula: URL que o autor informa e o provedor que a API deve classificar (spec 009). */
const LESSONS = [
  { slug: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', provider: 'youtube' },
  { slug: 'vimeo', url: 'https://vimeo.com/76979871', provider: 'vimeo' },
  {
    slug: 'bunny-iframe',
    url: 'https://iframe.mediadelivery.net/embed/1234/abcd-ef',
    provider: 'bunny',
  },
  {
    slug: 'bunny-hls',
    url: 'https://vz-1.b-cdn.net/abc/playlist.m3u8',
    provider: 'bunny',
  },
  {
    slug: 'panda',
    url: 'https://player-vz-ded14ebd-85a.tv.pandavideo.com.br/embed/?v=3b101f05',
    provider: 'panda',
  },
  { slug: 'file-mp4', url: mp4Url(`${TAG}-aula`), provider: 'file' },
] as const;

const EMBED_FRAME: Record<string, RegExp> = {
  youtube: /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/,
  vimeo: /^https:\/\/player\.vimeo\.com\/video\/76979871\?dnt=1$/,
  'bunny-iframe': /^https:\/\/iframe\.mediadelivery\.net\/embed\/1234\/abcd-ef$/,
  panda: /^https:\/\/player-vz-ded14ebd-85a\.tv\.pandavideo\.com\.br\/embed\/\?v=3b101f05$/,
};

interface Lesson {
  id: string;
  version: number;
  videoProvider: string;
}

/** Preparo pela API do admin (o editor de curso pela tela é do critério de saída da Fase 2). */
async function createCourse(admin: Page): Promise<{ slug: string; ids: Map<string, string> }> {
  const course = await adminCall<{ id: string; slug: string }>(admin, 'POST', '/api/v1/courses', {
    title: COURSE,
    summary: 'Uma aula por provedor, para a política de segurança de conteúdo.',
    accessMode: 'open',
  });
  const module = await adminCall<{ id: string }>(
    admin,
    'POST',
    `/api/v1/courses/${course.id}/modules`,
    { title: 'Provedores' },
  );
  const ids = new Map<string, string>();
  for (const item of LESSONS) {
    const lesson = await adminCall<Lesson>(admin, 'POST', `/api/v1/modules/${module.id}/lessons`, {
      title: `Aula ${item.slug} ${TAG}`,
      videoUrl: item.url,
      durationSeconds: 3,
    });
    // o admin classifica o provedor na gravação (spec 009)
    expect(lesson.videoProvider, `provedor de ${item.url}`).toBe(item.provider);
    await adminCall(admin, 'PATCH', `/api/v1/lessons/${lesson.id}`, {
      status: 'published',
      version: lesson.version,
    });
    ids.set(item.slug, lesson.id);
  }
  await adminCall(admin, 'POST', `/api/v1/courses/${course.id}/publish`, undefined, 200);
  return { slug: course.slug, ids };
}

test('cada provedor monta o player sem violação de CSP no documento do classroom', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const admin = await adminPage(browser);
  const { slug, ids } = await createCourse(admin);
  await admin.context().close();

  const { page } = await studentPage(browser, 'csp');
  const watch = await watchCsp(page);

  for (const item of LESSONS) {
    await test.step(`${item.slug} (${item.provider})`, async () => {
      // As esperas de rede ficam de pé antes da navegação: o player monta assim que a aula abre.
      const youtubeApi =
        item.slug === 'youtube' ? page.waitForRequest('https://www.youtube.com/iframe_api') : null;
      // Todo pedido do documento a host externo (o iframe tem política própria e não entra aqui):
      // script da IFrame API de outro host, ou fetch a host fora da lista, teria de aparecer.
      const external: string[] = [];
      const origin = new URL(CLASSROOM_URL).origin;
      const remember = (request: Request) => {
        if (request.frame() !== page.mainFrame()) return;
        const url = new URL(request.url());
        if (url.origin === origin) return;
        if (url.hostname === new URL(item.url).hostname) return;
        external.push(`${request.resourceType()} ${request.url()}`);
      };
      page.on('request', remember);
      const playlist = item.slug === 'bunny-hls' ? page.waitForRequest(item.url) : null;
      await page.goto(`${learningPath(slug)}/aulas/${ids.get(item.slug)}`);
      await expect(
        page.getByRole('heading', { level: 1, name: `Aula ${item.slug} ${TAG}` }),
      ).toBeVisible();

      const frame = EMBED_FRAME[item.slug];
      if (frame) {
        const iframe = page.locator('iframe').first();
        await expect(iframe).toBeVisible();
        await expect(iframe).toHaveAttribute('src', frame);
        // o `iframe` saiu do classroom; o que ele carrega dentro não é da nossa política
        await iframe.contentFrame();
      }
      if (youtubeApi) {
        // a IFrame API é o único script externo; carregar o resto de outro host apareceria aqui
        const api = await youtubeApi;
        expect(api.failure(), 'IFrame API do YouTube').toBeNull();
        expect((await api.response())?.status(), 'IFrame API respondeu').toBe(200);
      }
      if (playlist) {
        // hls.js busca a lista por fetch: `connect-src https://*.b-cdn.net` precisa deixar passar.
        // O pedido sair já prova isso; a resposta é do provedor (o endereço é de exemplo, não real).
        const request = await playlist;
        expect(request.url(), 'a lista HLS saiu para a rede').toBe(item.url);
      }
      if (item.slug === 'file-mp4') {
        const video = page.locator('video');
        await expect(video).toBeVisible();
        await expect
          .poll(async () => video.evaluate((element: HTMLVideoElement) => element.duration))
          .toBe(3);
        await video.evaluate(async (element: HTMLVideoElement) => {
          element.muted = true;
          await element.play();
        });
        await expect(page.getByText('O vídeo terminou: aula marcada como concluída.')).toBeVisible({
          timeout: 20_000,
        });
      }

      // dá tempo de o hls.js pedir os segmentos e de o provedor responder dentro do iframe
      await page.waitForTimeout(3000);
      await collectCsp(page, watch);
      page.off('request', remember);
      watch.assertClean();
      // do documento só podem sair a API do YouTube e os pedidos do provedor da aula
      expect(external, `pedidos externos do documento em ${item.slug}`).toEqual(
        external.filter((url) => url.startsWith('script https://www.youtube.com/')),
      );
    });
  }

  await page.goto(`${CLASSROOM_URL}/`);
  await collectCsp(page, watch);
  watch.assertClean();
  await page.context().close();
});

/** Palavra-chave de CSP: não é origem, não abre host nem esquema (`'self'`, `'none'`, `'unsafe-*'`). */
const KEYWORD = /^'(self|none|unsafe-[a-z-]+|strict-dynamic|report-sample)'$/;
/** `'sha256-…'` / `'nonce-…'`: hash do script inline do tema e afins. */
const HASH_OR_NONCE = /^'(sha(256|384|512)|nonce)-[A-Za-z0-9+/_=-]+'$/;
/** Fonte de esquema (`https:`, `data:`, `wss:`); qualquer outro valor sem palavra-chave é host. */
const SCHEME = /^([a-z][a-z0-9+.-]*):$/i;
/** Esquemas que o `img-src` do admin aceita: as imagens `https` do Markdown (ADR 0027), `data:` do CSS e `blob:` da prévia. */
const IMG_SCHEMES = ['https:', 'data:', 'blob:'];

interface Directive {
  name: string;
  sources: string[];
}

function parsePolicy(policy: string): Directive[] {
  return policy
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const [name = '', ...sources] = part.split(/\s+/);
      return { name: name.toLowerCase(), sources };
    });
}

/**
 * O que a política do admin NÃO pode ter: origem externa (host, curinga) em qualquer diretiva e
 * esquema fora de `img-src`. A única abertura é a imagem `https` do Markdown saneado (ADR 0027):
 * `script-src`, `frame-src`, `connect-src` e o resto seguem sem host e sem esquema amplo.
 *
 * Exportada para o teste da política poder ser exercitado sobre as políticas geradas pelo
 * `proxy/lighttpd/csp.mjs`, sem depender de o ambiente servido já estar reconstruído.
 */
export function externalOriginViolations(policy: string): string[] {
  const problems: string[] = [];
  if (policy.trim() === '') return ['política vazia'];
  const seen = new Set<string>();
  for (const { name, sources } of parsePolicy(policy)) {
    if (name === '') problems.push('diretiva sem nome');
    if (seen.has(name)) problems.push(`${name} aparece mais de uma vez`);
    seen.add(name);
    if (sources.length === 0) problems.push(`${name} sem fonte`);
    for (const source of sources) {
      if (KEYWORD.test(source) || HASH_OR_NONCE.test(source)) continue;
      if (source === '*') {
        problems.push(`${name} aceita curinga *`);
        continue;
      }
      if (!SCHEME.test(source)) {
        problems.push(`${name} aceita origem externa ${source}`);
        continue;
      }
      if (name === 'img-src' && IMG_SCHEMES.includes(source.toLowerCase())) continue;
      problems.push(`${name} aceita esquema ${source}`);
    }
  }
  return problems;
}

// Tarefa 629 (ADR 0027): o admin passou a aceitar as imagens `https` do Markdown saneado no
// `img-src`; a garantia que continua de pé é não haver origem externa (host nem curinga) e nenhum
// esquema fora de `img-src`. Abrir `script-src`, `frame-src`, `connect-src` ou pôr `http:` na
// imagem reprova aqui. A imagem `https` do Markdown aparecendo é da tarefa 625, e a política que o
// gerador produz (com `https:` em `img-src`) é a que este teste confere no cabeçalho servido.
test('o admin aceita https: só em img-src e segue sem origem externa na Content-Security-Policy', async ({
  page,
}) => {
  const response = await page.request.get(`${ADMIN_URL}/`);
  const policy = response.headers()['content-security-policy'] ?? '';
  expect(policy, 'o admin tem política').not.toBe('');
  expect(externalOriginViolations(policy), `política do admin: ${policy}`).toEqual([]);

  // O classroom continua com as origens dos players. A mesma trava de esquema só em imagem vale
  // para ele, a menos do `media-src` do player (spec 009), coberto pelo teste dos players.
  const classroom = await page.request.get(`${CLASSROOM_URL}/`);
  expect(classroom.headers()['content-security-policy']).toContain('https://www.youtube.com');
});
