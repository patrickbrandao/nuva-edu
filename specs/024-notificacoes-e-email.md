# 024 — Notificações e e-mail

Status: aprovada
Depende de: 000, 001, 004, 005, 007, 033

## Contexto

Vários recursos precisam avisar o usuário: resposta no fórum, compra aprovada, resposta de chamado, aula nova. Esta spec centraliza o mecanismo — central de notificações (sino), preferências por tipo e e-mail transacional por SMTP — para que cada recurso apenas declare o evento.

## Requisitos

- RF-01: Toda notificação é criada pelo worker a partir de uma tarefa `notify`, com tipo, destinatário, autor (opcional), alvo e dados do modelo.
- RF-02: A central lista as notificações do usuário, com lidas e não lidas, "marcar todas como lidas" e "limpar todas"; o sino mostra o contador de não lidas em tempo real por SSE.
- RF-03: O usuário liga e desliga, por grupo, o canal "plataforma" e o canal "e-mail".
- RF-04: E-mails transacionais obrigatórios (conta e compra) não podem ser desligados.
- RF-05: E-mails são enviados por SMTP pela fila, com novas tentativas; falhas aparecem na tela de operação do admin.
- RF-06: Cada tipo tem um modelo de e-mail em pt-BR (assunto, texto e HTML), com nome e logotipo da escola vindos de `settings`.
- RF-07: Todo e-mail não obrigatório tem link de descadastro de um clique para o grupo correspondente, sem exigir login.
- RNF-01: Notificação na central em até 5 segundos após o fato (p95); contador do sino atualizado em até 2 segundos após a criação.
- RNF-02: E-mail: até 5 tentativas da tarefa `email.send`, com espera própria entre elas (1 min, 5 min, 30 min, 2 h: quatro esperas para cinco tentativas) no lugar da regra geral da fila ([005](005-worker-e-fila.md)); depois marca `failed`.
- RNF-03: No máximo 1 e-mail por usuário, por tipo e por alvo a cada 15 minutos (agrupamento).
- RNF-04: Notificações lidas são apagadas após 90 dias; não lidas após 180 dias (`NUVA_RETENTION_*`, ver [033](033-observabilidade-retencao-backup.md)).

## Comportamento

### Tipos e grupos

| Grupo (preferência) | Tipos | Plataforma | E-mail (padrão) |
| --- | --- | --- | --- |
| `account` (obrigatório) | `account.verify_email`, `account.password_reset`, `account.exists`, `account.new_login`, `account.locked`, `account.password_changed`, `account.role_changed`, `account.deleted` | — | sempre |
| `purchase` (obrigatório) | `order.approved`, `order.refunded`, `subscription.renewed`, `subscription.payment_failed`, `subscription.canceled`, `subscription.expired`, `access.granted`, `access.revoked` | sim | sempre |
| `courses` | `lesson.published` (curso que o usuário possui), `course.published`, `certificate.issued` | sim | ligado |
| `forum` | `forum.reply` (tópico seguido), `forum.mention`, `forum.solution` | sim | ligado |
| `messages` | `dm.received` | sim | desligado |
| `community` | `follow.created`, `case.liked`, `case.commented`, `badge.awarded`, `level.up` | sim | desligado |
| `events` | `event.created`, `event.reminder`, `event.canceled` | sim | ligado |
| `support` | `ticket.reply`, `ticket.status_changed` | sim | sempre (não desligável) |
| `announcements` | `announcement.published` | sim | desligado |
| `moderation` | `moderation.content_hidden`, `moderation.warning`, `moderation.suspended` | sim | sempre |
| `staff` (só equipe) | `ticket.opened`, `ticket.user_reply`, `report.created`, `ops.job_failed` | sim | ligado |

- A regra de quem deve receber cada tipo está na spec do recurso; aqui fica o transporte.
- O worker confere, no momento do envio, se o destinatário ainda pode ver o alvo (por exemplo, perdeu o acesso ao curso); se não puder, descarta.
- Ninguém é notificado das próprias ações. Usuário suspenso ou removido não recebe nada, exceto `moderation.suspended` e `account.deleted`. A regra vale para as notificações (tarefa `notify`); os e-mails do grupo `account` seguem a regra própria da seção abaixo.

### Central

- Cada item mostra ícone do tipo, foto de quem gerou, título, texto curto, tempo relativo e link para o alvo. Abrir o item marca como lido.
- Agrupamento: notificações do mesmo tipo e alvo ainda não lidas são fundidas ("Ana e mais 3 responderam em…").
- Evento SSE `notification.created` com o contador atualizado ([004](004-classroom-api.md)). A equipe recebe as do grupo `staff` também no sino do site admin.

### E-mail

