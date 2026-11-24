import { ShellFooter } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../api/meta';
import { sourceCodeHref } from './brand';

/**
 * Rodapé: escola, versão, termos e o link "Código-fonte" que a AGPL-3.0 exige, no endereço de
 * `sourceCodeUrl` de `/api/v1/meta` (spec 006, RF-11).
 */
export function Footer() {
  const { t } = useTranslation();
  const { data } = useMeta();

  return (
    <ShellFooter
      links={[
        { id: 'terms', label: t('pages.terms'), href: '/termos' },
        { id: 'privacy', label: t('pages.privacy'), href: '/privacidade' },
        {
          id: 'source',
          label: t('footer.source'),
          href: sourceCodeHref(data?.sourceCodeUrl),
          external: true,
        },
      ]}
      newTabLabel={t('common.newTab')}
    >
      {data?.schoolName ?? t('app.name')}
      {data ? ` · ${t('footer.version', { version: data.version })}` : null}
    </ShellFooter>
  );
}
