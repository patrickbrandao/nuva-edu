# 008 — Papéis e permissões

Status: aprovada
Depende de: 000, 001, 007

## Contexto

O sistema tem um cadastro único de usuários com quatro papéis. O papel define o que cada um faz nos dois sites e, por herança, o que uma chave MCP faz ([027](027-mcp.md)). Esta spec é a referência única da matriz de permissões; as demais specs apontam para ela.

## Requisitos

- RF-01: Cada usuário tem exatamente um papel: `student`, `instructor`, `manager` ou `admin`.
- RF-02: A matriz desta spec é implementada uma única vez, em `packages/core`, como função `can(user, action, resource)`, usada pela `admin-api`, pela `classroom-api`, pelo `worker` e pelo MCP.
- RF-03: `instructor` só age sobre os cursos de que é dono e sobre o que deriva deles (módulos, aulas, fórum do curso, progresso dos alunos do curso).
- RF-04: Só `admin` altera papéis, cria equipe e mexe em dinheiro (preços, planos, cupons, reembolso) e em configurações.
- RF-05: A suspensão tem dois tipos: `posting` (bloqueia só a escrita) e `full` (derruba as sessões e bloqueia o login). Em qualquer das duas, as chaves MCP do usuário param de funcionar.
- RF-06: Toda negação por permissão é registrada na auditoria quando ocorre na `admin-api` ou no MCP ([028](028-auditoria.md)).
- RF-07: A permissão é avaliada pelo papel atual a cada requisição; mudança de papel vale na requisição seguinte.
- RNF-01: A matriz tem teste automatizado para cada célula (papel × ação), com 100% das células cobertas.
- RNF-02: A checagem de permissão acrescenta menos de 5 ms ao p95 de qualquer rota.

## Comportamento

### Papéis

| Papel | Quem é | Acessa o admin |
| --- | --- | --- |
| `student` | Qualquer pessoa cadastrada | Não |
| `instructor` | Autor de cursos; edita e modera só os próprios | Sim, restrito |
| `manager` | Moderador e operador: conteúdo, acessos, suporte | Sim |
| `admin` | Poder total | Sim |

Os papéis são cumulativos no classroom: toda a equipe faz o que um `student` faz, usando a própria conta, e aparece com selo "Equipe".

### Matriz — administração

Legenda: ✓ permitido · ◐ só nos próprios cursos · — negado.

| Ação | student | instructor | manager | admin |
| --- | --- | --- | --- | --- |
| Entrar no site admin | — | ✓ | ✓ | ✓ |
| Ver painel inicial | — | ◐ | ✓ | ✓ |
| **Pessoas** | | | | |
| Listar e ver alunos | — | ◐ (alunos dos seus cursos: nome, progresso) | ✓ | ✓ |
| Ver e-mail, CPF/CNPJ e compras do aluno | — | — | ✓ | ✓ |
| Editar dados do aluno | — | — | ✓ | ✓ |
| Suspender e reativar aluno | — | — | ✓ | ✓ |
| Encerrar sessões de um aluno | — | — | ✓ | ✓ |
| Ver a senha de um usuário | — | — | — | ✓ |
| Definir senha de um usuário | — | — | — | ✓ |
| Criar, editar, suspender equipe; mudar papel | — | — | — | ✓ |
| Excluir conta definitivamente (anonimizar) | — | — | — | ✓ |
| **Conteúdo** | | | | |
| Criar curso | — | ✓ (vira dono) | ✓ | ✓ |
| Editar curso, módulos, aulas, links | — | ◐ | ✓ | ✓ |
| Publicar e despublicar curso | — | ◐ (só curso próprio `open`; `paid` e `private` são publicados por gerente ou admin) | ✓ | ✓ |
| Excluir curso sem alunos | — | ◐ | ✓ | ✓ |
| Excluir curso com alunos | — | — | — | ✓ |
| Trocar o dono (instrutor) de um curso | — | — | ✓ | ✓ |
| Criar e editar ebooks e pacotes | — | — | ✓ | ✓ |
| Vincular ebook a curso ou aula | — | ◐ | ✓ | ✓ |
| Definir modo de acesso (`open`, `paid`, `private`) e amostra grátis | — | ◐ (amostra); — (modo) | ✓ | ✓ |
| Definir e alterar preço | — | — | — | ✓ |
| Criar e editar eventos do calendário | — | ◐ (eventos dos seus cursos) | ✓ | ✓ |
| Publicar novidades | — | ◐ (ligadas aos seus cursos) | ✓ | ✓ |
| **Acessos e vendas** | | | | |
| Conceder e revogar acesso manual | — | — | ✓ | ✓ |
| Ver pedidos, assinaturas e exportar CSV | — | — | ✓ | ✓ |
| Reembolsar pedido | — | — | — | ✓ |
| Cancelar assinatura de um aluno | — | — | — | ✓ |
| Criar e editar planos | — | — | — | ✓ |
| Criar e editar cupons | — | — | — | ✓ |
| **Comunidade e suporte** | | | | |
| Criar e editar categorias livres do fórum | — | — | ✓ | ✓ |
| Ocultar, editar, fixar, fechar e mover tópico ou resposta | — | ◐ (fórum dos seus cursos) | ✓ | ✓ |
| Ver e tratar denúncias | — | ◐ (do fórum dos seus cursos) | ✓ | ✓ |
| Ocultar e destacar cases | — | — | ✓ | ✓ |
| Conceder medalha manual | — | ◐ (a alunos dos seus cursos) | ✓ | ✓ |
| Editar tabela de pontos, níveis e medalhas | — | — | — | ✓ |
| Atender chamados | — | ◐ (só os de conteúdo dos seus cursos, inclusive "link quebrado") | ✓ | ✓ |
| Ver progresso e certificados dos alunos | — | ◐ | ✓ | ✓ |
| Revogar certificado | — | — | — | ✓ |
| **Sistema** | | | | |
| Emitir e revogar as próprias chaves MCP | — | — | ✓ | ✓ |
| Ver e revogar chaves MCP de outros | — | — | — | ✓ |
| Consultar auditoria | — | — | — | ✓ |
| Ver operação (fila, e-mails, webhooks) e reprocessar | — | — | — | ✓ |
| Configurações da escola, termos, integrações | — | — | — | ✓ |

