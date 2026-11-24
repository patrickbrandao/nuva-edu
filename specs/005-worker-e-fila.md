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
- Contagem de tentativas: `attempts` sobe quando o worker pega a tarefa, não quando ela falha. Tarefa com `attempts = max_attempts` não é mais pega.
- Novas tentativas: espera de `min(2^tentativa × 30 s, 6 h)` com variação aleatória de ±20%. Máximo de tentativas por tipo (tabelas abaixo).
- `failed` não é reprocessada sozinha; fica até alguém reenfileirar, descartar ou a retenção expirar.
- Encerramento do contêiner: o worker para de pegar tarefas, avisa as que estão em andamento, espera até 30 s por elas e devolve as restantes à fila. A devolução desfaz a contagem daquela tentativa (`attempts - 1`) e não mexe em `last_error`: interrupção por encerramento não é falha da tarefa. Detalhes em [Sinal de interrupção](#sinal-de-interrupção).
- Tarefa presa (RNF-04) volta à fila de imediato, com a tentativa contada (o worker morreu executando); se já gastou todas, fica `failed` com `last_error` dizendo que ficou sem batimento.
- Worker que perde a trava (a tarefa foi dada como presa e outro a pegou) abandona o resultado: concluir e falhar só valem para quem ainda é o `locked_by`. O manipulador é avisado pelo sinal para parar cedo.
- Tarefa de tipo que o worker não conhece (versões diferentes durante uma atualização) falha como erro comum e segue as tentativas; não é descartada.
- Mais de um contêiner `worker` pode rodar ao mesmo tempo; `SKIP LOCKED` evita execução dupla. As recorrentes usam chave de unicidade para não duplicar ([Tarefas recorrentes](#tarefas-recorrentes)).

### Sinal de interrupção

Cada execução recebe, no contexto do manipulador, um `AbortSignal` próprio (`context.signal`). O worker o aborta em dois momentos:

| Quando | O que acontece com a tarefa |
| --- | --- |
| O worker começa a encerrar (`SIGTERM`) | O sinal é abortado na hora, não no fim do prazo. Manipulador que para por causa dele (rejeita depois do aborto) tem a tarefa devolvida à fila de imediato, com `attempts - 1` e sem gravar `last_error`. Manipulador que termina com sucesso dentro dos 30 s conclui a tarefa normalmente (`done`). O que não terminar no prazo é devolvido do mesmo jeito, e o resultado que chegar depois é ignorado |
| O batimento descobre que a trava foi perdida | O sinal é abortado para o manipulador parar cedo; o resultado, qualquer que seja, é abandonado (outro worker já pode estar com a tarefa) |

- Abortar no início do encerramento, e não só no fim dos 30 s, foi a opção escolhida: quem acompanha o sinal (repassa a `fetch`, a uma espera) libera o contêiner cedo, e quem o ignora mantém o prazo inteiro.
- Depois do aborto por encerramento, qualquer rejeição do manipulador é tratada como interrupção, sem olhar o erro: a tarefa volta à fila sem contar a tentativa. Um erro real que coincida com o encerramento reaparece na execução seguinte.
- Acompanhar o sinal é opcional. Como a tarefa devolvida é executada de novo, vale a regra de idempotência (RF-05).
- Nas métricas, a execução interrompida assim conta com `outcome="released"` ([033](033-observabilidade-retencao-backup.md)). As devolvidas só no fim do prazo não geram contagem em `jobs_total`: o manipulador ainda não terminou.

### Idempotência

- `unique_key` opcional com índice único parcial sobre tarefas `queued` e `running`: enfileirar de novo com a mesma chave não cria segunda tarefa enquanto a primeira estiver ativa (`enqueue` devolve nulo). Depois que ela termina, a mesma chave pode ser enfileirada outra vez; quem precisa de "uma única vez" usa a regra das recorrentes.
- Manipuladores conferem o estado atual antes de agir (ex.: pedido já `paid` não é pago de novo; e-mail com `sent_at` preenchido não é reenviado).
- Efeitos externos carregam chave de idempotência derivada do `id` da tarefa (Mercado Pago) ou são registrados antes do envio (e-mail).

### Tarefas sob demanda

Este é o catálogo único de tipos de tarefa; as demais specs usam exatamente estes nomes.

| Tipo | Origem | O que faz | Tentativas |
| --- | --- | --- | --- |
| `email.send` | Qualquer serviço, por `enqueueEmail` de `packages/core` | Envia uma linha de `email_outbox` por SMTP, criando o token do link quando o tipo tem um ([024](024-notificacoes-e-email.md)) | 5, com as quatro esperas próprias de [024](024-notificacoes-e-email.md) (RNF-02: 1 min, 5 min, 30 min, 2 h) |
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
| `example.echo` | Testes e diagnóstico; nenhum fluxo do produto o enfileira | Registra no log a `message` do payload, sem outro efeito | 3 |

`example.echo` nasceu como exemplo da Fase 0 e fica no catálogo como tarefa de diagnóstico: serve aos testes da fila, ao e2e de fumaça e para conferir numa instalação que o worker está consumindo.

### Tarefas recorrentes

| Tipo | Frequência | O que faz | Tentativas |
| --- | --- | --- | --- |
| `payment.reconcile_orders` | A cada 5 min | Consulta no provedor os pedidos `pending` há mais de 2 min e conclui, ou expira os vencidos: 30 min para cartão e Pix (`NUVA_ORDER_PENDING_MINUTES`), 3 dias para boleto (`NUVA_ORDER_BOLETO_DAYS`) ([011](011-vendas-e-checkout.md), [013](013-pagamentos-mercado-pago.md)) | 3 |
| `payment.reconcile_subscriptions` | A cada 6 h | Confere as assinaturas no provedor; aplica a carência de 3 dias e a suspensão ([012](012-assinaturas.md)) | 3 |
| `payment.reconcile_refunds` | A cada 30 min | Conclui ou marca falha nos reembolsos pedidos ([013](013-pagamentos-mercado-pago.md)) | 3 |
| `entitlement.expire` | A cada 15 min | Marca como vencidos os direitos com `expires_at` passado e desfaz a cascata | 3 |
| `suspension.expire` | A cada 15 min | Encerra as suspensões com prazo vencido ([026](026-moderacao-e-denuncias.md)) | 3 |
| `ticket.autoclose` | Diária 04:00 | Fecha os chamados `resolved` vencidos ([023](023-chamados-de-suporte.md)) | 5 |
| `gamification.weekly` | Segunda-feira 00:00 | Fecha o ranking semanal e zera o acumulado da semana ([020](020-gamificacao.md)) | 5 |
| `image.cleanup` | Diária 03:45 | Apaga imagens sem referência há mais de 24 horas ([029](029-imagens.md)) | 5 |
| `retention.purge` | Diária 03:30 | Expurga dados vencidos conforme [033](033-observabilidade-retencao-backup.md) | 5 |
| `ops.digest` | Diária 08:00 | Se houver tarefas `failed`, e-mails ou webhooks com falha, notifica os admins | 5 |

O processamento de imagens enviadas não passa pela fila: é feito na API que recebe o envio ([029](029-imagens.md)).

O agendador roda dentro do `worker` e, a cada minuto, enfileira as recorrentes devidas:

- **Chave com a janela.** Cada execução tem `unique_key = <tipo>:<janela>`. A janela identifica o período a que a execução pertence:

  | Frequência | Janela | Exemplo de chave |
  | --- | --- | --- |
  | Diária | Data local, `AAAA-MM-DD` | `retention.purge:2026-11-24` |
  | Semanal | Data local da segunda-feira | `gamification.weekly:2026-11-23` |
  | A cada N minutos ou horas | Início do intervalo em UTC, `AAAA-MM-DDTHH:MM`, alinhado a múltiplos de N desde 00:00 UTC | `entitlement.expire:2026-11-24T10:15` |

- **Uma única vez por janela.** `enqueueRecurring` só insere se não existir tarefa com a mesma chave em **nenhum** estado (`queued`, `running`, `done` ou `failed`). O índice único parcial sozinho não basta: ele deixaria um segundo worker reenfileirar a janela que o primeiro já concluiu. A consulta de existência usa o índice simples de `unique_key`.
- **Janela residual.** Dois workers podem passar juntos pela consulta de existência; o índice único segura o segundo enquanto a tarefa do primeiro está ativa. Se ela terminar exatamente nesse intervalo, a janela é enfileirada duas vezes. Não há trava para isso: os manipuladores das recorrentes são idempotentes (RF-05), e a segunda execução não encontra nada a fazer.
- **Horário já passado.** Diária e semanal ficam devidas a partir do horário marcado e até o fim do dia local: worker que sobe depois do horário ainda enfileira a janela do dia, uma vez. Dia em que nenhum worker esteve no ar não é recuperado.
- **Falha.** Recorrente `failed` não bloqueia a janela seguinte. As de intervalo têm 3 tentativas, porque a janela seguinte refaz o trabalho; as diárias e a semanal têm 5.
- **Fuso.** Horários de diárias e da semanal no fuso da escola: chave `school.timezone` de `settings` (padrão `America/Sao_Paulo`; [031](031-infraestrutura-e-deploy.md), "Configurações da escola"). Valor inválido gera aviso no log e vale o padrão. O fuso é relido a cada minuto, sem reiniciar o worker.
- A retenção apaga as recorrentes concluídas depois de 7 dias; a essa altura a janela já passou e não volta a ficar devida.

### Casos de erro

- SMTP indisponível: `email.send` segue as tentativas; ao esgotar, fica `failed` e aparece na tela de e-mails pendentes.
- Mercado Pago indisponível: tarefas de pagamento seguem as tentativas; a reconciliação recorrente cobre o que restar.
- PostgreSQL indisponível: o worker reconecta com espera crescente; `/readyz` responde `503`.
- Erro de programação num manipulador: a tarefa falha com a mensagem e a pilha gravadas em `last_error` (sem dados pessoais nem senhas).

## Interfaces e contratos

- Sem API HTTP de negócio. Rotas internas: `/healthz`, `/readyz`, `/metrics`.
- Enfileiramento por função de `packages/core` (`enqueue(tx, type, payload, options)`), usada pelas duas APIs e pelo próprio worker.
- Enfileiramento de recorrente: `enqueueRecurring(tx, type, payload, { window })`, usada só pelo agendador.
- Aviso de nova tarefa: `NOTIFY nuva_jobs`, sem conteúdo, emitido por gatilho da tabela (ver "Dados"); o worker que o recebe consulta a fila.
- Tela de operações servida pela `admin-api` em `/api/v1/ops` ([003](003-admin-api.md)):

| Ação | Efeito | Erros |
| --- | --- | --- |
| Reenfileirar (`POST /ops/jobs/{id}/retry`) | A tarefa `failed` volta a `queued` para agora, com `attempts = 0`; `last_error` fica como registro | `404 not_found` se não existe; `409 job_not_failed` se não está `failed`; `409 job_already_active` se já existe tarefa `queued` ou `running` com a mesma `unique_key` |
| Descartar (`DELETE /ops/jobs/{id}`) | Apaga a tarefa `failed` | `404 not_found`; `409 job_not_failed` |

As duas ações gravam auditoria ([028](028-auditoria.md)).

## Dados

Tabela `jobs` (dono: `worker`; as APIs só inserem):

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | uuid v7 | Chave; padrão `uuidv7()` |
| `type` | text | Tipo da tarefa, no formato `palavra.palavra` em minúsculas (`^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$`) |
| `payload` | jsonb | Sempre um objeto (padrão `{}`); apenas identificadores, nunca senha, token ou CPF |
| `status` | text | `queued` (padrão), `running`, `done`, `failed` |
| `priority` | smallint | Maior primeiro. Padrão 0; pagamento usa 10 |
| `run_at` | timestamptz | Quando pode executar; padrão `now()` |
| `attempts` / `max_attempts` | smallint | Padrões 0 e 5; `0 <= attempts <= max_attempts` e `max_attempts >= 1`. Quem enfileira pela função do núcleo usa o máximo do tipo |
| `unique_key` | text | Unicidade opcional; nula ou não vazia |
| `locked_by`, `locked_at`, `heartbeat_at` | text, timestamptz, timestamptz | Controle de execução. Os três preenchidos em `running`, os três nulos em `queued`; `done` e `failed` guardam a última trava como registro de quem executou |
| `last_error` | text | Último erro, já mascarado e cortado em 8.000 caracteres |
| `created_at`, `finished_at` | timestamptz | `finished_at` preenchido se, e só se, o estado é `done` ou `failed` |

As regras da coluna "Descrição" são restrições `CHECK` da tabela (migrations 0002 e 0003): o banco recusa estado incoerente mesmo que o código erre.

Índices:

| Índice | Sobre | Para |
| --- | --- | --- |
| `jobs_ready_idx` | `(priority DESC, run_at)` onde `status = 'queued'` | Consumo com `SKIP LOCKED` |
| `jobs_unique_key_active_unique` (único) | `(unique_key)` onde `status IN ('queued', 'running')` | Deduplicação entre tarefas ativas |
| `jobs_unique_key_idx` | `(unique_key)` onde `unique_key IS NOT NULL` | Existência da recorrente em qualquer estado |
| `jobs_running_heartbeat_idx` | `(heartbeat_at)` onde `status = 'running'` | Tarefa presa |
| `jobs_finished_idx` | `(status, finished_at)` onde `status IN ('done', 'failed')` | Retenção e lista de falhas do `/ops` |

Aviso (`NOTIFY nuva_jobs`, sem conteúdo), por gatilho:

- em `INSERT`, quando a tarefa nasce `queued` e já pode executar;
- em `UPDATE` de `status` ou `run_at`, quando a tarefa passa a `queued` e já pode executar: é o que acorda o worker ao reenfileirar pelo `/ops`, ao devolver à fila no encerramento ou ao antecipar o `run_at`.

Tarefa agendada para depois não gera aviso; a varredura de 5 s a pega. O aviso só é entregue no `COMMIT`, então tarefa de transação desfeita não acorda ninguém.

O `worker` também é o único que escreve em: `payments`, estado de `orders` após a criação, `subscriptions`, `entitlements` com `source` `order`, `subscription` e `cascade`, `points_ledger`, `user_badges` automáticas, `certificates`, `notifications` (criação) e estado de processamento em `webhook_events`.

Retenção: `done` por 7 dias, `failed` por 30 dias ([033](033-observabilidade-retencao-backup.md)).

## Critérios de aceite

- [ ] Dois workers em paralelo nunca executam a mesma tarefa (teste com 1.000 tarefas).
- [ ] Tarefa enfileirada numa transação desfeita não existe na fila.
- [ ] Manipulador que falha é reexecutado com a espera prevista e termina em `failed` após o máximo de tentativas.
- [ ] Tarefa cujo worker foi morto volta à fila em até 5 minutos.
- [ ] Executar duas vezes `order.fulfill` para o mesmo pedido cria os direitos uma única vez.
- [ ] Recorrentes não duplicam com dois workers no ar, nem depois de a tarefa da janela ter sido concluída.
- [ ] Worker que sobe depois do horário de uma diária enfileira a janela do dia uma única vez.
- [ ] Tarefa devolvida à fila no encerramento mantém o número de tentativas que tinha antes de ser pega.
- [ ] Manipulador que para ao ver o sinal no encerramento tem a tarefa devolvida à fila antes do prazo, sem tentativa contada e sem `last_error`; perda da trava aborta o sinal da tarefa.
- [ ] Reenfileirar uma `failed` zera as tentativas e acorda o worker; com outra tarefa ativa de mesma chave, responde `409 job_already_active`.
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
