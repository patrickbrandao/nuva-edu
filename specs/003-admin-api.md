# 003 — admin-api

Status: aprovada
Depende de: 000, 001, 007, 008

## Contexto

A `admin-api` é o backend do site de administração (`https://<NUVA_ADMIN_HOST>`). Atende a equipe da escola (`instructor`, `manager`, `admin`) e hospeda o servidor MCP ([027](027-mcp.md)). É um serviço separado da `classroom-api` para isolar a superfície administrativa da superfície pública ([0004](decisions/0004-duas-apis-um-banco.md)); as duas compartilham o mesmo PostgreSQL e as regras de `packages/core`.

## Requisitos

- RF-01: Expor a API administrativa em `/api/v1`, descrita integralmente em `apps/admin-api/openapi.yaml` (OpenAPI 3.1).
- RF-02: Expor o servidor MCP em `/mcp` no mesmo processo ([027](027-mcp.md)).
- RF-03: Recusar com `403` qualquer sessão cujo papel seja apenas `student`.
- RF-04: Validar toda requisição e toda resposta contra o contrato; rota fora do contrato não é registrada. Única exceção: `/metrics`, que é interna e não entra no contrato.
- RF-05: Registrar em `audit_log` toda requisição que altera dados e toda leitura sensível ([028](028-auditoria.md)).
- RF-06: Aplicar as migrations pendentes não é função da API: ela só sobe se o banco estiver na versão esperada (caso contrário `/readyz` responde `503`).
- RF-07: Criar o admin inicial na primeira subida, conforme [007](007-contas-e-autenticacao.md).
- RF-08: Expor `/healthz`, `/readyz` e `/metrics` ([033](033-observabilidade-retencao-backup.md)). `/healthz` e `/readyz` ficam na raiz, fora de `/api/v1`, e são descritas no contrato.
- RF-09: Expor `GET /api/v1/meta`, sem sessão, com os dados públicos da instalação.
- RNF-01: p95 de resposta abaixo de 300 ms para leituras paginadas com 50 usuários de equipe simultâneos, em 2 vCPU / 4 GB.
- RNF-02: Corpo de requisição limitado a 1 MB, exceto envio de imagem, limitado a 5 MB ([029](029-imagens.md)); a imagem é processada na própria API que recebe o envio, não no worker.
- RNF-03: Limite de taxa de 300 requisições por minuto por sessão e 20 por minuto por IP nas rotas de autenticação.
- RNF-04: Nenhuma resposta, log ou erro contém o campo de senha, exceto a rota dedicada de exibição de senha ([007](007-contas-e-autenticacao.md)).

## Comportamento

### Autenticação e autorização

- Sessão por cookie `nuva_admin_session` (httpOnly, Secure, SameSite=Lax, escopo `NUVA_ADMIN_HOST`), descrita em [007](007-contas-e-autenticacao.md).
- Toda rota declara a permissão exigida; a checagem usa a matriz de [008](008-papeis-e-permissoes.md), implementada em `packages/core` e compartilhada com o MCP.
- Requisições que alteram dados exigem o cabeçalho `X-CSRF-Token` igual ao token emitido em `GET /api/v1/session`.
- O MCP não usa cookie: autentica por chave no cabeçalho `Authorization: Bearer` ([027](027-mcp.md)).

### Convenções da API

| Assunto | Regra |
| --- | --- |
| Caminhos no contrato | O `servers` do contrato é a origem do site (`/`); cada caminho aparece completo (`/api/v1/...`, `/healthz`, `/readyz`), igual à rota registrada. |
| Formato | JSON em UTF-8; campos em `camelCase`; datas ISO 8601 em UTC; dinheiro em centavos inteiros. |
| Erros | `application/problem+json` (RFC 9457) com `type`, `title`, `status`, `detail`, `instance`, `code` (identificador estável, ex.: `permission_denied`) e, em validação, `errors[]` com `path` e `message`. |
| Códigos | `400` validação, `401` sem sessão, `403` sem permissão, `404` inexistente ou fora do alcance do instrutor, `409` conflito de estado, `422` regra de negócio, `429` limite de taxa, `503` dependência indisponível. |
| Paginação | Por cursor: `?limit=` (padrão 25, máximo 100) e `?cursor=`; resposta `{ items, nextCursor }`, com `nextCursor` nulo na última página. |
| Ordenação e filtro | `?sort=campo` ou `-campo`; filtros como parâmetros nomeados, todos listados no contrato. |
| Busca | `?q=` com busca textual simples (`ILIKE` com índice trigram) onde o contrato indicar. |
| Idempotência | `POST` que cria cobrança, estorno ou concessão aceita `Idempotency-Key`; repetição devolve a primeira resposta por 24 h. |
| Concorrência | Edição de recurso envia `version` (inteiro); divergência resulta em `409`. |
| Rastreamento | Toda resposta traz `X-Request-Id`, presente também nos logs. |
| IP do cliente | Derivado de `X-Forwarded-For` apenas quando o remetente está em `TRUSTED_PROXIES`. |

