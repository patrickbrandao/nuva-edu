# 022 — Cases

Status: aprovada
Depende de: 000, 001, 003, 004, 008, 019, 020, 026, 029, 030

## Contexto

Cases são projetos que os alunos publicam para mostrar o que construíram com o que aprenderam. Servem de vitrine para a escola (são visíveis a visitantes sem login) e de reconhecimento para o aluno. Por exporem nome e conteúdo do aluno publicamente, exigem consentimento explícito.

## Requisitos

- RF-01: Aluno com acesso ativo e e-mail confirmado, ou membro da equipe, cria, edita, despublica e apaga os próprios cases.
- RF-02: Publicar exige marcar o consentimento de exibição pública; sem ele o case fica como rascunho.
- RF-03: Um case tem título, resumo, descrição, galeria de 1 a 8 imagens, 1 a 3 categorias, até 10 ferramentas, estágio, resultado (opcional) e link externo (opcional).
- RF-04: Usuários logados curtem, comentam e salvam cases; visitantes só leem.
- RF-05: Explorar com busca (título, ferramenta, autor), ordenação (recentes, mais curtidos, mais vistos) e filtros por categoria, ferramenta e estágio, com contagem.
- RF-06: Abas "Explorar", "Meus cases" e "Salvos".
- RF-07: A equipe marca um case como destaque; sem destaque manual, o destaque é o mais curtido dos últimos 30 dias.
- RF-08: O admin gerencia categorias e a lista de ferramentas; alunos podem sugerir ferramenta nova ao publicar.
- RNF-01: Listagem (24 cases) com p95 abaixo de 300 ms.
- RNF-02: Cada imagem obedece aos limites de [029](029-imagens.md); no máximo 8 imagens por case.
- RNF-03: Limites de envio: 3 cases por semana e 30 comentários por hora por usuário.

## Comportamento

### Estados

| Estado | Visível para |
| --- | --- |
| `draft` | Autor |
| `published` | Todos, inclusive visitantes |
| `hidden` | Autor e equipe (ocultado pela moderação, ver [026](026-moderacao-e-denuncias.md)) |

- Pós-moderação: publicar torna o case visível na hora.
- Despublicar volta para `draft`. Apagar remove o case, as imagens, os comentários, as curtidas e os salvos.

### Consentimento

- Texto no formulário: o case, o nome de exibição e a foto do autor ficarão visíveis publicamente, inclusive a quem não tem conta, e poderão ser indexados por buscadores.
- Grava-se `consent_at` e a versão do texto (`consent_version`). Editar o case não exige novo aceite; mudar o texto de consentimento na instalação não despublica cases existentes.
- Retirar o consentimento = despublicar ou apagar, disponível a qualquer momento.

### Visão do visitante

- Vê título, resumo, descrição, galeria, categorias, ferramentas, estágio, resultado, link, contadores, nome de exibição e foto do autor. Não vê comentários, perfil do autor nem `@handle`; curtir, comentar e salvar levam ao login.
- Páginas públicas com título, descrição e Open Graph próprios ([006](006-sites-e-interface.md)).

### Campos

| Campo | Regra |
| --- | --- |
| Título | 5 a 120 caracteres |
| Resumo | até 280 caracteres |
| Descrição | Markdown saneado (mesmas regras de [017](017-forum.md)), até 20.000 caracteres |
| Galeria | 1 a 8 imagens, ordenáveis; a primeira é a capa |
| Categorias | 1 a 3, de lista gerida pelo admin (padrão: Sistema interno, Agente de IA, App e ferramenta, Dados e análises, Automação, Site e conteúdo) |
| Ferramentas | até 10 etiquetas; sugestão nova fica visível só no próprio case até o admin aprová-la para a lista |
| Estágio | `first_project` (Primeiro projeto), `building` (Em construção), `running` (Rodando de verdade) |
| Resultado | até 120 caracteres, texto livre |
| Link externo | URL `https` |

### Interações

