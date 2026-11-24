import type { ReactNode } from 'react';
import { ForbiddenState } from '../api/problems';
import { useCan } from './session';

/**
 * Tela que exige uma ação da spec 008. Endereço aberto direto por quem não tem a ação mostra
 * "sem permissão"; a API continua sendo quem decide (spec 006, RF-10).
 */
export function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: ReactNode;
}) {
  const can = useCan();
  return can(permission) ? children : <ForbiddenState />;
}
