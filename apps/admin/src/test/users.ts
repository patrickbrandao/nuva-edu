import type { AdminSchemas } from '@nuva-edu/api-client/admin';

export const STUDENT_ID = '0193a5b2-0000-7000-8000-0000000000b1';

/** Ficha `UserDetail` de um aluno, como a API devolve. */
export function userDetail(
  overrides: Partial<AdminSchemas['UserDetail']> = {},
): AdminSchemas['UserDetail'] {
  return {
    id: STUDENT_ID,
    name: 'Bia Aluna',
    email: 'bia@aluna.test',
    emailVerified: true,
    role: 'student',
    avatarUrl: null,
    status: 'active',
    createdAt: '2026-10-01T12:00:00Z',
    lastLoginAt: '2026-11-20T09:30:00Z',
    fullName: 'Beatriz Aluna',
    hasPassword: true,
    identities: [
      { provider: 'google', email: 'bia@gmail.test', createdAt: '2026-10-02T12:00:00Z' },
    ],
    suspension: null,
    version: 3,
    ...overrides,
  };
}

/** Item `UserSummary` da lista. */
export function userSummary(
  overrides: Partial<AdminSchemas['UserSummary']> = {},
): AdminSchemas['UserSummary'] {
  const { fullName, hasPassword, identities, suspension, version, ...summary } = userDetail();
  void [fullName, hasPassword, identities, suspension, version];
  return { ...summary, ...overrides };
}
