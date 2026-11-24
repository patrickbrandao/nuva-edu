import { AdminAvatar, AdminButton, AdminScope, ThemeSwitch, useTheme } from '@nuva-edu/ui';
import { Bell, PanelLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, ScrollRestoration, useLocation, useMatches } from 'react-router';
import { useMeta } from '../api/meta';
import { DESKTOP_QUERY, MENU_STORAGE_KEY } from '../config';
import { LinkButton } from '../lib/LinkButton';
import { useMediaQuery } from '../lib/useMediaQuery';
import { Breadcrumb } from './Breadcrumb';
import { Footer } from './Footer';
import { HOME_PATH, LOGIN_PATH, type TextKey } from './navigation';
import { SIDEBAR_ID, Sidebar } from './Sidebar';
import { useThemeLabels } from './useThemeLabels';

/** Identificador da área de conteúdo, alvo do link "Ir para o conteúdo". */
const CONTENT_ID = 'conteudo';

/** O que cada rota informa à casca: a chave do nome legível da página. */
export interface RouteHandle {
  titleKey: TextKey;
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(MENU_STORAGE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function saveCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) localStorage.setItem(MENU_STORAGE_KEY, 'collapsed');
    else localStorage.removeItem(MENU_STORAGE_KEY);
  } catch {
    /* armazenamento indisponível: a escolha vale só para esta visita */
  }
}

function isRouteHandle(handle: unknown): handle is RouteHandle {
  return typeof handle === 'object' && handle !== null && 'titleKey' in handle;
}

/**
 * Casca do site do aluno: barra superior, menu lateral (gaveta abaixo de 1024 px), trilha,
 * conteúdo e rodapé. Montada aqui porque @nuva-edu/ui só tem a casca do painel administrativo.
 */
export function Shell() {
  const { t } = useTranslation();
  const { data: meta } = useMeta();
  const [themeMode, setThemeMode] = useTheme();
  const themeLabels = useThemeLabels();
  const location = useLocation();
  const matches = useMatches();

  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerWanted, setDrawerWanted] = useState(false);
  const drawerOpen = drawerWanted && !isDesktop;

  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const drawerWasOpen = useRef(false);
  const lastPath = useRef(location.pathname);
  const [pageChanged, setPageChanged] = useState(false);

  const handle = matches.map((match) => match.handle).findLast(isRouteHandle);
  const pageTitle = handle ? t(handle.titleKey) : t('notFound.title');
  const schoolName = meta?.schoolName ?? t('app.name');

  // Gaveta: o foco entra nela ao abrir e volta ao botão do menu ao fechar; a página não rola por baixo.
  useEffect(() => {
    if (drawerOpen) closeRef.current?.focus();
    else if (drawerWasOpen.current) toggleRef.current?.focus();
    drawerWasOpen.current = drawerOpen;
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  // Troca de página: o foco vai para o conteúdo e o nome da página é anunciado (WCAG 2.4.3).
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    setPageChanged(true);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const toggleMenu = () => {
    if (isDesktop) {
      saveCollapsed(!collapsed);
      setCollapsed(!collapsed);
    } else {
      setDrawerWanted(!drawerOpen);
    }
  };
  const menuExpanded = isDesktop ? !collapsed : drawerOpen;
  const toggleLabel = isDesktop
    ? t(collapsed ? 'shell.expandMenu' : 'shell.collapseMenu')
    : t(drawerOpen ? 'shell.closeMenu' : 'shell.openMenu');

  return (
    <AdminScope className="flex min-h-dvh flex-col bg-panel font-sans text-ink">
      <a
        href={`#${CONTENT_ID}`}
        className="sr-only rounded-lg bg-card px-3 py-2 text-sm text-ink focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60]"
      >
        {t('shell.skipToContent')}
      </a>

      <header
        inert={drawerOpen}
        className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-0 border-b border-solid border-line bg-panel px-3 sm:px-4"
      >
        <AdminButton
          ref={toggleRef}
          variant="ghost"
          icon={<PanelLeft aria-hidden="true" />}
          aria-label={toggleLabel}
          aria-expanded={menuExpanded}
          aria-controls={SIDEBAR_ID}
          title={toggleLabel}
          onClick={toggleMenu}
        />
        <Link
          to={HOME_PATH}
          className="flex min-w-0 items-center gap-2 text-[15px] font-semibold text-ink no-underline"
        >
          <span aria-hidden="true" className="flex shrink-0">
            <AdminAvatar square size={24} name={schoolName} />
          </span>
          <span className="min-w-0 truncate">{schoolName}</span>
        </Link>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ThemeSwitch compact mode={themeMode} onChange={setThemeMode} {...themeLabels} />
          <span className="hidden sm:flex">
            <LinkButton
              to="/notificacoes"
              variant="ghost"
              icon={<Bell aria-hidden="true" />}
              aria-label={t('shell.notifications')}
              title={t('shell.notifications')}
            />
          </span>
          <LinkButton to={LOGIN_PATH} variant="primary">
            {t('shell.signIn')}
          </LinkButton>
        </div>
      </header>

      <div className="flex min-w-0 flex-1">
        <Sidebar
          drawerOpen={drawerOpen}
          collapsed={collapsed}
          closeRef={closeRef}
          onClose={() => setDrawerWanted(false)}
        />
        <div inert={drawerOpen} className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-11 items-center border-0 border-b border-solid border-line px-4 sm:px-6">
            <Breadcrumb current={pageTitle} atHome={location.pathname === HOME_PATH} />
          </div>
          <main
            id={CONTENT_ID}
            ref={mainRef}
            tabIndex={-1}
            style={{ outline: 'none' }}
            className="min-w-0 flex-1"
          >
            <Outlet />
          </main>
          <Footer />
        </div>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {pageChanged ? t('shell.pageChanged', { title: pageTitle }) : ''}
      </p>
      <ScrollRestoration />
    </AdminScope>
  );
}
