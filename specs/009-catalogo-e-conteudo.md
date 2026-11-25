# 009 — Catálogo e conteúdo

Status: aprovada
Depende de: 000, 001, 003, 004, 008

## Contexto

O catálogo é tudo o que a escola oferece: cursos (com módulos e aulas), ebooks e pacotes. A equipe cadastra pelo site admin; o aluno e o visitante consomem pelo classroom. O nuva-edu não armazena vídeo nem arquivo: todo conteúdo pesado é um link externo informado pelo autor ([0006](decisions/0006-conteudo-por-link-externo.md)).

Esta spec define as entidades, os campos, os estados de publicação, os modos de acesso e a vitrine pública. Quem pode ver cada aula ou ebook é decidido em [010](010-direitos-de-acesso.md); planos de assinatura estão em [012](012-assinaturas.md).

## Requisitos

- RF-01: Cadastrar curso com módulos ordenados e aulas ordenadas dentro de cada módulo (Curso > Módulo > Aula).
- RF-02: Cadastrar ebook como produto próprio, com um link externo de arquivo.
- RF-03: Cadastrar pacote que combina cursos e ebooks.
- RF-04: Cada produto (curso, pacote, ebook) tem modo de acesso `open`, `paid` ou `private`.
- RF-05: Qualquer aula de curso `paid` ou `private` pode ser marcada como amostra grátis (`is_sample`).
- RF-06: Vincular ebooks a um curso, a um pacote ou a uma aula específica.
- RF-07: Cada produto e cada aula tem estado `draft` ou `published`; só o publicado aparece no classroom.
- RF-08: Reordenar módulos e aulas por arrastar; a ordem é persistida.
- RF-09: Aula aceita um vídeo principal (link/embed) e uma lista de links de apoio (arquivos e páginas).
- RF-10: Vitrine pública lista produtos publicados não privados, com preço e programa, sem exigir login.
- RF-11: Instrutor cria cursos e edita apenas aqueles de que é dono; ebooks e pacotes são criados e editados só por gerente e admin, e o instrutor apenas vincula ebooks existentes aos próprios cursos e aulas ([008](008-papeis-e-permissoes.md)).
- RF-12: Preço só pode ser alterado pelo admin; modo de acesso, por gerente e admin ([008](008-papeis-e-permissoes.md): `product.set_price`, `product.set_access`).
- RNF-01: Listagem da vitrine (até 200 produtos) responde em p95 < 300 ms.
- RNF-02: Página de curso com 300 aulas (programa completo) responde em p95 < 300 ms com no máximo 3 consultas ao banco.
- RNF-03: Limites: título até 160 caracteres; resumo até 300; descrição até 20.000 (Markdown); até 100 módulos por curso; até 500 aulas por curso; até 20 links de apoio por aula; URL até 2.000 caracteres.

## Comportamento

### Estados de publicação

| Estado | Visível no admin | Visível no classroom |
| --- | --- | --- |
| `draft` | sim | não |
| `published` | sim | sim, conforme o modo de acesso |

- Curso `published` com aula `draft`: a aula não aparece no programa nem conta no total de aulas e de duração.
- Despublicar um produto não revoga direitos de acesso; o item some da vitrine e da estante até voltar a ser publicado. O admin vê um aviso com o número de alunos afetados antes de confirmar.
- Ninguém exclui produto com pedido, direito ou progresso associado, nem o admin (retorna `409` `product_has_links`); o caminho é arquivar (`archived_at`), que equivale a despublicar em definitivo. Arquivar e desarquivar (`unarchive`) são só do admin, para curso, ebook e pacote (`product.archive`). Excluir sem nenhum vínculo: curso, pelo instrutor dono, gerente e admin (`course.delete`); ebook e pacote, por gerente e admin (`ebook_bundle.manage`). Excluir o curso exclui módulos, aulas, links e o template de certificado dele ([015](015-certificados.md)). Decisão da resposta à P2 da tarefa 400.
- Publicar um curso exige ao menos um módulo com uma aula publicada; publicar pacote exige ao menos um item; publicar ebook exige `file_url` válida.

