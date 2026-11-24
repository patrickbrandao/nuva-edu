# 019 — Perfil e diretório de membros

Status: aprovada
Depende de: 000, 001, 004, 007, 008, 010, 020, 029

## Contexto

O perfil dá identidade ao aluno no fórum, nos cases e nas mensagens; o diretório permite descobrir quem estuda na mesma escola. São a base da comunidade (Fase 6 do plano). Um perfil básico (nome, foto, bio) já existe desde a Fase 1, criado junto com a conta.

## Requisitos

- RF-01: Todo usuário tem um perfil com nome de exibição, `@handle` único, foto, capa, título, cidade, texto "sobre", até 5 links e até 10 habilidades.
- RF-02: O perfil mostra a completude em percentual e o próximo passo sugerido; só o dono vê esse quadro.
- RF-03: Um usuário segue e deixa de seguir outro; o perfil mostra contagem de seguidores e de seguidos.
- RF-04: O perfil tem abas Visão geral, Atividade (tópicos e respostas), Trabalho (cases) e Conquistas (nível, pontos, medalhas).
- RF-05: O diretório lista membros com busca por nome ou `@handle`, filtros (Alunos, Online, Disponíveis, Equipe, Todos), visão em grade ou lista e paginação por cursor.
- RF-06: Presença: "online agora" ou "ativo há X"; o usuário pode ocultar a própria presença.
- RF-07: O usuário define um status "disponível para conversar" e se o perfil aparece no diretório.
- RNF-01: Página do diretório (30 membros) com p95 abaixo de 300 ms com 10.000 cadastrados.
- RNF-02: Presença com atraso máximo de 2 minutos.

## Comportamento

### Quem vê o quê

- Perfis e diretório exigem login com e-mail confirmado. Visitantes não veem perfis (nos cases públicos aparecem só nome e foto do autor, ver [022](022-cases.md)).
- Perfil com `directory_visible = false` não aparece no diretório nem em "online agora", mas continua acessível pelo link em publicações.
- Usuário suspenso ou removido: perfil responde 404; publicações antigas mostram "usuário removido" ou o nome sem link.
- E-mail, CPF/CNPJ e dados de compra nunca aparecem no perfil.
- Selo de papel: "Aluno", "Instrutor" ou "Equipe" (`manager` e `admin` aparecem como "Equipe").

### Handle

- Gerado no cadastro a partir do nome (`nome-sobrenome`, com sufixo numérico em caso de colisão). Alterável pelo usuário 1 vez a cada 30 dias.
- 3 a 30 caracteres, `a-z`, `0-9` e hífen; lista de reservados (`admin`, `equipe`, `suporte`, `todos` e os nomes de rota).

### Completude

| Item | Peso |
| --- | --- |
| Nome | 15% |
| Foto | 15% |
| Título | 25% |
| Sobre | 15% |
| Cidade | 10% |
| Um link | 10% |
| Uma habilidade | 5% |
| Handle sem sufixo numérico | 5% |

Atingir 100% pela primeira vez concede pontos ([020](020-gamificacao.md)).

### Seguir

- Seguir é unilateral e não exige aprovação. Não é possível seguir a si mesmo nem alguém que bloqueou você ([021](021-mensagens-diretas.md)); bloquear desfaz o vínculo nos dois sentidos.
- Seguir gera notificação `follow.created` ao seguido ([024](024-notificacoes-e-email.md)).
- A aba Atividade de um terceiro mostra apenas publicações em categorias que quem está olhando pode ler ([017](017-forum.md)).

### Presença

- `last_seen_at` é atualizado pela `classroom-api` no máximo 1 vez por minuto por usuário, a partir de requisições autenticadas ou da conexão SSE aberta.
- "Online agora" = `last_seen_at` nos últimos 2 minutos. Caso contrário, "ativo há N minutos/horas/dias"; acima de 30 dias, nada é mostrado.
- Com `presence_hidden = true`, o usuário aparece sempre sem presença e fora do filtro "Online".

### Diretório

- Ordenação padrão: online primeiro, depois por pontos da semana, depois por nome.
- Filtros: `students` (padrão), `online`, `available`, `staff`, `all`.
- Cartão: foto, nome, handle, selo, título, cidade, pontos, presença, botões "Mensagem" (se permitido por [021](021-mensagens-diretas.md)) e "Ver perfil".
- Faixa "Destaques da semana": os 5 primeiros do ranking semanal ([020](020-gamificacao.md)).

### Visão geral do perfil

- Sobre, links, habilidades, "Jornada" (cursos em andamento e concluídos, com percentual; o usuário pode ocultar a jornada) e mapa de atividade dos últimos 12 meses (aulas concluídas, tópicos, respostas e cases por dia), lido de `activity_days` ([014](014-aprendizado-e-progresso.md)).

## Interfaces e contratos

- `apps/classroom-api/openapi.yaml`: `GET /members`, `GET /members/{handle}`, `GET /members/{handle}/activity`, `GET /members/{handle}/cases`, `PUT|DELETE /members/{handle}/follow`, `GET|PATCH /me/profile`, `PUT /me/profile/avatar`, `PUT /me/profile/cover`, `PATCH /me/handle`.
- `apps/admin-api/openapi.yaml`: leitura do perfil na ficha do usuário; edição e limpeza de campos do perfil pela moderação ([026](026-moderacao-e-denuncias.md)).
- Imagens: foto 512×512 e capa 1600×400, conforme [029](029-imagens.md).

## Dados

| Tabela | Campos principais | Dono (escrita) |
| --- | --- | --- |
| `profiles` | `user_id`, `handle`, `handle_changed_at`, `display_name`, `headline`, `city`, `about_md`, `about_html`, `links` (JSON, até 5), `skills` (texto[], até 10), `avatar_image_id`, `cover_image_id`, `available`, `directory_visible`, `presence_hidden`, `journey_hidden`, `timezone` (nulo = `settings.timezone`), `last_seen_at`, `completeness`, `announcements_seen_at` ([025](025-novidades.md)), `points_total`, `points_week`, `level_position` (escritos pelo `worker`, ver [020](020-gamificacao.md)) | `classroom-api` |
| `follows` | `follower_id`, `followed_id`, `created_at` | `classroom-api` |

Retenção: enquanto a conta existir; apagados na exclusão de conta ([030](030-lgpd.md)).

## Critérios de aceite

- [ ] Completude soma 100% com todos os itens e o quadro só aparece para o dono.
- [ ] Handle duplicado ou reservado é recusado; segunda troca em menos de 30 dias é recusada.
- [ ] Diretório filtra por online, disponíveis e equipe, e busca por nome e handle.
- [ ] Usuário com presença oculta não aparece como online para ninguém.
- [ ] Perfil fora do diretório não aparece na listagem, mas abre pelo link.
- [ ] Atividade de um terceiro não revela publicações de categorias que o observador não pode ler.
- [ ] Nenhuma resposta de perfil contém e-mail ou documento.

## Fora de escopo

- Perfis visíveis a visitantes, campos personalizados, verificação de identidade, importação de dados de redes sociais, sugestões de quem seguir.

## Decisões relacionadas

- [0017 — Escopo do MVP](decisions/0017-escopo-do-mvp.md)
- [0007 — Imagens no Postgres](decisions/0007-imagens-no-postgres.md)
