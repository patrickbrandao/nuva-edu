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
 * `menu.groups.<id>` e `menu.items.<id>`. Cada item aparece só para quem tem a ação `permission`
 * (spec 006, RF-10; identificadores de `x-permission` da spec 008) na lista `permissions` da sessão.
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
  /** Ação da spec 008 exigida para ver o item e abrir a tela. */
  permission: string;
}

export interface MenuGroup {
  id: MenuGroupId;
  items: readonly MenuItem[];
}

export const HOME_PATH = '/';
export const LOGIN_PATH = '/entrar';

export const MENU: readonly MenuGroup[] = [
  {
    id: 'overview',
    items: [
      { id: 'dashboard', path: HOME_PATH, icon: LayoutDashboard, permission: 'dashboard.view' },
    ],
  },
  {
    id: 'people',
    items: [
      {
        id: 'students',
        path: '/alunos',
        icon: Users,
        // `users.list` do instrutor é parcial (◐, alunos dos seus cursos, nas rotas do curso): a
        // lista geral é de quem vê os dados do aluno, como no mapa de telas da spec 006.
        permission: 'users.view_private',
      },
      { id: 'team', path: '/equipe', icon: ShieldCheck, permission: 'staff.manage' },
    ],
  },
  {
    id: 'content',
    items: [
      { id: 'courses', path: '/cursos', icon: GraduationCap, permission: 'course.edit' },
      { id: 'ebooks', path: '/ebooks', icon: BookOpen, permission: 'ebook_bundle.manage' },
      { id: 'bundles', path: '/pacotes', icon: Package, permission: 'ebook_bundle.manage' },
      { id: 'events', path: '/eventos', icon: CalendarDays, permission: 'event.manage' },
      { id: 'news', path: '/novidades', icon: Megaphone, permission: 'announcement.publish' },
    ],
  },
  {
    id: 'sales',
    items: [
      { id: 'orders', path: '/pedidos', icon: ShoppingCart, permission: 'sales.view' },
      { id: 'subscriptions', path: '/assinaturas', icon: Repeat, permission: 'sales.view' },
      { id: 'plans', path: '/planos', icon: Tags, permission: 'plan.manage' },
      { id: 'coupons', path: '/cupons', icon: TicketPercent, permission: 'coupon.manage' },
    ],
  },
  {
    id: 'community',
    items: [
      { id: 'forum', path: '/forum', icon: MessagesSquare, permission: 'forum.moderate' },
      { id: 'reports', path: '/denuncias', icon: Flag, permission: 'report.handle' },
      { id: 'cases', path: '/cases', icon: Trophy, permission: 'case.moderate' },
      { id: 'gamification', path: '/gamificacao', icon: Award, permission: 'badge.award' },
    ],
  },
  {
    id: 'support',
    items: [{ id: 'tickets', path: '/chamados', icon: LifeBuoy, permission: 'ticket.handle' }],
  },
  {
    id: 'system',
    items: [
      { id: 'mcpKeys', path: '/chaves-mcp', icon: KeyRound, permission: 'mcp_key.own' },
      { id: 'audit', path: '/auditoria', icon: ScrollText, permission: 'audit.view' },
      { id: 'operations', path: '/operacao', icon: Activity, permission: 'ops.manage' },
      { id: 'settings', path: '/configuracoes', icon: Settings, permission: 'settings.manage' },
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

/** Grupos com só os itens que a lista de ações permite; grupo vazio some. */
export function menuFor(permissions: readonly string[]): MenuGroup[] {
  const allowed = new Set(permissions);
  return MENU.map((group) => ({
    ...group,
    items: group.items.filter((item) => allowed.has(item.permission)),
  })).filter((group) => group.items.length > 0);
}