### Modos de acesso

| Modo | Na vitrine | Quem acessa o conteúdo |
| --- | --- | --- |
| `open` | sim | qualquer usuário logado, sem compra |
| `paid` | sim, com preço | quem tem direito ativo ([010](010-direitos-de-acesso.md)) |
| `private` | não | só quem recebeu concessão manual ou tem o item via pacote/plano |

- Produto `paid` precisa de `price_cents` ≥ 0. Preço `0` em produto `paid` é aceito e gera pedido gratuito ([011](011-vendas-e-checkout.md)).
- Produto `open` não tem preço e não entra na cesta.
- Produto `private` pode compor pacotes e planos; nunca aparece em vitrine, busca ou listagem para quem não tem direito.
- Validade do acesso: `access_days` (nulo = vitalício; inteiro ≥ 1 = dias contados da confirmação do pagamento).
- Quem não tem acesso a um curso publicado e não privado vê o programa (módulos, títulos, durações), não o conteúdo das aulas.

### Aula amostra

- `lessons.is_sample = true` libera a aula a qualquer usuário logado, independentemente do modo do curso.
- O classroom lista as amostras em "Aulas liberadas" (início e estante).
- Aula amostra tem o player completo, mas não libera os ebooks vinculados à aula.
- Comentários no tópico da aula amostra seguem a regra do fórum ([017](017-forum.md)): só quem tem o curso participa.

### Vídeo e links externos

O autor informa `video_url`. O sistema classifica o provedor na gravação e guarda `video_provider`:

| Provedor | Padrões de URL aceitos | Como é exibido | Informa fim do vídeo |
| --- | --- | --- | --- |
| `youtube` | `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/embed/`, `youtube.com/live/` | iframe (API do player) | sim |
| `vimeo` | `vimeo.com/<id>`, `player.vimeo.com/video/<id>` | iframe (API do player) | sim |
| `bunny` | `iframe.mediadelivery.net/embed/...`, `*.b-cdn.net/...m3u8` | iframe ou HLS | sim |
| `panda` | `player-vz-*.tv.pandavideo.com.br/embed/...` | iframe | sim |
| `file` | URL direta terminando em `.mp4` ou `.webm`, em qualquer host `https` | elemento de vídeo nativo | sim |
| `link` | qualquer outra URL `https`, inclusive `.m3u8` de host fora da tabela | botão "Abrir vídeo" em nova aba | não |

HLS (`.m3u8`) só é tocado a partir dos hosts da tabela (hoje, `*.b-cdn.net`, classificado como `bunny` e tocado pelo `<video>` nativo ou pelo `hls.js`, [0025](decisions/0025-bibliotecas-da-fase-2.md)); `.m3u8` de outro host vira `link`. Assim a política de segurança de conteúdo do classroom abre `connect-src` só para esses hosts; `.mp4` e `.webm` de qualquer host `https` tocam no `<video>` nativo, com `media-src https:`. Decisão da resposta à P5 da tarefa 400.

Regras de validação de qualquer URL de conteúdo (vídeo, apoio, ebook, capa externa):

- Esquema `https` obrigatório (`http` só é aceito para hosts `*.localhost` em desenvolvimento).
- Sem credenciais embutidas (`user:pass@`), sem espaços, até 2.000 caracteres.
- A URL nunca é buscada pelo servidor na gravação (evita SSRF); a checagem de disponibilidade é feita pelo navegador do aluno.
- `iframe` só é montado para os provedores da tabela; o domínio do iframe entra na política de segurança de conteúdo do classroom.
- A URL real só é entregue pela API a quem tem acesso à aula ou ao ebook ([010](010-direitos-de-acesso.md)); respostas de programa e de vitrine nunca a incluem.

Links de apoio (`lesson_links`): rótulo, URL, tipo (`file` | `page`) e ordem.

Link quebrado: o player e a lista de apoio têm o botão "Reportar problema", que abre um chamado já preenchido com o produto, a aula e o link ([023](023-chamados-de-suporte.md)).

