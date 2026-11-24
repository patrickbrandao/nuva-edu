import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readSavedTheme, THEME_STORAGE_KEY, ThemeSwitch, useTheme } from '../index';

function Harness() {
  const [mode, setMode, active] = useTheme();
  return (
    <>
      <ThemeSwitch mode={mode} onChange={setMode} />
      <output data-testid="active">{active}</output>
    </>
  );
}

/** Troca o matchMedia por um que diz o tema do sistema e avisa quando ele muda. */
function fakeSystemTheme(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<() => void>();
  window.matchMedia = (query: string) =>
    ({
      get matches() {
        return dark;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }) as unknown as MediaQueryList;
  return (next: boolean) => {
    dark = next;
    for (const listener of listeners) listener();
  };
}

const html = document.documentElement;

describe('tema Sistema, Claro e Escuro', () => {
  it('começa em Sistema: sem data-theme e sem nada gravado', () => {
    fakeSystemTheme(false);
    render(<Harness />);
    expect(
      screen.getByRole('button', { name: 'Usar o tema do sistema' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(html.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('active').textContent).toBe('light');
  });

  it('Escuro e Claro gravam a escolha em nuva-theme e marcam <html>', () => {
    fakeSystemTheme(false);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Tema escuro' }));
    expect(html.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('nuva-theme')).toBe('dark');
    expect(screen.getByTestId('active').textContent).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'Tema claro' }));
    expect(html.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('nuva-theme')).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: 'Usar o tema do sistema' }));
    expect(html.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('nuva-theme')).toBeNull();
  });

  it('em Sistema acompanha a troca de tema do sistema operacional', () => {
    const setSystemDark = fakeSystemTheme(false);
    render(<Harness />);
    expect(screen.getByTestId('active').textContent).toBe('light');
    act(() => setSystemDark(true));
    expect(screen.getByTestId('active').textContent).toBe('dark');
    expect(html.hasAttribute('data-theme')).toBe(false);
  });

  it('retoma a escolha gravada e ignora valor inválido', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readSavedTheme()).toBe('dark');
    fakeSystemTheme(false);
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Tema escuro' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(html.getAttribute('data-theme')).toBe('dark');

    localStorage.setItem(THEME_STORAGE_KEY, 'roxo');
    expect(readSavedTheme()).toBe('system');
  });

  it('aceita textos traduzidos em `labels`', () => {
    render(
      <ThemeSwitch
        mode="light"
        onChange={() => {}}
        groupLabel="Theme"
        labels={{
          system: { label: 'System', hint: 'Use system theme' },
          light: { label: 'Light', hint: 'Light theme' },
          dark: { label: 'Dark', hint: 'Dark theme' },
        }}
      />,
    );
    expect(screen.getByRole('group', { name: 'Theme' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Light theme' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
});
