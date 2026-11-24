import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useApi } from '../api/client';
import { SESSION_KEY, storeSession } from '../api/query';
import { HOME_PATH } from '../shell/navigation';

/**
 * "Sair" (`POST /api/v1/auth/logout`). Deu certo, ou a sessão já não existia (`401`): apaga a
 * sessão guardada e volta à vitrine. Outra falha: pede a sessão de novo ao servidor, que diz se
 * ela continua aberta.
 */
export function useSignOut() {
  const api = useApi();
  const client = useQueryClient();
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: async () => {
      await api.POST('/api/v1/auth/logout');
    },
    onSuccess: () => {
      storeSession(client, null);
      client.removeQueries({ predicate: (query) => query.queryKey[0] === 'account' });
      navigate(HOME_PATH);
    },
    onError: () => client.invalidateQueries({ queryKey: SESSION_KEY }),
  });
  return {
    signOut: () => mutation.mutateAsync().catch(() => undefined),
    pending: mutation.isPending,
  };
}