`duration_seconds` da aula é informado pelo autor (o sistema não mede vídeo externo). Totais de módulo e de curso são a soma das aulas publicadas.

### Ebooks vinculados

`product_ebooks` vincula um ebook a um alvo:

| `target_type` | Efeito |
| --- | --- |
| `course` | quem tem direito ao curso recebe o ebook |
| `bundle` | equivale a incluir o ebook no pacote, e a cascata o honra ([010](010-direitos-de-acesso.md)); o admin usa `bundle_items` para isso, então este tipo não é criado nem removido pelo admin (só leitura, abaixo) |
| `lesson` | quem tem direito ao curso da aula recebe o ebook; o ebook aparece na aba de materiais daquela aula |

O ebook vinculado passa a constar como adquirido pelo aluno, por cascata ([010](010-direitos-de-acesso.md)). O mesmo ebook pode ser vendido avulso e estar vinculado a vários alvos.

No admin (decisão da tarefa 585, levada ao contrato pela janela criada na 620):

- O detalhe do curso (`CourseDetail.ebooks`) traz os ebooks vinculados ao curso (alvo `course`), em qualquer estado, por título, como o detalhe da aula já traz os dela. O editor não faz uma leitura por ebook para saber o que está vinculado. `GET /ebooks` não ganha filtro por alvo.
- Vincular e desvincular um ebook de um alvo só: `PUT` e `DELETE /ebooks/{id}/targets/{targetType}/{targetId}` (`ebook.link`; `targetType` é `course` ou `lesson`). Dispensam ler os vínculos e reenviar a lista, e dois editores não desfazem o vínculo um do outro. São idempotentes: vínculo que já existe (`PUT`) ou que não existe (`DELETE`) responde `204` sem gravar nem auditar. Alvo inexistente: `422` `catalog_item_not_found`; alvo de curso alheio ao instrutor: `404`; o 501º vínculo do ebook: `422` `catalog_limit_exceeded` (`targetsPerEbook`). A mudança avança o `version` do ebook, enfileira o recálculo da cascata e grava a mesma auditoria da troca da lista.
- `PUT /ebooks/{id}/targets` (a lista inteira) continua, para a tela do ebook.

Vínculo `bundle` no admin (decisão da tarefa 660). A regra é do `packages/core`; a rota só repassa:

- **A escrita só alcança `course` e `lesson`.** `PUT /ebooks/{id}/targets` substitui os vínculos `course` e `lesson` do ebook (para o instrutor, só os dos próprios cursos e aulas) e nunca cria, remove nem recalcula vínculo `bundle`, para nenhum papel. `targetType: bundle` na lista, ou no vínculo de um ebook só, é `400` `validation_failed`, também para quem chama o núcleo sem passar pelo contrato. A rota não lê os vínculos atuais para repeti-los.
- **A leitura mostra o que existe.** `EbookDetail.targets` traz todos os vínculos que quem pede alcança, inclusive os `bundle` (gerente e admin; o instrutor não os vê): o vínculo vale na cascata, e escondê-lo esconderia a origem de um direito. Na resposta, `targetType` é `course`, `bundle` ou `lesson`; no corpo do `PUT`, só `course` ou `lesson`. O site mostra o vínculo `bundle` sem ação de editar e, ao gravar a lista, envia só os vínculos `course` e `lesson`.
- O vínculo `bundle` nasce só de carga direta no banco e some quando o pacote é excluído. Pôr um ebook num pacote pelo admin é `PUT /bundles/{id}/items`.
- **Limite.** Os 500 vínculos por ebook (`targetsPerEbook`) contam todos os vínculos do ebook depois da gravação, de qualquer tipo, inclusive os que a troca não alcança (os `bundle` e, para o instrutor, os de cursos alheios).
- **Respostas de `PUT /ebooks/{id}/targets`:** `422` `catalog_item_not_found` (alvo inexistente, com o campo) e `422` `catalog_limit_exceeded`; `409` `version_conflict` quando a `version` enviada é antiga. O contrato declara as duas.

