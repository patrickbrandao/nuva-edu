import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// O jsdom não tem ResizeObserver nem matchMedia.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ResizeObserverStub;

// As consultas de largura valem para `window.innerWidth`: 360 px por padrão (menu em gaveta);
// um teste de tela larga troca o valor antes de montar a página.
const NARROW_WIDTH = 360;
window.innerWidth = NARROW_WIDTH;

function matchesWidth(query: string): boolean {
  const rule = /\((min|max)-width:\s*([\d.]+)px\)/.exec(query);
  if (!rule) return false;
  const limit = Number(rule[2]);
  return rule[1] === 'min' ? window.innerWidth >= limit : window.innerWidth <= limit;
}

window.matchMedia = (query: string): MediaQueryList =>
  ({
    get matches() {
      return matchesWidth(query);
    },
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.innerWidth = NARROW_WIDTH;
  document.documentElement.removeAttribute('data-theme');
});

// O jsdom não rola a página; o React Router chama scrollTo ao restaurar a posição.
window.scrollTo = (() => {}) as typeof window.scrollTo;
