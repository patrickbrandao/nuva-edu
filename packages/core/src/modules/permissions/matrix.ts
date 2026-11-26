// Matriz de permissões (spec 008, "Matriz — administração" e "Matriz — classroom"), checada aqui
// uma única vez (RF-02) pela `admin-api`, pela `classroom-api`, pelo `worker` e pelo MCP.

import { notFound, permissionDenied } from '../../errors/domain-error.ts';
import {
  ADMIN_ACTIONS,
  type AdminAction,
  CLASSROOM_ACTIONS,
  type ClassroomAction,
  isPermissionAction,
  PERMISSION_ACTIONS,
  type PermissionAction,
} from './actions.ts';
import type { Role } from './roles.ts';

/**
 * Alcance de uma ação para um papel:
 *
 * - `all`: permitido sem restrição (✓);
 * - `own`: só nos próprios cursos (◐ do `instructor`, "Regra do instrutor"); o filtro pelo dono é
 *   aplicado na consulta, e recurso de outro curso responde `404`;
 * - `conditional`: depende de estado fora do papel (direito de acesso, acesso ao curso, e-mail
 *   confirmado, público da categoria, acesso ativo), conferido pelo módulo dono dessa condição.
 *
 * `null` é negado (—).
 */
export type PermissionScope = 'all' | 'own' | 'conditional';

/** Quem pede: o usuário da sessão (ou o emissor da chave MCP), ou `null` para o visitante. */
export interface PermissionUser {
  readonly id: string;
  readonly role: Role;
}

/**
 * Recurso de uma ação ◐: o curso a que ele pertence (o próprio curso, módulo, aula, tópico do
 * fórum do curso, aluno do curso...). `courseOwnerId` nulo é curso sem dono, gerido só por
 * `manager` e `admin`. O filtro por curso entra na Fase 2; o parâmetro já é aceito.
 */
export interface PermissionResource {
  readonly courseOwnerId: string | null;
}

type Cell = PermissionScope | null;

const A = 'all';
const O = 'own';
const C = 'conditional';
const N = null;

/** Colunas: `student`, `instructor`, `manager`, `admin`. */
const ADMIN_MATRIX: Readonly<Record<AdminAction, readonly [Cell, Cell, Cell, Cell]>> = {
  'admin.access': [N, A, A, A],
  'dashboard.view': [N, O, A, A],
  'users.list': [N, O, A, A],
  'users.view_private': [N, N, A, A],
  'users.edit': [N, N, A, A],
  'users.suspend': [N, N, A, A],
  'users.sessions.revoke': [N, N, A, A],
  'users.password.view': [N, N, N, A],
  'users.password.set': [N, N, N, A],
  'staff.manage': [N, N, N, A],
  'users.delete': [N, N, N, A],
  'course.create': [N, A, A, A],
  'course.edit': [N, O, A, A],
  // Instrutor publica só curso próprio `open`; `paid` e `private` são de gerente ou admin.
  'course.publish': [N, O, A, A],
  'course.delete': [N, O, A, A],
  // Arquivar e desarquivar curso, ebook e pacote (spec 009): ninguém exclui produto com vínculos.
  'product.archive': [N, N, N, A],
  'course.set_owner': [N, N, A, A],
  'ebook_bundle.manage': [N, N, A, A],
  'ebook.link': [N, O, A, A],
  // Instrutor define só a amostra grátis dos próprios cursos; o modo de acesso, não.
  'product.set_access': [N, O, A, A],
  'product.set_price': [N, N, N, A],
  'event.manage': [N, O, A, A],
  'announcement.publish': [N, O, A, A],
  'entitlement.manage': [N, N, A, A],
  'sales.view': [N, N, A, A],
  // Exportação CSV de vendas: só `admin`; o gerente recebe `403` auditado (specs 008 e 011).
  'sales.export': [N, N, N, A],
  'order.refund': [N, N, N, A],
  'subscription.cancel': [N, N, N, A],
  'plan.manage': [N, N, N, A],
  'coupon.manage': [N, N, N, A],
  'forum.category.manage': [N, N, A, A],
  'forum.moderate': [N, O, A, A],
  'report.handle': [N, O, A, A],
  'case.moderate': [N, N, A, A],
  'badge.award': [N, O, A, A],
  'gamification.configure': [N, N, N, A],
  'ticket.handle': [N, O, A, A],
  'progress.view': [N, O, A, A],
  // Emissão manual e reemissão (spec 015).
  'certificate.issue': [N, N, A, A],
  'certificate.revoke': [N, N, N, A],
  // Template do curso e PDF de exemplo; o padrão da escola é de `settings.manage`.
  'certificate.template.edit': [N, O, A, A],
  'mcp_key.own': [N, N, A, A],
  'mcp_key.manage_all': [N, N, N, A],
  'audit.view': [N, N, N, A],
  'ops.manage': [N, N, N, A],
  'settings.manage': [N, N, N, A],
};

