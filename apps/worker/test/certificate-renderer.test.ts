import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CERTIFICATE_PDF_MAX_BYTES } from '@nuva-edu/core';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CERTIFICATE_BROWSER_IDLE_MS,
  CERTIFICATE_RENDER_TIMEOUT_MS,
  CertificateRenderError,
  type CertificateRenderer,
  createCertificateRenderer,
  createMutex,
} from '../src/certificates/renderer.ts';
import { createWorkerMetrics } from '../src/metrics.ts';
import { captureLogger, readPdf, waitFor } from './helpers.ts';

// Renderização pelo Chromium headless shell (spec 015, "PDF"; ADR 0026). Precisa do navegador
// instalado: `pnpm browsers:worker` (docs/ambiente-local.md).

/** Servidor que conta as requisições que chegam: nenhuma deveria chegar. */
let server: Server;
let hits: string[] = [];
let origin: string;
let renderer: CertificateRenderer;
const intercepted: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    hits.push(request.url ?? '');
    response.end('x');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  renderer = createCertificateRenderer({
    logger: captureLogger().logger,
    onRequest: (url) => intercepted.push(url),
  });
});

afterAll(async () => {
  await renderer.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('renderização do PDF', () => {
  it('segue os limites da spec', () => {
    expect(CERTIFICATE_RENDER_TIMEOUT_MS).toBe(20_000);
    expect(CERTIFICATE_BROWSER_IDLE_MS).toBe(300_000);
    expect(CERTIFICATE_PDF_MAX_BYTES).toBe(2 * 1024 * 1024);
  });

  it('gera uma página A4 paisagem com o texto, mesmo com conteúdo de várias páginas', async () => {
    const html = `<!DOCTYPE html><html><body><p>Primeira página</p>${'<p style="page-break-before:always">Outra página</p>'.repeat(3)}</body></html>`;
    const pdf = await renderer.render(html, { kind: 'certificate' });
    const read = await readPdf(pdf);
    expect(read.pages).toBe(1);
    // A4 paisagem: 297 × 210 mm = 842 × 595 pontos.
    expect(Math.round(read.width)).toBeGreaterThanOrEqual(841);
    expect(Math.round(read.width)).toBeLessThanOrEqual(843);
    expect(Math.round(read.height)).toBeGreaterThanOrEqual(595);
    expect(Math.round(read.height)).toBeLessThanOrEqual(596);
    expect(read.text).toContain('Primeira página');
    expect(read.text).not.toContain('Outra página');
    expect(pdf.byteLength).toBeLessThanOrEqual(CERTIFICATE_PDF_MAX_BYTES);
  });

  it('não executa JavaScript e não deixa sair nenhuma requisição', async () => {
    hits = [];
    intercepted.length = 0;
    const html = `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="${origin}/estilo.css">
<style>@import url("${origin}/importado.css"); body { background: url("${origin}/fundo.png"); }
@font-face { font-family: X; src: url("${origin}/fonte.woff2"); } p { font-family: X; }</style>
<script src="${origin}/script.js"></script>
</head><body>
<p>Texto do certificado</p>
<img src="${origin}/imagem.png" srcset="${origin}/imagem2.png 2x">
<img src="https://example.com/rastreio.gif">
<iframe src="${origin}/quadro.html"></iframe>
<object data="${origin}/objeto.swf"></object>
<script>document.body.append('EXECUTADO'); fetch('${origin}/fetch');</script>
</body></html>`;
    const pdf = await renderer.render(html, { kind: 'preview' });
    const { text } = await readPdf(pdf);
    expect(text).toContain('Texto do certificado');
    expect(text).not.toContain('EXECUTADO');
    // Cada pedido foi interceptado e abortado; nenhum chegou ao servidor.
    expect(intercepted.length).toBeGreaterThan(0);
    expect(intercepted.some((url) => url.includes('/imagem.png'))).toBe(true);
    expect(intercepted.some((url) => url.includes('example.com'))).toBe(true);
    expect(intercepted.some((url) => url.endsWith('/fetch'))).toBe(false);
    expect(hits).toEqual([]);
  });

  it('imagem em data: não é requisição', async () => {
    intercepted.length = 0;
    const png =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await renderer.render(`<p>Com imagem</p><img src="${png}" width="10" height="10">`, {
      kind: 'certificate',
    });
    expect(intercepted).toEqual([]);
  });

  it('tempo esgotado é falha e entra na métrica', async () => {
    const metrics = createWorkerMetrics();
    const quick = createCertificateRenderer({
      logger: captureLogger().logger,
      histogram: metrics.certificateRender,
      timeoutMs: 1,
    });
    try {
      await expect(quick.render('<p>x</p>', { kind: 'preview' })).rejects.toMatchObject({
        name: 'CertificateRenderError',
        reason: 'timeout',
      });
      expect(metrics.registry.render()).toContain(
        'certificate_render_seconds_count{kind="preview"} 1',
      );
    } finally {
      await quick.close();
    }
  });

  it('fecha o navegador ocioso e abre outro na renderização seguinte', async () => {
    const idle = createCertificateRenderer({ logger: captureLogger().logger, idleMs: 50 });
    try {
      expect(idle.isBrowserOpen()).toBe(false);
      await idle.render('<p>um</p>', { kind: 'certificate' });
      expect(idle.isBrowserOpen()).toBe(true);
      await waitFor(() => !idle.isBrowserOpen(), 5_000);
      const { text } = await readPdf(await idle.render('<p>dois</p>', { kind: 'certificate' }));
      expect(text).toContain('dois');
    } finally {
      await idle.close();
    }
    expect(idle.isBrowserOpen()).toBe(false);
  });

  it('pedido abortado antes da vez não renderiza', async () => {
    const controller = new AbortController();
    controller.abort(new Error('encerrando'));
    await expect(
      renderer.render('<p>x</p>', { kind: 'certificate', signal: controller.signal }),
    ).rejects.toThrow('encerrando');
  });
});

/** Navegador falso: conta renderizações simultâneas e devolve o PDF pedido. */
function fakeBrowser(pdfBytes: number, state: { active: number; max: number; launches: number }) {
  return async (): Promise<Browser> => {
    state.launches += 1;
    let connected = true;
    const browser = {
      isConnected: () => connected,
      version: () => 'falso',
      on: () => browser,
      close: async () => {
        connected = false;
      },
      newContext: async () => ({
        setDefaultTimeout: () => {},
        close: async () => {},
        newPage: async () => ({
          route: async () => {},
          setContent: async () => {
            state.active += 1;
            state.max = Math.max(state.max, state.active);
            await new Promise((resolve) => setTimeout(resolve, 20));
            state.active -= 1;
          },
          pdf: async () => Buffer.alloc(pdfBytes, 1),
        }),
      }),
    };
    return browser as unknown as Browser;
  };
}

describe('renderizador com navegador falso', () => {
  it('um PDF por vez no processo, com um só navegador', async () => {
    const state = { active: 0, max: 0, launches: 0 };
    const fake = createCertificateRenderer({
      logger: captureLogger().logger,
      launch: fakeBrowser(100, state),
    });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => fake.render('<p>x</p>', { kind: 'certificate' })),
    );
    expect(results.map((pdf) => pdf.byteLength)).toEqual([100, 100, 100, 100]);
    expect(state.max).toBe(1);
    expect(state.launches).toBe(1);
    await fake.close();
  });

  it('PDF acima de 2 MiB é falha', async () => {
    const state = { active: 0, max: 0, launches: 0 };
    const fake = createCertificateRenderer({
      logger: captureLogger().logger,
      launch: fakeBrowser(CERTIFICATE_PDF_MAX_BYTES + 1, state),
    });
    const error = await fake.render('<p>x</p>', { kind: 'certificate' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CertificateRenderError);
    expect(error).toMatchObject({ reason: 'too_large' });
    await fake.close();
  });

  it('navegador que não sobe é falha do navegador, e a próxima tenta de novo', async () => {
    let attempts = 0;
    const fake = createCertificateRenderer({
      logger: captureLogger().logger,
      launch: async () => {
        attempts += 1;
        throw new Error('sem navegador');
      },
    });
    await expect(fake.render('<p>x</p>', { kind: 'certificate' })).rejects.toMatchObject({
      reason: 'browser',
    });
    await expect(fake.render('<p>x</p>', { kind: 'certificate' })).rejects.toMatchObject({
      reason: 'browser',
    });
    expect(attempts).toBe(2);
    await fake.close();
  });
});

describe('createMutex', () => {
  it('roda em ordem, uma por vez, e segue depois de uma falha', async () => {
    const exclusive = createMutex();
    const order: string[] = [];
    const task = (name: string, fail = false) =>
      exclusive(async () => {
        order.push(`início ${name}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`fim ${name}`);
        if (fail) throw new Error(name);
        return name;
      });
    const results = await Promise.allSettled([task('a'), task('b', true), task('c')]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(order).toEqual(['início a', 'fim a', 'início b', 'fim b', 'início c', 'fim c']);
  });
});
