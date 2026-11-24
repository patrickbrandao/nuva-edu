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
- RNF-02: E-mail: até 5 tentativas com espera crescente (1 min, 5 min, 30 min, 2 h, 12 h); depois marca `failed`.
- RNF-03: No máximo 1 e-mail por usuário, por tipo e por alvo a cada 15 minutos (agrupamento).
- RNF-04: Notificações lidas são apagadas após 90 dias; não lidas após 180 dias (`NUVA_RETENTION_*`, ver [033](033-observabilidade-retencao-backup.md)).

## Comportamento

### Tipos e grupos

| Grupo (preferência) | Tipos | Plataforma | E-mail (padrão) |
| --- | --- | --- | --- |
| `account` (obrigatório) | `account.verify_email`, `account.password_reset`, `account.new_login`, `account.password_changed`, `account.deleted` | — | sempre |
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
- Ninguém é notificado das próprias ações. Usuário suspenso ou removido não recebe nada, exceto `moderation.suspended` e `account.deleted`.

### Central

- Cada item mostra ícone do tipo, foto de quem gerou, título, texto curto, tempo relativo e link para o alvo. Abrir o item marca como lido.
- Agrupamento: notificações do mesmo tipo e alvo ainda não lidas são fundidas ("Ana e mais 3 responderam em…").
- Evento SSE `notification.created` com o contador atualizado ([004](004-classroom-api.md)). A equipe recebe as do grupo `staff` também no sino do site admin.

### E-mail

- Transporte SMTP configurado por `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`; TLS obrigatório fora do desenvolvimento. No desenvolvimento, Mailpit ([031](031-infraestrutura-e-deploy.md)).
- Cada e-mail é uma linha em `email_outbox`, processada pela tarefa `email.send` ([005](005-worker-e-fila.md)). SMTP fora do ar não bloqueia nenhuma ação do usuário.
- Modelos ficam no código do worker, em arquivos por tipo e por idioma; textos via arquivos de tradução. O admin edita apenas nome da escola, logotipo, cor e rodapé.
- Links de confirmação e de redefinição expiram em 24 h ([007](007-contas-e-autenticacao.md)); o e-mail nunca contém a senha.
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
| `email_outbox` | `user_id`, `to`, `type`, `subject`, `data` (JSON), `status` (`queued`/`sent`/`failed`), `attempts`, `last_error`, `sent_at` | `worker` |

Retenção: `notifications` conforme RNF-04; `email_outbox` enviados por 30 dias e com falha por 90 dias. O corpo renderizado do e-mail não é guardado; `data` não contém senha nem token em claro.

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
