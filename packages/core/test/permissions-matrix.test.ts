import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ACTIONS,
  assertCan,
  CLASSROOM_ACTIONS,
  can,
  canDeleteOwnAccount,
  isDomainError,
  isPermissionAction,
  isRole,
  isStaffRole,
  PERMISSION_ACTIONS,
  type PermissionAction,
  type PermissionScope,
  type PermissionUser,
  permissionScope,
  permissionsFor,
  ROLES,
  type Role,
  STAFF_ROLES,
} from '../src/index.ts';

// Cópia das duas matrizes da spec 008, célula por célula (RNF-01), escrita à parte do código para
// que um erro de digitação na matriz do núcleo não passe despercebido.
// ✓ = all · ◐ = own · ? = conditional · — = negado.
type Mark = '✓' | '◐' | '?' | '—';

const MARK: Record<Mark, PermissionScope | null> = {
  '✓': 'all',
  '◐': 'own',
  '?': 'conditional',
  '—': null,
};

// student, instructor, manager, admin
const ADMIN: Record<string, [Mark, Mark, Mark, Mark]> = {
  'admin.access': ['—', '✓', '✓', '✓'],
  'dashboard.view': ['—', '◐', '✓', '✓'],
  'users.list': ['—', '◐', '✓', '✓'],
  'users.view_private': ['—', '—', '✓', '✓'],
  'users.edit': ['—', '—', '✓', '✓'],
  'users.suspend': ['—', '—', '✓', '✓'],
  'users.sessions.revoke': ['—', '—', '✓', '✓'],
  'users.password.view': ['—', '—', '—', '✓'],
  'users.password.set': ['—', '—', '—', '✓'],
  'staff.manage': ['—', '—', '—', '✓'],
  'users.delete': ['—', '—', '—', '✓'],
  'course.create': ['—', '✓', '✓', '✓'],
  'course.edit': ['—', '◐', '✓', '✓'],
  'course.publish': ['—', '◐', '✓', '✓'],
  'course.delete': ['—', '◐', '✓', '✓'],
  'course.delete_with_students': ['—', '—', '—', '✓'],
  'course.set_owner': ['—', '—', '✓', '✓'],
  'ebook_bundle.manage': ['—', '—', '✓', '✓'],
  'ebook.link': ['—', '◐', '✓', '✓'],
  'product.set_access': ['—', '◐', '✓', '✓'],
  'product.set_price': ['—', '—', '—', '✓'],
  'event.manage': ['—', '◐', '✓', '✓'],
  'announcement.publish': ['—', '◐', '✓', '✓'],
  'entitlement.manage': ['—', '—', '✓', '✓'],
  'sales.view': ['—', '—', '✓', '✓'],
  'order.refund': ['—', '—', '—', '✓'],
  'subscription.cancel': ['—', '—', '—', '✓'],
  'plan.manage': ['—', '—', '—', '✓'],
  'coupon.manage': ['—', '—', '—', '✓'],
  'forum.category.manage': ['—', '—', '✓', '✓'],
  'forum.moderate': ['—', '◐', '✓', '✓'],
  'report.handle': ['—', '◐', '✓', '✓'],
  'case.moderate': ['—', '—', '✓', '✓'],
  'badge.award': ['—', '◐', '✓', '✓'],
  'gamification.configure': ['—', '—', '—', '✓'],
  'ticket.handle': ['—', '◐', '✓', '✓'],
  'progress.view': ['—', '◐', '✓', '✓'],
  'certificate.revoke': ['—', '—', '—', '✓'],
  'mcp_key.own': ['—', '—', '✓', '✓'],
  'mcp_key.manage_all': ['—', '—', '—', '✓'],
  'audit.view': ['—', '—', '—', '✓'],
  'ops.manage': ['—', '—', '—', '✓'],
  'settings.manage': ['—', '—', '—', '✓'],
};

// visitante, student, instructor, manager, admin
const CLASSROOM: Record<string, [Mark, Mark, Mark, Mark, Mark]> = {
  'catalog.view': ['✓', '✓', '✓', '✓', '✓'],
  'course.view_program': ['✓', '✓', '✓', '✓', '✓'],
  'lesson.watch_open': ['—', '✓', '✓', '✓', '✓'],
  'lesson.watch_sample': ['—', '✓', '✓', '✓', '✓'],
  'content.access_paid': ['—', '?', '?', '✓', '✓'],
  'purchase.create': ['—', '?', '✓', '✓', '✓'],
  'learning.track': ['—', '?', '?', '?', '?'],
  'forum.course.participate': ['—', '?', '?', '✓', '✓'],
  'forum.free.participate': ['—', '?', '✓', '✓', '✓'],
  'members.view': ['—', '✓', '✓', '✓', '✓'],
  'dm.send': ['—', '?', '✓', '✓', '✓'],
  'case.publish': ['—', '?', '✓', '✓', '✓'],
  'ticket.open': ['—', '✓', '✓', '✓', '✓'],
  'report.create': ['—', '✓', '✓', '✓', '✓'],
  'account.self_service': ['—', '✓', '?', '?', '?'],
};

