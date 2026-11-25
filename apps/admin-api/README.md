# apps/admin-api

API do site de administração (`@nuva-edu/admin-api`), descrita em `openapi.yaml` e em `specs/003-admin-api.md`. Dono: papel `api-admin`; o `openapi.yaml` é do `arquiteto` e aqui só é lido.

| Caminho | Conteúdo |
| --- | --- |
| `openapi.yaml` | Contrato (não edite: peça a mudança ao `arquiteto`) |
| `src/main.ts` | Entrada do processo: configuração, banco, subida e encerramento |
| `src/app.ts` | `buildAdminApp`: a API montada sobre `@nuva-edu/api-kit` |
| `src/contract.ts` | Caminho do contrato e exceções de CSRF |
| `src/check-contract.ts` | Comando `check-contract`: rotas x contrato, sem banco e sem porta |
| `src/session.ts` | Tratadores de `sessionCookie` e `csrfToken`, renovação e remoção do cookie, limites de taxa e auditoria da negação |
| `src/initial-admin.ts` | Admin inicial na subida (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) |
| `src/create-admin.ts` | Comando de emergência `create-admin` |
| `src/routes/` | Uma função `register...Routes` por grupo de rotas (`auth.ts`: login, saída e sessão; `images.ts`: envio da capa, exclusão e entrega; `courses.ts`: cursos, módulos, aulas e links; o `/meta` vem do `api-kit`) |
| `test/` | Integração (requisições injetadas, banco de teste) |
| `test/contract/` | Teste de contrato: rotas x `openapi.yaml`, regra do `csrfToken` e respostas de erro declaradas |

Aqui fica só transporte, validação e autorização; regra de negócio e acesso a dados ficam em `packages/core`. A base HTTP (validação pelo contrato, problem+json, id de requisição, IP real, sondas, métricas) vem de `packages/api-kit`.

## Rodar

```bash
pnpm --filter @nuva-edu/admin-api dev     # lê .env e .env.local da raiz; reinicia ao salvar
pnpm --filter @nuva-edu/admin-api start   # usa só as variáveis do ambiente (contêiner)
```

Escuta na porta 3000 (spec 031); `PORT` troca a porta fora do contêiner. Precisa do Postgres no ar e migrado (`pnpm db:migrate up`); sem isso o serviço sobe, mas `/readyz` responde `503`.

| Rota | O que faz |
| --- | --- |
| `GET /healthz` | Processo vivo; não toca no banco |
| `GET /readyz` | `200` com banco no ar e migrations em dia; senão `503` |
| `GET /metrics` | Texto do Prometheus (inclui `db_pool_connections{state}`: `active`, `idle`, `waiting`); fora do contrato, só rede interna |
| `GET /api/v1/meta` | Dados públicos da instalação e da marca da escola (`settings`), sem sessão; rota comum do `api-kit` (`registerMetaRoute`) |
| `POST /api/v1/auth/login` | Login da equipe por senha; grava `nuva_admin_session` (`student`: `403 staff_only`) |
| `POST /api/v1/auth/logout` | Encerra a sessão atual e apaga o cookie (exige `X-CSRF-Token`) |
| `GET /api/v1/session` | Dono da sessão, token CSRF e ações permitidas (`no-store`) |
| `GET /api/v1/images/{id}/{largura}.webp` | Entrega pública de uma variante, com `ETag` e `304` |
| `POST /api/v1/images`, `DELETE /api/v1/images/{id}` | Envio da capa de produto (`product_cover`, multipart) por `instructor`, `manager` e `admin`; exclusão da própria imagem ainda sem uso |
| `GET`, `POST /api/v1/courses`; `GET`, `PATCH`, `DELETE /api/v1/courses/{id}` | Catálogo de cursos (spec 009): o `instructor` só alcança os próprios (`404` nos demais); modo de acesso e preço exigem ações próprias (`403`) |
| `POST /api/v1/courses/{id}/publish`, `/unpublish`, `/archive`, `/unarchive`; `POST`, `DELETE .../request-review`; `PATCH .../owner` | Publicação, arquivo (`admin`), pedido de publicação e dono do curso |
| `POST /api/v1/courses/{id}/modules`, `PUT .../modules/order`; `PATCH`, `DELETE /api/v1/modules/{id}`; `POST /api/v1/modules/{id}/lessons`, `PUT .../lessons/order` | Módulos e ordem |
| `GET`, `PATCH`, `DELETE /api/v1/lessons/{id}`; `PUT /api/v1/lessons/{id}/links` | Aula (o `status` publica e despublica) e links de apoio |
| `GET`, `POST /api/v1/users` | Lista com busca, filtros e cursor (`manager`, `admin`); criação de conta de equipe (`admin`) |
| `GET`, `PATCH /api/v1/users/{id}` | Ficha; edição de nome, nome completo e e-mail com `version` |
| `PATCH /api/v1/users/{id}/role` | Muda o papel (`admin`) |
| `POST /api/v1/users/{id}/suspend`, `/reactivate` | Suspende e reativa (equipe como alvo: só `admin`) |
| `POST /api/v1/users/{id}/password/reveal` | Única resposta com a senha (ADR 0002): só `admin`, com a senha dele; `no-store`; grava `user.password_view` sem o valor |
| `PUT /api/v1/users/{id}/password` | Define a senha (`admin`) e encerra as sessões do usuário |
| `GET`, `DELETE /api/v1/users/{id}/sessions` | Sessões do usuário nos dois sites; encerra todas |
| `GET /api/v1/audit`, `GET /api/v1/audit/{id}` | Consulta da auditoria (`admin`); a lista grava `audit.search` |
| `GET`, `POST /api/v1/terms`, `POST /api/v1/terms/{id}/publish` | Versões dos termos (`admin`); a publicação grava `terms.publish` |

