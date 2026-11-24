import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { UnderConstructionPage } from './pages/UnderConstructionPage';
import { RequirePermission } from './session/RequirePermission';
import { SessionGate } from './session/SessionGate';
import { HOME_PATH, LOGIN_PATH, MENU_ITEMS, type MenuItemId } from './shell/menu';
import { Shell } from './shell/Shell';

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
const PAGES: Partial<Record<MenuItemId, RouteObject[]>> = {};

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