### Matriz — classroom

| Ação | Visitante | student | Equipe |
| --- | --- | --- | --- |
| Ver vitrine, planos, cases públicos, validar certificado | ✓ | ✓ | ✓ |
| Ver programa de curso não privado | ✓ | ✓ | ✓ |
| Assistir a aula de produto `open` | — | ✓ | ✓ |
| Assistir a aula `is_sample` | — | ✓ | ✓ |
| Assistir a aula e abrir link de ebook de produto `paid` ou `private` | — | Com direito ([010](010-direitos-de-acesso.md)) | `manager` e `admin`: sempre; `instructor`: nos próprios cursos, e nos demais com direito |
| Comprar, assinar | — | ✓ (e-mail confirmado) | ✓ |
| Marcar progresso, anotar, emitir certificado | — | Com acesso ao curso | Igual ao aluno |
| Ler e publicar no fórum de um curso | — | Com acesso ao curso | `manager` e `admin`: todos; `instructor`: os próprios e os que tiver direito |
| Ler e publicar em categoria livre | — | Conforme o público da categoria ([017](017-forum.md)) | ✓ |
| Criar categoria de fórum | — | — | Pelo admin (matriz acima) |
| Ver diretório e perfis | — | ✓ | ✓ |
| Enviar mensagem direta | — | Com acesso ativo ([021](021-mensagens-diretas.md)) | ✓ |
| Publicar case | — | ✓ (e-mail confirmado) | ✓ |
| Abrir chamado | — | ✓ | ✓ |
| Denunciar conteúdo ou usuário | — | ✓ | ✓ |
| Exportar os próprios dados e excluir a própria conta | — | ✓ | Exporta: ✓; exclusão: só depois de o admin rebaixar a conta a `student` ([030](030-lgpd.md)) |

"Acesso ativo" = ao menos um direito vigente a produto `paid` ou `private`, ou assinatura ativa.

### Identificadores das ações

Cada linha das matrizes é uma ação de `packages/core`, com o identificador abaixo. É ele que vai em `x-permission` no contrato, em `can(user, action, resource)` e na lista `permissions` de `GET /api/v1/session`. Ação ◐ é devolvida na lista para o papel que a tem em parte; o filtro pelo alcance é aplicado na consulta.

