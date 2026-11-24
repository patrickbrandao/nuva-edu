# 005 — worker e fila de tarefas

Status: aprovada
Depende de: 000, 001

## Contexto

Parte do trabalho não cabe no tempo de uma requisição (enviar e-mail, processar webhook, gerar certificado) ou não nasce de requisição alguma (vencer assinaturas, expurgar dados). O `worker` executa essas tarefas a partir de uma fila guardada no próprio PostgreSQL, sem Redis nem mensageria ([0008](decisions/0008-fila-e-sse-no-postgres.md)).

## Requisitos

- RF-01: Fila persistente na tabela `jobs`, consumida com `SELECT … FOR UPDATE SKIP LOCKED`.
- RF-02: Enfileirar na mesma transação da mudança que originou a tarefa (a tarefa só existe se a mudança foi gravada).
- RF-03: Novas tentativas automáticas com espera crescente e estado final `failed` visível no admin.
- RF-04: Agendamento por data (`run_at`) e tarefas recorrentes definidas em código.
- RF-05: Todo manipulador é idempotente: executar duas vezes produz o mesmo resultado de uma.
- RF-06: Reenfileirar ou descartar tarefa com falha pela tela de operações do admin ([003](003-admin-api.md), grupo `/ops`).
- RF-07: Expor `/healthz`, `/readyz` e `/metrics` ([033](033-observabilidade-retencao-backup.md)).
- RNF-01: Tarefa pronta começa a executar em até 2 s (acordada por `NOTIFY`; varredura de segurança a cada 5 s).
- RNF-02: Vazão mínima de 20 tarefas por segundo com 1 vCPU, medida com tarefas vazias.
- RNF-03: Concorrência padrão de 10 tarefas simultâneas, ajustável por `NUVA_WORKER_CONCURRENCY`.
- RNF-04: Tarefa presa (sem batimento por 5 minutos) volta à fila automaticamente.

## Comportamento

### Ciclo de vida da tarefa

```
queued → running → done
            ↓
         (erro) → queued (nova tentativa, run_at adiado) → … → failed
```

- Seleção: `status = 'queued' AND run_at <= now()`, por `priority` decrescente e `run_at` crescente, com `SKIP LOCKED`.
- Ao iniciar, a tarefa recebe `locked_by`, `locked_at` e passa a `running`; o worker renova `heartbeat_at` a cada 30 s.
- Novas tentativas: espera de `min(2^tentativa × 30 s, 6 h)` com variação aleatória de ±20%. Máximo de tentativas por tipo (tabela abaixo).
- `failed` não é reprocessada sozinha; fica até alguém reenfileirar, descartar ou a retenção expirar.
- Encerramento do contêiner: o worker para de pegar tarefas, espera até 30 s pelas em andamento e devolve as restantes à fila.
- Mais de um contêiner `worker` pode rodar ao mesmo tempo; `SKIP LOCKED` evita execução dupla. As recorrentes usam chave de unicidade para não duplicar.

### Idempotência

- `unique_key` opcional com índice único parcial sobre tarefas `queued` e `running`: enfileirar de novo com a mesma chave não cria segunda tarefa.
- Manipuladores conferem o estado atual antes de agir (ex.: pedido já `paid` não é pago de novo; e-mail com `sent_at` preenchido não é reenviado).
- Efeitos externos carregam chave de idempotência derivada do `id` da tarefa (Mercado Pago) ou são registrados antes do envio (e-mail).

### Tarefas sob demanda

Este é o catálogo único de tipos de tarefa; as demais specs usam exatamente estes nomes.

