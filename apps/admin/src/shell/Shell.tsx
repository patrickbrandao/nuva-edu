import {
  AdminBreadcrumb,
  AdminContent,
  AdminShell,
  AdminSidebar,
  AdminTopbar,
  ThemeSwitch,
  useTheme,
} from '@nuva-edu/ui';
import { GraduationCap } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';
import { useMeta } from '../api/meta';
import { Footer } from './Footer';
import { HOME_PATH, MENU, menuItemForPath } from './menu';
import { useInternalLinks } from './useInternalLinks';
import { useMenuCollapsed } from './useMenuCollapsed';
import { useThemeLabels } from './useThemeLabels';

// A casca do pacote é uma "janela" com moldura; aqui ela ocupa a página inteira.
const FULL_PAGE = { border: 0, borderRadius: 0, boxShadow: 'none' } as const;

/** Casca do painel: menu lateral, barra superior com trilha e tema, conteúdo e rodapé. */
export function Shell() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { data: meta } = useMeta();
  const [mode, setMode] = useTheme();
  const theme = useThemeLabels();
  const [collapsed, setCollapsed] = useMenuCollapsed();
  const root = useRef<HTMLDivElement>(null);
  useInternalLinks(root);

  const current = menuItemForPath(pathname);
  const home = t('menu.items.dashboard');
  const pageTitle = current ? t(`menu.items.${current.id}`) : t('notFound.title');
  const brandName = meta?.schoolName ?? t('app.name');

  useEffect(() => {
    document.title = `${pageTitle} · ${brandName}`;
  }, [pageTitle, brandName]);

  const sections = MENU.map((group) => ({
    id: group.id,
    label: t(`menu.groups.${group.id}`),
    items: group.items.map((item) => ({
      id: item.id,
      label: t(`menu.items.${item.id}`),
      icon: <item.icon size={16} aria-hidden="true" />,
      href: item.path,
    })),
  }));

  const crumbs =
    pathname === HOME_PATH
      ? [{ label: home }]
      : [{ label: home, href: HOME_PATH }, { label: pageTitle }];

  return (
    <div ref={root} className="contents">
      <AdminShell
        height="100dvh"
        style={FULL_PAGE}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        sidebar={
          <AdminSidebar
            brand={{ name: brandName, mark: <GraduationCap size={20} aria-hidden="true" /> }}
            sections={sections}
            active={current?.id}
            toggleLabel={[t('shell.collapseMenu'), t('shell.expandMenu')]}
          />
        }
      >
        <AdminTopbar
          actions={
            <ThemeSwitch
              compact
              mode={mode}
              onChange={setMode}
              labels={theme.labels}
              groupLabel={theme.groupLabel}
            />
          }
        >
          <AdminBreadcrumb items={crumbs} label={t('shell.breadcrumb')} />
        </AdminTopbar>
        <AdminContent>
          <Outlet />
        </AdminContent>
        <Footer />
      </AdminShell>
    </div>
  );
}
