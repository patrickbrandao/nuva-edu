# 017 — Fórum

Status: aprovada
Depende de: 000, 001, 004, 008, 009, 010, 024, 026

## Contexto

O fórum é o único espaço de conversa assíncrona entre alunos e equipe (canais de chat em tempo real estão fora de escopo). Ele substitui a área de comentários da aula: cada aula tem um tópico e comentar na aula é responder a esse tópico. Assim a discussão fica pesquisável, ligada ao conteúdo e restrita a quem tem direito a ele.

## Requisitos

- RF-01: Cada curso tem exatamente uma categoria de fórum, criada automaticamente quando o curso é publicado pela primeira vez.
- RF-02: Cada aula publicada tem exatamente um tópico na categoria do seu curso, criado automaticamente na publicação da aula; os comentários exibidos no player são as respostas desse tópico.
- RF-03: A equipe (`manager`, `admin`) cria, edita, ordena e arquiva categorias livres, cada uma com público `all` (todos os cadastrados) ou `active` (quem tem acesso ativo).
- RF-04: O aluno cria tópicos nas categorias em que pode escrever; não cria categorias.
- RF-05: Tópicos e respostas aceitam Markdown saneado, menções `@usuario` e reações por emoji.
- RF-06: A equipe fixa, fecha, move e oculta tópicos; o autor do tópico ou a equipe marcam uma resposta como solução ("resolvido").
- RF-07: O aluno segue um tópico para ser notificado de novas respostas; quem cria ou responde passa a seguir automaticamente.
- RF-08: Busca por texto em títulos e corpos, limitada às categorias que o usuário pode ler.
- RNF-01: Listagem de tópicos de uma categoria e leitura de um tópico com 50 respostas respondem com p95 abaixo de 300 ms com 500 usuários simultâneos.
- RNF-02: Corpo de tópico ou resposta com no máximo 20.000 caracteres; título com 5 a 150 caracteres.
- RNF-03: Limite de envio por usuário: 10 tópicos e 60 respostas por hora (ajustáveis pelo admin em `settings`).

## Comportamento

### Tipos de categoria

| Tipo (`kind`) | Origem | Quem lê e escreve |
| --- | --- | --- |
| `course` | Automática, uma por curso | Quem tem direito ativo ao curso ([010](010-direitos-de-acesso.md)); se o curso é `open`, todos os cadastrados |
| `free` com público `all` | Criada pela equipe | Todos os cadastrados com e-mail confirmado |
| `free` com público `active` | Criada pela equipe | Quem tem ao menos um direito ativo a produto não `open`, ou é da equipe |

- A equipe (`manager`, `admin`) lê e escreve em tudo. O `instructor` lê e escreve em todas as categorias `free` e nas categorias `course` dos próprios cursos; nas demais categorias `course` segue a regra de aluno.
- Quem não pode ler uma categoria não a vê na lista, nem os seus tópicos em busca, perfil de terceiros ou notificações.
- Aula amostra (`lessons.is_sample`): quem não tem o curso assiste à aula, mas não lê nem escreve no tópico; o player mostra o número de respostas e um convite para obter o curso.
- Perda de acesso (reembolso, fim de assinatura): o usuário deixa de ler e escrever na categoria; o que publicou permanece, com o autor visível.
- Usuário com e-mail não confirmado ou suspenso apenas lê o que o seu acesso permite.

### Tópicos automáticos de aula

- Título = título da aula; corpo = descrição da aula com link para o player; autor exibido = "Equipe". Renomear a aula renomeia o tópico.
- Não podem ser apagados nem movidos; despublicar a aula oculta o tópico, republicar o reexibe com as respostas.
- Alunos também criam tópicos livres dentro da categoria do curso (dúvidas gerais), separados dos tópicos de aula por um filtro "Aulas" / "Discussões".
- Excluir um curso arquiva a categoria (somente leitura para a equipe).

### Tópicos e respostas

- Estados do tópico: `open`, `closed` (não aceita respostas), `hidden` (moderação, ver [026](026-moderacao-e-denuncias.md)). Marcadores independentes: `pinned`, `solved`.
- Respostas em um nível de aninhamento: responde-se ao tópico ou a uma resposta (`parent_post_id`), sem aninhar além disso.
- Edição pelo autor a qualquer momento, com marca "editado" e data; exclusão pelo autor troca o corpo por "mensagem removida pelo autor" se houver respostas dependentes, senão apaga.
- Ordenação da lista: fixados primeiro, depois por última atividade. Filtros: todos, sem resposta, resolvidos, não resolvidos, que eu sigo.
- "Resolvido": o autor do tópico ou a equipe escolhem uma resposta como solução; ela aparece logo abaixo do tópico. Pode ser desfeito. Tópicos automáticos de aula não têm estado de resolvido.
- Menção `@usuario`: autocompletar só com usuários que podem ler a categoria; gera notificação ([024](024-notificacoes-e-email.md)). Menção a quem não pode ler vira texto simples.
- Reações: conjunto fixo de 6 emojis (👍 ❤️ 🎉 😄 🤔 👀), uma reação de cada tipo por usuário por publicação.
- Markdown saneado: negrito, itálico, listas, citação, código, links e imagens por URL externa. HTML bruto não é interpretado nem gravado no HTML resultante; links recebem `rel="nofollow noopener noreferrer"` e abrem em nova aba; `javascript:` e `data:` são recusados. O saneamento ocorre no servidor, na gravação, e o HTML resultante é guardado junto do Markdown. O pipeline, as listas de elementos/protocolos, a compatibilidade e os testes comuns estão na [0027](decisions/0027-markdown-saneado-no-servidor.md).
- Pontuação por participação: ver [020](020-gamificacao.md).

