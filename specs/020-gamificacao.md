# 020 — Gamificação

Status: aprovada
Depende de: 000, 001, 003, 004, 005, 014, 017, 019, 022

## Contexto

Pontos, níveis, medalhas e ranking incentivam o aluno a estudar e a participar. Cada escola quer calibrar isso a seu modo, então tudo o que é número ou nome é configurável pelo admin; esta spec fixa o mecanismo e uma tabela padrão de fábrica.

## Requisitos

- RF-01: Ações do aluno geram lançamentos de pontos num extrato imutável.
- RF-02: O nível do aluno é derivado do total de pontos, segundo uma tabela de níveis nomeados.
- RF-03: Medalhas são concedidas manualmente pela equipe ou automaticamente por regra (pontos atingidos, curso concluído, contagem de ações).
- RF-04: Há ranking semanal (segunda 00:00 a domingo 23:59, fuso da instalação) e ranking geral.
- RF-05: O admin edita pontos por ação, limites diários, níveis e medalhas; `manager` e `admin` concedem e retiram medalhas manuais; `instructor` concede medalha manual só a alunos dos próprios cursos; o ajuste manual de pontos é só do `admin`, com justificativa e registro na auditoria ([008](008-papeis-e-permissoes.md)).
- RF-06: O aluno vê o próprio extrato de pontos; os demais veem apenas total, nível e medalhas.
- RF-07: A equipe não pontua nem aparece em rankings.
- RNF-01: O lançamento de pontos ocorre em até 5 segundos após a ação, pelo worker.
- RNF-02: A página do ranking (100 posições) responde com p95 abaixo de 300 ms com 10.000 cadastrados.
- RNF-03: Nenhuma ação é pontuada duas vezes (chave de idempotência única por lançamento).

## Comportamento

### Tabela padrão de pontos

| Ação (`action`) | Pontos | Limite |
| --- | --- | --- |
| `lesson.completed` — concluir uma aula | 10 | 1 vez por aula |
| `course.completed` — concluir um curso | 100 | 1 vez por curso |
| `profile.completed` — perfil 100% | 30 | 1 vez |
| `forum.topic.created` — criar tópico | 5 | 3 por dia |
| `forum.post.created` — responder | 3 | 10 por dia |
| `forum.solution.accepted` — ter resposta marcada como solução | 25 | sem limite |
| `reaction.received` — receber reação em publicação ou case | 1 | 20 por dia |
| `case.published` — publicar um case | 50 | 1 por semana |
| `case.liked` — receber curtida num case | 2 | 30 por dia |
| `daily.streak` — estudar (concluir aula) em dia novo consecutivo, calculado a partir de `activity_days` ([014](014-aprendizado-e-progresso.md)) | 5 | 1 por dia |
| `manual.adjust` — ajuste do admin | variável (positivo ou negativo) | exige justificativa |

Regras: desfazer a ação (desmarcar aula, apagar publicação, publicação ocultada pela moderação, reembolso do curso) gera lançamento negativo de mesmo valor; o total nunca fica abaixo de zero.

### Tabela padrão de níveis

| Nível | Nome | Pontos mínimos |
| --- | --- | --- |
| 1 | Semente | 0 |
| 2 | Broto | 100 |
| 3 | Raiz | 300 |
| 4 | Tronco | 700 |
| 5 | Copa | 1.500 |
| 6 | Floresta | 3.000 |
| 7 | Farol | 6.000 |

O admin altera nomes e limites e cria até 20 níveis; os mínimos devem ser crescentes e o primeiro é sempre 0.

### Medalhas

| Tipo de regra (`rule_type`) | Concessão | Exemplo padrão |
| --- | --- | --- |
| `manual` | Equipe, com nota opcional | "Destaque da equipe" |
| `points` | Ao atingir N pontos | "Mil pontos" (1.000) |
| `course_completed` | Ao concluir um curso específico ou qualquer curso | "Primeiro curso concluído" |
| `action_count` | Ao acumular N ocorrências de uma ação | "Solucionador" (10 soluções aceitas), "Autor de case" (1 case publicado) |
| `streak` | N dias consecutivos de estudo | "Sete dias seguidos" |

