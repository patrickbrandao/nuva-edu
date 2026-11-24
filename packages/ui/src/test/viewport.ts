/**
 * Finge a largura da tela nos testes: troca o `matchMedia` por um que responde às
 * consultas `(max-width: Npx)` e `(min-width: Npx)` e avisa os ouvintes quando a
 * largura muda. Devolve a função que muda a largura.
 */
export function fakeViewport(initialWidth: number): (width: number) => void {
  let width = initialWidth;
  const listeners = new Set<() => void>();
  const matches = (query: string): boolean => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    if (max && width > Number(max[1])) return false;
    if (min && width < Number(min[1])) return false;
    return Boolean(max || min);
  };
  window.matchMedia = (query: string) =>
    ({
      get matches() {
        return matches(query);
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }) as unknown as MediaQueryList;
  return (next: number) => {
    width = next;
    for (const listener of listeners) listener();
  };
}
