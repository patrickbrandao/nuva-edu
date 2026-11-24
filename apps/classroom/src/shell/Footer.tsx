import { ShellFooter } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../api/meta';
import { SOURCE_CODE_URL } from '../config';

/** Rodapé: escola, versão, termos e o link "Código-fonte" que a AGPL-3.0 exige (spec 006, RF-11). */
export function Footer() {
  const { t } = useTranslation();
  const { data } = useMeta();

  return (
    <ShellFooter
      links={[
        { id: 'terms', label: t('pages.terms'), href: '/termos' },
        { id: 'privacy', label: t('pages.privacy'), href: '/privacidade' },
        { id: 'source', label: t('footer.source'), href: SOURCE_CODE_URL, external: true },
      ]}
      newTabLabel={t('common.newTab')}
    >
      {data?.schoolName ?? t('app.name')}
      {data ? ` · ${t('footer.version', { version: data.version })}` : null}
    </ShellFooter>
  );
}
