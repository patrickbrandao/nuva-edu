// Renderização do PDF do certificado (spec 015, "PDF"; ADR 0026): Chromium headless shell pelo
// `playwright-core`. Para cada PDF, um contexto novo sem JavaScript, offline e com toda requisição
// abortada; `setContent` do HTML já preenchido; A4 paisagem, só a página 1, com fundo e sem
// margem imposta. Tempo limite de 20 s; um PDF por vez no processo; o navegador sobe na primeira
// renderização e fecha depois de 5 minutos ocioso. PDF acima de 2 MiB é falha.

import type { Histogram } from '@nuva-edu/api-kit/metrics';
import { CERTIFICATE_PDF_MAX_BYTES, type Logger } from '@nuva-edu/core';
import { type Browser, type BrowserContext, chromium } from 'playwright-core';

/** Tempo limite de cada PDF (spec 015, RNF-07). */
export const CERTIFICATE_RENDER_TIMEOUT_MS = 20_000;
/** Navegador ocioso por este tempo é fechado (spec 015, "PDF"). */
export const CERTIFICATE_BROWSER_IDLE_MS = 5 * 60_000;

/** O que é renderizado: certificado emitido ou PDF de exemplo (rótulo `kind` da métrica). */
export type CertificateRenderKind = 'certificate' | 'preview';

/** Falha da renderização, com um motivo sem dado pessoal (vai ao log e ao pedido de exemplo). */
export class CertificateRenderError extends Error {
  readonly reason: 'timeout' | 'too_large' | 'browser';
  constructor(reason: CertificateRenderError['reason'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CertificateRenderError';
    this.reason = reason;
  }
}

export interface CertificateRendererOptions {
  logger: Logger;
  /** `certificate_render_seconds{kind}` (spec 033). */
  histogram?: Histogram;
  /** Padrões da spec; os testes encurtam. */
  timeoutMs?: number;
  idleMs?: number;
  /** Padrão: o headless shell do Playwright, com `--disable-dev-shm-usage`. */
  launch?: () => Promise<Browser>;
  /** Cada requisição interceptada (e abortada). Só para os testes contarem. */
  onRequest?: (url: string) => void;
}

export interface RenderOptions {
  kind: CertificateRenderKind;
  /** Abortado: não começa se ainda esperava a vez, e a renderização em curso é cancelada. */
  signal?: AbortSignal;
}

export interface CertificateRenderer {
  /** HTML completo (já validado e preenchido) → PDF. Um por vez; os demais esperam a vez. */
  render(html: string, options: RenderOptions): Promise<Uint8Array>;
  /** `true` com o navegador aberto. */
  isBrowserOpen(): boolean;
  /** Fecha o navegador (encerramento do worker). Renderização seguinte abre outro. */
  close(): Promise<void>;
}

/** Fila de uma vaga: cada chamada espera a anterior terminar, com sucesso ou não. */
export function createMutex(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}

const defaultLaunch = () => chromium.launch({ headless: true, args: ['--disable-dev-shm-usage'] });

export function createCertificateRenderer(
  options: CertificateRendererOptions,
): CertificateRenderer {
  const { logger, histogram, onRequest } = options;
  const timeoutMs = options.timeoutMs ?? CERTIFICATE_RENDER_TIMEOUT_MS;
  const idleMs = options.idleMs ?? CERTIFICATE_BROWSER_IDLE_MS;
  const launch = options.launch ?? defaultLaunch;
  const exclusive = createMutex();
  let browser: Browser | null = null;
  let idleTimer: NodeJS.Timeout | null = null;

  const clearIdle = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const closeBrowser = async (): Promise<void> => {
    clearIdle();
    const current = browser;
    browser = null;
    if (current) {
      await current.close().catch((error: unknown) => {
        logger.warn({ err: error }, 'Falha ao fechar o navegador dos certificados');
      });
    }
  };

  const openBrowser = async (): Promise<Browser> => {
    if (browser?.isConnected()) {
      return browser;
    }
    browser = null;
    let opened: Browser;
    try {
      opened = await launch();
    } catch (error) {
      throw new CertificateRenderError('browser', 'O navegador não pôde ser iniciado.', {
        cause: error,
      });
    }
    opened.on('disconnected', () => {
      if (browser === opened) {
        browser = null;
      }
    });
    browser = opened;
    logger.info({ version: opened.version() }, 'Navegador dos certificados iniciado');
    return opened;
  };

  const renderOnce = async (html: string, signal: AbortSignal | undefined): Promise<Uint8Array> => {
    let context: BrowserContext | null = null;
    let timer: NodeJS.Timeout | undefined;
    let expired = false;
    const onAbort = () => void context?.close().catch(() => {});
    try {
      const work = (async () => {
        const current = await openBrowser();
        context = await current.newContext({ javaScriptEnabled: false, offline: true });
        context.setDefaultTimeout(timeoutMs);
        const page = await context.newPage();
        // Nenhuma requisição sai: `data:` não passa por aqui e não é requisição de rede.
        await page.route('**/*', (route) => {
          onRequest?.(route.request().url());
          return route.abort('blockedbyclient');
        });
        await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
        return page.pdf({
          format: 'A4',
          landscape: true,
          pageRanges: '1',
          printBackground: true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });
      })();
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(
            new CertificateRenderError(
              'timeout',
              `O PDF não ficou pronto em ${Math.round(timeoutMs / 1000)} s.`,
            ),
          );
        }, timeoutMs);
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      // A tarefa perdida pelo prazo continua até o contexto fechar (no `finally`).
      work.catch(() => {});
      const pdf = await Promise.race([work, deadline]);
      if (pdf.byteLength > CERTIFICATE_PDF_MAX_BYTES) {
        throw new CertificateRenderError(
          'too_large',
          `O PDF passou de ${CERTIFICATE_PDF_MAX_BYTES / 1024 / 1024} MiB.`,
        );
      }
      return new Uint8Array(pdf);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof CertificateRenderError) {
        throw error;
      }
      if (expired) {
        throw new CertificateRenderError('timeout', 'O PDF não ficou pronto no tempo limite.');
      }
      throw new CertificateRenderError('browser', 'O navegador falhou ao gerar o PDF.', {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      await (context as BrowserContext | null)?.close().catch(() => {});
    }
  };

  return {
    render(html, renderOptions) {
      return exclusive(async () => {
        renderOptions.signal?.throwIfAborted();
        clearIdle();
        const started = performance.now();
        try {
          return await renderOnce(html, renderOptions.signal);
        } finally {
          histogram?.observe((performance.now() - started) / 1000, { kind: renderOptions.kind });
          idleTimer = setTimeout(() => void exclusive(closeBrowser), idleMs);
          idleTimer.unref();
        }
      });
    },
    isBrowserOpen: () => browser !== null,
    close: () => exclusive(closeBrowser),
  };
}
