import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminBreadcrumb,
  AdminButton,
  AdminContent,
  AdminShell,
  AdminSidebar,
  AdminTopbar,
  ThemeSwitch,
  useTheme,
  useToast,
} from '@nuva-edu/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useApi } from '../api/client';
import { useMeta } from '../api/meta';
import { useProblemText } from '../api/problems';
import { useOpsSummary } from '../features/email-operations/queries';
import { NotificationBellMenu } from '../features/notifications/NotificationBellMenu';
import { NOTIFICATION_PREFS_PATH, NOTIFICATIONS_PATH } from '../features/notifications/paths';
import { forgetSession, useSession } from '../session/session';
import { BrandMark } from './BrandMark';
import { validAccentColor } from './brand';
import { useCrumbState } from './crumbs';
import { Footer } from './Footer';
import { HOME_PATH, LOGIN_PATH, menuFor, menuItemForPath } from './menu';
import { TermsNotice } from './TermsNotice';
import { useThemeLabels } from './useThemeLabels';

/** Abaixo desta largura de tela o menu lateral é uma gaveta (spec 006, RNF-01). */
const DRAWER_BELOW = 1024;

/**
 * Casca do painel: menu lateral (só os itens que o papel pode usar; spec 006, RF-10) com o
 * usuário e o "Sair", barra superior com trilha e tema, aviso de termos, conteúdo e rodapé.
 */
export function Shell() {
  const { t } = useTranslation();
  const api = useApi();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const describe = useProblemText();
  const session = useSession();
  const { pathname } = useLocation();
  const { data: meta } = useMeta();
  const [mode, setMode] = useTheme();
  const theme = useThemeLabels();

  const current = menuItemForPath(pathname);
  const home = t('menu.items.dashboard');
  // A central e as preferências não têm item de menu; a trilha e o título da aba ainda precisam
  // de um nome legível (spec 006, RF-07).
  const extraTitle =
    pathname === NOTIFICATIONS_PATH
      ? t('notifications.title')
      : pathname === NOTIFICATION_PREFS_PATH
        ? t('notifications.prefs.title')
        : undefined;
  const pageTitle = current ? t(`menu.items.${current.id}`) : (extraTitle ?? t('notFound.title'));
  const brandName = meta?.schoolName ?? t('app.name');
  const [subPage, provideCrumb] = useCrumbState();
  const accentColor = validAccentColor(meta?.accentColor);
  // Selo do menu com as falhas da operação (spec 033): só o `admin` tem a leitura.
  const ops = useOpsSummary(session.permissions.includes('ops.manage'));

  useEffect(() => {
    document.title = `${subPage ?? pageTitle} · ${brandName}`;
  }, [subPage, pageTitle, brandName]);

  const logout = useMutation({
    mutationFn: async () => {
      await api.POST('/api/v1/auth/logout');
    },
    onSettled: (_data, error) => {
      // Sessão já encerrada (401) também é saída: o cookie não vale mais.
      if (error && !(isApiError(error) && error.status === 401)) {
        const { text, detail } = describe(error);
        toast.error(detail ? `${text} ${detail}` : text, { title: t('shell.logoutError') });
        return;
      }
      forgetSession(queryClient);
      void navigate(LOGIN_PATH, { replace: true });
    },
  });

  const sections = menuFor(session.permissions).map((group) => ({
    id: group.id,
    label: t(`menu.groups.${group.id}`),
    items: group.items.map((item) => ({
      id: item.id,
      label: t(`menu.items.${item.id}`),
      icon: <item.icon size={16} aria-hidden="true" />,
      href: item.path,
      ...(item.id === 'operations' && ops.data && ops.data.failures > 0
        ? { badge: ops.data.failures }
        : {}),
    })),
  }));

  const crumbs =
    pathname === HOME_PATH
      ? [{ label: home }]
      : subPage && current
        ? [
            { label: home, href: HOME_PATH },
            { label: pageTitle, href: current.path },
            { label: subPage },
          ]
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
          brand={{
            name: brandName,
            mark: <BrandMark logoUrl={meta?.logoUrl} name={brandName} />,
            // Cor da marca do menu (ícone padrão); o restante da interface segue `--minui-accent`.
            ...(accentColor ? { color: accentColor } : {}),
          }}
          sections={sections}
          active={current?.id}
          navLabel={t('shell.menu')}
          toggleLabel={[t('shell.collapseMenu'), t('shell.expandMenu')]}
          user={{
            name: session.user.name,
            role: t(`roles.${session.user.role}`),
            src: session.user.avatarUrl ?? undefined,
          }}
          userAction={
            <AdminButton
              variant="ghost"
              size="sm"
              icon={<LogOut size={15} aria-hidden="true" />}
              aria-label={t('shell.logout')}
              title={t('shell.logout')}
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            />
          }
        />
      }
    >
      <AdminTopbar
        actions={
          <span className="flex items-center gap-2">
            <NotificationBellMenu />
            <ThemeSwitch
              compact
              mode={mode}
              onChange={setMode}
              labels={theme.labels}
              groupLabel={theme.groupLabel}
            />
          </span>
        }
      >
        <AdminBreadcrumb items={crumbs} label={t('shell.breadcrumb')} />
      </AdminTopbar>
      <TermsNotice />
      <AdminContent>{provideCrumb(<Outlet />)}</AdminContent>
      <Footer />
    </AdminShell>
  );
}
