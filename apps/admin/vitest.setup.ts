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

// O jsdom não calcula layout (largura 0): sem isto a casca se veria estreita e recolheria o menu.
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get: () => 1280,
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