- Transporte SMTP configurado por `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`. Porta 465: TLS desde a conexão; outra porta: `STARTTLS` obrigatório. A única exceção é `SMTP_HOST=mailpit` (o Mailpit do Compose), que dispensa TLS. Com `SMTP_USER` definido, `SMTP_PASSWORD` é obrigatório e a autenticação é feita; sem ele, não há autenticação. No desenvolvimento, Mailpit ([031](031-infraestrutura-e-deploy.md)).
- Cada e-mail é uma linha em `email_outbox`, processada pela tarefa `email.send` ([005](005-worker-e-fila.md)). SMTP fora do ar não bloqueia nenhuma ação do usuário.
- Modelos ficam no código do worker, em arquivos por tipo e por idioma; textos via arquivos de tradução. O admin edita apenas nome da escola, logotipo, cor e rodapé.
- Links de confirmação e de redefinição expiram em 24 h ([007](007-contas-e-autenticacao.md)); o e-mail nunca contém a senha.

### E-mails do grupo `account` e da Fase 1

O grupo `account` não tem canal "plataforma", então não passa pela tarefa `notify`: a função `enqueueEmail(trx, { userId, type, data })` de `packages/core` grava a linha de `email_outbox` (com `to` = e-mail atual do usuário) e enfileira `email.send` na mesma transação da ação. Na Fase 1, antes da central de notificações, `moderation.suspended` usa o mesmo caminho; com a Fase 4 ele passa a sair por `notify`, com os dois canais.

| Tipo | Quando ([007](007-contas-e-autenticacao.md), [008](008-papeis-e-permissoes.md)) | `data` | Link |
| --- | --- | --- | --- |
| `account.verify_email` | Cadastro por senha, reenvio, conta criada pelo admin, e-mail trocado, cadastro social sem e-mail verificado | — | `<classroomUrl>/confirmar?token=` (token `verify`) |
| `account.password_reset` | "Esqueci a senha" | — | `<classroomUrl>/redefinir?token=` (token `reset`) |
| `account.exists` | Cadastro com e-mail que já tem conta | — | `<classroomUrl>/entrar` e `<classroomUrl>/redefinir` |
| `account.new_login` | Login em dispositivo novo | `at`, `ip`, `browser`, `os`, `site` | `<classroomUrl>/conta/acesso` |
| `account.locked` | Primeiro bloqueio da conta na janela | `until` | `<classroomUrl>/redefinir` |
| `account.password_changed` | Senha definida, trocada, redefinida ou definida pelo admin | `by` (`self` ou `admin`) | `<classroomUrl>/redefinir` |
| `account.role_changed` | Papel alterado pelo admin | `role` | `<adminUrl>` quando o papel novo é de equipe |
| `moderation.suspended` | Suspensão aplicada | `kind`, `endsAt` (ou nulo) | — |

- Assunto e textos em pt-BR, nos arquivos de tradução do worker; o nome da escola vem de `settings` (`school.name`) no momento do envio.
- `data` não leva senha, token nem motivo interno de suspensão.
- Conta suspensa, com suspensão `full` ou `posting`, recebe todos os e-mails desta tabela: são de segurança da própria conta (confirmação de e-mail, redefinição de senha, bloqueio, dispositivo novo, mudança de senha ou de papel) e não dependem de a pessoa poder entrar. Conta excluída não recebe nenhum: `enqueueEmail` a deixa de fora. A suspensão não muda o envio; só a exclusão o impede.

### E-mails da Fase 2

Até a central de notificações (Fase 4), os dois avisos da Fase 2 saem só por e-mail, pelo mesmo caminho do grupo `account`: `enqueueEmail` na transação da ação. Com a Fase 4 passam a sair por `notify`, com os dois canais e as preferências do grupo.

| Tipo | Grupo | Quando | `data` | Link |
| --- | --- | --- | --- | --- |
| `access.granted` | `purchase` | Concessão manual de acesso ([010](010-direitos-de-acesso.md)); na Fase 3 também pedido pago e assinatura | `productType`, `productTitle`, `expiresAt` (ou nulo) | `<classroomUrl>/meus-cursos` (curso e pacote) ou `<classroomUrl>/meus-ebooks` (ebook) |
| `certificate.issued` | `courses` | Certificado emitido, automático, manual ou retroativo ao cadastrar o template ([015](015-certificados.md)); não sai na reemissão | `courseTitle`, `code` | `<classroomUrl>/progresso` e `<classroomUrl>/certificados/<code>` |

- Só para o titular; conta excluída não recebe, e conta suspensa (`full`) também não, porque não pode usar o que o e-mail anuncia.
- `certificate.issued` é de grupo desligável, mas até a Fase 4 não há preferência a respeitar: sai sempre, sem `List-Unsubscribe`. O cabeçalho entra com as preferências.

### Links com token

