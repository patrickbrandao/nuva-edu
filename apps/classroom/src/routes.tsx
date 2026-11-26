import type { RouteObject } from 'react-router';
import { CERTIFICATES_PATH } from './certificates/certificates';
import { ErrorPage } from './pages/ErrorPage';
import { HomePage } from './pages/HomePage';
import {
  ACCOUNT_PATH,
  CART_PATH,
  CHECKOUT_PATH,
  HOME_PATH,
  LOGIN_PATH,
  MY_COURSES_PATH,
  MY_EBOOKS_PATH,
  NOTES_PATH,
  ORDER_PATH,
  PENDING_PAGES,
  PROGRESS_PATH,
  PURCHASES_PATH,
  START_PATH,
} from './shell/navigation';
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
        path: START_PATH,
        handle: handle({ titleKey: 'menu.items.start' }),
        lazy: async () => ({ Component: (await import('./pages/StartPage')).StartPage }),
      },
      {
        path: MY_COURSES_PATH,
        handle: handle({ titleKey: 'menu.items.myCourses' }),
        lazy: async () => ({ Component: (await import('./pages/MyCoursesPage')).MyCoursesPage }),
      },
      {
        path: MY_EBOOKS_PATH,
        handle: handle({ titleKey: 'menu.items.myEbooks' }),
        lazy: async () => ({ Component: (await import('./pages/MyEbooksPage')).MyEbooksPage }),
      },
      {
        path: PROGRESS_PATH,
        handle: handle({ titleKey: 'menu.items.progress' }),
        lazy: async () => ({ Component: (await import('./pages/ProgressPage')).ProgressPage }),
      },
      {
        path: NOTES_PATH,
        handle: handle({ titleKey: 'menu.items.notes' }),
        lazy: async () => ({ Component: (await import('./pages/NotesPage')).NotesPage }),
      },
      {
        path: CART_PATH,
        handle: handle({ titleKey: 'sales.cart.title' }),
        lazy: async () => ({ Component: (await import('./sales/CartPage')).CartPage }),
      },
      {
        path: CHECKOUT_PATH,
        handle: handle({ titleKey: 'sales.checkout.title' }),
        lazy: async () => ({ Component: (await import('./sales/CheckoutPage')).CheckoutPage }),
      },
      {
        path: `${ORDER_PATH}/:id`,
        handle: handle({ titleKey: 'sales.order.title' }),
        lazy: async () => ({ Component: (await import('./sales/OrderPage')).OrderPage }),
      },
      {
        path: PURCHASES_PATH,
        handle: handle({ titleKey: 'sales.orders.title' }),
        lazy: async () => ({
          Component: (await import('./sales/PurchasesPage')).PurchasesPage,
        }),
      },
      {
        path: CERTIFICATES_PATH,
        handle: handle({ titleKey: 'pages.certificates' }),
        lazy: async () => ({
          Component: (await import('./pages/CertificateValidationPage')).CertificateValidationPage,
        }),
      },
      {
        path: `${CERTIFICATES_PATH}/:codigo`,
        handle: handle({ titleKey: 'pages.certificates' }),
        lazy: async () => ({
          Component: (await import('./pages/CertificateValidationPage')).CertificateValidationPage,
        }),
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
