import { LoadingState } from '@nuva-edu/ui';
import { lazy, type ReactNode, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { RouteObject } from 'react-router';
import { CERTIFICATES_PATH } from './api/certificates';
import { COURSES_PATH } from './api/courses';
import { BUNDLES_PATH, EBOOKS_PATH } from './api/products';
import { TERMS_PATH } from './api/terms';
import { AuditEntryPage } from './pages/audit/AuditEntryPage';
import { AUDIT_PATH, AuditPage } from './pages/audit/AuditPage';
import { CertificatesPage } from './pages/certificates/CertificatesPage';
import { CoursesPage } from './pages/courses/CoursesPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SettingsPage } from './pages/SettingsPage';
import { TermsPage } from './pages/terms/TermsPage';
import { UnderConstructionPage } from './pages/UnderConstructionPage';
import { StudentsPage } from './pages/users/StudentsPage';
import { TeamPage } from './pages/users/TeamPage';
import { STUDENTS_PATH } from './pages/users/UserBits';
import { UserDetailPage } from './pages/users/UserDetailPage';
import { RequirePermission } from './session/RequirePermission';
import { SessionGate } from './session/SessionGate';
import { HOME_PATH, LOGIN_PATH, MENU_ITEMS, type MenuItemId } from './shell/menu';
import { Shell } from './shell/Shell';

/*
 * Telas carregadas sob demanda (spec 006, RNF-03): o editor de curso e as telas de ebook e de
 * pacote ficam fora do JavaScript inicial.
 */
const CourseEditorPage = lazy(() =>
  import('./pages/courses/CourseEditorPage').then((module) => ({
    default: module.CourseEditorPage,
  })),
);
const ProductsPage = lazy(() =>
  import('./pages/products/ProductsPage').then((module) => ({ default: module.ProductsPage })),
);
const ProductEditorPage = lazy(() =>
  import('./pages/products/ProductEditorPage').then((module) => ({
    default: module.ProductEditorPage,
  })),
);

function PageFallback() {
  const { t } = useTranslation();
  return <LoadingState label={t('common.loadingPage')} />;
}

const onDemand = (element: ReactNode): ReactNode => (
  <Suspense fallback={<PageFallback />}>{element}</Suspense>
);

const itemOf = (id: MenuItemId) => MENU_ITEMS.find((item) => item.id === id);

/** Tela de um item do menu, atrás da ação que o item exige. */
function guarded(id: MenuItemId, element: ReactNode): ReactNode {
  const item = itemOf(id);
  return item ? (
    <RequirePermission permission={item.permission}>{element}</RequirePermission>
  ) : (
    element
  );
}

/** Telas já construídas, por item do menu. Item sem tela leva à página "em construção". */
const PAGES: Partial<Record<MenuItemId, RouteObject[]>> = {
  students: [
    { path: STUDENTS_PATH, element: <StudentsPage /> },
    { path: `${STUDENTS_PATH}/:id`, element: <UserDetailPage /> },
  ],
  team: [{ path: '/equipe', element: <TeamPage /> }],
  certificates: [{ path: CERTIFICATES_PATH, element: <CertificatesPage /> }],
  courses: [
    { path: COURSES_PATH, element: <CoursesPage /> },
    { path: `${COURSES_PATH}/:id`, element: onDemand(<CourseEditorPage />) },
  ],
  ebooks: [
    { path: EBOOKS_PATH, element: onDemand(<ProductsPage kind="ebook" />) },
    { path: `${EBOOKS_PATH}/:id`, element: onDemand(<ProductEditorPage kind="ebook" />) },
  ],
  bundles: [
    { path: BUNDLES_PATH, element: onDemand(<ProductsPage kind="bundle" />) },
    { path: `${BUNDLES_PATH}/:id`, element: onDemand(<ProductEditorPage kind="bundle" />) },
  ],
  audit: [
    { path: AUDIT_PATH, element: <AuditPage /> },
    { path: `${AUDIT_PATH}/:id`, element: <AuditEntryPage /> },
  ],
  settings: [
    { path: '/configuracoes', element: <SettingsPage /> },
    { path: TERMS_PATH, element: <TermsPage /> },
  ],
};

/** Rotas do site: `/entrar` fora da guarda; o resto exige sessão (spec 006, "Sessão"). */
export const routes: RouteObject[] = [
  { path: LOGIN_PATH, element: <LoginPage /> },
  {
    element: <SessionGate />,
    children: [
      {
        element: <Shell />,
        children: [
          { path: HOME_PATH, element: guarded('dashboard', <HomePage />) },
          ...MENU_ITEMS.filter((item) => item.path !== HOME_PATH).flatMap(
            (item) =>
              PAGES[item.id]?.map((route) => ({
                ...route,
                element: guarded(item.id, route.element),
              })) ?? [
                {
                  path: item.path,
                  element: guarded(item.id, <UnderConstructionPage item={item.id} />),
                },
              ],
          ),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
