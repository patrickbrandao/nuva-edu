# packages/api-kit

Base HTTP comum das duas APIs do nuva-edu (`@nuva-edu/api-kit`): o Fastify já montado com validação pelo contrato OpenAPI, erros em problem+json, id de requisição, IP real, `/healthz`, `/readyz`, `/metrics` e encerramento limpo. Dono: papel `api-admin` (specs/002). Nada aqui é específico de uma API: o que muda entre elas entra por parâmetro.

Roda direto no Node 26, sem build: os imports levam `.ts` e a sintaxe é só a que o Node apaga.

| Caminho | Conteúdo |
| --- | --- |
| `src/contract.ts` | Leitura do `openapi.yaml` (3.1) e lista de operações |
| `src/validation.ts` | Validação de requisição e de resposta (Ajv, JSON Schema 2020-12) |
| `src/contract-check.ts` | Comparação rotas x contrato, regra do `csrfToken` e operações pendentes |
| `src/app.ts` | `createApiApp`: o Fastify com tudo ligado |
| `src/errors.ts` | Qualquer erro → problem+json com os códigos da spec 003 |
| `src/client-ip.ts` | IP real conforme `TRUSTED_PROXIES` (spec 031) |
| `src/health.ts` | Verificações do `/readyz` (banco e migrations) |
| `src/metrics.ts` | Registro de métricas no formato de texto do Prometheus |
| `src/sse.ts` | Cabeçalhos e formato de evento SSE, e o conjunto dos fluxos abertos |
| `src/request-state.ts` | `createRequestState`: dado tipado da API por requisição |
| `src/server.ts` | `startServer`: escuta e encerra limpo em SIGTERM |

## Uso

```ts
import { createApiApp, databaseReadiness, loadContract, startServer } from '@nuva-edu/api-kit';
import { closeDatabase, createDatabase, createLogger, loadConfigOrExit } from '@nuva-edu/core';

const config = loadConfigOrExit({ service: 'classroom-api', required: [] });
const logger = createLogger({ service: 'classroom-api', level: config.logLevel });
const db = createDatabase({ connectionString: config.databaseUrl, applicationName: 'classroom-api', logger });

const app = createApiApp({
  contract: loadContract(new URL('../openapi.yaml', import.meta.url)),
  logger,
  trustedProxies: config.trustedProxies,
  readiness: databaseReadiness({ db, connectionString: config.databaseUrl }),
  security: {}, // um tratador por esquema de segurança do contrato (veja abaixo)
});

// Rota de negócio: só pelo operationId. Método, caminho, segurança e validação vêm do contrato.
app.operation('getMeta', async (request) => ({ schoolName: '...', version: '...' /* ... */ }));

app.addHook('onClose', () => closeDatabase(db));
await startServer(app, { port: 3000 });
```

`/healthz`, `/readyz` e `/metrics` já vêm registradas; as duas primeiras precisam estar no contrato.

## O que a base garante