### Pacotes

- `bundle_items` lista cursos e ebooks (nunca outro pacote). O corpo de `PUT /bundles/{id}/items` só aceita `productType` `course` ou `ebook`: outro valor, `bundle` inclusive, é `400` `validation_failed`, e o id de um pacote enviado como `course` ou `ebook` é `422` `catalog_item_not_found`. Não há código de erro próprio para pacote em pacote: o `bundle_in_bundle` foi retirado (tarefa 660), porque o contrato já recusa o valor antes do núcleo e um valor de enum que só existe para ser recusado não se justifica.
- Incluir ou remover item de um pacote já vendido recalcula a cascata de quem tem o pacote ([010](010-direitos-de-acesso.md)); a remoção pede confirmação com o número de alunos afetados.
- A vitrine mostra o preço do pacote e a soma dos preços avulsos dos itens `paid`, para evidenciar a economia.

### Vitrine pública

Acessível sem login no classroom:

- Lista de cursos, pacotes e ebooks `published` com modo `open` ou `paid`, com capa, título, resumo, nível, totais (módulos, aulas, duração), preço e validade.
- Página do produto: descrição completa, programa (curso), itens (pacote), autor, data de atualização, botão de compra ou de acesso.
- Lista de planos de assinatura ativos ([012](012-assinaturas.md)).
- Filtros: tipo de produto, nível, gratuito × pago; busca por título e resumo; ordenação por mais recentes, título e preço.
- Cada página define título, descrição e Open Graph próprios ([0018](decisions/0018-vitrine-spa.md)).

Comprar, assistir e baixar exigem login.

### Autoria

- `courses.owner_id` aponta para o instrutor dono do curso. Admin e gerente podem trocá-lo.
- O instrutor não publica nem despublica curso `paid` ou `private`: ele envia para publicação, e gerente ou admin publicam. Curso `open` de que é dono, publica direto. Ele marca aulas como amostra grátis, mas não muda o modo de acesso nem o preço. Aulas novas em curso já publicado seguem a mesma regra do curso.
- "Enviar para publicação" é `POST /courses/{id}/request-review`: grava `courses.review_requested_at` (e auditoria `course.request_review`) e vale para o curso e para as aulas `draft` dele. A lista de cursos do admin tem o filtro "aguardando publicação". Publicar o curso, ou publicar a última aula `draft` dele, limpa o campo; o instrutor pode cancelar o pedido (`DELETE /courses/{id}/request-review`). O aviso à equipe no sino entra com a central de notificações ([024](024-notificacoes-e-email.md), Fase 4).
- Publicar e despublicar aula é `PATCH /lessons/{id}` com `status`, sujeito à mesma regra do curso: o instrutor só o faz em curso `open` de que é dono.
- Toda alteração de catálogo grava auditoria ([028](028-auditoria.md)).

### Criação e edição

Regras do `packages/core`, que as rotas da `admin-api` só repassam (decisões da tarefa 620, que alinhou o contrato do admin e o núcleo).

**Edição com `version`.** Curso, módulo, aula, ebook e pacote têm cada um o próprio `version` (inteiro, começa em 1), como manda a [003](003-admin-api.md) ("Concorrência"). O catálogo não tem "última gravação vence".

- As leituras de detalhe e toda resposta de escrita que devolve o recurso trazem `version` (`CourseDetail`, `CourseModule`, `LessonDetail`, `EbookDetail`, `BundleDetail`).
- `PATCH` de curso, módulo, aula, ebook e pacote **exige** `version` no corpo (`400` `validation_failed` sem ela). Diferente da gravada: `409` `version_conflict`, sem campo extra; o site avisa, relê o recurso e a pessoa refaz a edição sobre o estado atual.
- `PUT /lessons/{id}/links`, `PUT /bundles/{id}/items`, `PUT /ebooks/{id}/targets` e `PATCH /courses/{id}/owner` aceitam `version` **opcional** (a da aula, do pacote, do ebook e do curso): enviada, é conferida. O site admin sempre a envia. É opcional porque cada uma substitui um valor inteiro, sem mesclar com o estado lido.
- As trocas de ordem (`PUT .../modules/order`, `PUT .../lessons/order`), as ações (`publish`, `unpublish`, `archive`, `unarchive`, `request-review`) e os vínculos de um ebook só não recebem `version`: a lista de ordem já é conferida contra os itens atuais (`order_mismatch`), e as ações são idempotentes.
- Toda gravação num recurso avança o `version` dele, inclusive as ações e as trocas de lista; quem edita usa o `version` da última resposta. Criar, mover ou excluir um filho (módulo, aula) não avança o `version` do pai.