## Sessão e autorização

- `sessionCookie`: sessão válida do site admin (`authenticateSession` do núcleo); senão `401 unauthenticated`, e o cookie recebido é apagado. Renovada a sessão, o cookie volta com o `Max-Age` cheio.
- Papel `student`: `403 permission_denied` em toda operação fora de `/api/v1/auth/*` (spec 003 RF-03). Cada ação de `x-permission` da operação precisa ser permitida ao papel (`can`, spec 008); com mais de uma, todas. A rota refina o que depende do alvo (aluno ou equipe, alcance do instrutor).
- `csrfToken`: `X-CSRF-Token` igual ao token da sessão; senão `403 csrf_token_invalid`.
- A recusa do tratador (`x-permission` ou papel `student`) grava `outcome = denied` na auditoria, com a ação em `details.permission` (spec 028). O `403` que depende do alvo vem do núcleo, que já grava a negação: a API não a grava de novo.
- Limite de taxa (spec 003 RNF-03): 300 por minuto por sessão; 20 por minuto por IP nas operações de `/api/v1/auth/*`.

## Admin inicial e `create-admin`

Na subida, sem nenhum `admin`: com `ADMIN_EMAIL` e `ADMIN_PASSWORD`, cria (ou promove) o admin; sem elas, registra um aviso a cada subida. Com admin existente, as variáveis são ignoradas. `ADMIN_PASSWORD` fora de 8 a 128 caracteres impede a subida. O log nunca leva a senha nem o e-mail.

```bash
docker compose exec -it admin-api node src/create-admin.ts --email <e-mail>
```

Pede a senha duas vezes, sem eco; senha por argumento é recusada (saída `2`), e sem terminal interativo também. Cria ou promove a conta, confirma o e-mail, encerra as sessões dela e grava na auditoria com `origin = cli`. Saída `0` em sucesso, `1` em falha (senhas diferentes, senha ou e-mail recusados, banco).

## Nova rota

1. A operação precisa existir no `openapi.yaml` (tarefa para o `arquiteto`).
2. Registre pelo `operationId`: `app.operation('listUsers', handler)`, num arquivo de `src/routes/`.
3. Teste em `test/`. O teste de contrato e a própria subida do serviço falham se contrato e rotas divergirem.

Escrita sem `csrfToken` no contrato só passa no teste de contrato se o `operationId` estiver em `CSRF_EXCEPTIONS` (`src/contract.ts`).

## Conferir o contrato

```bash
pnpm --filter @nuva-edu/admin-api check-contract                # avisa das operações com x-nuva-pending
pnpm --filter @nuva-edu/admin-api check-contract --no-pending   # falha se houver alguma (verify:full, release)
docker run --rm <imagem> node src/check-contract.ts --no-pending
```

Sai com `0` quando confere, `1` com divergência (lista no `stderr`) e `2` em opção desconhecida. Não precisa de banco nem de variáveis da instalação.

## Testes

```bash
pnpm --filter @nuva-edu/admin-api test
pnpm --filter @nuva-edu/admin-api typecheck
```
