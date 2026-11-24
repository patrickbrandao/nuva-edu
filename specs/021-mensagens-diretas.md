# 021 — Mensagens diretas

Status: aprovada
Depende de: 000, 001, 004, 008, 010, 019, 024, 026

## Contexto

Membros conversam em privado, um a um. Como o cadastro é livre, a conversa é restrita a quem tem acesso ativo ou é da equipe, e vem acompanhada de bloqueio, denúncia e limite de envio para conter spam e assédio.

## Requisitos

- RF-01: Conversas são sempre entre exatamente dois usuários; existe no máximo uma conversa por par.
- RF-02: Só inicia ou envia mensagem quem tem ao menos um direito ativo a produto não `open` ([010](010-direitos-de-acesso.md)) ou é da equipe (`instructor`, `manager`, `admin`), e tem e-mail confirmado.
- RF-03: Mensagens chegam em tempo real por SSE; a lista de conversas mostra prévia, hora e contador de não lidas.
- RF-04: O usuário bloqueia e desbloqueia outro usuário, e denuncia uma mensagem ou uma conversa.
- RF-05: O usuário silencia uma conversa (sem notificação) e a arquiva (some da lista até nova mensagem).
- RF-06: Busca de destinatário por nome ou `@handle`, com "online agora" primeiro.
- RNF-01: Mensagem entregue ao destinatário conectado em até 2 segundos (p95).
- RNF-02: Limites por remetente: 30 mensagens por minuto e 10 conversas novas por dia (ajustáveis em `settings`); mensagem com até 5.000 caracteres.
- RNF-03: Histórico paginado por cursor, 50 mensagens por página, p95 abaixo de 300 ms.

## Comportamento

### Quem fala com quem

| Remetente | Pode iniciar com |
| --- | --- |
| Aluno com acesso ativo | Qualquer aluno com acesso ativo e qualquer membro da equipe |
| Equipe | Qualquer usuário, inclusive sem acesso ativo |
| Aluno sem acesso ativo | Ninguém; só responde em conversa iniciada pela equipe. Para falar com a escola, usa chamado ([023](023-chamados-de-suporte.md)) |

- Se o remetente perde o acesso ativo, as conversas ficam somente leitura para ele, salvo as iniciadas pela equipe.
- O destinatário pode desligar "aceito mensagens de alunos" no perfil; a equipe sempre consegue escrever.
- Usuário suspenso não envia; removido aparece como "usuário removido" e a conversa fica somente leitura.

### Mensagens

- Texto simples com quebras de linha, links clicáveis (`rel="nofollow noopener"`) e emoji. Sem Markdown, HTML, anexos ou imagens. Todo o texto é escapado na exibição.
- Estados: enviada e lida (`read_at`). A leitura é marcada quando o destinatário abre a conversa; a confirmação de leitura é visível ao remetente.
- O autor apaga a própria mensagem em até 15 minutos; ela vira "mensagem apagada". Não há edição.
- Envio por `POST`; a `classroom-api` grava, emite `NOTIFY` e o destinatário recebe o evento SSE `dm.message.created`; `dm.message.read` avisa o remetente. Se o destinatário está desconectado, gera notificação `dm.received` ([024](024-notificacoes-e-email.md)), no máximo uma por conversa a cada 15 minutos.

### Bloqueio e denúncia

- Bloquear impede mensagens nos dois sentidos, desfaz "seguir" ([019](019-perfil-e-diretorio.md)) e oculta o bloqueador do diretório para o bloqueado. O bloqueado não é avisado; ao tentar enviar recebe erro genérico de indisponibilidade.
- Não é possível bloquear a equipe.
- Denunciar envia a mensagem (e as 10 anteriores e 10 seguintes da conversa, como contexto) à fila de moderação ([026](026-moderacao-e-denuncias.md)). Esse é o único caso em que a equipe lê mensagens diretas, e o acesso fica na auditoria ([028](028-auditoria.md)).

### Casos de erro

| Situação | Resposta |
| --- | --- |
| Remetente sem acesso ativo | 403 `dm_requires_access` |
| Destinatário bloqueou, não aceita mensagens ou está indisponível | 403 `dm_unavailable` (mesma resposta para os três casos) |
| Limite de envio | 429 com `Retry-After` |
| Conversa de terceiros | 404 |

## Interfaces e contratos

- `apps/classroom-api/openapi.yaml`: `GET /conversations`, `POST /conversations` (por `handle`; devolve a existente se já houver), `GET /conversations/{id}/messages`, `POST /conversations/{id}/messages`, `POST /conversations/{id}/read`, `PATCH /conversations/{id}` (silenciar, arquivar), `DELETE /messages/{id}`, `GET /dm/recipients?q=`, `GET|POST /me/blocks`, `DELETE /me/blocks/{userId}`, `POST /messages/{id}/report`.
- Eventos SSE em `GET /api/v1/stream`: `dm.message.created`, `dm.message.read`, `dm.message.deleted` ([004](004-classroom-api.md)).
- `apps/admin-api/openapi.yaml`: nenhuma rota de leitura de conversas; só o trecho anexado a uma denúncia, via fila de moderação.

## Dados

| Tabela | Campos principais | Dono (escrita) |
| --- | --- | --- |
| `conversations` | `user_a_id`, `user_b_id` (par ordenado, único), `last_message_at`, `started_by` | `classroom-api` |
| `conversation_members` | `conversation_id`, `user_id`, `last_read_at`, `muted`, `archived_at` | `classroom-api` |
| `messages` | `conversation_id`, `sender_id`, `body`, `created_at`, `read_at`, `deleted_at` | `classroom-api` |
| `user_blocks` | `blocker_id`, `blocked_id`, `created_at` | `classroom-api` |

Retenção: mensagens permanecem enquanto ao menos um dos dois participantes tiver conta. Na exclusão de conta ([030](030-lgpd.md)), as mensagens do usuário ficam para o outro participante com autor "usuário removido". O corpo das mensagens nunca vai para logs.

## Critérios de aceite

- [ ] Aluno sem produto pago recebe 403 ao iniciar conversa e consegue responder a uma conversa aberta pela equipe.
- [ ] Mensagem aparece para o destinatário conectado em até 2 segundos, sem recarregar.
- [ ] Contador de não lidas zera ao abrir a conversa e o remetente vê a confirmação de leitura.
- [ ] Após o bloqueio, nenhum dos dois consegue enviar, e a resposta ao bloqueado não revela o bloqueio.
- [ ] A 31ª mensagem no mesmo minuto retorna 429.
- [ ] Texto com `<script>` é exibido como texto.
- [ ] Usuário não consegue ler conversa de terceiros por identificador (404).
- [ ] A equipe só vê mensagens anexadas a uma denúncia, e essa leitura gera registro de auditoria.

## Fora de escopo

- Conversas em grupo, anexos e imagens, mensagens de voz, indicador "digitando", edição de mensagem, criptografia de ponta a ponta, WebSocket.

## Decisões relacionadas

- [0008 — Fila e SSE no Postgres](decisions/0008-fila-e-sse-no-postgres.md)
- [0017 — Escopo do MVP](decisions/0017-escopo-do-mvp.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md) (F1-22)