/** Colunas: visitante, `student`, `instructor`, `manager`, `admin` (as três últimas são a Equipe). */
const CLASSROOM_MATRIX: Readonly<Record<ClassroomAction, readonly [Cell, Cell, Cell, Cell, Cell]>> =
  {
    'catalog.view': [A, A, A, A, A],
    'course.view_program': [A, A, A, A, A],
    'lesson.watch_open': [N, A, A, A, A],
    'lesson.watch_sample': [N, A, A, A, A],
    // Aluno: com direito (spec 010). Instrutor: nos próprios cursos, e nos demais com direito.
    'content.access_paid': [N, C, C, A, A],
    // Aluno: com e-mail confirmado.
    'purchase.create': [N, C, A, A, A],
    // Com acesso ao curso, igual para a equipe.
    'learning.track': [N, C, C, C, C],
    // Aluno: com acesso ao curso. Instrutor: os próprios e os que tiver direito.
    'forum.course.participate': [N, C, C, A, A],
    // Aluno: conforme o público da categoria (spec 017).
    'forum.free.participate': [N, C, A, A, A],
    'members.view': [N, A, A, A, A],
    // Aluno: com acesso ativo (spec 021).
    'dm.send': [N, C, A, A, A],
    // Aluno: com e-mail confirmado.
    'case.publish': [N, C, A, A, A],
    'ticket.open': [N, A, A, A, A],
    'report.create': [N, A, A, A, A],
    // Equipe exporta os dados, mas só exclui a conta depois de rebaixada a `student` (spec 030):
    // veja `canDeleteOwnAccount`.
    'account.self_service': [N, A, C, C, C],
  };

const ADMIN_COLUMN: Readonly<Record<Role, 0 | 1 | 2 | 3>> = {
  student: 0,
  instructor: 1,
  manager: 2,
  admin: 3,
};

type Holder = Role | 'visitor';

const SCOPES: ReadonlyMap<Holder, ReadonlyMap<string, PermissionScope>> = buildScopes();

function buildScopes(): Map<Holder, Map<string, PermissionScope>> {
  const holders: Holder[] = ['visitor', 'student', 'instructor', 'manager', 'admin'];
  const scopes = new Map<Holder, Map<string, PermissionScope>>(
    holders.map((holder) => [holder, new Map()]),
  );
  for (const action of ADMIN_ACTIONS) {
    for (const role of ['student', 'instructor', 'manager', 'admin'] as const) {
      const cell = ADMIN_MATRIX[action][ADMIN_COLUMN[role]];
      if (cell) scopes.get(role)?.set(action, cell);
    }
  }
  for (const action of CLASSROOM_ACTIONS) {
    CLASSROOM_MATRIX[action].forEach((cell, index) => {
      const holder = holders[index] as Holder;
      if (cell) scopes.get(holder)?.set(action, cell);
    });
  }
  return scopes;
}

function holderOf(user: PermissionUser | null | undefined): Holder {
  return user ? user.role : 'visitor';
}

/**
 * Alcance da ação para quem pede (`null` = negado). A rota usa para decidir se aplica o filtro de
 * curso (`own`) ou se exige alcance total: na Fase 1, `GET /users` exige `users.list` com `all`.
 */
export function permissionScope(
  user: PermissionUser | null | undefined,
  action: PermissionAction,
): PermissionScope | null {
  return SCOPES.get(holderOf(user))?.get(action) ?? null;
}

/**
 * Pode fazer a ação? (spec 008, RF-02.) Avalia o papel atual, a cada chamada (RF-07).
 *
 * - Ação negada ao papel, ou identificador desconhecido: `false`.
 * - Alcance `own` com `resource`: só se `user` é o dono do curso (curso sem dono: `false`). Sem
 *   `resource`, `true`: a permissão é parcial e o filtro vai na consulta.
 * - Alcance `conditional`: `true` pelo papel; a condição (direito, e-mail confirmado...) é do
 *   módulo dono dela.
 */
export function can(
  user: PermissionUser | null | undefined,
  action: PermissionAction,
  resource?: PermissionResource,
): boolean {
  if (!isPermissionAction(action)) return false;
  const scope = permissionScope(user, action);
  if (scope === null) return false;
  if (scope === 'own' && resource !== undefined) {
    return user != null && resource.courseOwnerId === user.id;
  }
  return true;
}

/**
 * Como `can`, mas lança o erro da spec 008 ("Casos de erro"): `403` `permission_denied` sem a
 * permissão; `404` `not_found` para recurso fora do alcance do instrutor.
 */
export function assertCan(
  user: PermissionUser | null | undefined,
  action: PermissionAction,
  resource?: PermissionResource,
): void {
  if (can(user, action, resource)) return;
  if (permissionScope(user, action) === 'own') throw notFound();
  throw permissionDenied();
}

/** Grupo de ações: as da matriz de administração ou as do classroom. */
export type PermissionGroup = 'admin' | 'classroom';

/**
 * Lista devolvida em `Session.permissions` (`GET /api/v1/session`), na ordem das matrizes. Inclui
 * as ações ◐ e as condicionais, que o papel tem em parte. `group` restringe a uma das matrizes;
 * `null` é o visitante.
 */
export function permissionsFor(role: Role | null, group?: PermissionGroup): PermissionAction[] {
  const scopes = SCOPES.get(role ?? 'visitor');
  const actions: readonly PermissionAction[] =
    group === 'admin'
      ? ADMIN_ACTIONS
      : group === 'classroom'
        ? CLASSROOM_ACTIONS
        : PERMISSION_ACTIONS;
  return actions.filter((action) => scopes?.has(action));
}

/**
 * Exclusão da própria conta (`account.self_service`, spec 030): o aluno exclui; a equipe só
 * depois de o admin rebaixar a conta a `student`.
 */
export function canDeleteOwnAccount(user: PermissionUser): boolean {
  return user.role === 'student';
}
