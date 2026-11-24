# apps/admin-api

API do site de administração (`@nuva-edu/admin-api`), descrita em `openapi.yaml` e em `specs/003-admin-api.md`. Dono: papel `api-admin`; o `openapi.yaml` é do `arquiteto` e aqui só é lido.

| Caminho | Conteúdo |
| --- | --- |
| `openapi.yaml` | Contrato (não edite: peça a mudança ao `arquiteto`) |
| `src/main.ts` | Entrada do processo: configuração, banco, subida e encerramento |
| `src/app.ts` | `buildAdminApp`: a API montada sobre `@nuva-edu/api-kit` |
| `src/contract.ts` | Caminho do contrato e exceções de CSRF |
| `src/check-contract.ts` | Comando `check-contract`: rotas x contrato, sem banco e sem porta |
| `src/routes/` | Uma função `register...Routes` por grupo de rotas |
| `test/` | Integração (requisições injetadas, banco de teste) |
| `test/contract/` | Teste de contrato: rotas x `openapi.yaml` e regra do `csrfToken` |

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
| `GET /api/v1/meta` | Dados públicos da instalação, sem sessão |

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
