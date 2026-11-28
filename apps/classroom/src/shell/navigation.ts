import type { ParseKeys } from 'i18next';
import {
  BadgeCheck,
  Bell,
  BookOpen,
  CalendarDays,
  FolderOpen,
  GraduationCap,
  House,
  LifeBuoy,
  type LucideIcon,
  Mail,
  Medal,
  Megaphone,
  MessagesSquare,
  NotebookPen,
  Receipt,
  Settings,
  ShoppingBasket,
  Store,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react';

/** Chave de texto nos arquivos de tradução; o compilador confere que existe. */
export type TextKey = ParseKeys;

export interface NavItem {
  id: string;
  /** Rota em português, como no mapa de telas da spec 006. */
  path: string;
  labelKey: TextKey;
  icon: LucideIcon;
  /** Marca o item como atual só no endereço exato (há rotas filhas com item próprio). */
  end?: boolean;
}

export interface NavGroup {
  id: string;
  labelKey: TextKey;
  items: readonly NavItem[];
}

/** Central de notificações do aluno (spec 024). */
export const NOTIFICATIONS_PATH = '/notificacoes';
/** Preferências de notificação dentro das configurações da conta (spec 006, `/conta/*`). */
export const NOTIFICATION_PREFS_PATH = '/conta/notificacoes';
/** Descadastro de um grupo de e-mail pelo token do link (spec 024, RF-07); público. */
export const UNSUBSCRIBE_PATH = '/descadastro';

/** Menu do classroom: os grupos e as telas de entrada do mapa da spec 006. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'explore',
    labelKey: 'menu.groups.explore',
    items: [
      { id: 'showcase', path: '/', labelKey: 'menu.items.showcase', icon: Store, end: true },
      { id: 'plans', path: '/planos', labelKey: 'menu.items.plans', icon: BadgeCheck },
      { id: 'cases', path: '/cases', labelKey: 'menu.items.cases', icon: Trophy, end: true },
    ],
  },
  {
    id: 'learning',
    labelKey: 'menu.groups.learning',
    items: [
      { id: 'start', path: '/inicio', labelKey: 'menu.items.start', icon: House },
      {
        id: 'myCourses',
        path: '/meus-cursos',
        labelKey: 'menu.items.myCourses',
        icon: GraduationCap,
      },
      { id: 'myEbooks', path: '/meus-ebooks', labelKey: 'menu.items.myEbooks', icon: BookOpen },
      { id: 'calendar', path: '/calendario', labelKey: 'menu.items.calendar', icon: CalendarDays },
      { id: 'notes', path: '/anotacoes', labelKey: 'menu.items.notes', icon: NotebookPen },
      { id: 'progress', path: '/progresso', labelKey: 'menu.items.progress', icon: TrendingUp },
    ],
  },
  {
    id: 'community',
    labelKey: 'menu.groups.community',
    items: [
      { id: 'forum', path: '/forum', labelKey: 'menu.items.forum', icon: MessagesSquare },
      { id: 'members', path: '/membros', labelKey: 'menu.items.members', icon: Users },
      { id: 'ranking', path: '/ranking', labelKey: 'menu.items.ranking', icon: Medal },
      { id: 'myCases', path: '/cases/meus', labelKey: 'menu.items.myCases', icon: FolderOpen },
    ],
  },
  {
    id: 'communication',
    labelKey: 'menu.groups.communication',
    items: [{ id: 'messages', path: '/mensagens', labelKey: 'menu.items.messages', icon: Mail }],
  },
  {
    id: 'purchase',
    labelKey: 'menu.groups.purchase',
    items: [{ id: 'cart', path: '/cesta', labelKey: 'menu.items.cart', icon: ShoppingBasket }],
  },
  {
    id: 'account',
    labelKey: 'menu.groups.account',
    items: [
      {
        id: 'purchases',
        path: '/conta/compras',
        labelKey: 'menu.items.purchases',
        icon: Receipt,
      },
      { id: 'news', path: '/novidades', labelKey: 'menu.items.news', icon: Megaphone },
      {
        id: 'notifications',
        path: NOTIFICATIONS_PATH,
        labelKey: 'menu.items.notifications',
        icon: Bell,
      },
      { id: 'support', path: '/suporte', labelKey: 'menu.items.support', icon: LifeBuoy },
      {
        id: 'settings',
        path: '/conta',
        labelKey: 'menu.items.settings',
        icon: Settings,
        end: true,
      },
    ],
  },
];

/** Endereço da vitrine, raiz da trilha de navegação. */
export const HOME_PATH = '/';
/** Configurações da conta (tem rota própria). */
export const ACCOUNT_PATH = '/conta';
/** Endereço da tela de login. */
export const LOGIN_PATH = '/entrar';
/** Entrada do aluno, estante, ebooks, progresso e anotações (têm rota própria). */
export const START_PATH = '/inicio';
export const MY_COURSES_PATH = '/meus-cursos';
export const MY_EBOOKS_PATH = '/meus-ebooks';
export const PROGRESS_PATH = '/progresso';
export const NOTES_PATH = '/anotacoes';
/** Planos de assinatura (spec 006, mapa de telas; spec 012). */
export const PLANS_PATH = '/planos';
/** Assinaturas do aluno dentro de "Minhas compras", com o detalhe de cada uma. */
export const SUBSCRIPTIONS_PATH = '/conta/compras/assinaturas';
/** Compra (spec 006, mapa de telas): cesta, checkout, retorno do pagamento e minhas compras. */
export const CART_PATH = '/cesta';
export const CHECKOUT_PATH = '/checkout';
export const ORDER_PATH = '/pedidos';
export const PURCHASES_PATH = '/conta/compras';

/** Telas do menu que já foram construídas. */
const BUILT_PAGES: readonly string[] = [
  HOME_PATH,
  ACCOUNT_PATH,
  START_PATH,
  MY_COURSES_PATH,
  MY_EBOOKS_PATH,
  PROGRESS_PATH,
  NOTES_PATH,
  PLANS_PATH,
  CART_PATH,
  PURCHASES_PATH,
  NOTIFICATIONS_PATH,
  '/forum',
];

/**
 * Telas do mapa que ainda não foram construídas: abrem a página "em construção" com o nome
 * legível. As do menu saem de NAV_GROUPS; as demais são citadas por links do site.
 */
export const PENDING_PAGES: readonly { path: string; titleKey: TextKey }[] = [
  ...NAV_GROUPS.flatMap((group) => group.items)
    .filter((item) => !BUILT_PAGES.includes(item.path))
    .map((item) => ({ path: item.path, titleKey: item.labelKey })),
];
