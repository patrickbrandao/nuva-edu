import type { RouteObject } from 'react-router';
import { ErrorPage } from './pages/ErrorPage';
import { HomePage } from './pages/HomePage';
import { ACCOUNT_PATH, HOME_PATH, LOGIN_PATH, PENDING_PAGES } from './shell/navigation';
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
        path: '/cadastro/social',
        handle: handle({ titleKey: 'pages.socialSignUp' }),
        lazy: async () => ({
          Component: (await import('./pages/SocialSignUpPage')).SocialSignUpPage,
        }),
      },
      {
        path: ACCOUNT_PATH,
        handle: handle({ titleKey: 'menu.items.settings' }),
        lazy: async () => ({ Component: (await import('./pages/AccountPage')).AccountPage }),
      },
      {
        path: '/conta/acesso',
        handle: handle({ titleKey: 'pages.access' }),
        lazy: async () => ({ Component: (await import('./pages/AccessPage')).AccessPage }),
      },
      {
        path: '/conta/perfil',
        handle: handle({ titleKey: 'pages.profile' }),
        lazy: async () => ({ Component: (await import('./pages/ProfilePage')).ProfilePage }),
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
      {
        path: '/cursos/:slug',
        handle: handle({ titleKey: 'pages.course' }),
        lazy: async () => {
          const { ProductPage } = await import('./pages/ProductPage');
          return { element: <ProductPage type="course" /> };
        },
      },
      {
        path: '/pacotes/:slug',
        handle: handle({ titleKey: 'pages.bundle' }),
        lazy: async () => {
          const { ProductPage } = await import('./pages/ProductPage');
          return { element: <ProductPage type="bundle" /> };
        },
      },
      {
        path: '/ebooks/:slug',
        handle: handle({ titleKey: 'pages.ebook' }),
        lazy: async () => {
          const { ProductPage } = await import('./pages/ProductPage');
          return { element: <ProductPage type="ebook" /> };
        },
      },
      {
        path: '/meus-cursos/:slug',
        handle: handle({ titleKey: 'pages.myCourse' }),
        lazy: async () => ({ Component: (await import('./pages/CoursePage')).CoursePage }),
      },
      {
        path: '/meus-cursos/:slug/aulas/:aula',
        handle: handle({ titleKey: 'pages.lesson' }),
        lazy: async () => ({ Component: (await import('./pages/LessonPage')).LessonPage }),
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