const userOf = (role: Role, id = `id-${role}`): PermissionUser => ({ id, role });

describe('identificadores das ações', () => {
  it('são os 43 do admin e os 15 do classroom da spec, sem repetição', () => {
    expect([...ADMIN_ACTIONS]).toEqual(Object.keys(ADMIN));
    expect([...CLASSROOM_ACTIONS]).toEqual(Object.keys(CLASSROOM));
    expect(new Set(PERMISSION_ACTIONS).size).toBe(43 + 15);
  });

  it('isPermissionAction reconhece só identificadores da matriz', () => {
    expect(isPermissionAction('users.list')).toBe(true);
    expect(isPermissionAction('users.view')).toBe(false);
    expect(isPermissionAction(42)).toBe(false);
  });
});

describe('papéis', () => {
  it('são quatro, e a equipe são os três acima de student', () => {
    expect(ROLES).toEqual(['student', 'instructor', 'manager', 'admin']);
    expect(STAFF_ROLES).toEqual(['instructor', 'manager', 'admin']);
    expect(ROLES.filter(isStaffRole)).toEqual(STAFF_ROLES);
    expect(isRole('admin')).toBe(true);
    expect(isRole('visitor')).toBe(false);
    expect(isRole(null)).toBe(false);
  });
});

describe('matriz — administração (célula por célula)', () => {
  const cells = Object.entries(ADMIN).flatMap(([action, marks]) =>
    ROLES.map((role, index) => ({ action, role, mark: marks[index] as Mark })),
  );

  it.each(cells)('$role × $action = $mark', ({ action, role, mark }) => {
    const user = userOf(role);
    const id = action as PermissionAction;
    expect(permissionScope(user, id)).toBe(MARK[mark]);
    expect(can(user, id)).toBe(mark !== '—');
    expect(permissionsFor(role).includes(id)).toBe(mark !== '—');
  });

  it('visitante não tem nenhuma ação do admin', () => {
    for (const action of ADMIN_ACTIONS) {
      expect(can(null, action)).toBe(false);
      expect(can(undefined, action)).toBe(false);
    }
  });
});

describe('matriz — classroom (célula por célula)', () => {
  const holders = [null, ...ROLES] as const;
  const cells = Object.entries(CLASSROOM).flatMap(([action, marks]) =>
    holders.map((role, index) => ({
      action,
      role,
      label: role ?? 'visitante',
      mark: marks[index] as Mark,
    })),
  );

  it.each(cells)('$label × $action = $mark', ({ action, role, mark }) => {
    const user = role ? userOf(role) : null;
    const id = action as PermissionAction;
    expect(permissionScope(user, id)).toBe(MARK[mark]);
    expect(can(user, id)).toBe(mark !== '—');
    expect(permissionsFor(role).includes(id)).toBe(mark !== '—');
  });
});

describe('alcance ◐ do instrutor', () => {
  const instructor = userOf('instructor', 'ivo');

  it('sem recurso, permite (o filtro é aplicado na consulta)', () => {
    expect(can(instructor, 'course.edit')).toBe(true);
  });

  it('com recurso, só no curso de que é dono', () => {
    expect(can(instructor, 'course.edit', { courseOwnerId: 'ivo' })).toBe(true);
    expect(can(instructor, 'course.edit', { courseOwnerId: 'outro' })).toBe(false);
    expect(can(instructor, 'course.edit', { courseOwnerId: null })).toBe(false);
  });

  it('manager e admin agem em qualquer curso, inclusive sem dono', () => {
    for (const role of ['manager', 'admin'] as const) {
      expect(can(userOf(role), 'course.edit', { courseOwnerId: 'ivo' })).toBe(true);
      expect(can(userOf(role), 'course.edit', { courseOwnerId: null })).toBe(true);
    }
  });

  it('o recurso não amplia ação negada', () => {
    expect(can(instructor, 'course.set_owner', { courseOwnerId: 'ivo' })).toBe(false);
  });

  it('recusa identificador desconhecido', () => {
    expect(can(userOf('admin'), 'users.view' as PermissionAction)).toBe(false);
  });
});

