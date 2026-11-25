# apps/worker

Worker do nuva-edu (`@nuva-edu/worker`): consome a fila de tarefas do PostgreSQL e agenda as recorrentes (specs 005 e 033). Dono: papel `api-classroom`.

Roda direto no Node 26, sem build. Métricas e verificações do `/readyz` vêm de `@nuva-edu/api-kit/metrics` e `@nuva-edu/api-kit/health`, as entradas do kit que não carregam o Fastify. Toda escrita na tabela `jobs` passa pelas funções de `@nuva-edu/core`; aqui não há SQL próprio sobre ela.

| Caminho | Conteúdo |
| --- | --- |
| `src/main.ts` | Entrada: configuração, sinais (`SIGTERM`, `SIGINT`) e saída |
| `src/app.ts` | Liga banco, laço de consumo, agendador e HTTP interno |
| `src/worker.ts` | Laço: `NOTIFY` + varredura, concorrência, batimento, tarefa presa, encerramento |
| `src/handlers.ts` | Um manipulador por tipo do registro do núcleo, todos idempotentes |
| `entitlement.recompute` (em `src/handlers.ts`) | Recálculo da cascata (spec 010): chama `recalculateEntitlements` do núcleo, lotes de 500 raízes; payload inválido falha sem nova tentativa |
| `src/email/send-email.ts` | `email.send` (spec 024): lê `email_outbox`, cria o token do link, envia e marca `sent` numa transação |
| `src/email/templates.ts`, `src/email/locales/pt-BR.ts` | Layout (texto e HTML) e textos de cada tipo de e-mail, por idioma |
| `src/email/smtp.ts` | Transporte SMTP (Nodemailer), regra de TLS e classificação dos erros |
| `src/retention.ts` | `retention.purge` (spec 033): sessões, links de e-mail, tentativas de login, dispositivos, `email_outbox` e auditoria (`audit_log_purge`), em lotes de 5.000 |
| `src/secrets.ts` | Segredos exigidos na subida (`SMTP_PASSWORD` quando há `SMTP_USER`) |
| `src/scheduler.ts` | Recorrentes: janela no fuso da escola (`school.timezone`, lido pelo `createSettingsReader` do núcleo), `enqueueRecurring` |
| `src/http.ts` | `/healthz`, `/readyz`, `/metrics` em `node:http` |
| `src/metrics.ts`, `src/queue-metrics.ts` | Métricas do laço e medidores da fila, do pool e do processo |

## Rodar

```bash
pnpm --filter @nuva-edu/worker dev     # lê .env e .env.local da raiz; reinicia a cada mudança
PORT=3901 pnpm --filter @nuva-edu/worker dev
```

| Variável | Padrão | Uso |
| --- | --- | --- |
| `NUVA_WORKER_CONCURRENCY` | `10` | Tarefas simultâneas |
| `PORT` | `3000` | Porta do HTTP interno (saúde e métricas) |
| `SMTP_HOST`, `SMTP_PORT` | `mailpit`, `1025` | Servidor SMTP. Porta 465: TLS desde a conexão; outra: STARTTLS obrigatório; só o host `mailpit` dispensa TLS |
| `SMTP_USER`, `SMTP_PASSWORD` | vazio | Autenticação; com `SMTP_USER`, `SMTP_PASSWORD` é obrigatória e a subida falha citando-a |
| `SMTP_FROM` | `nuva-edu <no-reply@${NUVA_DOMAIN}>` | Remetente |
| `NUVA_CLASSROOM_HOST`, `NUVA_ADMIN_HOST`, `NUVA_PUBLIC_SCHEME`, `NUVA_PUBLIC_PORT` | spec 031 | Endereços dos links nos e-mails |

No encerramento o worker para de pegar tarefas, aborta o sinal das que estão em execução, espera até 30 s por elas e devolve o resto à fila.

Cada manipulador recebe `(job, { signal })`, com um `AbortSignal` próprio da tarefa: ele é abortado quando o worker começa a encerrar e quando a trava da tarefa é perdida. Manipulador longo repassa o sinal a `fetch` e às esperas. O que para por causa do encerramento (rejeita depois do aborto) volta à fila sem contar a tentativa, com `outcome="released"`; não é registrado como falha.

`/readyz` responde `{ status, checks }` com `database`, `migrations` e `queue`. O motivo da falha sai só no log: `Serviço não está pronto` uma vez por mudança de estado, e `Serviço voltou a estar pronto`.

## Métricas

`jobs_total{type,outcome}` (`done`, `retry`, `failed`, `lost`, `released`), `jobs_duration_seconds{type}`, `jobs_queue_depth{type}`, `jobs_failed{type}`, `jobs_count{status}` (`queued`, `ready`, `running`, `done`, `failed`), `jobs_oldest_pending_seconds`, `worker_jobs_running`, `worker_concurrency`, `worker_database_up`, `db_pool_connections{state}` (`active`, `idle`, `waiting`) e as do processo (`process_*`, `nodejs_heap_size_used_bytes`).

Os rótulos saem em ordem alfabética (`jobs_total{outcome="done",type="..."}`). Com o banco fora, `worker_database_up` vale 0 e os medidores da fila saem só com o cabeçalho, sem série.

## E-mail

`email.send` envia uma linha de `email_outbox` e é idempotente: linha que não está `queued` não sai de novo. O token dos links de confirmação e de redefinição é criado na mesma transação que marca o envio; se o SMTP falha, a transação desfaz e nenhum token fica valendo. O token em claro existe só no corpo enviado: nunca em log, em `jobs` nem em `email_outbox`. O log e o `last_error` também não levam o endereço do destinatário (`smtp: EENVELOPE 550 (recusa permanente)`).

Recusa 5xx do destinatário ou da mensagem marca `failed` sem nova tentativa (`PermanentJobError`); o resto segue a espera própria do tipo (1 min, 5 min, 30 min, 2 h). Na última tentativa a linha também fica `failed`. Confirmação para quem já confirmou o e-mail, ou para conta excluída, fica `sent` sem envio (`skipped: already_verified`, `skipped: user_deleted`).

`access.granted` (spec 024, "E-mails da Fase 2") leva a `/meus-cursos` (curso e pacote) ou `/meus-ebooks` (ebook). Os tipos com `skipFullySuspended` no núcleo não saem para a conta com suspensão `full` no momento do envio (`skipped: user_suspended`).

Texto novo de e-mail: acrescente o tipo em `src/email/locales/pt-BR.ts`; o tipo `EmailTemplates` obriga um modelo por tipo do núcleo. Tipo que o núcleo ainda lista como pendente de modelo entra também em `EXTRA_TEMPLATE_EMAIL_TYPES` (`src/email/templates.ts`).

## Tipo novo de tarefa

1. O `nucleo` acrescenta o tipo em `JobPayloads` e `JOB_DEFINITIONS`; sem o manipulador, o worker deixa de compilar.
2. Escreva o manipulador em `src/handlers.ts`: confira o estado antes de agir, porque a mesma tarefa pode executar mais de uma vez.
3. Recorrente: acrescente em `RECURRING_JOBS` (`src/scheduler.ts`).

## Testes

```bash
NUVA_TEST_DB=local pnpm --filter @nuva-edu/worker test   # Postgres local no ar
pnpm --filter @nuva-edu/worker typecheck
```
