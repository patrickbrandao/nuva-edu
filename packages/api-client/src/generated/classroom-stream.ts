// ARQUIVO GERADO. Não edite à mão.
// Origem: apps/classroom-api/openapi.yaml
// Para atualizar: pnpm --filter @nuva-edu/api-client generate

/** Nomes de evento do fluxo SSE (discriminador de `StreamEvent`). */
export const streamEventNames = [
  "dm.message.created",
  "dm.message.read",
  "dm.message.deleted",
  "notification.created",
  "forum.post.created",
  "announcement.published",
  "presence",
  "ping",
] as const;
