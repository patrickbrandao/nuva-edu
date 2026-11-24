# 018 — Calendário e eventos

Status: aprovada
Depende de: 000, 001, 003, 004, 008, 009, 010, 024

## Contexto

A escola faz lives e encontros. O calendário mostra ao aluno o que está acontecendo, o que vem e o que já passou, entrega o link de transmissão a quem tem direito e aponta a gravação quando ela vira aula. A transmissão acontece em serviço externo (Meet, Zoom, YouTube); o sistema só guarda o link.

## Requisitos

- RF-01: A equipe (`manager`, `admin`; `instructor` para eventos ligados aos próprios cursos) cria, edita, cancela e apaga eventos.
- RF-02: Cada evento define um público: `all`, `active` ou `product` (lista de produtos).
- RF-03: O status é calculado a partir do horário: `upcoming`, `live`, `past`; além de `canceled`, definido manualmente.
- RF-04: O link de transmissão só é entregue pela API a quem pertence ao público, a partir de 15 minutos antes do início até o fim.
- RF-05: Um evento passado pode apontar para uma aula como gravação.
- RF-06: O aluno vê agenda mensal, lista de eventos, filtro por dia e aba de gravações.
- RF-07: Criar um evento notifica o público; um lembrete é enviado 30 minutos antes do início a quem pertence ao público.
- RNF-01: A agenda de um mês responde com p95 abaixo de 300 ms.
- RNF-02: O status exibido nunca diverge do horário real em mais de 60 segundos (recalculado no cliente a partir de `starts_at` e `ends_at`, com a hora do servidor informada na resposta).

## Comportamento

### Público

| `audience` | Quem acessa o link e os detalhes completos |
| --- | --- |
| `all` | Qualquer cadastrado |
| `active` | Quem tem ao menos um direito ativo a produto não `open`, ou é da equipe |
| `product` | Quem tem direito ativo a pelo menos um dos produtos listados em `event_products` ([010](010-direitos-de-acesso.md)) |

- Todos os cadastrados veem título, descrição, data, tipo e público de qualquer evento não cancelado. Quem não pertence ao público vê o bloqueio "exclusivo para alunos" com o caminho para obter acesso (os produtos do evento ou a vitrine), nunca o link.
- A equipe sempre vê o link.

### Status

- `upcoming`: agora < `starts_at`. `live`: `starts_at` ≤ agora < `ends_at`. `past`: agora ≥ `ends_at`.
- `canceled`: marcado pela equipe; aparece riscado na agenda até a data e gera notificação ao público.
- Não é guardado no banco, exceto o cancelamento (`canceled_at`).

### Regras

- Campos: título, descrição (Markdown saneado), tipo (`live`, `meeting`, `workshop`, `other`), `starts_at`, `ends_at` (maior que o início, duração máxima de 12 horas), link de transmissão (URL `https`), público, curso relacionado (opcional), aula de gravação (opcional).
- Horários guardados em UTC e exibidos no fuso do navegador; o admin informa o horário no fuso do próprio navegador.
- Recorrência: ao criar, a equipe pode repetir o evento semanalmente por N semanas (1 a 26); o sistema cria N eventos independentes, editáveis um a um.
- Gravação: `recording_lesson_id` aponta para uma aula; a aba "Gravações" lista eventos passados com gravação, e o acesso à aula segue as regras da própria aula ([014](014-aprendizado-e-progresso.md)).
- Banner na página inicial do classroom quando há evento `live` visível para o usuário.
- Notificações: `event.created`, `event.reminder` (30 min antes), `event.canceled` ([024](024-notificacoes-e-email.md)); o lembrete é a tarefa `event.reminder`, agendada no worker ([005](005-worker-e-fila.md)), refeita se o horário mudar.

### Casos de erro

| Situação | Resposta |
| --- | --- |
| Pedir o link fora do público | 403 `event_forbidden` |
| Pedir o link antes da janela de 15 minutos | 409 `event_not_open`, com o horário de abertura |
| `ends_at` ≤ `starts_at` ou duração acima de 12 h | 422 |

## Interfaces e contratos

- `apps/classroom-api/openapi.yaml`: `GET /events?from&to`, `GET /events/{id}`, `GET /events/{id}/join` (devolve o link), `GET /events/recordings`.
- `apps/admin-api/openapi.yaml`: `GET|POST /events`, `GET|PATCH|DELETE /events/{id}`, `POST /events/{id}/cancel`.

## Dados

| Tabela | Campos principais | Dono (escrita) |
| --- | --- | --- |
| `events` | `title`, `description_md`, `description_html`, `kind`, `starts_at`, `ends_at`, `stream_url`, `audience`, `course_id`, `recording_lesson_id`, `series_id`, `canceled_at`, `created_by` | `admin-api` |
| `event_products` | `event_id`, `product_type`, `product_id` | `admin-api` |

Retenção: permanente. `stream_url` nunca aparece em listagens, logs ou respostas a quem está fora do público.

## Critérios de aceite

- [ ] Evento `product` mostra o link só a quem tem o produto; os demais recebem 403 e veem o bloqueio.
- [ ] O link não é entregue antes de 15 minutos do início nem após o fim.
- [ ] Status muda de `upcoming` para `live` e para `past` conforme o relógio, sem recarregar a página.
- [ ] Repetição semanal por 4 semanas cria 4 eventos independentes.
- [ ] Evento passado com gravação aparece na aba "Gravações" e leva à aula.
- [ ] Criar, cancelar e lembrar geram as notificações correspondentes só para o público.

## Fora de escopo

- Transmissão própria, inscrição com vagas, lista de presença, exportação `.ics`, integração com Google Calendar, recorrência com regras além de "semanal por N semanas".

## Decisões relacionadas

- [0017 — Escopo do MVP](decisions/0017-escopo-do-mvp.md)
- [0006 — Conteúdo por link externo](decisions/0006-conteudo-por-link-externo.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md) (P-06)
