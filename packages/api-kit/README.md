# packages/api-kit

Base HTTP comum das duas APIs do nuva-edu (`@nuva-edu/api-kit`): o Fastify já montado com validação pelo contrato OpenAPI, erros em problem+json, id de requisição, IP real, `/healthz`, `/readyz`, `/metrics` e encerramento limpo. Dono: papel `api-admin` (specs/002). Nada aqui é específico de uma API: o que muda entre elas entra por parâmetro.

Roda direto no Node 26, sem build: os imports levam `.ts` e a sintaxe é só a que o Node apaga.

| Caminho | Conteúdo |
| --- | --- |
| `src/contract.ts` | Leitura do `openapi.yaml` (3.1) e lista de operações |
| `src/validation.ts` | Validação de requisição e de resposta (Ajv, JSON Schema 2020-12) |
| `src/contract-check.ts` | Comparação rotas x contrato e regra do `csrfToken` |
| `src/app.ts` | `createApiApp`: o Fastify com tudo ligado |
| `src/errors.ts` | Qualquer erro → problem+json com os códigos da spec 003 |
| `src/client-ip.ts` | IP real conforme `TRUSTED_PROXIES` (spec 031) |
| `src/health.ts` | Verificações do `/readyz` (banco e migrations) |
| `src/metrics.ts` | Registro de métricas no formato de texto do Prometheus |
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

- **Contrato manda.** `app.operation(id, handler)` é a única forma de criar rota de negócio. Na subida (`ready`/`listen`), rota registrada fora do contrato ou operação do contrato sem rota lança `ContractMismatchError` e o serviço não sobe (spec 003). Só `GET /metrics` fica fora; outra exceção entra em `internalRoutes`.
- **Requisição validada** antes da rota: caminho, consulta e cabeçalhos são convertidos para o tipo do contrato e recebem os valores padrão (`request.query.limit` chega como número); o corpo é validado sem conversão. Falha: `400 validation_failed` com `errors[]` (`body.email`, `query.limit`). As mensagens nunca repetem o valor recebido.
- **Resposta validada** depois da rota: status, tipo de mídia e corpo JSON. Fora do contrato vira `500 internal_error`, com o motivo no log (caminho e regra, sem valores). Corpo que não é JSON (texto, fluxo, SSE) não tem o conteúdo validado.
- **Erros** sempre em `application/problem+json`: `DomainError` do core sai com o próprio `code`; erro de requisição do Fastify (JSON malformado, corpo acima do limite, tipo de conteúdo errado) vira `validation_failed` (400); rota inexistente, `not_found`; falha de conexão com o PostgreSQL, `database_unavailable` (503); o resto, `internal_error` sem `detail`. `rate_limited` com `retryAfterSeconds` ganha o cabeçalho `Retry-After`. Erro com status que a operação não declara chega ao cliente e gera um aviso no log.
- **Id de requisição**: usa o `X-Request-Id` do proxy quando tem forma segura, senão cria; volta na resposta e está em toda linha de `request.log` como `request_id`.
- **Log por requisição** (spec 033): `method`, `route` (o padrão da rota, nunca a URL com consulta), `status`, `duration_ms`, `client_ip`, `client_ip_source`, `peer_ip` e `error_code`. Sondas saem em `debug`.
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
- O tratador guarda o que descobriu (usuário, sessão) num campo de `request` decorado pela própria API.

## Teste de contrato de cada API

Em `test/contract/` (pasta que o `verify` reconhece):

```ts
import { formatContractReport } from '@nuva-edu/api-kit';

const report = app.checkContract({ csrfExceptions: ['login'] });
expect(formatContractReport(report)).toBe(''); // lista cada divergência
```

O relatório acusa rota fora do contrato, operação sem rota, escrita sem `csrfToken` no `security` (em qualquer alternativa) fora da lista de exceções, e exceção que deixou de valer.

## Testes

```bash
pnpm --filter @nuva-edu/api-kit test        # precisa de Postgres (NUVA_TEST_DB=local usa o do compose)
pnpm --filter @nuva-edu/api-kit typecheck
```