- **Contrato manda.** `app.operation(id, handler)` é a única forma de criar rota de negócio. Na subida (`ready`/`listen`), rota registrada fora do contrato ou operação do contrato sem rota lança `ContractMismatchError` e o serviço não sobe (spec 003). Só `GET /metrics` fica fora; outra exceção entra em `internalRoutes`. Operação com `x-nuva-pending: true` é a exceção: veja "Operação pendente".
- **Requisição validada** antes da rota: caminho, consulta e cabeçalhos são convertidos para o tipo do contrato e recebem os valores padrão (`request.query.limit` chega como número); o corpo é validado sem conversão. Falha: `400 validation_failed` com `errors[]` (`body.email`, `query.limit`). As mensagens nunca repetem o valor recebido. `Content-Type` que a operação não declara (ou que o serviço não sabe ler): `415 unsupported_media_type`. Corpo acima do limite: `413 payload_too_large`.
- **Resposta validada** depois da rota: status, tipo de mídia e corpo JSON. Fora do contrato vira `500 internal_error`, com o motivo no log (caminho e regra, sem valores). Corpo que não é JSON (texto, fluxo, SSE) não tem o conteúdo validado.
- **Erros** sempre em `application/problem+json`: `DomainError` do core sai com o próprio `code`; erro de requisição do Fastify vira `validation_failed` (400; JSON malformado, corpo vazio), `payload_too_large` (413) ou `unsupported_media_type` (415); rota inexistente, `not_found`; falha de conexão com o PostgreSQL, `database_unavailable` (503); o resto, `internal_error` sem `detail`. `rate_limited` com `retryAfterSeconds` ganha o cabeçalho `Retry-After`. Erro com status que a operação não declara chega ao cliente e gera um aviso no log (é o caso de `413` e `415` enquanto o contrato não os declara).
- **HTTP malformado**, que o Node recusa antes de existir requisição (linha ou cabeçalho ilegível, corpo menor que o `Content-Length`): `400 validation_failed` em problem+json, com `X-Request-Id`; o corpo cortado leva `errors: [{ path: "body" }]`. Não entra em `http_requests_total` nem no log de requisição (só uma linha `debug`). Prazo esgotado (`408`) e cabeçalhos grandes demais (`431`) saem como no Fastify, sem problem+json: a spec não define código para eles.
- **Id de requisição**: usa o `X-Request-Id` do proxy quando tem forma segura, senão cria; volta na resposta e está em toda linha de `request.log` como `request_id`.
- **Log por requisição** (spec 033): `method`, `route` (o padrão da rota, nunca a URL com consulta), `status`, `duration_ms`, `client_ip`, `client_ip_source`, `peer_ip` e `error_code`. Sondas saem em `debug`. Cada requisição gera uma linha só: `Requisição atendida` quando a resposta termina, ou `Requisição encerrada pelo cliente` (com `aborted: true`) quando o cliente fecha a conexão antes.
- **Requisição abortada**: o cliente que fecha antes do fim (o caso normal de um fluxo SSE) é registrado no log e em `http_requests_total`/`http_request_duration_seconds` com o status convencional **499** (`CLIENT_CLOSED_REQUEST_STATUS`, o mesmo código que o nginx usa). O 499 nunca vai ao cliente e não entra no contrato.
- **IP real** em `request.client` (`ip`, `source`, `peerIp`) e em `request.ip`: os cabeçalhos só valem se a conexão vem de `TRUSTED_PROXIES`; do `X-Forwarded-For` vale o endereço mais à direita que não é proxy confiável; `X-Real-IP` é a alternativa. Use `request.client.ip` em limite de taxa e auditoria, e grave também `peerIp`.
- **`/metrics`** (fora do contrato): `http_requests_total{route,method,status}`, `http_request_duration_seconds{route,method}` e métricas do processo. Responde `404` a quem chega com cabeçalho de proxy ou de fora de rede privada. Métricas próprias: `app.metrics.counter(...)`, `.gauge(...)`, `.histogram(...)`.
- **Encerramento**: no SIGTERM/SIGINT para de aceitar conexões, espera as requisições em curso, roda os ganchos `onClose` e sai com 0; passou de 10 s, sai com 1.

## Sessão e CSRF (pontos de extensão)

A base não implementa sessão nem CSRF: ela chama um tratador por esquema de segurança do contrato, antes da validação e da rota.

```ts
createApiApp({
  // ...
  security: {
    sessionCookie: async (request, { operation }) => { /* lança unauthenticated() ou permissionDenied() */ },
    csrfToken: async (request) => { /* lança DomainError com code 'csrf_token_invalid' (403) */ },
  },
});
```

- Operação pública (`security: []`) não chama nenhum tratador.
- Registrar uma operação cujo esquema não tem tratador lança na hora: rota protegida nunca fica aberta por esquecimento.
- Numa alternativa (`- sessionCookie: []` + `csrfToken: []`) os tratadores rodam na ordem do contrato; com mais de uma alternativa, basta uma passar.
- O tratador guarda o que descobriu (usuário, sessão) com um dos mecanismos abaixo.

## Dados da API na requisição (com tipo, sem importar `fastify`)

As APIs não dependem de `fastify`: os tipos vêm de `@nuva-edu/api-kit`. Há duas formas de associar um dado à requisição.

**`createRequestState`** (a mais simples; nada é decorado):

```ts
import { createRequestState } from '@nuva-edu/api-kit';

const session = createRequestState<SessionUser>('session');
session.set(request, user);            // no tratador de `sessionCookie`
const user = session.require(request); // na rota; lança se ninguém guardou
const maybe = session.get(request);    // `undefined` em operação pública
```

**Campo no `request` ou na instância**, declarando o tipo nas interfaces de extensão do kit:

```ts
declare module '@nuva-edu/api-kit' {
  interface ApiRequestExtensions { session: SessionUser | null }
  interface ApiInstanceExtensions { mailer: Mailer }
}

app.decorateRequest('session', null);
app.decorate('mailer', mailer);
// request.session e app.mailer passam a existir, com tipo, em todo o serviço
```

## Fluxo SSE

```ts
const app = createApiApp({ /* ... */ eventStreams: true });

app.operation('openStream', (request, reply) => {
  const stream = new PassThrough();
  stream.write(formatSseComment()); // faz os cabeçalhos saírem já
  return app.eventStreams.open(reply, stream);
});
// em outro ponto: stream.write(formatSseEvent({ id: 7, event: 'notification.created', data: { id } }));
```

- `app.eventStreams.open` põe os cabeçalhos de `SSE_HEADERS` (`Content-Type: text/event-stream`, `Cache-Control: no-store`, `X-Accel-Buffering: no`) e passa a contar o fluxo até ele fechar.
- `eventStreams: true` registra o medidor `sse_connections` e, no `preClose`, encerra os fluxos abertos (`app.eventStreams.closeAll()`), para o SIGTERM não esperar por eles. Sem a opção, `open` lança.
- O cliente que fecha o fluxo gera a linha `Requisição encerrada pelo cliente` com status 499; o fluxo que o servidor encerra, `Requisição atendida` com 200.
- `formatSseEvent` escreve `id`, `event`, `retry` e `data` (JSON numa linha). `app.contractSchema('StreamEvent')` valida um evento contra o esquema do contrato.

