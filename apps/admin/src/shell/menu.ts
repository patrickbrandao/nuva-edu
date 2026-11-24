import {
  Activity,
  Award,
  BookOpen,
  CalendarDays,
  Flag,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  type LucideIcon,
  Megaphone,
  MessagesSquare,
  Package,
  Repeat,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Tags,
  TicketPercent,
  Trophy,
  Users,
} from 'lucide-react';

/*
 * Menu lateral do admin, na ordem do mapa de telas da spec 006. Os rótulos vêm das traduções:
 * `menu.groups.<id>` e `menu.items.<id>`. O filtro por papel (RF-10) entra junto com a sessão.
 */
export type MenuGroupId =
  | 'overview'
  | 'people'
  | 'content'
  | 'sales'
  | 'community'
  | 'support'
  | 'system';

export type MenuItemId =
  | 'dashboard'
  | 'students'
  | 'team'
  | 'courses'
  | 'ebooks'
  | 'bundles'
  | 'events'
  | 'news'
  | 'orders'
  | 'subscriptions'
  | 'plans'
  | 'coupons'
  | 'forum'
  | 'reports'
  | 'cases'
  | 'gamification'
  | 'tickets'
  | 'mcpKeys'
  | 'audit'
  | 'operations'
  | 'settings';

export interface MenuItem {
  id: MenuItemId;
  path: string;
  icon: LucideIcon;
}

export interface MenuGroup {
  id: MenuGroupId;
  items: readonly MenuItem[];
}

export const HOME_PATH = '/';
export const LOGIN_PATH = '/entrar';

export const MENU: readonly MenuGroup[] = [
  { id: 'overview', items: [{ id: 'dashboard', path: HOME_PATH, icon: LayoutDashboard }] },
  {
    id: 'people',
    items: [
      { id: 'students', path: '/alunos', icon: Users },
      { id: 'team', path: '/equipe', icon: ShieldCheck },
    ],
  },
  {
    id: 'content',
    items: [
      { id: 'courses', path: '/cursos', icon: GraduationCap },
      { id: 'ebooks', path: '/ebooks', icon: BookOpen },
      { id: 'bundles', path: '/pacotes', icon: Package },
      { id: 'events', path: '/eventos', icon: CalendarDays },
      { id: 'news', path: '/novidades', icon: Megaphone },
    ],
  },
  {
    id: 'sales',
    items: [
      { id: 'orders', path: '/pedidos', icon: ShoppingCart },
      { id: 'subscriptions', path: '/assinaturas', icon: Repeat },
      { id: 'plans', path: '/planos', icon: Tags },
      { id: 'coupons', path: '/cupons', icon: TicketPercent },
    ],
  },
  {
    id: 'community',
    items: [
      { id: 'forum', path: '/forum', icon: MessagesSquare },
      { id: 'reports', path: '/denuncias', icon: Flag },
      { id: 'cases', path: '/cases', icon: Trophy },
      { id: 'gamification', path: '/gamificacao', icon: Award },
    ],
  },
  { id: 'support', items: [{ id: 'tickets', path: '/chamados', icon: LifeBuoy }] },
  {
    id: 'system',
    items: [
      { id: 'mcpKeys', path: '/chaves-mcp', icon: KeyRound },
      { id: 'audit', path: '/auditoria', icon: ScrollText },
      { id: 'operations', path: '/operacao', icon: Activity },
      { id: 'settings', path: '/configuracoes', icon: Settings },
    ],
  },
];

export const MENU_ITEMS: readonly MenuItem[] = MENU.flatMap((group) => group.items);

/** Item do menu a que um endereço pertence: o próprio caminho ou uma tela abaixo dele. */
export function menuItemForPath(pathname: string): MenuItem | undefined {
  return MENU_ITEMS.find((item) =>
    item.path === HOME_PATH
      ? pathname === HOME_PATH
      : pathname === item.path || pathname.startsWith(`${item.path}/`),
  );
}
