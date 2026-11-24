import type { RouteObject } from 'react-router';
import { ErrorPage } from './pages/ErrorPage';
import { HomePage } from './pages/HomePage';
import { HOME_PATH, LOGIN_PATH, PENDING_PAGES } from './shell/navigation';
import { type RouteHandle, Shell } from './shell/Shell';

const handle = (value: RouteHandle): RouteHandle => value;

/**
 * Rotas do classroom, em português (mapa de telas da spec 006). A vitrine vai no pacote inicial;
 * as demais telas são carregadas sob demanda (RNF-03).
 */
export const routes: RouteObject[] = [
  {
    element: <Shell />,
    errorElement: <ErrorPage />,
    hydrateFallbackElement: <span />,
    children: [
      { path: HOME_PATH, element: <HomePage />, handle: handle({ titleKey: 'home.title' }) },
      {
        path: LOGIN_PATH,
        handle: handle({ titleKey: 'login.title' }),
        lazy: async () => ({ Component: (await import('./pages/LoginPage')).LoginPage }),
      },
      {
        path: '/cadastro',
        handle: handle({ titleKey: 'pages.signUp' }),
        lazy: async () => ({ Component: (await import('./pages/SignUpPage')).SignUpPage }),
      },
      {
        path: '/confirmar',
        handle: handle({ titleKey: 'pages.confirmEmail' }),
        lazy: async () => ({
          Component: (await import('./pages/ConfirmEmailPage')).ConfirmEmailPage,
        }),
      },
      {
        path: '/redefinir',
        handle: handle({ titleKey: 'pages.resetPassword' }),
        lazy: async () => ({
          Component: (await import('./pages/ResetPasswordPage')).ResetPasswordPage,
        }),
      },
      {
        path: '/termos',
        handle: handle({ titleKey: 'pages.terms' }),
        lazy: async () => {
          const { LegalPage } = await import('./pages/LegalPage');
          return { element: <LegalPage document="terms" /> };
        },
      },
      {
        path: '/privacidade',
        handle: handle({ titleKey: 'pages.privacy' }),
        lazy: async () => {
          const { LegalPage } = await import('./pages/LegalPage');
          return { element: <LegalPage document="privacy" /> };
        },
      },
      ...PENDING_PAGES.map(
        ({ path, titleKey }): RouteObject => ({
          path,
          handle: handle({ titleKey }),
          lazy: async () => {
            const { UnderConstructionPage } = await import('./pages/UnderConstructionPage');
            return { element: <UnderConstructionPage titleKey={titleKey} /> };
          },
        }),
      ),
      {
        path: '*',
        handle: handle({ titleKey: 'notFound.title' }),
        lazy: async () => ({ Component: (await import('./pages/NotFoundPage')).NotFoundPage }),
      },
    ],
  },
];