### Casos de erro

| Situação | Resposta |
| --- | --- |
| Escrever sem permissão na categoria | 403 `forum_forbidden` |
| Responder em tópico `closed` ou `hidden` | 409 `topic_closed` |
| Limite de envio excedido | 429 com `Retry-After` |
| Categoria ou tópico inexistente ou invisível ao usuário | 404 (não revela existência) |

## Interfaces e contratos

- `apps/classroom-api/openapi.yaml`: `GET /forum/categories`, `GET /forum/categories/{id}/topics`, `POST /forum/categories/{id}/topics`, `GET /forum/topics/{id}`, `PATCH /forum/topics/{id}`, `POST /forum/topics/{id}/posts`, `PATCH|DELETE /forum/posts/{id}`, `PUT|DELETE /forum/posts/{id}/reactions/{emoji}`, `PUT /forum/topics/{id}/solution`, `PUT|DELETE /forum/topics/{id}/follow`, `GET /forum/search`, `GET /lessons/{id}/topic`.
- `apps/admin-api/openapi.yaml`: CRUD de categorias livres, `PATCH /forum/topics/{id}` (fixar, fechar, mover, ocultar), listagem para moderação.
- Evento SSE `forum.post.created` para quem está com o tópico aberto (fluxo em [004](004-classroom-api.md)).
- A regra "pode ler / pode escrever" vive em `packages/core` e é usada pelas duas APIs.

## Dados

| Tabela | Campos principais | Dono (escrita) |
| --- | --- | --- |
| `forum_categories` | `kind`, `course_id`, `audience` (`all`/`active`), `name`, `description`, `position`, `archived_at` | `admin-api` (livres); criação automática pela publicação do curso |
| `forum_topics` | `category_id`, `lesson_id` (nulo se livre), `author_id`, `title`, `body_md`, `body_html`, `status`, `pinned`, `solution_post_id`, `last_activity_at`, `posts_count` | `classroom-api`; moderação pela `admin-api` |
| `forum_posts` | `topic_id`, `parent_post_id`, `author_id`, `body_md`, `body_html`, `edited_at`, `deleted_at`, `hidden_at` | `classroom-api`; moderação pela `admin-api` |
| `reactions` | `target_type` (`forum_topic`/`forum_post`), `target_id`, `user_id`, `emoji` | `classroom-api` |
| `forum_topic_follows` | `topic_id`, `user_id` | `classroom-api` |

Retenção: conteúdo permanente. Na exclusão de conta ([030](030-lgpd.md)) o autor vira "usuário removido" e o conteúdo é mantido.

## Critérios de aceite

- [ ] Publicar um curso cria a categoria; publicar uma aula cria o tópico, e ele aparece no player como área de comentários.
- [ ] Aluno sem o curso não vê a categoria nem os tópicos, por lista, busca ou URL direta (404).
- [ ] Aluno sem nenhum produto pago escreve em categoria livre `all` e não vê categoria livre `active`.
- [ ] Reembolso do curso remove leitura e escrita na categoria sem apagar as publicações do aluno.
- [ ] Publicação com `<script>` ou `javascript:` tem HTML persistido sem trecho ativo; `https` de imagem permitida aparece, e URL proibida não gera imagem/link ativo (testes de XSS e paridade com a interface).
- [ ] Menção gera notificação apenas para quem pode ler a categoria.
- [ ] Marcar e desmarcar solução funciona para o autor do tópico e para a equipe, e é recusado para terceiros.
- [ ] Limite de envio retorna 429.

## Fora de escopo

- Canais de chat em tempo real, enquetes, anexos enviados (só imagem por URL externa), assinatura por e-mail de categoria inteira, "postagens salvas".
- Categorias criadas por alunos.

## Decisões relacionadas

- [0017 — Escopo do MVP](decisions/0017-escopo-do-mvp.md)
- [0008 — Fila e SSE no Postgres](decisions/0008-fila-e-sse-no-postgres.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md) (P-03, F1-14, F1-23)
- [0027 — Markdown saneado no servidor](decisions/0027-markdown-saneado-no-servidor.md)