**Slug.** O slug tem o formato do contrato (minúsculas, números e hífens, até 160). Vale para curso, ebook e pacote, e a unicidade é por tipo de produto.

- Informado: usado como veio; repetido, `409` `slug_taken`.
- Ausente na criação: o núcleo o gera do título: sem acentos, em minúsculas, cada sequência de caracteres fora de `a-z0-9` vira um hífen, sem hífen nas pontas, até 160. Título que não deixa nenhum caractere gera `curso`, `ebook` ou `pacote`, conforme o tipo.
- Slug gerado que já existe recebe o menor sufixo livre `-2`, `-3`, … até `-99` (a base é cortada para o total caber em 160); só o gerado ganha sufixo. Sem sufixo livre, ou se outra gravação tomar o slug no mesmo instante: `409` `slug_taken`.
- O slug não é regerado quando o título muda; só muda quando alguém o edita.

**Modo de acesso inicial.** Curso, ebook e pacote criados sem `accessMode` nascem `private`, sem preço: nada chega à vitrine nem a "qualquer usuário logado" sem um ato de quem tem `product.set_access`. Consequência para o instrutor, que não define o modo de acesso: o curso dele nasce `private`, e ele o envia para publicação; publica direto só depois que gerente ou admin o tornam `open`. O padrão das colunas `access_mode` acompanha a regra.

**Permissão antes da regra.** Em toda escrita de catálogo, a permissão do campo é conferida antes da regra de negócio do valor: quem envia `priceCents` sem `product.set_price`, ou `accessMode`/`accessDays` sem `product.set_access`, recebe `403`, qualquer que seja o valor e o estado do produto. `422` `price_not_allowed` e `price_required` são só para quem tem a permissão. Campo enviado com o valor que o produto já tem não é alteração e não exige a permissão.

**Duração da aula.** `duration_seconds` não é nula no banco; `0` é "não informada". `durationSeconds` ausente na criação, ou `null` na criação e na edição, grava `0`; as respostas trazem sempre o inteiro.

**Mover aula entre módulos.** `PUT /modules/{id}/lessons/order` recebe a ordem nova das aulas do módulo. Aula de outro módulo **do mesmo curso**, na lista, é movida para este, na posição indicada; o módulo de origem fecha a numeração das que ficaram. A lista precisa conter todas as aulas que já estão no módulo. Aula de outro curso, aula inexistente ou aula do módulo que falta na lista: `422` `order_mismatch`. A movimentação é uma transação, não muda o total de aulas do curso (o limite por curso não se aplica), avança o `version` de cada aula movida e grava na auditoria, além da reordenação, o módulo de origem e o de destino de cada uma. O progresso dos alunos é por aula e não muda.

**Leitura de módulo.** O núcleo lê um módulo por id para o admin (`getAdminModule`: o módulo no formato de `CourseModule`, com as aulas e o `version`, e o curso a que pertence), com o mesmo alcance do curso (módulo de curso alheio ao instrutor: `404`). Não há `GET /modules/{id}` no contrato: a função serve às respostas de `PATCH /modules/{id}` e de `PUT /modules/{id}/lessons/order`.

### Casos de erro