| Tipo | Origem | O que faz | Tentativas |
| --- | --- | --- | --- |
| `email.send` | Qualquer serviço | Envia uma linha de `email_outbox` por SMTP ([024](024-notificacoes-e-email.md)) | 8 |
| `notify` | Qualquer serviço, pela função `notify` de `packages/core` | Cria as notificações dos destinatários e enfileira e-mails conforme as preferências ([024](024-notificacoes-e-email.md)) | 5 |
| `payment.webhook` | `classroom-api` | Processa um `webhook_events`: consulta o pagamento e atualiza pedido ou assinatura ([013](013-pagamentos-mercado-pago.md)) | 10 |
| `order.fulfill` | `payment.webhook`, reconciliação | Marca o pedido pago e cria os direitos em cascata ([010](010-direitos-de-acesso.md)) | 10 |
| `refund.execute` | `admin-api` | Estorna no Mercado Pago e revoga direitos em cascata ([011](011-vendas-e-checkout.md)) | 10 |
| `entitlement.recompute` | Mudança de vínculo ebook ↔ produto, de itens de pacote ou de plano | Recalcula direitos derivados dos usuários afetados | 5 |
| `course.completed` | `classroom-api`, ao atingir 100% do curso | Dispara `certificate.render`, `gamification.award` e `notify` ([014](014-aprendizado-e-progresso.md)) | 5 |
| `certificate.render` | `course.completed`, emissão manual, reemissão | Gera o PDF e o código de validação ([015](015-certificados.md)) | 5 |
| `certificate.backfill` | Admin liga o certificado num curso já concluído por alunos | Emite os certificados pendentes ([015](015-certificados.md)) | 3 |
| `gamification.award` | Aula concluída, publicação, case, curso concluído | Lança pontos, recalcula nível e medalhas automáticas ([020](020-gamificacao.md)) | 5 |
| `event.reminder` | Criação ou mudança de horário de evento (agendada para 30 min antes) | Notifica o público do evento ([018](018-calendario-e-eventos.md)) | 3 |
| `announcement.publish` | Novidade com publicação agendada | Publica no horário marcado ([025](025-novidades.md)) | 3 |
| `account.export` | Pedido do aluno ou do admin | Monta o arquivo de dados pessoais ([030](030-lgpd.md)) | 3 |
| `account.anonymize` | Fim da carência da exclusão de conta | Anonimiza o usuário ([030](030-lgpd.md)) | 5 |

### Tarefas recorrentes

| Tipo | Frequência | O que faz |
| --- | --- | --- |
| `payment.reconcile_orders` | A cada 5 min | Consulta no provedor os pedidos `pending` há mais de 2 min e conclui, ou expira os vencidos: 30 min para cartão e Pix (`NUVA_ORDER_PENDING_MINUTES`), 3 dias para boleto (`NUVA_ORDER_BOLETO_DAYS`) ([011](011-vendas-e-checkout.md), [013](013-pagamentos-mercado-pago.md)) |
| `payment.reconcile_subscriptions` | A cada 6 h | Confere as assinaturas no provedor; aplica a carência de 3 dias e a suspensão ([012](012-assinaturas.md)) |
| `payment.reconcile_refunds` | A cada 30 min | Conclui ou marca falha nos reembolsos pedidos ([013](013-pagamentos-mercado-pago.md)) |
| `entitlement.expire` | A cada 15 min | Marca como vencidos os direitos com `expires_at` passado e desfaz a cascata |
| `suspension.expire` | A cada 15 min | Encerra as suspensões com prazo vencido ([026](026-moderacao-e-denuncias.md)) |
| `ticket.autoclose` | Diária 04:00 | Fecha os chamados `resolved` vencidos ([023](023-chamados-de-suporte.md)) |
| `gamification.weekly` | Segunda-feira 00:00 | Fecha o ranking semanal e zera o acumulado da semana ([020](020-gamificacao.md)) |
| `image.cleanup` | Diária 03:45 | Apaga imagens sem referência há mais de 24 horas ([029](029-imagens.md)) |
| `retention.purge` | Diária 03:30 | Expurga dados vencidos conforme [033](033-observabilidade-retencao-backup.md) |
| `ops.digest` | Diária 08:00 | Se houver tarefas `failed`, e-mails ou webhooks com falha, notifica os admins |