- Cada medalha tem nome, descrição, ícone (da biblioteca de ícones da interface) e cor. O admin cria, edita e desativa medalhas; desativar não retira as já concedidas.
- Medalha automática é concedida uma única vez por usuário e não é retirada quando os pontos caem; medalha manual pode ser retirada pela equipe.
- Até 3 medalhas, escolhidas pelo aluno, aparecem ao lado do nome no fórum e no perfil.
- Conceder medalha gera notificação `badge.awarded`; subir de nível gera `level.up` ([024](024-notificacoes-e-email.md)).

### Ranking

- Semanal: soma dos lançamentos positivos e negativos da semana corrente; zera na virada. Geral: total acumulado.
- Empate: quem atingiu o total primeiro fica à frente.
- Mostra posição, foto, nome, nível e pontos; a própria posição do aluno aparece destacada mesmo fora das 100 primeiras.
- Ficam fora: equipe, suspensos, removidos e quem tem `directory_visible = false` ([019](019-perfil-e-diretorio.md)), que ainda vê a própria posição.
- "Destaques da semana" no diretório: 5 primeiros do ranking semanal.

### Processamento

- As APIs gravam o fato (aula concluída, resposta criada) e enfileiram a tarefa `gamification.award`; o worker ([005](005-worker-e-fila.md)) aplica limites, grava o lançamento, atualiza os totais e avalia medalhas.
- Chave de idempotência: `action` + identificador do objeto + usuário (e a data, para ações com limite diário).
- Alterar a tabela de pontos vale só para ações futuras; lançamentos passados não são recalculados. Alterar níveis reavalia o nível de todos numa tarefa em segundo plano, sem notificações retroativas.

## Interfaces e contratos

- `apps/classroom-api/openapi.yaml`: `GET /me/points`, `GET /me/points/ledger`, `GET /rankings/weekly`, `GET /rankings/all-time`, `GET /members/{handle}/achievements`, `PUT /me/featured-badges`.
- `apps/admin-api/openapi.yaml`: `GET|PUT /gamification/actions`, `GET|PUT /gamification/levels`, CRUD `/gamification/badges`, `POST|DELETE /users/{id}/badges/{badgeId}`, `POST /users/{id}/points/adjust`.
- Ferramentas MCP correspondentes em [027](027-mcp.md).

## Dados

| Tabela | Campos principais | Dono (escrita) |
| --- | --- | --- |
| `points_ledger` | `user_id`, `action`, `points`, `ref_type`, `ref_id`, `idempotency_key` (único), `note`, `created_by`, `created_at` | `worker`; ajustes manuais pela `admin-api` |
| `levels` | `position`, `name`, `min_points` | `admin-api` |
| `badges` | `name`, `description`, `icon`, `color`, `rule_type`, `rule_params` (JSON), `active` | `admin-api` |
| `user_badges` | `user_id`, `badge_id`, `awarded_at`, `awarded_by` (nulo se automática), `note`, `featured` | `worker` (automáticas), `admin-api` (manuais), `classroom-api` (`featured`) |
| `settings` (chave `gamification.actions`) | pontos e limites por ação | `admin-api` |

Totais (`profiles.points_total`, `profiles.points_week`, `profiles.level_position`, declarados em [019](019-perfil-e-diretorio.md)) são escritos pelo `worker` como valores derivados, recalculáveis a partir do extrato. Retenção: extrato permanente enquanto a conta existir; apagado na exclusão de conta ([030](030-lgpd.md)).

## Critérios de aceite

- [ ] Instalação nova vem com as tabelas padrão de pontos, níveis e medalhas desta spec.
- [ ] Concluir a mesma aula duas vezes pontua uma só; desmarcar gera lançamento negativo.
- [ ] A 11ª resposta do dia no fórum não pontua.
- [ ] Atingir 100 pontos muda o nível para "Broto" e notifica.
- [ ] Medalha por pontos é concedida uma vez e permanece se os pontos caírem.
- [ ] Ranking semanal zera na virada da semana; o geral não.
- [ ] Equipe não aparece no ranking; `admin` consegue ajustar pontos com justificativa e o ajuste fica na auditoria; `manager` recebe `403` no ajuste de pontos ([028](028-auditoria.md)).
- [ ] O total recalculado a partir do extrato é igual ao total guardado (teste de consistência).

## Fora de escopo

- Troca de pontos por prêmios ou descontos, missões e desafios com prazo, ranking por curso, "presentes".

## Decisões relacionadas

- [0017 — Escopo do MVP](decisions/0017-escopo-do-mvp.md)
- [0008 — Fila e SSE no Postgres](decisions/0008-fila-e-sse-no-postgres.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md) (P-05)
