import type { RouteObject } from 'react-router';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { UnderConstructionPage } from './pages/UnderConstructionPage';
import { HOME_PATH, LOGIN_PATH, MENU_ITEMS } from './shell/menu';
import { Shell } from './shell/Shell';

/** Rotas do site. Item do menu ainda sem tela leva à página "em construção". */
export const routes: RouteObject[] = [
  { path: LOGIN_PATH, element: <LoginPage /> },
  {
    element: <Shell />,
    children: [
      { path: HOME_PATH, element: <HomePage /> },
      ...MENU_ITEMS.filter((item) => item.path !== HOME_PATH).map((item) => ({
        path: item.path,
        element: <UnderConstructionPage item={item.id} />,
      })),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
