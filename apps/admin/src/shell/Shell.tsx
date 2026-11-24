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
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router';
import { useMeta } from '../api/meta';
import { Footer } from './Footer';
import { HOME_PATH, MENU, menuItemForPath } from './menu';
import { useThemeLabels } from './useThemeLabels';

/** Abaixo desta largura de tela o menu lateral é uma gaveta (spec 006, RNF-01). */
const DRAWER_BELOW = 1024;

/** Casca do painel: menu lateral, barra superior com trilha e tema, conteúdo e rodapé. */
export function Shell() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { data: meta } = useMeta();
  const [mode, setMode] = useTheme();
  const theme = useThemeLabels();

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
    <AdminShell
      fullPage
      drawerBelow={DRAWER_BELOW}
      drawerLabels={{
        open: t('shell.openMenu'),
        close: t('shell.closeMenu'),
        title: t('shell.menu'),
      }}
      sidebar={
        <AdminSidebar
          brand={{ name: brandName, mark: <GraduationCap size={20} aria-hidden="true" /> }}
          sections={sections}
          active={current?.id}
          navLabel={t('shell.menu')}
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
  );
}
