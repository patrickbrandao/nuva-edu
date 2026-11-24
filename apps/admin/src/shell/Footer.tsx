import { ShellFooter } from '@nuva-edu/ui';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../api/meta';
import { sourceCodeUrlOf } from './brand';

/** Rodapé comum: versão instalada e o link "Código-fonte" que a AGPL-3.0 pede (spec 006, RF-11). */
export function Footer() {
  const { t } = useTranslation();
  const { data: meta } = useMeta();
  return (
    <ShellFooter
      links={[
        {
          id: 'source',
          label: t('footer.source'),
          href: sourceCodeUrlOf(meta?.sourceCodeUrl),
          external: true,
        },
      ]}
      newTabLabel={t('common.newTab')}
    >
      {meta ? t('footer.version', { version: meta.version }) : null}
    </ShellFooter>
  );
}
