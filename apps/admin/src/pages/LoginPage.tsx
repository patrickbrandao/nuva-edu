import {
  AdminButton,
  AdminCard,
  AdminField,
  AdminScope,
  ThemeSwitch,
  useTheme,
} from '@nuva-edu/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../api/meta';
import { Footer } from '../shell/Footer';
import { useThemeLabels } from '../shell/useThemeLabels';

/**
 * Tela de entrada: só a estrutura. O login de verdade (sessão, erros, login social) chega com
 * a spec 007, na Fase 1; por isso o formulário ainda não envia nada.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const { data: meta } = useMeta();
  const [mode, setMode] = useTheme();
  const theme = useThemeLabels();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const brandName = meta?.schoolName ?? t('app.name');

  useEffect(() => {
    document.title = `${t('login.title')} · ${brandName}`;
  }, [t, brandName]);

  const onSubmit = (event: FormEvent) => event.preventDefault();

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
        <AdminCard pad className="w-full max-w-sm">
          <p className="m-0 text-xs font-medium text-ink-3">
            {brandName} · {t('app.admin')}
          </p>
          <h1 className="mt-1 mb-1 text-xl font-semibold text-ink">{t('login.title')}</h1>
          <p className="mt-0 mb-5 text-ink-3">{t('login.subtitle')}</p>
          <form className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
            <AdminField
              label={t('login.email')}
              type="email"
              name="email"
              autoComplete="username"
              value={email}
              onChange={setEmail}
            />
            <AdminField
              label={t('login.password')}
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
            />
            <AdminButton variant="primary" type="submit" disabled>
              {t('login.submit')}
            </AdminButton>
            <p role="note" className="m-0 text-xs text-ink-3">
              {t('login.unavailable')}
            </p>
          </form>
        </AdminCard>
      </main>
      <Footer />
    </AdminScope>
  );
}
