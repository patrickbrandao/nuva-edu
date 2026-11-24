import { useTranslation } from 'react-i18next';
import { useMeta } from '../api/meta';
import { SOURCE_CODE_URL } from '../config';

/** Rodapé comum: versão instalada e o link "Código-fonte" que a AGPL-3.0 pede (spec 006, RF-11). */
export function Footer() {
  const { t } = useTranslation();
  const { data: meta } = useMeta();
  return (
    <footer className="flex flex-none flex-wrap items-center justify-between gap-x-4 gap-y-1 border-0 border-t border-solid border-line px-[22px] py-2.5 text-xs text-ink-3">
      <span>{meta ? t('footer.version', { version: meta.version }) : null}</span>
      <a
        className="text-ink-2 underline-offset-2 hover:text-ink hover:underline"
        href={SOURCE_CODE_URL}
        target="_blank"
        rel="noreferrer"
      >
        {t('footer.source')}
      </a>
    </footer>
  );
}