describe('assertCan', () => {
  const codeOf = (run: () => void): string | undefined => {
    try {
      run();
    } catch (error) {
      return isDomainError(error) ? `${error.status} ${error.code}` : 'outro';
    }
    return undefined;
  };

  it('passa quando pode', () => {
    expect(codeOf(() => assertCan(userOf('manager'), 'entitlement.manage'))).toBeUndefined();
  });

  it('403 permission_denied sem a permissão', () => {
    expect(codeOf(() => assertCan(userOf('manager'), 'order.refund'))).toBe(
      '403 permission_denied',
    );
    expect(codeOf(() => assertCan(null, 'admin.access'))).toBe('403 permission_denied');
  });

  it('404 not_found para curso fora do alcance do instrutor', () => {
    const instructor = userOf('instructor', 'ivo');
    expect(codeOf(() => assertCan(instructor, 'course.edit', { courseOwnerId: 'x' }))).toBe(
      '404 not_found',
    );
  });
});

describe('permissionsFor', () => {
  it('segue a ordem das matrizes e filtra por grupo', () => {
    const all = permissionsFor('manager');
    expect(all).toEqual(PERMISSION_ACTIONS.filter((action) => all.includes(action)));
    expect(
      permissionsFor('manager', 'admin').every((a) => ADMIN_ACTIONS.includes(a as never)),
    ).toBe(true);
    expect(permissionsFor('student', 'admin')).toEqual([]);
    expect(permissionsFor(null, 'classroom')).toEqual(['catalog.view', 'course.view_program']);
    expect(permissionsFor('admin', 'admin')).toEqual([...ADMIN_ACTIONS]);
  });

  it('a lista do instrutor no admin traz as ações ◐ e course.create', () => {
    expect(permissionsFor('instructor', 'admin')).toEqual([
      'admin.access',
      'dashboard.view',
      'users.list',
      'course.create',
      'course.edit',
      'course.publish',
      'course.delete',
      'ebook.link',
      'product.set_access',
      'event.manage',
      'announcement.publish',
      'forum.moderate',
      'report.handle',
      'badge.award',
      'ticket.handle',
      'progress.view',
    ]);
  });
});

describe('exclusão da própria conta', () => {
  it('só student exclui; a equipe só depois de rebaixada', () => {
    expect(ROLES.filter((role) => canDeleteOwnAccount(userOf(role)))).toEqual(['student']);
  });
});

describe('desempenho (RNF-02)', () => {
  it('can acrescenta menos de 5 ms no p95', () => {
    const samples: number[] = [];
    const users = ROLES.map((role) => userOf(role));
    for (let i = 0; i < 2000; i++) {
      const user = users[i % users.length] as PermissionUser;
      const action = PERMISSION_ACTIONS[i % PERMISSION_ACTIONS.length] as PermissionAction;
      const start = performance.now();
      can(user, action, { courseOwnerId: user.id });
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.floor(samples.length * 0.95)] as number;
    expect(p95).toBeLessThan(5);
  });
});

// Lê `x-permission` dos contratos sem alterá-los: valor único, lista em fluxo (`[a, b]`) ou lista
// em bloco (`- a`).
function contractPermissions(path: URL): string[] {
  const lines = readFileSync(path, 'utf8').split('\n');
  const found: string[] = [];
  lines.forEach((line, index) => {
    const match = /^(\s*)x-permission:\s*(.*?)\s*$/.exec(line);
    if (!match) return;
    const indent = (match[1] as string).length;
    const value = (match[2] as string).replace(/\s+#.*$/, '');
    const unquote = (text: string) => text.trim().replace(/^["']|["']$/g, '');
    if (value.startsWith('[')) {
      found.push(...value.slice(1, -1).split(',').map(unquote).filter(Boolean));
    } else if (value !== '') {
      found.push(unquote(value));
    } else {
      for (const next of lines.slice(index + 1)) {
        const item = /^(\s*)-\s*(.+?)\s*$/.exec(next);
        if (!item || (item[1] as string).length < indent) break;
        found.push(unquote(item[2] as string));
      }
    }
  });
  return found;
}

describe('contratos', () => {
  const admin = contractPermissions(
    new URL('../../../apps/admin-api/openapi.yaml', import.meta.url),
  );
  const classroom = contractPermissions(
    new URL('../../../apps/classroom-api/openapi.yaml', import.meta.url),
  );

  it('o contrato do admin declara x-permission', () => {
    expect(admin.length).toBeGreaterThan(0);
  });

  it.each([...new Set([...admin, ...classroom])])('x-permission %s existe na matriz', (action) => {
    expect(isPermissionAction(action)).toBe(true);
  });
});
