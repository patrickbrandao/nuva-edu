// Vigia da Content-Security-Policy do documento do classroom (spec 009, "Vídeo e links externos";
// tarefa 065): o `securitypolicyviolation` dispara antes do pedido sair, então basta escutá-lo para
// saber que a política barrou algo, mesmo sem resposta do provedor. O console traz a mesma violação
// como erro "Content Security Policy". Os `iframe` dos provedores têm política própria: o que
// acontece dentro deles não é do classroom, por isso só contam os eventos do documento principal
// (o ouvinte vai por `addInitScript`, que não entra nos frames) e as mensagens do console da página.
import { expect, type Page } from '@playwright/test';

export interface CspViolation {
  /** Diretiva violada, sem o sufixo `-elem` (ex.: `frame-src`, `script-src`). */
  directive: string;
  blockedURI: string;
}

export interface CspWatch {
  violations: CspViolation[];
  consoleErrors: string[];
  assertClean(): void;
}

/** Começa a vigiar a página; cada navegação instala o ouvinte de novo. */
export async function watchCsp(page: Page): Promise<CspWatch> {
  const violations: CspViolation[] = [];
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /Content Security Policy/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  await page.addInitScript(() => {
    const w = window as Window & { __nuvaCsp?: unknown[] };
    w.__nuvaCsp = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      w.__nuvaCsp?.push({
        directive: event.effectiveDirective,
        blockedURI: event.blockedURI,
      });
    });
  });
  return {
    violations,
    consoleErrors,
    assertClean() {
      expect(violations, `violações de CSP em ${page.url()}`).toEqual([]);
      expect(consoleErrors, `console de ${page.url()}`).toEqual([]);
    },
  };
}

/** Recolhe as violações do documento atual; chame antes de cada navegação e no fim. */
export async function collectCsp(page: Page, watch: CspWatch): Promise<void> {
  const found = await page.evaluate(() => {
    const w = window as Window & { __nuvaCsp?: { directive: string; blockedURI: string }[] };
    const list = w.__nuvaCsp ?? [];
    w.__nuvaCsp = [];
    return list;
  });
  watch.violations.push(...found);
}