| Grupo | Identificadores (na ordem das linhas da matriz) |
| --- | --- |
| Acesso | `admin.access`, `dashboard.view` |
| Pessoas | `users.list`, `users.view_private`, `users.edit`, `users.suspend`, `users.sessions.revoke`, `users.password.view`, `users.password.set`, `staff.manage`, `users.delete` |
| Conteúdo | `course.create`, `course.edit`, `course.publish`, `course.delete`, `course.delete_with_students`, `course.set_owner`, `ebook_bundle.manage`, `ebook.link`, `product.set_access`, `product.set_price`, `event.manage`, `announcement.publish` |
| Acessos e vendas | `entitlement.manage`, `sales.view`, `order.refund`, `subscription.cancel`, `plan.manage`, `coupon.manage` |
| Comunidade e suporte | `forum.category.manage`, `forum.moderate`, `report.handle`, `case.moderate`, `badge.award`, `gamification.configure`, `ticket.handle`, `progress.view`, `certificate.revoke` |
| Sistema | `mcp_key.own`, `mcp_key.manage_all`, `audit.view`, `ops.manage`, `settings.manage` |
| Classroom | `catalog.view`, `course.view_program`, `lesson.watch_open`, `lesson.watch_sample`, `content.access_paid`, `purchase.create`, `learning.track`, `forum.course.participate`, `forum.free.participate`, `members.view`, `dm.send`, `case.publish`, `ticket.open`, `report.create`, `account.self_service` |

- Nas rotas de usuário da `admin-api`, `users.view` (ver a ficha) é a mesma ação de `users.list`; `users.view_private` decide se e-mail, CPF/CNPJ e compras vão na resposta.
- `users.list` do `instructor` (alunos dos seus cursos) é servido pelas rotas do curso ([009](009-catalogo-e-conteudo.md), [014](014-aprendizado-e-progresso.md)), na Fase 2. Na Fase 1 não há curso: `GET /users` exige `users.list` com alcance total (`manager` e `admin`), e o `instructor` recebe `403`.
- Ação sobre conta de equipe (`instructor`, `manager`, `admin`) exige `staff.manage`, mesmo que a ação sobre aluno exija outra (`users.edit`, `users.suspend`, `users.sessions.revoke`).

### Regra do instrutor

- Cada curso tem `owner_id`. Quem cria o curso como `instructor` vira o dono; `manager` e `admin` podem atribuir o dono.
- "Próprios cursos" inclui: módulos, aulas e links do curso; ebooks vinculados ao curso (vínculo, não o ebook em si); a categoria e os tópicos do curso no fórum; denúncias sobre esse conteúdo; progresso e certificados dos alunos do curso; eventos e novidades ligados ao curso; chamados de conteúdo do curso (inclusive "link quebrado").
- O filtro é aplicado na consulta ao banco. Recurso de outro curso responde `404`.
- O instrutor não vê e-mail, CPF/CNPJ, compras nem senha de aluno; vê nome, avatar, progresso e participação no fórum.
- Curso sem dono (instrutor removido ou rebaixado) passa a ser gerido só por `manager` e `admin`.

### Mudança de papel

- Só `admin` muda papel. A mudança é auditada, encerra as sessões do usuário no site admin e avisa o usuário por e-mail.
- Rebaixar para `student` remove o acesso ao admin na hora (rebaixar `manager` para `instructor` também revoga as chaves MCP, pois `instructor` não as emite); os cursos do ex-instrutor ficam sem dono; as chaves MCP do usuário deixam de funcionar (papel insuficiente) e são marcadas como revogadas.
- Rebaixar `admin` para `manager`: as chaves MCP continuam, agora com poderes de `manager` ([027](027-mcp.md)).
- O último `admin` ativo não pode ser rebaixado, suspenso nem excluído.
- Um admin não muda o próprio papel.

### Suspensão

