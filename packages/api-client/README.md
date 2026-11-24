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

- Só `4xx` e `5xx` lançam. `204` volta com `data` `undefined`; `304` (de `getImageVariant` com
  `If-None-Match`) volta como resposta comum: confira `response.status`.
- `Session` existe nos dois contratos com conteúdo diferente: use `AdminSession` ou
  `ClassroomSession` (ou `AdminSchemas['Session']` / `ClassroomSchemas['Session']`).
- `Problem.code` é `string`: a lista de códigos é aberta no contrato. Os códigos de cada operação
  estão na descrição dela (e no comentário do tipo gerado).

Login social: `startOAuth` e as voltas do provedor só respondem `302`. O site **navega** até a
URL; não chama por `fetch` (seguiria o redirecionamento até o provedor e falharia por CORS):

```ts
import { classroomOAuthStartUrl } from '@nuva-edu/api-client/classroom';

window.location.assign(classroomOAuthStartUrl('google', { intent: 'link', returnTo: '/conta' }));
// admin: adminOAuthStartUrl('google', { returnTo: '/' }) — sem `intent`
```

Envio de imagem (`uploadImage`, `multipart/form-data`). O contrato declara `file` como `string`
com `contentMediaType`, e o tipo gerado fica `string`; use o auxiliar, que recebe `File`/`Blob`
e monta o `FormData` (o `fetch` põe o `Content-Type` com o `boundary`):

```ts
import { uploadImage } from '@nuva-edu/api-client/classroom';

const { data: image } = await uploadImage(api, file, 'avatar'); // ClassroomSchemas['Image']
```

As variantes (`/api/v1/images/{imageId}/{variant}.webp`) são para `<img src>`; os campos
`avatarUrl` e `logoUrl` já trazem esse caminho.

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
- `test:files` (`vitest run`): usado pelo `pnpm verify:quick` para rodar só os testes ligados à
  mudança; `test` encadeia o `check` e por isso não aceita a lista de arquivos.

O `typescript` 5 nas dependências de desenvolvimento existe só para o `openapi-typescript`, que usa
a API de compilador que o TypeScript 7 não tem. A checagem de tipos do pacote usa o TypeScript 7 da
raiz.