O processamento de imagens enviadas não passa pela fila: é feito na API que recebe o envio ([029](029-imagens.md)).

O agendador roda dentro do `worker`: a cada minuto enfileira as recorrentes devidas com `unique_key = tipo + janela`. Horários no fuso de `settings.timezone` (padrão `America/Sao_Paulo`).

### Casos de erro

- SMTP indisponível: `email.send` segue as tentativas; ao esgotar, fica `failed` e aparece na tela de e-mails pendentes.
- Mercado Pago indisponível: tarefas de pagamento seguem as tentativas; a reconciliação recorrente cobre o que restar.
- PostgreSQL indisponível: o worker reconecta com espera crescente; `/readyz` responde `503`.
- Erro de programação num manipulador: a tarefa falha com a mensagem e a pilha gravadas em `last_error` (sem dados pessoais nem senhas).

## Interfaces e contratos

- Sem API HTTP de negócio. Rotas internas: `/healthz`, `/readyz`, `/metrics`.
- Enfileiramento por função de `packages/core` (`enqueue(tx, type, payload, options)`), usada pelas duas APIs e pelo próprio worker.
- Aviso de nova tarefa: `NOTIFY nuva_jobs`.
- Tela de operações servida pela `admin-api` em `/api/v1/ops` ([003](003-admin-api.md)).

## Dados

Tabela `jobs` (dono: `worker`; as APIs só inserem):

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | uuid v7 | Chave |
| `type` | text | Tipo da tarefa |
| `payload` | jsonb | Apenas identificadores; nunca senha, token ou CPF |
| `status` | text | `queued`, `running`, `done`, `failed` |
| `priority` | smallint | Padrão 0; pagamento usa 10 |
| `run_at` | timestamptz | Quando pode executar |
| `attempts` / `max_attempts` | smallint | Controle de tentativas |
| `unique_key` | text | Unicidade opcional |
| `locked_by`, `locked_at`, `heartbeat_at` | — | Controle de execução |
| `last_error` | text | Último erro |
| `created_at`, `finished_at` | timestamptz | Datas |

O `worker` também é o único que escreve em: `payments`, estado de `orders` após a criação, `subscriptions`, `entitlements` com `source` `order`, `subscription` e `cascade`, `points_ledger`, `user_badges` automáticas, `certificates`, `notifications` (criação) e estado de processamento em `webhook_events`.

Retenção: `done` por 7 dias, `failed` por 30 dias ([033](033-observabilidade-retencao-backup.md)).

## Critérios de aceite

- [ ] Dois workers em paralelo nunca executam a mesma tarefa (teste com 1.000 tarefas).
- [ ] Tarefa enfileirada numa transação desfeita não existe na fila.
- [ ] Manipulador que falha é reexecutado com a espera prevista e termina em `failed` após o máximo de tentativas.
- [ ] Tarefa cujo worker foi morto volta à fila em até 5 minutos.
- [ ] Executar duas vezes `order.fulfill` para o mesmo pedido cria os direitos uma única vez.
- [ ] Recorrentes não duplicam com dois workers no ar.
- [ ] Tela de operações lista as `failed` e permite reenfileirar e descartar.
- [ ] Definition of Done ([002](002-organizacao-do-trabalho.md)) atendida.

## Fora de escopo

- Redis, Valkey, NATS ou qualquer mensageria externa.
- Fluxos encadeados com orquestração (cada tarefa enfileira a seguinte, se precisar).
- Resumo semanal por e-mail ([0017](decisions/0017-escopo-do-mvp.md)).

## Decisões relacionadas

- [0008 — Fila e SSE no PostgreSQL](decisions/0008-fila-e-sse-no-postgres.md)
- [0004 — Duas APIs, um banco](decisions/0004-duas-apis-um-banco.md)
- [0005 — Modelo de venda e Mercado Pago](decisions/0005-modelo-de-venda-e-mercado-pago.md)
