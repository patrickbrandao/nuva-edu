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
        path: '/notificacoes',
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
/** Entrada do aluno, estante, ebooks e progresso (têm rota própria). */
export const START_PATH = '/inicio';
export const MY_COURSES_PATH = '/meus-cursos';
export const MY_EBOOKS_PATH = '/meus-ebooks';
export const PROGRESS_PATH = '/progresso';

/** Telas do menu que já foram construídas. */
const BUILT_PAGES: readonly string[] = [
  HOME_PATH,
  ACCOUNT_PATH,
  START_PATH,
  MY_COURSES_PATH,
  MY_EBOOKS_PATH,
  PROGRESS_PATH,
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