| Situação | Resposta |
| --- | --- |
| URL fora das regras | `422` `content_url_invalid` com o campo e o motivo |
| Instrutor editando curso de outro dono | `404` ([008](008-papeis-e-permissoes.md)) |
| Instrutor alterando preço ou modo de acesso; gerente alterando preço | `403`, antes de qualquer regra do valor ("Criação e edição") |
| Excluir produto com vínculos, por qualquer papel | `409` `product_has_links` |
| Arquivar ou desarquivar sem ser admin | `403` |
| Publicar curso sem aula publicada | `422` `course_has_no_published_lesson` |
| Slug informado repetido; slug gerado sem sufixo livre | `409` `slug_taken` |
| Pacote na lista de itens de um pacote (`productType: bundle`); `targetType: bundle` na escrita de vínculos de ebook | `400` `validation_failed` |
| Publicar pacote sem item; publicar ebook sem `file_url` | `422` `bundle_has_no_items`; `422` `ebook_file_required` |
| Publicar produto `paid` sem preço; tornar `paid` um produto publicado sem preço | `422` `price_required` |
| Enviar preço para produto `open`, por quem tem `product.set_price` | `422` `price_not_allowed` (mudar para `open` sem enviar preço apaga o preço) |
| Publicar, ou pedir publicação de, produto arquivado | `422` `product_archived` |
| Arquivar o que já está arquivado; desarquivar o que não está | `200`, sem gravar nem auditar |
| Item de pacote ou alvo de vínculo de ebook que não existe (inclusive id de pacote enviado como `course` ou `ebook`) | `422` `catalog_item_not_found`, com o campo |
| Capa que não é imagem `product_cover` | `422` `cover_image_invalid` |
| Dono que não é instrutor, ou foi excluído | `422` `owner_invalid` |
| Ordem de módulos que não lista exatamente os módulos do curso; ordem de aulas sem alguma aula do módulo, ou com aula de outro curso | `422` `order_mismatch` |
| Quantidade acima de um limite | `422` `catalog_limit_exceeded`, com `limit` (o nome do limite) e `max` |
| Excluir módulo que ainda tem aulas | `409` `module_not_empty` (as aulas saem antes, cada uma com a própria auditoria) |
| Gravação sobre versão antiga (`version`) | `409` `version_conflict` ([003](003-admin-api.md)), declarado em toda operação que recebe `version` |
| `PATCH` de curso, módulo, aula, ebook ou pacote sem `version` | `400` `validation_failed` |

Limites além da RNF-03, validados no `packages/core` (`CATALOG_LIMITS`) e repetidos no contrato: slug, rótulo de link e nome do autor até 160 caracteres; até 200 itens por pacote; até 500 vínculos por ebook; duração da aula até 86.400 s; preço até 1.000.000.000 centavos; validade até 36.500 dias; carga horária do certificado até 10.000 horas; até 100.000 páginas. Campo de texto ou número fora do limite é `400` `validation_failed`; `catalog_limit_exceeded` é só para quantidade (`modulesPerCourse`, `lessonsPerCourse`, `linksPerLesson`, `itemsPerBundle`, `targetsPerEbook`).

## Interfaces e contratos

`apps/admin-api/openapi.yaml` (escrita), sob `/api/v1`:

- `GET|POST /courses`, `GET|PATCH|DELETE /courses/{id}`, `POST /courses/{id}/publish`, `POST /courses/{id}/unpublish`, `POST /courses/{id}/archive`, `POST /courses/{id}/unarchive`, `POST|DELETE /courses/{id}/request-review`
- `POST /courses/{id}/modules`, `PATCH|DELETE /modules/{id}`, `PUT /courses/{id}/modules/order`
- `POST /modules/{id}/lessons`, `GET|PATCH|DELETE /lessons/{id}`, `PUT /modules/{id}/lessons/order`, `PUT /lessons/{id}/links`
- `GET|POST /ebooks`, `GET|PATCH|DELETE /ebooks/{id}` e ações de publicação (`publish`, `unpublish`, `archive`, `unarchive`, como no curso)
- `GET|POST /bundles`, `GET|PATCH|DELETE /bundles/{id}`, `PUT /bundles/{id}/items` e as mesmas ações de publicação
- `POST /images` e `DELETE /images/{imageId}` com a finalidade `product_cover` ([029](029-imagens.md))
- `PUT /ebooks/{id}/targets` (vínculos em `product_ebooks`) e `PUT|DELETE /ebooks/{id}/targets/{targetType}/{targetId}` (um vínculo)