### Grupos de rotas

| Prefixo em `/api/v1` | Conteúdo | Spec |
| --- | --- | --- |
| `/meta` | Dados públicos da instalação, sem sessão: `schoolName`, `version`, `currency`, `locale`, `authProviders` (provedores de login social configurados: `google`, `facebook`, `apple`) | esta spec, [007](007-contas-e-autenticacao.md) |
| `/session`, `/auth/*` | Login, logout, sessão atual, token CSRF | [007](007-contas-e-autenticacao.md) |
| `/users` | Alunos e equipe: listar, ver, editar, suspender, mudar papel, exibir senha, sessões | [007](007-contas-e-autenticacao.md), [008](008-papeis-e-permissoes.md) |
| `/courses`, `/modules`, `/lessons`, `/ebooks`, `/bundles` | Catálogo e conteúdo | [009](009-catalogo-e-conteudo.md) |
| `/entitlements` | Concessão e revogação manual, consulta de direitos | [010](010-direitos-de-acesso.md) |
| `/orders`, `/refunds`, `/coupons`, `/sales/export` | Vendas, estorno, cupons, CSV | [011](011-vendas-e-checkout.md) |
| `/plans`, `/subscriptions` | Planos e assinaturas | [012](012-assinaturas.md) |
| `/payments/provider` | Estado da integração de pagamento | [013](013-pagamentos-mercado-pago.md) |
| `/progress`, `/certificates` | Progresso por aluno e curso, certificados | [014](014-aprendizado-e-progresso.md), [015](015-certificados.md) |
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
| `/ops/*` (inclui `/ops/jobs`, `/ops/emails`, `/ops/webhooks`) | Fila, e-mails e webhooks com falha, reprocessamento | [005](005-worker-e-fila.md), [024](024-notificacoes-e-email.md), [033](033-observabilidade-retencao-backup.md) |
| `/notifications` | Central de notificações da equipe | [024](024-notificacoes-e-email.md) |
| `/search` | Busca global no painel | [006](006-sites-e-interface.md) |
| `/dashboard` | Indicadores da tela inicial | [006](006-sites-e-interface.md) |

### Alcance do instrutor

Toda listagem e toda leitura de conteúdo, fórum, progresso e certificados feita por `instructor` é filtrada, no banco, pelos cursos de que ele é dono. Recurso de outro curso responde `404`, não `403`, para não revelar existência.

### Casos de erro

- Banco indisponível: `503` com `code: database_unavailable`; `/readyz` passa a `503`.
- Mercado Pago indisponível em estorno: `503` com `code: payment_provider_unavailable`; nada é alterado localmente.
- Contrato e rota divergentes: o serviço não sobe (falha na inicialização) e o teste de contrato falha no CI.

## Interfaces e contratos

- HTTP: `apps/admin-api/openapi.yaml`.
- MCP: Streamable HTTP em `/mcp`, ferramentas descritas em [027](027-mcp.md).
- Linha de comando na imagem: `create-admin` (emergência, ver [007](007-contas-e-autenticacao.md)), `check-contract` e `migrate` (aplica as migrations; é o comando do serviço `migrate` do Compose, que usa esta mesma imagem e roda antes das APIs, ver [031](031-infraestrutura-e-deploy.md)).
- Banco: migrations em `database/postgres/migrations`.

## Dados

A `admin-api` é a única que escreve em: `settings`, `terms_versions`, `courses`, `modules`, `lessons`, `lesson_links`, `ebooks`, `bundles`, `bundle_items`, `product_ebooks`, `plans`, `plan_items`, `coupons`, `events`, `announcements`, `levels`, `badges`, `mcp_keys`, `audit_log`, `refunds` (solicitação), `entitlements` com `source = grant`, papel e estado de suspensão em `users`, estado de moderação em `forum_topics`, `forum_posts`, `cases`, `case_comments` e `reports`, e o lado da equipe em `tickets` e `ticket_messages`.

Lê as demais tabelas. Retenção: [033](033-observabilidade-retencao-backup.md).

## Critérios de aceite

- [ ] Toda rota registrada existe em `apps/admin-api/openapi.yaml` e vice-versa (teste de contrato).
- [ ] Sessão de `student` recebe `403` em qualquer rota de `/api/v1`, exceto `/auth/*` e `/meta`.
- [ ] `instructor` recebe `404` ao pedir curso, aula, tópico ou progresso de curso que não é seu.
- [ ] Erros seguem `application/problem+json` com `code` estável.
- [ ] Requisição que altera dados sem `X-CSRF-Token` válido recebe `403`.
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
- [0009 — Stack TypeScript, Fastify e Kysely](decisions/0009-stack-typescript-fastify-kysely.md)
- [0012 — Chaves MCP herdam o papel](decisions/0012-mcp-chaves-herdam-papel.md)
- [0002 — Senha em texto legível](decisions/0002-senha-em-texto-legivel.md)
