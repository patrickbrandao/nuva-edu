import { isApiError } from '@nuva-edu/api-client/admin';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SESSION_KEY } from '../session/session';

export type ActionResult<R> = { ok: true; data: R } | { ok: false; error: unknown };

/**
 * Escrita de uma tela, com o estado só no componente que a chama: nada vai para o cache de
 * mutações do TanStack Query. É o que se usa quando o corpo ou a resposta têm senha (a do admin,
 * a nova do usuário, a exibida), que não pode ficar em estado global (ADR 0002, spec 007).
 * Um `401` confere a sessão de novo, como as leituras.
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: A): Promise<ActionResult<R>> => {
      setBusy(true);
      setError(null);
      try {
        const data = await latest.current(...args);
        return { ok: true, data };
      } catch (caught) {
        if (isApiError(caught) && caught.status === 401) {
          void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
        }
        if (mounted.current) setError(caught);
        return { ok: false, error: caught };
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [queryClient],
  );

  const reset = useCallback(() => setError(null), []);
  return { busy, error, run, reset };
}
