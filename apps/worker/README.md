# apps/worker

Worker do nuva-edu (`@nuva-edu/worker`): consome a fila de tarefas do PostgreSQL e agenda as recorrentes (specs 005 e 033). Dono: papel `api-classroom`.

Roda direto no Node 26, sem build. Toda escrita na tabela `jobs` passa pelas funções de `@nuva-edu/core`; aqui não há SQL próprio sobre ela.

| Caminho | Conteúdo |
| --- | --- |
| `src/main.ts` | Entrada: configuração, sinais (`SIGTERM`, `SIGINT`) e saída |
| `src/app.ts` | Liga banco, laço de consumo, agendador e HTTP interno |
| `src/worker.ts` | Laço: `NOTIFY` + varredura, concorrência, batimento, tarefa presa, encerramento |
| `src/handlers.ts` | Um manipulador por tipo do registro do núcleo, todos idempotentes |
| `src/scheduler.ts` | Recorrentes: janela no fuso de `settings.timezone`, `enqueueRecurring` |
| `src/http.ts` | `/healthz`, `/readyz`, `/metrics` em `node:http` |
| `src/metrics.ts`, `src/queue-metrics.ts` | Contador, histograma e texto do Prometheus |

## Rodar

```bash
pnpm --filter @nuva-edu/worker dev     # lê .env e .env.local da raiz; reinicia a cada mudança
PORT=3901 pnpm --filter @nuva-edu/worker dev
```

| Variável | Padrão | Uso |
| --- | --- | --- |
| `NUVA_WORKER_CONCURRENCY` | `10` | Tarefas simultâneas |
| `PORT` | `3000` | Porta do HTTP interno (saúde e métricas) |

No encerramento o worker para de pegar tarefas, espera até 30 s pelas em execução e devolve o resto à fila.

## Métricas

`jobs_total{type,outcome}` (`done`, `retry`, `failed`, `lost`), `jobs_duration_seconds{type}`, `jobs_queue_depth{type}`, `jobs_failed{type}`, `jobs_count{status}` (`queued`, `ready`, `running`, `done`, `failed`), `worker_jobs_running`, `worker_concurrency`, `worker_database_up`.

## Tipo novo de tarefa

1. O `nucleo` acrescenta o tipo em `JobPayloads` e `JOB_DEFINITIONS`; sem o manipulador, o worker deixa de compilar.
2. Escreva o manipulador em `src/handlers.ts`: confira o estado antes de agir, porque a mesma tarefa pode executar mais de uma vez.
3. Recorrente: acrescente em `RECURRING_JOBS` (`src/scheduler.ts`).

## Testes

```bash
NUVA_TEST_DB=local pnpm --filter @nuva-edu/worker test   # Postgres local no ar
pnpm --filter @nuva-edu/worker typecheck
```
