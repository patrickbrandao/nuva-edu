import type { AdminClient } from '@nuva-edu/api-client/admin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../../api/client';

export const forumKey = ['forum-admin'] as const;

export function forumBody<T>(data: T | undefined): T {
  if (data === undefined) throw new Error('Resposta do fórum sem corpo.');
  return data;
}

export function useForumAction() {
  const api = useApi();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (action: (client: AdminClient) => Promise<unknown>) => action(api),
    onSuccess: () => cache.invalidateQueries({ queryKey: forumKey }),
  });
}

export const adminTopicPath = (id: string) => `/forum/t/${encodeURIComponent(id)}`;
export const reportPath = (type: string, id: string) =>
  `/denuncias/${type}/${encodeURIComponent(id)}`;
