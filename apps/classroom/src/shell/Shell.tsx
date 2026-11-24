import { AdminButton, ClassroomShell, ThemeSwitch, useTheme } from '@nuva-edu/ui';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { matchPath, Outlet, ScrollRestoration, useLocation, useMatches } from 'react-router';
import { useMeta } from '../api/meta';
import { MENU_STORAGE_KEY } from '../config';
import { TermsGate } from '../legal/TermsGate';
import { safeReturnTo, withReturnTo } from '../session/returnTo';
import { useSession } from '../session/session';
import { BrandLogo, useBrandLogo } from './BrandLogo';
import { useBrandAccent } from './brand';
import { Footer } from './Footer';
import { HOME_PATH, LOGIN_PATH, NAV_GROUPS, type TextKey } from './navigation';
import { UserMenu } from './UserMenu';
import { useThemeLabels } from './useThemeLabels';
import { VerifyEmailBanner } from './VerifyEmailBanner';

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

const LEGAL_PAGES = ['/termos', '/privacidade'];

function isRouteHandle(handle: unknown): handle is RouteHandle {
  return typeof handle === 'object' && handle !== null && 'titleKey' in handle;
}

/**
 * Casca do site do aluno: entrega ao `ClassroomShell` de @nuva-edu/ui os textos, o menu do mapa
 * de telas, a página atual e as ações da barra superior. Ficam aqui o que depende do roteador,
 * das traduções e do navegador: a página atual, o foco no conteúdo a cada troca de página e a
 * escolha de menu recolhido.
 */
export function Shell() {
  const { t } = useTranslation();
  const { data: meta } = useMeta();
  const [themeMode, setThemeMode] = useTheme();
  const themeLabels = useThemeLabels();
  const { pathname, search } = useLocation();
  const { session } = useSession();
  const matches = useMatches();

  useBrandAccent();

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const mainRef = useRef<HTMLElement>(null);
  const lastPath = useRef(pathname);
  const [pageChanged, setPageChanged] = useState(false);

  const handle = matches.map((match) => match.handle).findLast(isRouteHandle);
  const pageTitle = handle ? t(handle.titleKey) : t('notFound.title');
  const schoolName = meta?.schoolName ?? t('app.name');
  const [logoSrc, onLogoError] = useBrandLogo(meta?.logoUrl);

  // Troca de página: o foco vai para o conteúdo e o nome da página é anunciado (WCAG 2.4.3).
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    setPageChanged(true);
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  // Termos pendentes: a tela de aceite toma o lugar das páginas, menos a dos próprios termos.
  const gated = Boolean(session?.termsPending.length) && !LEGAL_PAGES.includes(pathname);

  const groups = NAV_GROUPS.map((group) => ({
    id: group.id,
    label: t(group.labelKey),
    items: group.items.map((item) => ({
      id: item.id,
      label: t(item.labelKey),
      href: item.path,
      icon: <item.icon size={16} aria-hidden="true" />,
    })),
  }));
  const active = NAV_GROUPS.flatMap((group) => group.items).find((item) =>
    matchPath({ path: item.path, end: item.end ?? false }, pathname),
  )?.id;

  return (
    <ClassroomShell
      brand={{
        name: schoolName,
        href: HOME_PATH,
        // Sem logotipo (ou se a imagem falhar), a casca desenha as iniciais da escola.
        ...(logoSrc
          ? { mark: <BrandLogo src={logoSrc} school={schoolName} onError={onLogoError} /> }
          : {}),
      }}
      groups={groups}
      active={active}
      labels={{
        skipToContent: t('shell.skipToContent'),
        menu: t('shell.menu'),
        openMenu: t('shell.openMenu'),
        closeMenu: t('shell.closeMenu'),
        collapseMenu: t('shell.collapseMenu'),
        expandMenu: t('shell.expandMenu'),
        breadcrumb: t('shell.breadcrumb'),
      }}
      crumbs={
        pathname === HOME_PATH
          ? [{ label: pageTitle }]
          : [{ label: t('home.title'), href: HOME_PATH }, { label: pageTitle }]
      }
      actions={
        <>
          <ThemeSwitch compact mode={themeMode} onChange={setThemeMode} {...themeLabels} />
          <span className="hidden sm:flex">
            <AdminButton
              href="/notificacoes"
              variant="ghost"
              icon={<Bell aria-hidden="true" />}
              aria-label={t('shell.notifications')}
              title={t('shell.notifications')}
            />
          </span>
          {session ? (
            <UserMenu session={session} />
          ) : (
            <AdminButton
              href={withReturnTo(LOGIN_PATH, safeReturnTo(pathname + search))}
              variant="primary"
            >
              {t('shell.signIn')}
            </AdminButton>
          )}
        </>
      }
      footer={<Footer />}
      collapsed={collapsed}
      onCollapsedChange={(next) => {
        saveCollapsed(next);
        setCollapsed(next);
      }}
      mainRef={mainRef}
      announcement={pageChanged ? t('shell.pageChanged', { title: pageTitle }) : ''}
    >
      {session && !session.user.emailVerified && !gated ? (
        <VerifyEmailBanner email={session.user.email} />
      ) : null}
      {gated && session ? <TermsGate session={session} /> : <Outlet />}
      <ScrollRestoration />
    </ClassroomShell>
  );
}
