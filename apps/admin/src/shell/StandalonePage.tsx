import { AdminCard, AdminScope, ThemeSwitch, useTheme } from '@nuva-edu/ui';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../api/meta';
import { Footer } from './Footer';
import { useThemeLabels } from './useThemeLabels';

interface StandalonePageProps {
  /** Título da tela (h1) e, sem `tabTitle`, da aba. */
  title: string;
  /** Título da aba, quando difere do h1 (ex.: "Painel" enquanto a sessão carrega). */
  tabTitle?: string;
  subtitle?: ReactNode;
  /** Largura do cartão: `sm` (formulário curto) ou `md` (estado de erro, aviso). */
  width?: 'sm' | 'md';
  children?: ReactNode;
}

/**
 * Tela fora da casca do painel (entrar, carregando a sessão, falha ao abrir): cartão no meio,
 * seletor de tema no alto e o rodapé com o código-fonte.
 */
export function StandalonePage({
  title,
  tabTitle,
  subtitle,
  width = 'sm',
  children,
}: StandalonePageProps) {
  const { t } = useTranslation();
  const { data: meta } = useMeta();
  const [mode, setMode] = useTheme();
  const theme = useThemeLabels();
  const brandName = meta?.schoolName ?? t('app.name');

  useEffect(() => {
    document.title = `${tabTitle ?? title} · ${brandName}`;
  }, [tabTitle, title, brandName]);

  return (
    <AdminScope className="flex min-h-dvh flex-col bg-panel">
      <div className="flex justify-end p-4">
        <ThemeSwitch
          compact
          mode={mode}
          onChange={setMode}
          labels={theme.labels}
          groupLabel={theme.groupLabel}
        />
      </div>
      <main className="flex flex-1 items-center justify-center px-4 pb-10">
        <AdminCard pad className={width === 'sm' ? 'w-full max-w-sm' : 'w-full max-w-lg'}>
          <p className="m-0 text-xs font-medium text-ink-3">
            <span>{brandName}</span> · {t('app.admin')}
          </p>
          <h1 className="mt-1 mb-1 text-xl font-semibold text-ink">{title}</h1>
          {subtitle ? <p className="mt-0 mb-5 text-ink-3">{subtitle}</p> : null}
          {children}
        </AdminCard>
      </main>
      <Footer />
    </AdminScope>
  );
}
