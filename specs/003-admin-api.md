# 003 — admin-api

Status: aprovada
Depende de: 000, 001, 007, 008

## Contexto

A `admin-api` é o backend do site de administração (`https://<NUVA_ADMIN_HOST>`). Atende a equipe da escola (`instructor`, `manager`, `admin`) e hospeda o servidor MCP ([027](027-mcp.md)). É um serviço separado da `classroom-api` para isolar a superfície administrativa da superfície pública ([0004](decisions/0004-duas-apis-um-banco.md)); as duas compartilham o mesmo PostgreSQL e as regras de `packages/core`.

## Requisitos

- RF-01: Expor a API administrativa em `/api/v1`, descrita integralmente em `apps/admin-api/openapi.yaml` (OpenAPI 3.1).
- RF-02: Expor o servidor MCP em `/mcp` no mesmo processo ([027](027-mcp.md)).
- RF-03: Recusar com `403` qualquer sessão cujo papel seja apenas `student`.
- RF-04: Validar toda requisição e toda resposta contra o contrato; rota fora do contrato não é registrada. Única exceção: `/metrics`, que é interna e não entra no contrato. A conferência é estrita na subida ([Subida estrita](#subida-estrita)).
- RF-05: Registrar em `audit_log` toda requisição que altera dados e toda leitura sensível ([028](028-auditoria.md)).
- RF-06: Aplicar as migrations pendentes não é função da API: ela só sobe se o banco estiver na versão esperada (caso contrário `/readyz` responde `503`).
- RF-07: Criar o admin inicial na primeira subida, conforme [007](007-contas-e-autenticacao.md).
- RF-08: Expor `/healthz`, `/readyz` e `/metrics` ([033](033-observabilidade-retencao-backup.md)). `/healthz` e `/readyz` ficam na raiz, fora de `/api/v1`, e são descritas no contrato.
- RF-09: Expor `GET /api/v1/meta`, sem sessão, com os dados públicos da instalação e da marca da escola ([Meta](#meta)).
- RNF-01: p95 de resposta abaixo de 300 ms para leituras paginadas com 50 usuários de equipe simultâneos, em 2 vCPU / 4 GB.
- RNF-02: Corpo de requisição limitado a 1 MB, exceto envio de imagem, limitado a 5 MB ([029](029-imagens.md)); a imagem é processada na própria API que recebe o envio, não no worker.
- RNF-03: Limites de taxa: 300 requisições por minuto por sessão; 20 por minuto por IP nas operações de autenticação (`/api/v1/auth/*`: login, logout e as três do login social). Não há limite de visitante: requisição sem sessão só conta no limite da autenticação ou no da entrega de imagens. A entrega de imagens (`getImageVariant`) fica fora do limite por sessão e tem conta própria, de 600 por minuto por IP, com ou sem sessão ([029](029-imagens.md), "Limite de taxa da entrega"). Acima de qualquer limite, `429` `rate_limited` com `Retry-After`.
- RNF-04: Nenhuma resposta, log ou erro contém o campo de senha, exceto a rota dedicada de exibição de senha ([007](007-contas-e-autenticacao.md)).
- RNF-05: Sustentar 500 conexões SSE abertas num único processo, com consumo adicional inferior a 200 MB de RAM, e entregar `notification.created` em até 2 s após a gravação ([024](024-notificacoes-e-email.md)).

## Comportamento

### Autenticação e autorização

- Sessão por cookie `nuva_admin_session` (httpOnly, Secure, SameSite=Lax, escopo `NUVA_ADMIN_HOST`), descrita em [007](007-contas-e-autenticacao.md).
- Toda rota declara a permissão exigida; a checagem usa a matriz de [008](008-papeis-e-permissoes.md), implementada em `packages/core` e compartilhada com o MCP.
- Requisições que alteram dados exigem o cabeçalho `X-CSRF-Token` igual ao token emitido em `GET /api/v1/session`. Ausente ou diferente: `403` com `code: csrf_token_invalid`, e nada é alterado. Detalhes em [CSRF no contrato](#csrf-no-contrato).
- O MCP não usa cookie: autentica por chave no cabeçalho `Authorization: Bearer` ([027](027-mcp.md)).

### Convenções da API

| Assunto | Regra |
| --- | --- |
| Caminhos no contrato | O `servers` do contrato é a origem do site (`/`); cada caminho aparece completo (`/api/v1/...`, `/healthz`, `/readyz`), igual à rota registrada. |
| Formato | JSON em UTF-8; campos em `camelCase`; datas ISO 8601 em UTC; dinheiro em centavos inteiros. |
| Erros | `application/problem+json` (RFC 9457) com `type`, `title`, `status`, `detail`, `instance`, `code` (identificador estável, ver [Códigos de erro](#códigos-de-erro)) e, em validação, `errors[]` com `path` e `message`. |
| Status | `400` validação, `401` sem sessão, `403` sem permissão, `404` inexistente ou fora do alcance do instrutor, `409` conflito de estado, `413` corpo acima do limite, `415` `Content-Type` não aceito, `422` regra de negócio, `429` limite de taxa, `500` erro inesperado, `503` dependência indisponível. |
| Paginação | Por cursor: `?limit=` (padrão 25, máximo 100) e `?cursor=`; resposta `{ items, nextCursor }`, com `nextCursor` nulo na última página. No contrato, o esquema comum `Page` traz só `nextCursor`; cada listagem o compõe com `allOf` e declara `items` (obrigatório, com o esquema dos itens) no próprio membro, para o cliente gerado tipar os itens. |
| Ordenação e filtro | `?sort=campo` ou `-campo`; filtros como parâmetros nomeados, todos listados no contrato. |
| Busca | `?q=` com busca textual simples (`ILIKE` com índice trigram) onde o contrato indicar. |
| Idempotência | `POST` que cria cobrança, estorno ou concessão aceita `Idempotency-Key`; repetição devolve a primeira resposta por 24 h. |
| Concorrência | Edição de recurso envia `version` (inteiro); divergência resulta em `409`. |
| Rastreamento | Toda resposta traz `X-Request-Id`, presente também nos logs. |
| IP do cliente | Derivado de `X-Forwarded-For` apenas quando o remetente está em `TRUSTED_PROXIES`. |

### Códigos de erro

O `code` do problem+json é o que o cliente usa para decidir o que fazer; `title` e `detail` são texto para pessoas e podem mudar. Os códigos gerais abaixo valem para as duas APIs, estão no esquema `Problem` dos dois contratos e são os que `packages/core` (`errors/`) produz.

| `code` | Status | Quando | Campo extra |
| --- | --- | --- | --- |
| `validation_failed` | 400 | Requisição fora do contrato | `errors[]` |
| `unauthenticated` | 401 | Sem sessão válida | |
| `permission_denied` | 403 | Sessão válida, sem permissão para a operação | |
| `csrf_token_invalid` | 403 | Escrita sem `X-CSRF-Token` ou com token diferente do da sessão | |
| `not_found` | 404 | Recurso inexistente ou fora do alcance de quem pede | |
| `version_conflict` | 409 | `version` enviada diferente da gravada | |
| `payload_too_large` | 413 | Corpo acima do limite da rota (RNF-02) | |
| `unsupported_media_type` | 415 | `Content-Type` que a operação não declara em `requestBody.content`, ou que o serviço não sabe ler | |
| `rate_limited` | 429 | Limite de taxa atingido | `retryAfterSeconds` |
| `internal_error` | 500 | Erro inesperado; sem `detail`, o erro original vai só para o log | |
| `database_unavailable` | 503 | Banco indisponível | |
| `payment_provider_unavailable` | 503 | Provedor de pagamento indisponível | |

Regras:

- Formato: `snake_case` (`^[a-z][a-z0-9_]*$`).
- `409`, `422` e `503` não têm código genérico: cada ocorrência usa um código próprio da regra (`topic_closed`, `last_admin`), definido na spec do recurso e citado na descrição da operação no contrato. Recusa de acesso com motivo que a interface precisa distinguir também usa código próprio com `403` (`account_suspended`, `entitlement_required`).
- A lista é aberta: código novo entra pela spec do recurso; um código existente só muda de nome ou de status com mudança de versão da API. Código geral novo entra nesta tabela e no esquema `Problem` dos dois contratos.
- `retryAfterSeconds` (inteiro) repete o cabeçalho `Retry-After` e acompanha `rate_limited` quando o tempo é conhecido.
- Corpo que não é JSON válido, corpo vazio com `Content-Type: application/json`, corpo obrigatório ausente e `Content-Length` divergente continuam `400 validation_failed`, com um item em `errors[]` de `path: body`: é requisição fora do contrato, e o cliente trata como qualquer outra validação.
- Requisição que o servidor HTTP recusa antes de interpretar (o analisador do Node falha e a requisição nem chega às rotas):

  | Caso | Resposta |
  | --- | --- |
  | HTTP malformado (linha de requisição ou cabeçalho inválido) | `400 validation_failed` em problem+json, com `errors[]` vazio |
  | Corpo menor que o `Content-Length` anunciado | `400 validation_failed` em problem+json, com um item em `errors[]` de `path: body` |
  | Prazo de envio da requisição esgotado | `408`, no formato padrão do servidor HTTP |
  | Cabeçalhos acima do tamanho máximo | `431`, no formato padrão do servidor HTTP |

  `408` e `431` não têm `code` nem problem+json: o corpo é o JSON simples do Fastify (`statusCode`, `error`, `message`), em `application/json`. Acontecem antes de existir uma requisição interpretada, não são resposta de nenhuma operação e não entram nos contratos nem na tabela de [Respostas de erro declaradas](#respostas-de-erro-declaradas). As quatro respostas levam `X-Request-Id` e fecham a conexão. O `packages/api-client` trata `408` e `431` como `unknown_error`.
- `payload_too_large` e `unsupported_media_type` têm código próprio porque o cliente reage de outro jeito: no primeiro, a interface diz o limite ao usuário (envio de imagem); o segundo indica erro de quem chama, não de preenchimento.
- `unknown_error` não é emitido pelas APIs: é o que `packages/api-client` usa quando a resposta de erro não é um problem+json.
- O status `499` não é um erro da API: é a marca interna, nos logs e nas métricas, da requisição que o cliente encerrou antes do fim da resposta ([033](033-observabilidade-retencao-backup.md), "Requisição encerrada pelo cliente"). Nunca vai ao cliente, não tem `code` e não entra nos contratos.

### Respostas de erro declaradas

A validação de resposta recusa status que a operação não declara; por isso cada operação declara todos os erros que pode devolver, com as respostas comuns de `components.responses`:

| Operação | Declara |
| --- | --- |
| Toda operação de `/api/v1` | `400`, `429`, `500`, `503` |
| Com sessão (não tem `security: []`) | também `401` e `403` |
| Com corpo de requisição | também `413` e `415` |
| Com parâmetro de caminho | também `404` |
| `/healthz`, `/readyz` | só as próprias (`200`; `503` no `/readyz`) |

- `400` vale também para operação sem parâmetros (como `GET /api/v1/meta`): cabeçalho ou URL malformados são recusados antes da rota.
- `409` e `422` são declarados só onde a spec do recurso define um código.
- O teste de contrato confere a tabela acima em todas as operações.

### CSRF no contrato

A API recusa toda requisição que altera dados sem `X-CSRF-Token` válido. No contrato, essa exigência é o esquema de segurança `csrfToken` (cabeçalho `X-CSRF-Token`), declarado na mesma entrada de `sessionCookie` no `security` de cada operação de escrita:

```yaml
security:
  - sessionCookie: []
    csrfToken: []
```

Não há parâmetro de cabeçalho para o token. Como parâmetro obrigatório, o tipo gerado cobraria o cabeçalho em cada chamada, embora o cliente de `packages/api-client` o preencha sozinho; como parâmetro opcional, o contrato diria que a API aceita escrita sem ele. Como esquema de segurança, o contrato continua dizendo a verdade e a chamada tipada não muda.

- Leituras (`GET`, `HEAD`, `OPTIONS`) usam só o `security` padrão (`sessionCookie`).
- A checagem é feita pela API antes da rota, junto com a da sessão, e não pela validação de parâmetros; por isso a falta do cabeçalho é `403`, não `400`.
- Operação de escrita sem `csrfToken` no `security` é exceção e diz o motivo na descrição.
- O teste de contrato confere que toda operação que não é de leitura declara `csrfToken` ou está na lista de exceções.

### Fluxo SSE da equipe

Desde a Fase 4, `GET /api/v1/stream` existe também na `admin-api` ([0028](decisions/0028-sse-tambem-na-admin-api.md)). Usa a sessão `nuva_admin_session` e as regras desta API: sem sessão responde `401 unauthenticated`; sessão apenas `student` responde `403 permission_denied`. A suspensão `full` fecha a conexão pela regra comum de sessões.

- Abre `text/event-stream` com cookie, sem CSRF por ser leitura; uma conexão por aba do admin e no máximo 3 por usuário, derrubando a mais antiga na quarta.
- Entrega `notification.created` das notificações destinadas ao usuário da sessão, com o contador de não lidas; nenhum evento de outro usuário, mensagem direta ou conteúdo da comunidade. O nome, os campos `id`/`event`/`data` e o esquema são os mesmos do classroom ([004](004-classroom-api.md), "Fluxo SSE").
- Reutiliza `packages/api-kit`, `user_event_id_seq`, `publishUserEvent`, `LISTEN/NOTIFY`, `ping`, reenvio por `Last-Event-ID`, recarga na reconexão e limites de carga do fluxo do classroom. O hub comum filtra o canal a `notification.created`; os demais tipos não são entregues nem guardados para reenvio no admin. Não cria canal, sequência ou infraestrutura paralela.
- Os limites de reenvio são os mesmos da [004](004-classroom-api.md): o estado persistido e a recarga da central são a fonte de recuperação; nenhuma tela depende de receber todos os eventos.
- O contrato declara o caminho completo, os erros e os esquemas do evento. O proxy configura o host admin como configura o classroom ([031](031-infraestrutura-e-deploy.md), "SSE atrás do proxy").

### Grupos de rotas

| Prefixo em `/api/v1` | Conteúdo | Spec |
| --- | --- | --- |
| `/meta` | Dados públicos da instalação e da marca, sem sessão ([Meta](#meta)) | esta spec, [007](007-contas-e-autenticacao.md), [031](031-infraestrutura-e-deploy.md) |
| `/session`, `/auth/*` | Login, logout, sessão atual, token CSRF | [007](007-contas-e-autenticacao.md) |
| `/users` | Alunos e equipe: listar, ver, editar, suspender, mudar papel, exibir senha, sessões | [007](007-contas-e-autenticacao.md), [008](008-papeis-e-permissoes.md) |
| `/courses`, `/modules`, `/lessons`, `/ebooks`, `/bundles` | Catálogo e conteúdo | [009](009-catalogo-e-conteudo.md) |
| `/entitlements` | Concessão e revogação manual, consulta de direitos | [010](010-direitos-de-acesso.md) |
| `/orders`, `/refunds`, `/coupons`, `/sales/export` | Vendas, estorno, cupons, CSV | [011](011-vendas-e-checkout.md) |
| `/plans`, `/subscriptions` | Planos e assinaturas | [012](012-assinaturas.md) |
| `/payments/provider` | Estado da integração de pagamento | [013](013-pagamentos-mercado-pago.md) |
| `/progress`, `/certificates` | Progresso por aluno e curso, certificados (lista, gestão e download do PDF pela equipe) | [014](014-aprendizado-e-progresso.md), [015](015-certificados.md) |
| `/forum/*` | Categorias livres, moderação de tópicos e respostas | [017](017-forum.md) |
| `/events` | Calendário | [018](018-calendario-e-eventos.md) |
| `/gamification/*`, `/users/{id}/badges`, `/users/{id}/points/adjust` | Tabela de pontos, níveis, medalhas, concessão manual de medalha e ajuste manual de pontos (só admin) | [020](020-gamificacao.md) |
| `/cases` | Destaque e moderação de cases | [022](022-cases.md) |
| `/tickets` | Atendimento de chamados | [023](023-chamados-de-suporte.md) |
| `/announcements` | Novidades da escola | [025](025-novidades.md) |
| `/moderation/*`, `/users/{id}/moderation-history` | Fila de denúncias, ações de moderação, advertências e suspensões | [026](026-moderacao-e-denuncias.md) |
| `/mcp-keys` | Emissão e revogação de chaves MCP | [027](027-mcp.md) |
| `/audit` | Consulta ao registro de auditoria | [028](028-auditoria.md) |
| `/images` | Envio e leitura de imagens | [029](029-imagens.md) |
| `/settings/*`, `/terms`, `/users/{id}/export`, `/users/{id}/deletion` | Configuração da escola, identidade visual, versões de termos, exportação e exclusão em nome do usuário | [030](030-lgpd.md), [031](031-infraestrutura-e-deploy.md) |
| `/ops/*` (inclui `/ops/jobs`, `/ops/emails`, `/ops/webhooks`) | Fila, e-mails e webhooks com falha; só evento de webhook `failed` aceita reprocessamento, `rejected` fica sem essa ação | [005](005-worker-e-fila.md), [024](024-notificacoes-e-email.md), [033](033-observabilidade-retencao-backup.md) |
| `/notifications`, `/stream` | Central de notificações da equipe e seu fluxo SSE | [024](024-notificacoes-e-email.md), esta spec |
| `/search` | Busca global no painel | [006](006-sites-e-interface.md) |
| `/dashboard` | Indicadores da tela inicial | [006](006-sites-e-interface.md) |

### Meta

`GET /api/v1/meta` é o único endpoint público de dados da instalação e de marca; os dois sites o chamam ao carregar ([006](006-sites-e-interface.md), RF-06 e RF-11). Não há endpoint de marca separado: os dados são poucos, públicos e lidos no mesmo momento. As duas APIs devolvem o mesmo esquema `Meta`.

| Campo | Tipo | Origem | Regra |
| --- | --- | --- | --- |
| `schoolName` | texto | `settings` `school.name` | Padrão `nuva-edu` |
| `version` | texto | `version` do `package.json` do serviço | SemVer. Na imagem, é a versão gravada pelo argumento de build `NUVA_VERSION` ([031](031-infraestrutura-e-deploy.md), "Dockerfiles"); fora dela, a do repositório |
| `currency` | texto | `NUVA_CURRENCY` | ISO 4217 |
| `locale` | texto | `NUVA_LOCALE` | Etiqueta BCP 47, já na forma canônica ([031](031-infraestrutura-e-deploy.md)) |
| `authProviders` | lista | variáveis dos provedores | `google`, `facebook`, `apple`; vazia quando nenhum |
| `logoUrl` | texto ou nulo | `settings` `school.logo_image_id` | Caminho da imagem na própria API, na variante de 256 px ([029](029-imagens.md)); nulo sem logotipo, e os sites mostram só o nome |
| `accentColor` | texto ou nulo | `settings` `school.accent_color` | `#RRGGBB`; nulo usa a cor de destaque padrão de `packages/ui` |
| `sourceCodeUrl` | texto | `settings` `school.source_code_url` | Sempre presente (AGPL-3.0, [0016](decisions/0016-licenca-agpl-3.md)); padrão `https://github.com/patrickbrandao/nuva-edu` |

- As chaves de `settings`, os formatos e os padrões estão em [031](031-infraestrutura-e-deploy.md), "Configurações da escola".
- A leitura de `settings` é feita por `packages/core` (módulo `settings`), que aplica o padrão quando a chave não existe ou tem valor inválido; valor inválido gera aviso no log e nunca derruba o `/meta`.
- No contrato, os oito campos são obrigatórios (`required`): `logoUrl` e `accentColor` vão sempre na resposta, com `null` quando não há valor, e nunca são omitidos.

### Subida estrita

- Na inicialização, a API compara as rotas registradas com o contrato nos dois sentidos: operação do contrato sem rota, ou rota fora do contrato, impede a subida, com a lista completa no log. A subida barra só isso.
- O teste de contrato e o comando `check-contract` fazem a mesma comparação e conferem, além dela, o que depende só do texto do contrato: o `csrfToken` das escritas ([CSRF no contrato](#csrf-no-contrato)) e as [respostas de erro declaradas](#respostas-de-erro-declaradas). Divergência nesses dois pontos reprova o teste de contrato (no `verify:quick`, quando o contrato ou as rotas mudam, e no CI) e o `check-contract` (no `verify:full` e na imagem), mas não impede a subida.
- Operação com `x-nuva-pending: true` no contrato é ignorada quando não tem rota (o contrato chegou antes do código): a subida só a cita no log, em nível `info`, e o caminho responde `404 not_found` como qualquer outro inexistente.
- Operação pendente **com** rota registrada também não impede a subida, mas gera aviso (`warn`) no log da subida e a cada conferência do contrato: a marca precisa sair do contrato.
- No teste de contrato, a lista de divergências continua vazia com operação pendente, com ou sem rota: o teste passa. Os avisos saem numa lista à parte, cada linha começando por `aviso:`, que o teste imprime.
- As demais regras valem para a operação pendente: `csrfToken` nas escritas e respostas de erro declaradas (teste de contrato e `check-contract`), e esquemas válidos.
- `check-contract --no-pending` falha se o contrato tiver qualquer operação pendente, com ou sem rota, listando-as; é usado no `verify:full` e na release, e é o que impede a marca de ficar esquecida. Sem a opção, o comando só avisa. O comando confere rotas e contrato sem precisar de banco. Existe nas duas APIs (`pnpm --filter @nuva-edu/admin-api check-contract` e `pnpm --filter @nuva-edu/classroom-api check-contract`), e o `verify:full` o chama no passo `contrato` ([032](032-verificacao-e-ci.md)).
- O fluxo de trabalho que essa regra impõe está em [002](002-organizacao-do-trabalho.md), "Janela de contrato".

### Alcance do instrutor

Toda listagem e toda leitura de conteúdo, fórum, progresso e certificados feita por `instructor` é filtrada, no banco, pelos cursos de que ele é dono. Recurso de outro curso responde `404`, não `403`, para não revelar existência.

### Casos de erro

- Banco indisponível: `503` com `code: database_unavailable`; `/readyz` passa a `503`.
- Mercado Pago indisponível em estorno: `503` com `code: payment_provider_unavailable`; nada é alterado localmente.
- Contrato e rota divergentes (operação sem rota ou rota fora do contrato): o serviço não sobe (falha na inicialização) e o teste de contrato falha no CI ([Subida estrita](#subida-estrita)).
- Corpo acima do limite: `413` com `code: payload_too_large`. `Content-Type` não declarado pela operação: `415` com `code: unsupported_media_type`. Em ambos, a rota não roda.

## Interfaces e contratos

- HTTP: `apps/admin-api/openapi.yaml`.
- MCP: Streamable HTTP em `/mcp`, ferramentas descritas em [027](027-mcp.md).
- Linha de comando na imagem: `create-admin` (emergência, ver [007](007-contas-e-autenticacao.md)), `check-contract` e o comando de migrations (`node /app/database/postgres/src/cli.ts up`), que é o que o serviço `migrate` do Compose executa: ele usa esta mesma imagem, está no `docker-compose.yml` da `admin-api` e roda antes das APIs e do worker ([031](031-infraestrutura-e-deploy.md)).
- Base HTTP: `packages/api-kit`, comum às duas APIs. Além da validação pelo contrato e dos erros, ela dá o registro e as métricas de cada requisição, inclusive da encerrada pelo cliente (status `499`), e a base dos fluxos SSE ([004](004-classroom-api.md), "Base do fluxo"; [033](033-observabilidade-retencao-backup.md)).
- Banco: migrations em `database/postgres/migrations`.

## Dados

A `admin-api` é a única que escreve em: `settings`, `terms_versions`, `courses`, `modules`, `lessons`, `lesson_links`, `ebooks`, `bundles`, `bundle_items`, `product_ebooks`, `plans`, `plan_items`, `coupons`, `events`, `announcements`, `levels`, `badges`, `mcp_keys`, `audit_log`, `refunds` (solicitação), `entitlements` com `source = grant`, papel e estado de suspensão em `users`, estado de moderação em `forum_topics`, `forum_posts`, `cases`, `case_comments` e `reports`, preferências de notificação da equipe no admin e o lado da equipe em `tickets` e `ticket_messages`.

Lê as demais tabelas. Retenção: [033](033-observabilidade-retencao-backup.md).

## Critérios de aceite

- [ ] Toda rota registrada existe em `apps/admin-api/openapi.yaml` e vice-versa (teste de contrato).
- [ ] Sessão de `student` recebe `403` em qualquer rota de `/api/v1`, exceto `/auth/*` e `/meta`.
- [ ] `instructor` recebe `404` ao pedir curso, aula, tópico ou progresso de curso que não é seu.
- [ ] `/api/v1/stream` exige sessão de equipe, entrega só as notificações do titular, limita três conexões e recupera a central após reconexão; `student` recebe `403`.
- [ ] Erros seguem `application/problem+json` com `code` estável, e os códigos gerais são os da tabela de [Códigos de erro](#códigos-de-erro).
- [ ] Corpo acima do limite recebe `413` com `payload_too_large`; `Content-Type` não declarado recebe `415` com `unsupported_media_type`; JSON malformado recebe `400` com `validation_failed`.
- [ ] Toda operação declara as respostas de erro da tabela de [Respostas de erro declaradas](#respostas-de-erro-declaradas) (teste de contrato).
- [ ] Operação com `x-nuva-pending` não impede a subida, com ou sem rota; `check-contract --no-pending` falha enquanto houver alguma.
- [ ] `GET /api/v1/meta` devolve o nome, a cor e o endereço do código-fonte gravados em `settings`, e os padrões quando não há nada gravado.
- [ ] Limites de taxa de RNF-03 respondem `429` com `Retry-After`; a entrega de imagens não conta no limite por sessão.
- [ ] Requisição que altera dados sem `X-CSRF-Token` válido recebe `403` com `code: csrf_token_invalid`.
- [ ] Toda operação de escrita do contrato declara `csrfToken` no `security`.
- [ ] Nenhuma resposta de `/users` contém a senha; só a rota de exibição a devolve, e apenas para `admin`.
- [ ] Toda alteração gera linha em `audit_log`.
- [ ] `/readyz` responde `503` com banco fora do ar ou em versão de migration diferente da esperada.
- [ ] Definition of Done ([002](002-organizacao-do-trabalho.md)) atendida.

## Fora de escopo

- API pública para terceiros além do MCP.
- Versão `/api/v2`.
- Upload de vídeo ou de arquivo ([0006](decisions/0006-conteudo-por-link-externo.md)).

## Decisões relacionadas

- [0004 — Duas APIs, um banco](decisions/0004-duas-apis-um-banco.md)
- [0028 — SSE também na admin-api](decisions/0028-sse-tambem-na-admin-api.md)
- [0009 — Stack TypeScript, Fastify e Kysely](decisions/0009-stack-typescript-fastify-kysely.md)
- [0012 — Chaves MCP herdam o papel](decisions/0012-mcp-chaves-herdam-papel.md)
- [0019 — Janela de contrato e operações pendentes](decisions/0019-janela-de-contrato-e-operacoes-pendentes.md)
- [0022 — Janela de contrato num só branch](decisions/0022-janela-de-contrato-num-so-branch.md)
- [0002 — Senha em texto legível](decisions/0002-senha-em-texto-legivel.md)