O contrato do admin alcança as regras de "Criação e edição" e de "Ebooks vinculados" numa janela de contrato própria (`version` nos detalhes e nos `PATCH`, `409` declarado, `CourseDetail.ebooks`, as duas operações de um vínculo, `422` e `409` em `PUT /ebooks/{id}/targets`, `409` em `PUT /bundles/{id}/items` e os textos de vínculo `bundle` e de pacote em pacote); até ela fechar, as rotas de edição leem o `version` atual e o repassam ao núcleo, e a rota de `PUT /ebooks/{id}/targets` repete os vínculos `bundle` atuais na lista que entrega ao núcleo.

`apps/classroom-api/openapi.yaml` (leitura), sob `/api/v1`:

- `GET /catalog` (vitrine, sem login), `GET /catalog/{type}/{slug}` (produto e programa, sem login)
- `GET /courses/{slug}` (programa com estado de acesso do usuário), `GET /lessons/{id}` (conteúdo; exige acesso)
- `GET /ebooks/{slug}`, `GET /ebooks/{id}/download` (devolve a URL; exige acesso)
- `GET /samples` (aulas amostra)

Migrations em `database/postgres/migrations`.

## Dados

Dono (escrita): `admin-api`. Leitura: `classroom-api` e `worker`.

| Tabela | Campos principais |
| --- | --- |
| `courses` | `id`, `slug` (único), `title`, `summary`, `description`, `level` (`beginner` \| `intermediate` \| `advanced` \| nulo), `cover_image_id`, `owner_id` (instrutor dono, nulo quando gerido só por gerente e admin), `access_mode`, `price_cents`, `access_days`, `certificate_enabled`, `certificate_hours` ([015](015-certificados.md)), `status`, `review_requested_at`, `published_at`, `archived_at`, `created_at`, `updated_at` |
| `modules` | `id`, `course_id`, `title`, `position`, `created_at`, `updated_at` |
| `lessons` | `id`, `module_id`, `title`, `description`, `type` (`video` no MVP), `video_url`, `video_provider`, `duration_seconds`, `is_sample`, `status`, `position`, `forum_topic_id`, `created_at`, `updated_at` |
| `lesson_links` | `id`, `lesson_id`, `label`, `url`, `kind`, `position` |
| `ebooks` | `id`, `slug`, `title`, `summary`, `description`, `cover_image_id`, `author_name` (texto), `file_url`, `pages`, `access_mode`, `price_cents`, `access_days`, `status`, `published_at`, `archived_at` |
| `bundles` | `id`, `slug`, `title`, `summary`, `description`, `cover_image_id`, `access_mode`, `price_cents`, `access_days`, `status`, `published_at`, `archived_at` |
| `bundle_items` | `bundle_id`, `product_type` (`course` \| `ebook`), `product_id`, `position` |
| `product_ebooks` | `ebook_id`, `target_type` (`course` \| `bundle` \| `lesson`), `target_id` |

- `lessons.type` existe para extensão futura (questionário); o MVP só usa `video`.
- `lessons.forum_topic_id` nasce nulo e sem chave estrangeira; a chave e a criação do tópico entram com o fórum ([017](017-forum.md), Fase 4).
- Capas são imagens enviadas ([029](029-imagens.md)).
- O template de certificado de cada curso fica em `certificate_templates` ([015](015-certificados.md)), não em `courses`; é editado pela rota própria (`/courses/{id}/certificate-template`), não pelo `PATCH /courses/{id}`.
- Retenção: dados de catálogo são permanentes; arquivados nunca são apagados automaticamente.

### O que fica para outras fases

A Fase 2 entrega esta spec inteira, exceto o que depende de recurso de fase posterior:

