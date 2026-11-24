// Papéis (spec 008, "Papéis"). `users.role` guarda um destes quatro valores (CHECK no banco).

/** Os quatro papéis, do menor para o maior poder. */
export const ROLES = ['student', 'instructor', 'manager', 'admin'] as const;

export type Role = (typeof ROLES)[number];

/** Papéis da equipe: entram no site admin e aparecem com o selo "Equipe" no classroom. */
export const STAFF_ROLES = ['instructor', 'manager', 'admin'] as const satisfies readonly Role[];

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isStaffRole(role: Role): role is StaffRole {
  return role !== 'student';
}
