# apps/classroom-api

API do site do aluno (`@nuva-edu/classroom-api`), descrita em `openapi.yaml` e em `specs/004-classroom-api.md`. Dono: papel `api-classroom`; o `openapi.yaml` é do `arquiteto` e aqui só é lido.

| Caminho | Conteúdo |
| --- | --- |
| `openapi.yaml` | Contrato (não edite: peça a mudança ao `arquiteto`) |
| `src/main.ts` | Entrada do processo: configuração, banco, subida e encerramento |
| `src/app.ts` | `buildClassroomApp`: a API montada sobre `@nuva-edu/api-kit`, com o fluxo SSE |
| `src/contract.ts` | Caminho do contrato e exceções de CSRF |
| `src/check-contract.ts` | Comando `check-contract`: rotas x contrato, sem banco e sem porta |
| `src/session.ts` | Tratador da sessão (entra por parâmetro) e o usuário da requisição |
| `src/routes/` | Uma função `register...Routes` por grupo de rotas |
| `src/stream/` | SSE: leitura do aviso, formato no fio e distribuição por usuário |
| `test/` | Integração (requisições injetadas e cliente HTTP real no SSE, banco de teste) |
| `test/contract/` | Teste de contrato: rotas x `openapi.yaml`, regra do `csrfToken` e nomes dos eventos |

Aqui fica só transporte, validação e autorização; regra de negócio e acesso a dados ficam em `packages/core`. A base HTTP (validação pelo contrato, problem+json, id de requisição, IP real, sondas, métricas) vem de `packages/api-kit`.

## Rodar

```bash
pnpm --filter @nuva-edu/classroom-api dev     # lê .env e .env.local da raiz; reinicia ao salvar
pnpm --filter @nuva-edu/classroom-api start   # usa só as variáveis do ambiente (contêiner)
```

Escuta na porta 3000 (spec 031); `PORT` troca a porta fora do contêiner. Precisa do Postgres no ar e migrado (`pnpm db:migrate up`); sem isso o serviço sobe, mas `/readyz` e o fluxo SSE respondem `503`.

| Rota | O que faz |
| --- | --- |
| `GET /healthz` | Processo vivo; não toca no banco |
| `GET /readyz` | `200` com banco no ar e migrations em dia; senão `503` |
| `GET /metrics` | Texto do Prometheus (inclui `sse_connections` e `db_pool_connections{state}`); fora do contrato, só rede interna |
| `GET /api/v1/meta` | Dados públicos da instalação, sem sessão |
| `GET /api/v1/stream` | Fluxo SSE do usuário da sessão |

## Conferir o contrato

```bash
pnpm --filter @nuva-edu/classroom-api check-contract                # avisa das operações com x-nuva-pending
pnpm --filter @nuva-edu/classroom-api check-contract --no-pending   # falha se houver alguma (verify:full, release)
docker run --rm <imagem> node src/check-contract.ts --no-pending
```

Sai com `0` quando confere, `1` com divergência (lista no `stderr`) e `2` em opção desconhecida. Não precisa de banco nem de variáveis da instalação: a API é montada com `listenUserEvents: false`, sem a escuta do `nuva_user_events`.

## Sessão

A sessão real entra na Fase 1 (spec 007). Até lá, `buildClassroomApp` recebe o tratador em `authenticate` e o padrão (`rejectEverySession`) recusa sempre: toda rota com `sessionCookie` responde `401`. Os testes injetam um tratador falso. A rota lê o usuário com `session.get(request)` (`createRequestState` do api-kit, em `src/session.ts`).

## Fluxo SSE

- Uma conexão `LISTEN nuva_user_events` por processo (`listenChannel` do `@nuva-edu/core`), aberta na subida e fechada no encerramento, com reconexão de espera crescente (1 s a 30 s).
- Carga do `NOTIFY`: `{ "userId": "<uuid>", "kind": "<nome do evento>", "id": <inteiro crescente por usuário>, "data": { ... } }`. `kind` é um dos nomes de `StreamEvent` do contrato (menos `ping`); `data` vai ao cliente como veio. Carga fora do formato é descartada com um aviso no log, sem o conteúdo.
- Antes de entregar, o evento é conferido com o esquema `StreamEvent` do contrato (`app.contractSchema`). O que não confere é descartado e não fica guardado para reenvio; o aviso no log traz `reason: contract_mismatch`, o nome do evento e o caminho dos campos recusados, nunca os valores.
- O `StreamHub` (`src/stream/hub.ts`) entrega cada evento só às conexões do `userId`, envia `ping` a cada 25 s, limita a 3 conexões por usuário (a quarta encerra a mais antiga) e derruba o cliente que não lê.
- `Last-Event-ID`: reenvia os eventos de `id` maior dos últimos 5 minutos, guardados na memória do processo. Não cobre reinício da API nem queda da escuta; nesses casos a interface recarrega as listas.
- Escuta caída (banco indisponível): as conexões abertas são fechadas e novas recebem `503 database_unavailable`.
- A rota entrega o fluxo por `app.eventStreams.open` (`eventStreams: true` no api-kit): a base põe os cabeçalhos de SSE, mantém o medidor `sse_connections` e, no `SIGTERM`, encerra os fluxos antes de o servidor parar, para não segurar o encerramento.
- Fim do fluxo no log: uma linha só, a da requisição. `Requisição encerrada pelo cliente` com `status: 499` quando o navegador fecha; `Requisição atendida` com 200 quando é o servidor.
- Para derrubar as conexões de um usuário (sessão encerrada, suspensão): `userEventStream(app).hub.disconnectUser(userId)`.

Testar à mão, com o serviço no ar e um tratador de sessão que aceite a requisição:

```sql
select pg_notify('nuva_user_events', '{"userId":"<uuid>","kind":"presence","id":1,"data":{"userId":"<uuid>","online":true}}');
```

## Nova rota

1. A operação precisa existir no `openapi.yaml` (tarefa para o `arquiteto`).
2. Registre pelo `operationId`: `app.operation('getCatalog', handler)`, num arquivo de `src/routes/`.
3. Teste em `test/`. O teste de contrato e a própria subida do serviço falham se contrato e rotas divergirem.

Escrita sem `csrfToken` no contrato só passa no teste de contrato se o `operationId` estiver em `CSRF_EXCEPTIONS` (`src/contract.ts`).

## Testes

```bash
pnpm --filter @nuva-edu/classroom-api test        # precisa de Postgres (NUVA_TEST_DB=local usa o do compose)
pnpm --filter @nuva-edu/classroom-api typecheck
```
