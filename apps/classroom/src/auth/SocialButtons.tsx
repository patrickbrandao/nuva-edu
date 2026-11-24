import { classroomOAuthStartUrl } from '@nuva-edu/api-client/classroom';
import { AdminButton } from '@nuva-edu/ui';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../api/meta';
import { browser } from '../lib/browser';

/**
 * Login e cadastro social (spec 007, "Fluxo do provedor"): um botão por provedor de
 * `authProviders` do `/api/v1/meta`. O botão navega (página inteira, sem `fetch`) para
 * `startOAuth`, que responde `302` para o provedor; a volta cai em `returnTo`.
 */
export function SocialButtons({ title, returnTo }: { title: string; returnTo: string }) {
  const { t } = useTranslation();
  const { data: meta } = useMeta();
  const headingId = useId();
  if (!meta?.authProviders.length) return null;
  return (
    <section
      aria-labelledby={headingId}
      className="mt-5 flex flex-col gap-2.5 border-0 border-t border-solid border-line pt-4"
    >
      <h2 id={headingId} className="m-0 text-[13px] font-medium text-ink-3">
        {title}
      </h2>
      {meta.authProviders.map((provider) => (
        <AdminButton
          key={provider}
          onClick={() => browser.assign(classroomOAuthStartUrl(provider, { returnTo }))}
        >
          {t('login.continueWith', { provider: t(`auth.providers.${provider}`) })}
        </AdminButton>
      ))}
    </section>
  );
}