## Esquema avulso do contrato

`app.contractSchema(nome)` (ou `createContractValidator(contract).schema(nome)`) devolve o validador de um esquema de `components.schemas`: recebe o valor e devolve os campos recusados (`[]` quando confere), com tipos exatos e sem conversão.

## Operação pendente (`x-nuva-pending`)

Uma operação marcada com `x-nuva-pending: true` no `openapi.yaml` pode chegar à `main` antes da rota: a conferência na subida e o `checkContract` não exigem a rota dela (e aceitam se já existir). Enquanto a rota não existe, o caminho responde `404` e a subida só informa no log (`info`). Pendente que já tem rota gera aviso (`warn`) na subida e a cada `app.checkContract()`, até a marca sair do contrato.

- `report.pendingOperations`: pendentes sem rota. `report.pendingWithRoute`: pendentes que já têm rota (a marca pode sair do contrato). Nenhuma das duas listas entra em `report.ok`.
- `formatContractReport(report)` continua listando só as divergências; com `{ warnings: true }` (ou `formatContractWarnings(report)`) lista também os avisos, cada linha começando por `aviso:`.
- `checkContract(..., { allowPending: false })` (também em `app.checkContract`) trata toda operação pendente, com ou sem rota, como divergência (`report.pendingNotAllowed`): é a base do `check-contract --no-pending` da spec 003.
- As outras regras (CSRF em toda escrita, esquemas válidos) valem para a operação pendente.

## Comando `check-contract`

`runCheckContract` é o comando `check-contract` da spec 003 ("Subida estrita"), igual nas duas APIs: monta o app, repete a conferência da subida e do teste de contrato (rotas x contrato nos dois sentidos, `csrfToken` das escritas) e devolve o código de saída. Não escuta em porta e não precisa de banco. Cada API tem um `src/check-contract.ts` e o script `check-contract` no `package.json`:

```ts
import { runCheckContract } from '@nuva-edu/api-kit';

process.exitCode = await runCheckContract({
  service: 'admin-api',
  csrfExceptions: CSRF_EXCEPTIONS,
  // Logger em `silent`: a saída do comando é só o relatório.
  build: () => buildAdminApp({ config, db, logger, readiness: {} }),
});
```

```bash
pnpm --filter @nuva-edu/admin-api check-contract                # operação pendente só gera aviso
pnpm --filter @nuva-edu/admin-api check-contract --no-pending   # verify:full e release
node src/check-contract.ts --no-pending                         # na imagem (sem pnpm)
```

| Saída | Quando |
| --- | --- |
| `0` | Contrato e rotas conferem. Sem `--no-pending`, as pendentes saem como `aviso:` no `stderr` |
| `1` | Divergência (uma por linha no `stderr`), app que não monta ou, com `--no-pending`, qualquer operação com `x-nuva-pending`, com ou sem rota |
| `2` | Opção desconhecida |

## Métricas e saúde sem Fastify

O `worker` (e qualquer processo sem HTTP de negócio) usa duas entradas que não carregam o Fastify, o Ajv nem o leitor de contrato:

```ts
import { createMetricsRegistry, METRICS_CONTENT_TYPE, registerProcessMetrics } from '@nuva-edu/api-kit/metrics';
import { createReadinessLogger, databaseReadiness, runReadinessChecks } from '@nuva-edu/api-kit/health';

const registry = createMetricsRegistry();
const jobs = registry.counter({ name: 'jobs_total', help: '...' });
jobs.inc({ type, outcome: 'done' });
jobs.get({ type, outcome: 'done' }); // valor atual, para testes

const report = await runReadinessChecks({
  ...databaseReadiness({ db, connectionString }), // `database` e `migrations`
  queue: () => worker.isLoopActive(),
});
```

Medida lida de fora (tamanho da fila): `registry.gauge({ name, help, collect })`, com `collect` devolvendo o número ou a lista de séries; lista vazia expõe só o cabeçalho da métrica.

## Teste de contrato de cada API

Em `test/contract/` (pasta que o `verify` reconhece):

```ts
import { formatContractReport } from '@nuva-edu/api-kit';

const report = app.checkContract({ csrfExceptions: ['login'] });
expect(formatContractReport(report)).toBe(''); // lista cada divergência
```

O relatório acusa rota fora do contrato, operação sem rota (salvo as pendentes), escrita sem `csrfToken` no `security` (em qualquer alternativa) fora da lista de exceções, e exceção que deixou de valer.

## Testes

```bash
pnpm --filter @nuva-edu/api-kit test        # precisa de Postgres (NUVA_TEST_DB=local usa o do compose)
pnpm --filter @nuva-edu/api-kit typecheck
```
