# @nuva-edu/api-client

Tipos e clientes HTTP das duas APIs, gerados dos contratos `apps/admin-api/openapi.yaml` e
`apps/classroom-api/openapi.yaml`. Os sites não escrevem URL de API à mão (spec 006, RF-02).

## Uso

```ts
import { createAdminClient, isApiError } from '@nuva-edu/api-client/admin';

const api = createAdminClient({ csrfToken: () => session.csrfToken });

try {
  const { data: meta } = await api.GET('/api/v1/meta'); // AdminSchemas['Meta'] | undefined
} catch (error) {
  if (isApiError(error) && error.code === 'database_unavailable') {
    // error.status, error.problem, error.requestId, error.retryAfter, error.fieldErrors
  }
}
```

- Entradas: `@nuva-edu/api-client/admin`, `@nuva-edu/api-client/classroom` e a raiz (tudo).
- Chamadas na própria origem da página, com o cookie de sessão (`credentials: 'include'`).
- Resposta fora de 2xx lança `ApiError` com o problem+json; falha de rede lança `ApiNetworkError`.
- `X-CSRF-Token` é preenchido em requisições que alteram dados, a partir de `csrfToken`.

Fluxo SSE do classroom:

```ts
import { openClassroomStream } from '@nuva-edu/api-client/classroom';

const stream = openClassroomStream({
  onEvent(event) {
    if (event.event === 'notification.created') updateBadge(event.data.unreadCount);
  },
  onError: ({ closed }) => closed && goToLogin(),
});
stream.close();
```

## Geração

`src/generated` é gerado com `openapi-typescript` e commitado. Não edite à mão.

- `pnpm --filter @nuva-edu/api-client generate`: regenera a partir dos contratos.
- `pnpm --filter @nuva-edu/api-client check`: regenera em memória e falha se o commitado estiver
  diferente. Roda dentro de `test`.

O `typescript` 5 nas dependências de desenvolvimento existe só para o `openapi-typescript`, que usa
a API de compilador que o TypeScript 7 não tem. A checagem de tipos do pacote usa o TypeScript 7 da
raiz.
