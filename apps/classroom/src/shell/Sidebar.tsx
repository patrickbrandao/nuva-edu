import { AdminButton } from '@nuva-edu/ui';
import { X } from 'lucide-react';
import type { KeyboardEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { NAV_GROUPS } from './navigation';

/** Identificador do menu, apontado pelo `aria-controls` do botão da barra superior. */
export const SIDEBAR_ID = 'menu-principal';

interface SidebarProps {
  /** Abaixo de 1024 px o menu é uma gaveta sobre a página; `drawerOpen` diz se está aberta. */
  drawerOpen: boolean;
  /** A partir de 1024 px o menu recolhe para uma coluna de ícones. */
  collapsed: boolean;
  closeRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

const linkClass = [
  'flex min-h-9 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm text-ink-2 no-underline',
  'hover:bg-hover hover:text-ink',
  'aria-[current=page]:bg-active aria-[current=page]:font-medium aria-[current=page]:text-ink',
].join(' ');

/** Menu lateral do aluno: os grupos do mapa de telas (spec 006). */
export function Sidebar({ drawerOpen, collapsed, closeRef, onClose }: SidebarProps) {
  const { t } = useTranslation();
  const hideWhenCollapsed = collapsed ? 'lg:sr-only' : '';

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (drawerOpen && event.key === 'Escape') onClose();
  };

  return (
    <>
      {drawerOpen ? (
        <div
          className="fixed inset-0 z-40 bg-black/45 lg:hidden"
          data-testid="menu-backdrop"
          aria-hidden="true"
          onClick={onClose}
        />
      ) : null}
      <aside
        id={SIDEBAR_ID}
        {...(drawerOpen
          ? { role: 'dialog', 'aria-modal': true, 'aria-label': t('shell.menu') }
          : {})}
        onKeyDown={onKeyDown}
        className={[
          'flex shrink-0 flex-col border-0 border-r border-solid border-line bg-side',
          'max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:w-72 max-lg:max-w-[85vw]',
          'motion-safe:max-lg:transition-transform',
          drawerOpen ? 'max-lg:translate-x-0' : 'max-lg:invisible max-lg:-translate-x-full',
          'lg:sticky lg:top-14 lg:h-[calc(100dvh-3.5rem)] lg:self-start',
          collapsed ? 'lg:w-14' : 'lg:w-60',
        ].join(' ')}
      >
        <div className="flex h-14 items-center justify-between border-0 border-b border-solid border-line px-3 lg:hidden">
          <span className="text-sm font-medium text-ink">{t('shell.menu')}</span>
          <AdminButton
            ref={closeRef}
            variant="ghost"
            icon={<X aria-hidden="true" />}
            aria-label={t('shell.closeMenu')}
            title={t('shell.closeMenu')}
            onClick={onClose}
          />
        </div>
        <nav aria-label={t('shell.menu')} className="flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="mb-4 last:mb-0">
              <p
                id={`menu-grupo-${group.id}`}
                className={`m-0 px-2.5 pb-1.5 text-xs font-medium text-ink-3 ${hideWhenCollapsed}`}
              >
                {t(group.labelKey)}
              </p>
              <ul
                aria-labelledby={`menu-grupo-${group.id}`}
                className="m-0 flex list-none flex-col gap-0.5 p-0"
              >
                {group.items.map((item) => (
                  <li key={item.id}>
                    <NavLink
                      to={item.path}
                      end={item.end ?? false}
                      className={linkClass}
                      title={collapsed ? t(item.labelKey) : undefined}
                      onClick={onClose}
                    >
                      <item.icon size={16} aria-hidden="true" />
                      <span className={`min-w-0 truncate ${hideWhenCollapsed}`}>
                        {t(item.labelKey)}
                      </span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