- Curtida: uma por usuário por case; o autor não curte o próprio.
- Comentários: Markdown saneado, até 5.000 caracteres, um nível de resposta, editáveis e apagáveis pelo autor; o dono do case apaga comentários no próprio case.
- Visualizações: contadas uma vez por usuário logado por dia e uma vez por sessão anônima por dia (cookie técnico sem identificação); o autor não conta.
- Salvar: lista privada do usuário.
- Notificações ao autor: `case.liked` (agrupadas), `case.commented` ([024](024-notificacoes-e-email.md)). Pontos: [020](020-gamificacao.md).
- O perfil mostra os cases publicados na aba "Trabalho" ([019](019-perfil-e-diretorio.md)).
- Se o autor perde o acesso ativo, os cases publicados permanecem; ele continua podendo editá-los e apagá-los, mas não criar novos.

## Interfaces e contratos

- `apps/classroom-api/openapi.yaml` (rotas de leitura sem autenticação): `GET /cases`, `GET /cases/{id}`, `GET /cases/facets`, `GET /cases/featured`; autenticadas: `POST /cases`, `PATCH|DELETE /cases/{id}`, `POST /cases/{id}/publish`, `POST /cases/{id}/unpublish`, `POST|DELETE /cases/{id}/images`, `PUT /cases/{id}/images/order`, `PUT|DELETE /cases/{id}/like`, `PUT|DELETE /cases/{id}/save`, `GET|POST /cases/{id}/comments`, `PATCH|DELETE /cases/comments/{id}`, `GET /me/cases`, `GET /me/cases/saved`.
- `apps/admin-api/openapi.yaml`: CRUD de categorias e ferramentas, `PUT|DELETE /cases/{id}/featured`, ocultar e reexibir.

## Dados

| Tabela | Campos principais | Dono (escrita) |
| --- | --- | --- |
| `cases` | `author_id`, `title`, `summary`, `body_md`, `body_html`, `stage`, `result`, `external_url`, `status`, `consent_at`, `consent_version`, `featured_at`, `published_at`, `likes_count`, `comments_count`, `views_count` | `classroom-api`; destaque e ocultação pela `admin-api` |
| `case_images` | `case_id`, `image_id`, `position` | `classroom-api` |
| `case_comments` | `case_id`, `parent_comment_id`, `author_id`, `body_md`, `body_html`, `edited_at`, `hidden_at` | `classroom-api` |
| `case_categories`, `case_tools` | `name`, `slug`, `approved` (ferramentas) | `admin-api`; sugestões de ferramenta pela `classroom-api` |
| `case_category_links`, `case_tool_links` | vínculos N:N | `classroom-api` |
| `case_likes`, `case_saves` | `case_id`, `user_id` | `classroom-api` |
| `case_views` | `case_id`, `viewer_key`, `day` (único) | `classroom-api` |

Retenção: enquanto publicado ou em rascunho. Na exclusão de conta ([030](030-lgpd.md)) os cases do usuário e suas imagens são apagados (não anonimizados), por serem conteúdo de identificação pública. `case_views` é expurgada após 90 dias, mantendo o contador.

## Critérios de aceite

- [ ] Sem o consentimento marcado, a publicação é recusada e o case permanece rascunho.
- [ ] Visitante lê um case publicado e não recebe comentários nem `@handle` na resposta da API.
- [ ] A nona imagem é recusada.
- [ ] Filtros por categoria, ferramenta e estágio retornam contagens corretas.
- [ ] Curtir duas vezes conta uma; o autor não curte o próprio case.
- [ ] Case ocultado pela moderação some para todos, exceto autor e equipe.
- [ ] Excluir a conta apaga os cases e as imagens do usuário.
- [ ] Descrição com HTML perigoso é saneada (teste de XSS), inclusive na página pública.

## Fora de escopo

- Aprovação prévia de cases, vídeo enviado, coautoria, votação ou concurso, exportação, "postagens salvas" fora dos cases.

## Decisões relacionadas

- [0017 — Escopo do MVP](decisions/0017-escopo-do-mvp.md)
- [0007 — Imagens no Postgres](decisions/0007-imagens-no-postgres.md)
- [0018 — Vitrine SPA](decisions/0018-vitrine-spa.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md) (F2-13, F1-23)
