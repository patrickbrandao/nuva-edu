import { AdminButton, AdminCard, AdminField } from '@nuva-edu/ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMeta } from '../api/meta';
import { usePageMeta } from '../lib/usePageMeta';

const linkClass = 'text-ink underline underline-offset-2';

/**
 * Tela de login: só a estrutura (spec 007 traz o comportamento). O formulário ainda não chama
 * a API e não guarda o que foi digitado; enviar mostra o aviso de indisponível.
 */
export function LoginPage() {
  const { t } = useTranslation();
  const { data: meta } = useMeta();
  const [notice, setNotice] = useState('');

  usePageMeta(t('login.title'), t('login.description'));

  const showUnavailable = () => setNotice(t('login.unavailable'));
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    showUnavailable();
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-5 px-4 py-10 sm:py-16">
      <header className="flex flex-col gap-1.5">
        <h1 className="m-0 text-2xl font-semibold tracking-tight text-ink">{t('login.title')}</h1>
        <p className="m-0 text-sm text-ink-3">{t('login.lead')}</p>
      </header>

      <AdminCard pad>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <AdminField
            label={t('login.email')}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
          />
          <AdminField
            label={t('login.password')}
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
          <AdminButton type="submit" variant="primary">
            {t('login.submit')}
          </AdminButton>
          <Link to="/redefinir" className={`${linkClass} self-start text-[13px]`}>
            {t('login.forgot')}
          </Link>
        </form>

        {meta?.authProviders.length ? (
          <section
            aria-labelledby="login-social"
            className="mt-5 flex flex-col gap-2.5 border-0 border-t border-solid border-line pt-4"
          >
            <h2 id="login-social" className="m-0 text-[13px] font-medium text-ink-3">
              {t('login.social')}
            </h2>
            {meta.authProviders.map((provider) => (
              <AdminButton key={provider} onClick={showUnavailable}>
                {t('login.continueWith', { provider: t(`auth.providers.${provider}`) })}
              </AdminButton>
            ))}
          </section>
        ) : null}
      </AdminCard>

      <p role="status" aria-live="polite" className="m-0 min-h-5 text-sm text-ink-2">
        {notice}
      </p>

      <p className="m-0 text-sm text-ink-3">
        {t('login.noAccount')}{' '}
        <Link to="/cadastro" className={linkClass}>
          {t('login.signUp')}
        </Link>
      </p>
    </div>
  );
}
