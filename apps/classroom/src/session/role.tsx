import { createContext, type ReactNode, useContext } from 'react';

/** Papéis do cadastro único de usuários (spec 008, RF-01). */
export type UserRole = 'student' | 'instructor' | 'manager' | 'admin';

/** Equipe: todo papel diferente de `student` (spec 008). */
export function isStaff(role: UserRole | null): boolean {
  return role === 'instructor' || role === 'manager' || role === 'admin';
}

// A sessão chega na Fase 1; até lá não há usuário e o papel é sempre `null` em produção.
// Quando `GET /api/v1/session` existir, `useSessionRole` passa a ler o papel dela.
const SessionRoleContext = createContext<UserRole | null>(null);

/** Entrega o papel do usuário da sessão à árvore. Hoje só os testes usam. */
export function SessionRoleProvider({
  role,
  children,
}: {
  role: UserRole | null;
  children: ReactNode;
}) {
  return <SessionRoleContext.Provider value={role}>{children}</SessionRoleContext.Provider>;
}

/** Papel do usuário da sessão; `null` para visitante. */
export function useSessionRole(): UserRole | null {
  return useContext(SessionRoleContext);
}
