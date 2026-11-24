import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useMeta } from '../api/meta';
import { SOURCE_CODE_URL } from '../config';

const linkClass = 'text-ink-2 underline underline-offset-2 hover:text-ink';

/** Rodapé: escola, versão, termos e o link "Código-fonte" que a AGPL-3.0 exige (spec 006, RF-11). */
export function Footer() {
  const { t } = useTranslation();
  const { data } = useMeta();

  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-0 border-t border-solid border-line px-4 py-4 text-[13px] text-ink-3 sm:px-6">
      <span>
        {data?.schoolName ?? t('app.name')}
        {data ? ` · ${t('footer.version', { version: data.version })}` : null}
      </span>
      <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
        <li>
          <Link to="/termos" className={linkClass}>
            {t('pages.terms')}
          </Link>
        </li>
        <li>
          <Link to="/privacidade" className={linkClass}>
            {t('pages.privacy')}
          </Link>
        </li>
        <li>
          <a
            href={SOURCE_CODE_URL}
            target="_blank"
            rel="noreferrer"
            className={`${linkClass} inline-flex items-center gap-1`}
          >
            {t('footer.source')}
            <ExternalLink size={12} aria-hidden="true" />
            <span className="sr-only">{t('common.newTab')}</span>
          </a>
        </li>
      </ul>
    </footer>
  );
}
