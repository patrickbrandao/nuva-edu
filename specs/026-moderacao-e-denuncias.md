# 026 — Moderação e denúncias

Status: aprovada
Depende de: 000, 001, 003, 004, 007, 008, 017, 019, 021, 022, 024, 028

## Contexto

O conteúdo dos alunos (fórum, cases, comentários, perfil, mensagens) é publicado na hora, sem aprovação prévia. A contrapartida é um mecanismo único de denúncia, uma fila para a equipe e ações de moderação com registro, para que conteúdo abusivo saia rápido e de forma auditável.

## Requisitos

- RF-01: Qualquer usuário logado denuncia um tópico, uma resposta, um case, um comentário de case, um perfil ou uma mensagem direta, escolhendo um motivo e, opcionalmente, descrevendo.
- RF-02: As denúncias entram numa fila no admin, agrupadas por conteúdo, com contagem de denunciantes.
- RF-03: Quem modera pode: descartar a denúncia, ocultar o conteúdo, reexibir, editar (remover trecho), fechar tópico, advertir o autor e suspender o autor.
- RF-04: A equipe também modera por iniciativa própria, sem denúncia, direto no conteúdo.
- RF-05: O autor é notificado quando seu conteúdo é ocultado, quando é advertido e quando é suspenso, com o motivo.
- RF-06: Toda ação de moderação vai para a auditoria ([028](028-auditoria.md)), com moderador, alvo, motivo e data.
- RF-07: O denunciante vê, em "minhas denúncias", se a denúncia foi analisada, sem detalhes da punição.
- RNF-01: Limite de 20 denúncias por usuário por dia; uma denúncia por usuário por conteúdo.
- RNF-02: Conteúdo com 5 denunciantes distintos (ajustável em `settings`) é ocultado automaticamente até a análise.
- RNF-03: Ocultar tem efeito imediato: a próxima leitura por qualquer usuário já não traz o conteúdo.

## Comportamento

### Motivos

`spam`, `harassment` (assédio ou ofensa), `inappropriate` (conteúdo impróprio), `piracy` (compartilhamento de conteúdo pago ou de links de aulas e ebooks), `personal_data` (exposição de dados pessoais), `other` (exige descrição).

### Quem modera o quê

| Papel | Alcance |
| --- | --- |
| `admin` | Tudo; único que exclui definitivamente conteúdo e contas |
| `manager` | Tudo, exceto exclusão definitiva e ações sobre contas da equipe |
| `instructor` | Tópicos e respostas da categoria de fórum dos próprios cursos: ocultar, reexibir, fechar, fixar. Não suspende nem adverte; pode encaminhar à equipe |
| `student` | Só denuncia |

Denúncias contra membros da equipe são visíveis apenas ao `admin`.

### Ações

| Ação | Efeito |
| --- | --- |
| Descartar | Denúncia marcada `dismissed`; conteúdo permanece |
| Ocultar | `hidden_at` no conteúdo: some para todos, exceto autor (que vê o aviso "ocultado pela moderação") e equipe. Pontos ligados ao conteúdo são estornados ([020](020-gamificacao.md)) |
| Reexibir | Desfaz a ocultação |
| Editar | A equipe altera o texto; fica a marca "editado pela moderação" e a versão original é guardada na auditoria |
| Fechar tópico | Estado `closed` ([017](017-forum.md)) |
| Limpar perfil | Remove foto, capa ou campos de texto do perfil ([019](019-perfil-e-diretorio.md)) |
| Advertir | Notificação `moderation.warning` com o motivo; conta no histórico do usuário |
| Suspender | Ver abaixo |

### Suspensão

- Tipos: `posting` (não publica em fórum, cases, comentários nem mensagens, mas estuda normalmente) e `full` (não entra; todas as sessões são derrubadas na hora, ver [007](007-contas-e-autenticacao.md)).
- Prazo: 1, 7 ou 30 dias, ou indeterminado. O fim do prazo reativa automaticamente (tarefa `suspension.expire` do worker, [005](005-worker-e-fila.md)).
- Suspensão `full` não cancela assinatura nem reembolsa compras; isso é decisão separada do admin ([011](011-vendas-e-checkout.md), [012](012-assinaturas.md)).
- Com suspensão `full`, não abre nem responde chamados, inclusive por link enviado no e-mail de suspensão; não há token ou sessão especial de suporte. Com `posting`, abre e responde pela própria conta. O e-mail de segurança continua sendo enviado, sem link de suporte ([007](007-contas-e-autenticacao.md), [023](023-chamados-de-suporte.md)).
- Chaves MCP emitidas por um usuário suspenso param de funcionar na hora ([027](027-mcp.md)).
- O histórico de advertências e suspensões aparece na ficha do usuário no admin.

### Fila

