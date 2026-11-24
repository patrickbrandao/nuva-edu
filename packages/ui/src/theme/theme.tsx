import type { ReactNode } from 'react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import '../styles/tokens.css';
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from './boot';
import './theme.css';

/*
 * Tema da página: "system" (padrão), "light" ou "dark".
 * Portado de minui-react `showcase/theme.jsx`, com a chave do nuva-edu (spec 006, RF-04).
 *
 * - "system" não grava nada e deixa o CSS seguir o sistema operacional;
 * - "light" e "dark" gravam a escolha e põem data-theme em <html>, que os
 *   tokens (styles/tokens.css) usam para trocar todas as cores.
 */
export type ThemeMode = 'system' | 'light' | 'dark';
export type ActiveTheme = 'light' | 'dark';

/** Cor da barra do navegador (celular) em cada tema: o valor de --minui-stage. */
export const THEME_BAR_COLORS: Record<ActiveTheme, string> = { light: '#f5f5f2', dark: '#070707' };

// A chave e o script de partida ficam em ./boot, importável sem CSS nem JSX.
export { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY };

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Lê o modo salvo; qualquer valor inválido ou armazenamento indisponível vale "system". */
export function readSavedTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

/** Aplica o modo em <html> e grava a escolha ("system" apaga a chave). */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', mode);
  try {
    if (mode === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* armazenamento indisponível: o tema vale só para esta visita */
  }
}

function subscribeSystem(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const systemIsDark = (): boolean => window.matchMedia(DARK_QUERY).matches;

/** Devolve [modo escolhido, função para trocar, tema efetivamente em uso]. */
export function useTheme(): [ThemeMode, (mode: ThemeMode) => void, ActiveTheme] {
  const [mode, setMode] = useState<ThemeMode>(readSavedTheme);
  const dark = useSyncExternalStore(subscribeSystem, systemIsDark, () => false);
  const active: ActiveTheme = mode === 'system' ? (dark ? 'dark' : 'light') : mode;

  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_BAR_COLORS[active]);
  }, [active]);

  return [mode, setMode, active];
}

export interface ThemeOptionText {
  /** Texto visível do botão. */
  label: string;
  /** Nome acessível e dica do botão. */
  hint: string;
}

export type ThemeSwitchLabels = Record<ThemeMode, ThemeOptionText>;

/** Textos padrão (pt-BR). Os sites passam os das suas traduções em `labels`. */
export const THEME_LABELS: ThemeSwitchLabels = {
  system: { label: 'Sistema', hint: 'Usar o tema do sistema' },
  light: { label: 'Claro', hint: 'Tema claro' },
  dark: { label: 'Escuro', hint: 'Tema escuro' },
};

const ICONS: Record<ThemeMode, ReactNode> = {
  system: <path d="M3.5 5.5h13v8.5h-13zM7.5 17h5M10 14v3" />,
  light: (
    <>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.6v1.8M10 15.6v1.8M2.6 10h1.8M15.6 10h1.8M4.8 4.8l1.3 1.3M13.9 13.9l1.3 1.3M4.8 15.2l1.3-1.3M13.9 6.1l1.3-1.3" />
    </>
  ),
  dark: <path d="M16.2 11.7A6.6 6.6 0 0 1 8.3 3.8a6.6 6.6 0 1 0 7.9 7.9Z" />,
};

const MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

export interface ThemeSwitchProps {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
  labels?: ThemeSwitchLabels;
  /** Nome acessível do grupo. */
  groupLabel?: string;
  /** Só os ícones (o nome continua no aria-label). */
  compact?: boolean;
  className?: string;
}

/** Seletor de tema da barra superior: Sistema, Claro e Escuro. */
export function ThemeSwitch({
  mode,
  onChange,
  labels = THEME_LABELS,
  groupLabel = 'Tema da página',
  compact = false,
  className,
}: ThemeSwitchProps) {
  const classes = ['minui-theme', compact ? 'minui-theme--compact' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <fieldset className={classes} aria-label={groupLabel}>
      {MODES.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={mode === id}
          aria-label={labels[id].hint}
          title={labels[id].hint}
          onClick={() => onChange(id)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            {ICONS[id]}
          </svg>
          <span className="minui-theme__label">{labels[id].label}</span>
        </button>
      ))}
    </fieldset>
  );
}
