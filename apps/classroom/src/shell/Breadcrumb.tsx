import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { HOME_PATH } from './navigation';

/** Trilha de navegação: a vitrine e a página atual, sempre com o nome legível. */
export function Breadcrumb({ current, atHome }: { current: string; atHome: boolean }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('shell.breadcrumb')} className="min-w-0 text-[13px] text-ink-3">
      <ol className="m-0 flex min-w-0 list-none items-center gap-1.5 p-0">
        {atHome ? null : (
          <li className="flex shrink-0 items-center gap-1.5">
            <Link to={HOME_PATH} className="text-ink-3 no-underline hover:text-ink hover:underline">
              {t('home.title')}
            </Link>
            <ChevronRight size={14} aria-hidden="true" />
          </li>
        )}
        <li className="min-w-0 truncate font-medium text-ink" aria-current="page">
          {current}
        </li>
      </ol>
    </nav>
  );
}
