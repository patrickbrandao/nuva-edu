import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// O jsdom não tem ResizeObserver nem matchMedia; os componentes só precisam que existam.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = ResizeObserverStub;

window.matchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
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
  document.documentElement.removeAttribute('data-theme');
});

// O jsdom não rola a página; o React Router chama scrollTo ao restaurar a posição.
window.scrollTo = (() => {}) as typeof window.scrollTo;