- Agrupada por conteúdo, ordenada por número de denunciantes e depois por data. Filtros: estado (`open`, `resolved`, `dismissed`), tipo de conteúdo, motivo.
- Cada item mostra o conteúdo, o contexto (tópico, case ou trecho da conversa), o autor com seu histórico e os denunciantes.
- Para mensagens diretas, o item traz a mensagem denunciada e até 10 mensagens antes e 10 depois, fornecidas pelo denunciante ao denunciar ([021](021-mensagens-diretas.md)); a leitura gera registro de auditoria.
- Resolver um item resolve todas as denúncias do mesmo conteúdo.
- A equipe recebe `report.created` (grupo `staff`, [024](024-notificacoes-e-email.md)); ocultação automática por limite gera notificação com prioridade.

### Casos de erro

| Situação | Resposta |
| --- | --- |
| Denunciar o próprio conteúdo | 422 |
| Denunciar duas vezes o mesmo conteúdo | 200, sem criar nova denúncia |
| Limite diário de denúncias | 429 |
| Moderador fora do alcance (por exemplo, instrutor em outro curso) | 403 |
| `manager` agindo sobre conta da equipe | 403 |

## Interfaces e contratos

- `apps/classroom-api/openapi.yaml`: `POST /reports` (com `target_type`, `target_id`, `reason`, `details`), `GET /me/reports`.
- `apps/admin-api/openapi.yaml`: `GET /moderation/queue`, `GET /moderation/queue/{targetType}/{targetId}`, `POST /moderation/actions` (ação, alvo, motivo), `GET /users/{id}/moderation-history`, `POST /users/{id}/suspend`, `POST /users/{id}/unsuspend`, `POST /users/{id}/warn`.
- A regra de alcance por papel vive em `packages/core` ([008](008-papeis-e-permissoes.md)).
- Ferramentas MCP de moderação em [027](027-mcp.md).

## Dados

| Tabela | Campos principais | Dono (escrita) |
| --- | --- | --- |
| `reports` | `reporter_id`, `target_type` (`forum_topic`, `forum_post`, `case`, `case_comment`, `profile`, `message`), `target_id`, `reason`, `details`, `context` (JSON, só para mensagens), `status`, `resolved_by`, `resolved_at`, `resolution` | `classroom-api` (criação), `admin-api` (resolução) |
| `moderation_actions` | `moderator_id`, `action`, `target_type`, `target_id`, `target_user_id`, `reason`, `created_at` | `admin-api` |
| `user_suspensions` | `user_id`, `kind` (`posting`/`full`), `reason`, `starts_at`, `ends_at`, `lifted_at`, `created_by` | `admin-api`; `worker` no fim do prazo |
| `hidden_at`, `hidden_by` | colunas nos conteúdos moderáveis | `admin-api`; `worker` na ocultação automática |

Decisões de esquema da migration 0005 para `user_suspensions` (aceitas na tarefa 198): `created_by` é obrigatório (toda suspensão é aplicada por alguém da equipe, pelo painel ou por MCP com o emissor da chave; o worker só encerra, preenchendo `lifted_at`); `user_id` e `created_by` têm chave estrangeira para `users` sem cascata, porque o histórico é registro de terceiros e a linha de `users` nunca é apagada ([030](030-lgpd.md)); `ends_at` nulo é prazo indeterminado.

Retenção: denúncias resolvidas por 2 anos; ações de moderação e suspensões por 2 anos, junto com a auditoria ([033](033-observabilidade-retencao-backup.md)). Na exclusão de conta do denunciante, a denúncia permanece sem o denunciante.

## Critérios de aceite

- [ ] Denúncia de cada um dos seis tipos de conteúdo aparece na fila com o contexto correto.
- [ ] Conteúdo ocultado some para os demais usuários na leitura seguinte e continua visível ao autor com aviso.
- [ ] Cinco denunciantes distintos ocultam o conteúdo automaticamente e notificam a equipe.
- [ ] Instrutor oculta resposta no fórum do próprio curso e recebe 403 em outro curso.
- [ ] Suspensão `full` derruba as sessões abertas, bloqueia o login e impede abrir/responder chamados, inclusive por link; ao fim do prazo o acesso volta sozinho.
- [ ] Suspensão `posting` bloqueia fórum, cases, comentários e mensagens, mas não o player.
- [ ] Cada ação cria registro em `moderation_actions` e na auditoria.
- [ ] Denúncia contra membro da equipe não aparece para `manager`.
- [ ] O denunciante vê "analisada" sem saber a punição aplicada.

## Fora de escopo

- Aprovação prévia de conteúdo, filtro automático de palavras, detecção por IA, recurso formal contra punição, canal de suporte para conta com suspensão `full`, banimento por IP ou dispositivo.

## Decisões relacionadas

- [0017 — Escopo do MVP](decisions/0017-escopo-do-mvp.md)
- [0012 — MCP: chaves herdam o papel](decisions/0012-mcp-chaves-herdam-papel.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md) (F1-23, F1-25)
