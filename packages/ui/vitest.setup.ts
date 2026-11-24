import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// O jsdom não tem ResizeObserver, matchMedia nem canvas; os componentes só
// precisam que existam (a medição de texto cai na estimativa por caractere).
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

HTMLCanvasElement.prototype.getContext = (() => null) as HTMLCanvasElement['getContext'];

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});