- A tarefa `email.send` cria o token do link no momento de montar o e-mail (tipos `account.verify_email` e `account.password_reset`): gera o valor aleatório, grava o SHA-256 em `email_tokens` com validade de 24 h, invalida os anteriores do mesmo usuário e propósito e põe o valor em claro só no corpo enviado ([007](007-contas-e-autenticacao.md), "Tokens de e-mail").
- Nova tentativa do mesmo e-mail gera token novo; o anterior deixa de valer.
- Se o usuário já confirmou o e-mail quando `account.verify_email` vai sair, a linha é marcada `sent` sem envio (`last_error = 'skipped: already_verified'`).
- Se o `to` da linha não é mais o e-mail atual do usuário (a equipe trocou o e-mail depois do enfileiramento), `account.verify_email` e `account.password_reset` são marcados `sent` sem envio e sem token (`last_error = 'skipped: email_changed'`) ([007](007-contas-e-autenticacao.md), "Tokens de e-mail").
- Cabeçalhos `List-Unsubscribe` e `List-Unsubscribe-Post` nos e-mails não obrigatórios; o token de descadastro identifica usuário e grupo e não expira.
- Tela de operação no admin: e-mails pendentes e com falha, com motivo e botão "reenviar".

### Casos de erro

| Situação | Comportamento |
| --- | --- |
| SMTP recusa o destinatário (erro permanente) | Marca `failed` sem novas tentativas; após 3 falhas permanentes seguidas marca o e-mail do usuário como `undeliverable` e avisa na central |
| SMTP indisponível | Novas tentativas conforme RNF-02 |
| Tipo desconhecido na tarefa | Tarefa falha e aparece na tela de operação |

## Interfaces e contratos

- `apps/classroom-api/openapi.yaml`: `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/{id}/read`, `POST /notifications/read-all`, `DELETE /notifications`, `GET|PUT /me/notification-prefs`, `POST /unsubscribe/{token}` (sem login).
- `apps/admin-api/openapi.yaml`: as mesmas rotas de central para a equipe; `GET /ops/emails`, `POST /ops/emails/{id}/retry`; `GET|PUT /settings/branding`.
- Função `notify(type, recipients, payload)` em `packages/core`, único ponto de entrada para as APIs e o worker.

## Dados

| Tabela | Campos principais | Dono (escrita) |
| --- | --- | --- |
| `notifications` | `user_id`, `type`, `actor_id`, `target_type`, `target_id`, `data` (JSON), `group_key`, `count`, `read_at`, `created_at` | `worker` (criação); `classroom-api` e `admin-api` (leitura, limpeza) |
| `notification_prefs` | `user_id`, `group`, `in_app`, `email` | `classroom-api` |
| `email_outbox` | `id`, `user_id`, `to`, `type`, `subject`, `data` (JSON), `status` (`queued`/`sent`/`failed`), `attempts`, `last_error`, `created_at`, `sent_at` | `worker` (envio); APIs e worker inserem por `enqueueEmail` |

Retenção: `notifications` conforme RNF-04; `email_outbox` enviados por 30 dias e com falha por 90 dias. O corpo renderizado do e-mail não é guardado; `data` não contém senha nem token em claro.

Decisões de esquema da migration 0007 (aceitas na tarefa 198):

- A coluna `to` segue o nome desta spec; é palavra reservada e vai sempre entre aspas no SQL (`"to"`). Guarda o e-mail do usuário no momento do enfileiramento, e a fila do usuário é apagada na exclusão de conta ([030](030-lgpd.md)).
- `sent_at` existe se, e só se, `status = 'sent'`; o "reenviar" da tela de operação devolve `failed` a `queued`. `subject` é nulo até o envio e não é amarrado ao estado: o envio pulado (`skipped: already_verified`) fica `sent` sem montar o e-mail.
- O expurgo dos com falha (90 dias) conta de `created_at`: a tabela não guarda a data da falha. O dos enviados (30 dias) conta de `sent_at`.
- `type` segue o formato dos códigos do catálogo (minúsculas, ao menos um ponto) e `data` é um objeto JSON.

## Critérios de aceite

- [ ] Resposta em tópico seguido cria notificação e incrementa o sino do destinatário sem recarregar.
- [ ] Desligar o e-mail do grupo `forum` impede o e-mail e mantém a notificação na plataforma.
- [ ] Não é possível desligar e-mails dos grupos `account`, `purchase`, `support` e `moderation`.
- [ ] Com o SMTP fora do ar, o cadastro conclui e o e-mail é enviado quando o SMTP volta.
- [ ] Cinco respostas no mesmo tópico em 10 minutos geram um e-mail e uma notificação agrupada.
- [ ] O link de descadastro funciona sem login e afeta só o grupo indicado.
- [ ] Usuário que perdeu o acesso ao curso não recebe `lesson.published` dele.
- [ ] Nenhum e-mail nem registro de `email_outbox` contém a senha do usuário.

## Fora de escopo

- Resumo semanal por e-mail, notificações push do navegador, SMS e WhatsApp, edição completa de modelos pelo admin, webhooks de bounce de provedores.

## Decisões relacionadas

- [0008 — Fila e SSE no Postgres](decisions/0008-fila-e-sse-no-postgres.md)
- [0017 — Escopo do MVP](decisions/0017-escopo-do-mvp.md)
- [0002 — Senha em texto legível](decisions/0002-senha-em-texto-legivel.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md) (F2-11, F4-06)
