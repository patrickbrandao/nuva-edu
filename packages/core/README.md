# packages/core

Núcleo do nuva-edu (`@nuva-edu/core`): a base usada pelas duas APIs e pelo worker, e a única casa das regras de negócio. Dono: papel `nucleo` (specs/002).

Roda direto no Node 26, sem build: os imports levam `.ts` e a sintaxe é só a que o Node apaga.

| Caminho | Conteúdo |
| --- | --- |
| `src/config/` | Configuração lida e validada das variáveis de ambiente (spec 031) |
| `src/db/` | Conexão Kysely e tipos gerados do banco (`generated/`, não edite à mão) |
| `src/logging/` | Logger JSON e máscara de campos proibidos (spec 033) |
| `src/errors/` | Erro de domínio e conversão em problem+json (spec 003) |
| `src/modules/` | Uma pasta por área de negócio (veja o README de lá) |
| `src/modules/jobs/` | Fila de tarefas em segundo plano sobre a tabela `jobs` (spec 005) |
| `scripts/db-types.ts` | Gera os tipos do Kysely a partir do banco |
| `test/` | Testes (Vitest); os de banco usam um banco clonado do modelo |

## Uso

```ts
import {
  createDatabase,
  createLogger,
  loadConfigOrExit,
  PROBLEM_CONTENT_TYPE,
  resolveRequestId,
  toProblem,
} from '@nuva-edu/core';

// Variável obrigatória ausente ou inválida: uma linha JSON `fatal` citando a variável, e exit 1.
const config = loadConfigOrExit({ service: 'admin-api', required: ['SESSION_SECRET'] });
const logger = createLogger({ service: 'admin-api', level: config.logLevel });
const db = createDatabase({ connectionString: config.databaseUrl, applicationName: 'admin-api', logger });

const log = logger.withRequestId(resolveRequestId(request.headers['x-request-id']));
log.info('Requisição atendida', { route, status, duration_ms });

// No tratador de erros da API:
const problem = toProblem(error, { instance: request.url });
reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
```

## Logs: o que nunca sai

- Campo cujo nome contém `password`, `token`, `secret`, `authorization`, `cookie`, `cpf`, `cnpj`, `document`, `key` (e `senha`, `credential`, `cardnumber`, `cvv`) é trocado por `[REDACTED]`, em qualquer profundidade.
- Em texto livre é mascarado o que tem forma reconhecível: credencial em URL, `Bearer`/`Basic`, pares `senha=valor`, CPF e CNPJ.
- Uma senha solta no meio de uma frase não tem forma: **nunca interpole senha, token ou chave numa mensagem**. Passe como campo, que a máscara cobre.
- O log de consultas traz só o SQL, sem parâmetros; `detail` e `where` dos erros do PostgreSQL são mascarados, porque reproduzem valores das linhas.

## Fila de tarefas

Fila no PostgreSQL (spec 005). As APIs só enfileiram (e reenfileiram pelo `/ops`); o restante é do worker.

```ts
// API: junto com a escrita de negócio. Desfeita a transação, a tarefa não existe.
await db.transaction().execute(async (trx) => {
  // ... escrita de negócio ...
  await enqueue(trx, 'example.echo', { message: 'olá' }, { uniqueKey: 'echo:42' });
});

// Worker: acorda pelo NOTIFY, e varre a cada SWEEP_INTERVAL_MS de qualquer forma.
const listener = listenForJobs({ connectionString: config.databaseUrl, onNotify: wake, logger });
const jobs = await claimJobs(db, { workerId, limit: livres });
for (const job of jobs) {
  const lock = { jobId: job.id, workerId };
  try {
    if (!isKnownJob(job)) throw new Error(`Tipo de tarefa desconhecido: ${job.type}`);
    await run(job); // switch (job.type) estreita o payload
    await completeJob(db, lock);
  } catch (error) {
    await failJob(db, { ...lock, error }); // nova tentativa com espera crescente, ou failed
  }
}
```

| Função | Uso |
| --- | --- |
| `enqueue(db, tipo, payload, { runAt, priority, maxAttempts, uniqueKey })` | Enfileira; `null` se a `uniqueKey` já tem tarefa `queued` ou `running` |
| `enqueueRecurring(db, tipo, payload, { window })` | Recorrente da janela (`tipo:janela`), uma única vez em qualquer estado |
| `claimJobs(db, { workerId, limit })` | Pega tarefas prontas com `SKIP LOCKED`; cada claim conta uma tentativa |
| `heartbeatJobs(db, { workerId, jobIds })` | Renova o batimento (a cada `HEARTBEAT_INTERVAL_MS`); devolve os ids ainda travados |
| `completeJob` / `failJob` / `releaseJob` | Conclui, registra falha (`last_error` mascarado) ou devolve à fila no encerramento |
| `requeueStaleJobs(db)` | Tarefa `running` sem batimento há `STALE_AFTER_MS` volta à fila, ou falha se esgotou |
| `retryJob(db, id)` | Reenfileira uma `failed` (tela `/ops`) |
| `getJobCounts(db)` / `getJobCountsByType(db)` | Contagens para `/metrics` e `/ops` |
| `listenForJobs({ connectionString, onNotify })` | `LISTEN nuva_jobs` em conexão dedicada, com reconexão |

Tipo novo de tarefa: acrescente em `JobPayloads` e `JOB_DEFINITIONS` (`src/modules/jobs/registry.ts`), com o nome do catálogo da spec 005. Payload leva só identificadores.

## Tipos do banco

```bash
pnpm --filter @nuva-edu/core db:types         # depois de cada migration nova
pnpm --filter @nuva-edu/core db:types:check   # falha se os tipos estiverem desatualizados
```

As colunas `snake_case` aparecem em `camelCase` no código (`CamelCasePlugin`). SQL escrito à mão com `sql` continua em `snake_case`.

## Testes

```bash
pnpm --filter @nuva-edu/core test            # precisa do Postgres local no ar
pnpm --filter @nuva-edu/core test:coverage   # falha abaixo de 80% de linhas
pnpm --filter @nuva-edu/core typecheck
```