- `manager` suspende e reativa `student`; só `admin` suspende equipe. Ninguém suspende a si mesmo.
- Dois tipos, registrados em `user_suspensions` ([026](026-moderacao-e-denuncias.md)): `posting` impede publicar em fórum, cases, comentários e mensagens, mas o usuário entra e estuda normalmente; `full` encerra todas as sessões, recusa o login com `account_suspended` e fecha as conexões SSE. Nos dois tipos as chaves MCP são recusadas.
- A suspensão pode ter prazo (`ends_at`); ao fim dele o worker a encerra.
- O que permanece: compras, direitos de acesso, progresso e conteúdo já publicado (que pode ser ocultado pela moderação). A suspensão não cancela assinatura: a cobrança segue até o admin cancelar ([012](012-assinaturas.md)).
- Suspensão exige motivo (texto), guardado em `user_suspensions.reason` (resumo em `users.suspended_reason`), auditado e visível só à equipe. O usuário é avisado por e-mail, sem o motivo interno.
- Reativar restaura o acesso; sessões e chaves MCP não voltam sozinhas (o usuário entra de novo; chaves seguem válidas se não foram revogadas).
- Pela `admin-api` ([007](007-contas-e-autenticacao.md), "Interfaces e contratos"): `POST /users/{id}/suspend` com `kind`, `reason` (1 a 500 caracteres) e `durationDays` (1, 7, 30 ou nulo = indeterminado), e `POST /users/{id}/reactivate`. Suspender quem já está suspenso: `409` `already_suspended` (para mudar o tipo ou o prazo, reativa e suspende de novo); reativar quem não está: `409` `not_suspended`.
- Cada suspensão é uma linha em `user_suspensions` (`starts_at = now()`, `ends_at` pelo prazo, `created_by`); `users.suspended_*` espelham a suspensão vigente. Reativar ou o fim do prazo (tarefa `suspension.expire`) preenchem `lifted_at` e limpam `users.suspended_*`, com `user.unsuspend` na auditoria (`origin = worker` no fim do prazo).
- E-mail ao suspender: `moderation.suspended` com o tipo e o prazo, sem o motivo. Nesta fase ele sai só por e-mail; o canal "plataforma" entra com as notificações ([024](024-notificacoes-e-email.md)). Mudança de papel envia `account.role_changed`.

### Casos de erro

| Caso | Resposta |
| --- | --- |
| Ação sem permissão | `403` `permission_denied` |
| Recurso fora do alcance do instrutor | `404` `not_found` |
| Rebaixar, suspender ou excluir o último admin | `422` `last_admin` |
| Mudar o próprio papel ou suspender a si mesmo | `422` `self_action_not_allowed` |
| `manager` tentando suspender equipe | `403` `permission_denied` |

## Interfaces e contratos

- Função `can(user, action, resource)` e a lista de ações em `packages/core`; cada rota dos contratos declara a ação exigida em `x-permission`.
- `apps/admin-api/openapi.yaml`: `PATCH /users/{id}/role`, `POST /users/{id}/suspend`, `POST /users/{id}/reactivate`, `PATCH /courses/{id}/owner`.
- `GET /api/v1/session` devolve o papel e a lista de ações permitidas, usada pelos sites para montar o menu ([006](006-sites-e-interface.md)).
- O MCP aplica a mesma função com o emissor da chave como `user` ([027](027-mcp.md)).

## Dados

- `users.role` (texto com `CHECK` nos quatro valores, padrão `student`), `users.suspended_at`, `users.suspended_reason`, `users.suspended_by`.
- `courses.owner_id` (referência a `users`, nulo permitido).
- Dono: `admin-api` escreve papel, suspensão e dono de curso.
- Histórico de mudanças de papel e de suspensão fica em `audit_log` (2 anos).

## Critérios de aceite

- [ ] Teste automatizado cobre todas as células das duas matrizes.
- [ ] `instructor` edita o próprio curso e recebe `404` no curso de outro; não vê e-mail nem compras de aluno.
- [ ] `manager` concede acesso manual e é recusado ao reembolsar, criar cupom, alterar preço e ver senha.
- [ ] Mudança de papel vale na requisição seguinte e encerra as sessões do admin.
- [ ] Suspender um usuário derruba as sessões, fecha o SSE e faz as chaves MCP dele responderem erro em até 5 s.
- [ ] O último admin não pode ser rebaixado, suspenso nem excluído.
- [ ] Toda negação na `admin-api` e no MCP aparece na auditoria.
- [ ] O menu do site admin corresponde à lista de ações devolvida por `/session`.
- [ ] Definition of Done ([002](002-organizacao-do-trabalho.md)) atendida.

## Fora de escopo

- Papéis personalizados e permissões por usuário.
- Vários donos por curso ou co-instrutores.
- Escopo configurável por chave MCP ([0012](decisions/0012-mcp-chaves-herdam-papel.md)).
- Repasse financeiro a instrutores ([0001](decisions/0001-decisoes-iniciais.md)).

## Decisões relacionadas

- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md)
- [0012 — Chaves MCP herdam o papel](decisions/0012-mcp-chaves-herdam-papel.md)
- [0002 — Senha em texto legível](decisions/0002-senha-em-texto-legivel.md)
- [0011 — Autenticação, sessão e vínculo social](decisions/0011-autenticacao-sessao-e-vinculo-social.md)