- "Reportar problema" (player, materiais) abre chamado: entra com os chamados ([023](023-chamados-de-suporte.md), Fase 4); até lá o botão não aparece.
- Lista de planos na vitrine: com as assinaturas ([012](012-assinaturas.md), Fase 3).
- Botão de compra e cesta: com as vendas ([011](011-vendas-e-checkout.md), Fase 3). Na Fase 2 o produto `paid` aparece na vitrine e na página do produto com o preço e o estado bloqueado, sem botão de compra nem cesta, com o texto "Acesso liberado pela escola"; o acesso vem só por concessão manual ([010](010-direitos-de-acesso.md)). Decisão da resposta à P6 da tarefa 400.
- Tópico da aula no fórum: Fase 4.

## Critérios de aceite

- [ ] Criar curso com 2 módulos e 3 aulas, reordenar e publicar; o classroom mostra a ordem nova.
- [ ] Curso `paid` sem direito: o programa aparece, `GET /lessons/{id}` responde `403` e nenhuma resposta traz `video_url`.
- [ ] Aula `is_sample` abre para usuário logado sem direito ao curso.
- [ ] Produto `private` não aparece em `GET /catalog` nem na busca, e seu slug responde `404` a quem não tem direito.
- [ ] URL `http://`, com credenciais ou acima de 2.000 caracteres é recusada com `422`.
- [ ] Cada provedor da tabela é reconhecido a partir dos padrões listados; URL desconhecida vira `link`.
- [ ] Instrutor recebe `404` ao editar curso alheio e `403` ao alterar preço ou modo de acesso do próprio curso.
- [ ] Excluir curso com pedido, direito ou progresso responde `409` também para o admin; arquivar funciona só para o admin.
- [ ] Gerente altera o modo de acesso e recebe `403` ao alterar o preço.
- [ ] `.m3u8` de host fora da tabela é classificado como `link`.
- [ ] Produto `paid` sem direito mostra preço e bloqueio, sem botão de compra.
- [ ] Vitrine e página de produto abrem sem login e têm título e descrição próprios.
- [ ] Limites da RNF-03 validados com teste.
- [ ] `PATCH` de curso, módulo, aula, ebook e pacote com `version` antiga responde `409` `version_conflict` e não grava; sem `version`, `400`.
- [ ] Curso, ebook e pacote criados sem `accessMode` nascem `private`.
- [ ] Criar sem `slug` gera o slug do título; o segundo produto do mesmo tipo com o mesmo título recebe o sufixo `-2`; slug informado repetido responde `409`.
- [ ] Instrutor que envia `priceCents` para o próprio curso recebe `403`, com o curso `open` ou `paid`.
- [ ] Aula movida de um módulo a outro do mesmo curso pela ordem de aulas; aula de outro curso na lista responde `422` `order_mismatch`.
- [ ] `durationSeconds: null` grava `0`.
- [ ] O detalhe do curso traz os ebooks vinculados; vincular e desvincular um ebook de um curso não altera os outros vínculos do ebook.
- [ ] `PUT /ebooks/{id}/targets` com lista vazia, por gerente, mantém o vínculo `bundle` do ebook e não enfileira recálculo do pacote; o vínculo aparece em `EbookDetail.targets`; `targetType: bundle` no corpo responde `400`.
- [ ] `PUT /bundles/{id}/items` com `productType: bundle` responde `400`; com o id de um pacote como `course`, `422` `catalog_item_not_found`.

## Fora de escopo

- Upload e transcodificação de vídeo; armazenamento de ebooks e arquivos.
- Questionários, provas e outros tipos de aula.
- Liberação gradual por data (drip) e pré-requisito entre aulas.
- Pacote dentro de pacote.
- Versões e histórico de edição do conteúdo.
- Proteção contra cópia do conteúdo externo (depende do serviço escolhido pelo autor).

## Decisões relacionadas

- [0006](decisions/0006-conteudo-por-link-externo.md)
- [0017](decisions/0017-escopo-do-mvp.md)
- [0018](decisions/0018-vitrine-spa.md)
- [0001](decisions/0001-decisoes-iniciais.md)
