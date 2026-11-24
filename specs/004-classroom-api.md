# 004 — classroom-api

Status: aprovada
Depende de: 000, 001, 007, 008, 010

## Contexto

A `classroom-api` é o backend do site do aluno (`https://<NUVA_CLASSROOM_HOST>`). Atende visitantes sem login (vitrine, cases públicos, validação de certificado), alunos e a equipe quando participa da comunidade. Recebe o webhook do Mercado Pago e mantém o fluxo SSE de mensagens e notificações. É separada da `admin-api` por decisão de arquitetura ([0004](decisions/0004-duas-apis-um-banco.md)).

## Requisitos

- RF-01: Expor a API do aluno em `/api/v1`, descrita integralmente em `apps/classroom-api/openapi.yaml` (OpenAPI 3.1), incluindo o fluxo SSE.
- RF-02: Servir sem login: vitrine, cases públicos, validação de certificado, termos vigentes, as rotas de autenticação e `GET /api/v1/meta`.
- RF-03: Verificar o direito de acesso ([010](010-direitos-de-acesso.md)) em toda rota que entrega conteúdo de aula, link de ebook, fórum de curso ou evento restrito.
- RF-04: Receber o webhook do Mercado Pago, validar a assinatura, gravar em `webhook_events` e enfileirar o processamento ([013](013-pagamentos-mercado-pago.md)).
- RF-05: Manter `GET /api/v1/stream` (SSE) para entregar mensagens diretas e notificações sem recarregar a página.
- RF-06: Validar toda requisição e toda resposta contra o contrato.
- RF-07: Higienizar todo conteúdo escrito por usuário (fórum, cases, mensagens, perfil, chamados) antes de gravar e devolver apenas HTML permitido.
- RF-08: Expor `/healthz`, `/readyz` e `/metrics` ([033](033-observabilidade-retencao-backup.md)). `/healthz` e `/readyz` ficam na raiz, fora de `/api/v1`, e são descritas no contrato; `/metrics` é interna e não entra nele.
- RNF-01: p95 abaixo de 300 ms com 500 usuários simultâneos em 2 vCPU / 4 GB.
- RNF-02: Sustentar 500 conexões SSE abertas num único processo, com consumo adicional inferior a 200 MB de RAM.
- RNF-03: Evento SSE entregue em até 2 s após a gravação da mensagem ou notificação.
- RNF-04: Limites de taxa: 120 requisições por minuto por sessão; 60 por minuto por IP para visitantes; 10 por minuto por IP em login, cadastro e redefinição; 20 mensagens diretas por minuto e 10 publicações de fórum por minuto por usuário.
- RNF-05: Corpo de requisição limitado a 256 KB, exceto envio de imagem, limitado a 5 MB ([029](029-imagens.md)); a imagem é processada na própria API que recebe o envio, não no worker.

## Comportamento

### Autenticação e autorização

- Sessão por cookie `nuva_classroom_session` (httpOnly, Secure, SameSite=Lax, escopo `NUVA_CLASSROOM_HOST`), independente do cookie do admin ([007](007-contas-e-autenticacao.md)).
- Requisições que alteram dados exigem `X-CSRF-Token` (sem ele, `403` com `code: csrf_token_invalid`), exceto o webhook de pagamento (autenticado por assinatura) e os retornos OAuth (protegidos por `state`). No contrato, a exigência é o esquema de segurança `csrfToken`, como na `admin-api` ([003](003-admin-api.md), "CSRF no contrato"); as exceções não o declaram e dizem o motivo na descrição.
- Usuário suspenso tem as sessões derrubadas e recebe `403` com `code: account_suspended`.
- Usuário com e-mail não confirmado navega e assiste a conteúdo aberto, mas recebe `403` com `code: email_not_verified` ao comprar ou publicar.
- A equipe usa a mesma API com a própria conta; o selo "Equipe" vem do papel.

### Convenções da API

Iguais às da `admin-api` ([003](003-admin-api.md)): caminhos completos no contrato, JSON em `camelCase`, erros em `application/problem+json` com `code` estável (os códigos gerais e as regras para código próprio são os de "Códigos de erro" da 003), paginação por cursor (`limit` padrão 25, máximo 100; `Page` composto por `allOf`, com `items` declarado em cada listagem), `Idempotency-Key` em criação de pedido e de assinatura, `X-Request-Id` em toda resposta, IP do cliente por `TRUSTED_PROXIES`.

Regra adicional: recurso que existe mas ao qual o aluno não tem direito responde `403` com `code: entitlement_required` e, no corpo, os produtos que o liberam (para a interface oferecer a compra). Produto `private` sem direito responde `404`.

### Grupos de rotas

| Prefixo em `/api/v1` | Login | Conteúdo | Spec |
| --- | --- | --- | --- |
| `/meta` | Não | Dados públicos da instalação, com os mesmos campos da `admin-api` | [003](003-admin-api.md) |
| `/auth/*`, `/session` | Não | Cadastro, login, OAuth, confirmação, redefinição | [007](007-contas-e-autenticacao.md) |
| `/catalog` | Não | Vitrine: produtos e planos não privados | [009](009-catalogo-e-conteudo.md) |
| `/courses`, `/lessons`, `/ebooks`, `/library` | Sim (programa: não) | Programa, player, links, estante | [009](009-catalogo-e-conteudo.md), [014](014-aprendizado-e-progresso.md) |
| `/cart`, `/checkout`, `/orders`, `/coupons/validate` | Sim | Cesta, checkout, pedidos | [011](011-vendas-e-checkout.md) |
| `/plans`, `/subscriptions` | Sim (lista: não) | Assinar, cancelar, situação | [012](012-assinaturas.md) |
| `/webhooks/mercadopago` | Assinatura | Aviso de pagamento | [013](013-pagamentos-mercado-pago.md) |
| `/progress` | Sim | Conclusão de aula, continuar de onde parou | [014](014-aprendizado-e-progresso.md) |
| `/certificates` | Validação: não | Emitir, baixar, validar por código | [015](015-certificados.md) |
| `/notes` | Sim | Anotações | [016](016-anotacoes.md) |
| `/forum/*` | Sim | Categorias, tópicos, respostas, reações | [017](017-forum.md) |
| `/events` | Sim | Calendário | [018](018-calendario-e-eventos.md) |
| `/members`, `/profile`, `/follows` | Sim | Diretório, perfil, seguir | [019](019-perfil-e-diretorio.md) |
| `/me/points`, `/rankings/*`, `/members/{handle}/achievements` | Sim | Pontos, nível, medalhas, ranking | [020](020-gamificacao.md) |
| `/conversations`, `/blocks` | Sim | Mensagens diretas, bloqueio | [021](021-mensagens-diretas.md) |
| `/cases` | Leitura: não (cases públicos são visíveis a visitantes) | Cases, curtidas, comentários, salvos | [022](022-cases.md) |
| `/tickets` | Sim | Chamados | [023](023-chamados-de-suporte.md) |
| `/notifications`, `/me/notification-prefs` | Sim | Central e preferências | [024](024-notificacoes-e-email.md) |
| `/unsubscribe/{token}` | Não (token do e-mail) | Descadastro de um tipo de e-mail | [024](024-notificacoes-e-email.md) |
| `/announcements` | Sim | Novidades | [025](025-novidades.md) |
| `/reports`, `/me/reports` | Sim | Denunciar conteúdo ou usuário | [026](026-moderacao-e-denuncias.md) |
| `/images` | Leitura: não | Envio e leitura | [029](029-imagens.md) |
| `/me/export`, `/me/deletion`, `/me/terms-acceptance`, `/legal/{document}` | Sim (`/legal`: não) | LGPD: exportação, exclusão, aceite e textos vigentes | [030](030-lgpd.md) |
| `/search` | Sim | Busca global em cursos, aulas, tópicos e membros visíveis ao usuário | [006](006-sites-e-interface.md) |
| `/stream` | Sim | SSE | esta spec |

### Fluxo SSE (`GET /api/v1/stream`)

1. O navegador abre a conexão com o cookie de sessão. Resposta `text/event-stream`, sem compressão, com `Cache-Control: no-store`.
2. A API mantém uma única conexão `LISTEN` ao PostgreSQL por processo, no canal `nuva_user_events`. Quem grava uma mensagem ou notificação executa `NOTIFY` com `{ userId, kind, id }` na mesma transação.
3. A API repassa o evento às conexões abertas daquele `userId`.

| Evento | Dados | Quando |
| --- | --- | --- |
| `dm.message.created` | `conversationId`, `messageId` | Nova mensagem direta recebida ([021](021-mensagens-diretas.md)) |
| `dm.message.read` | `conversationId`, `messageId` | O destinatário leu a mensagem |
| `dm.message.deleted` | `conversationId`, `messageId` | Mensagem apagada |
| `notification.created` | `notificationId`, `type`, `unreadCount` | Nova notificação ([024](024-notificacoes-e-email.md)) |
| `forum.post.created` | `topicId`, `postId` | Nova resposta num tópico aberto na tela ([017](017-forum.md)) |
| `announcement.published` | `announcementId`, `unreadCount` | Nova novidade publicada ([025](025-novidades.md)) |
| `presence` | `userId`, `online` | Mudança de presença de alguém numa conversa aberta |
| `ping` | objeto vazio | A cada 25 s, para manter a conexão viva |

- O evento carrega só identificadores; o conteúdo é buscado pela rota normal, que checa permissão.
- No fio, cada evento usa os campos `id`, `event` (nome da tabela acima) e `data` (objeto JSON numa linha). No contrato, cada evento é um esquema `StreamEvent*`, reunidos em `StreamEvent`.
- Cada evento tem `id` crescente por usuário, exceto `ping`, que não tem `id`. Na reconexão, `Last-Event-ID` faz a API reenviar o que foi perdido nos últimos 5 minutos; além disso, a interface recarrega as listas.
- Limite de 3 conexões SSE por usuário; a quarta derruba a mais antiga.
- Presença: usuário é "online" enquanto tiver conexão SSE aberta; `profiles.last_seen_at` ([019](019-perfil-e-diretorio.md)) é atualizado no fechamento e a cada 60 s.
- Sessão encerrada ou usuário com suspensão `full`: a conexão é fechada pelo servidor.

### Casos de erro

- PostgreSQL indisponível: `503`; conexões SSE são fechadas e o navegador reconecta com espera crescente (1 s a 30 s).
- Mercado Pago indisponível no checkout: `503` com `code: payment_provider_unavailable`; o restante do site segue normal ([013](013-pagamentos-mercado-pago.md)).
- Webhook com assinatura inválida: `401`, registrado em `webhook_events` com `status = rejected`.

## Interfaces e contratos

- HTTP e SSE: `apps/classroom-api/openapi.yaml`.
- Entrada externa: `POST /api/v1/webhooks/mercadopago` e os retornos OAuth em `/api/v1/auth/{google,facebook,apple}/callback`.
- Banco: migrations em `database/postgres/migrations`.

## Dados

A `classroom-api` é a única que escreve em: `users` (cadastro e dados do próprio usuário), `sessions`, `oauth_identities`, `email_tokens`, `login_attempts`, `terms_acceptances`, `carts`, `cart_items`, `orders` e `order_items` (criação), `lesson_progress`, `notes`, `forum_topics` e `forum_posts` (conteúdo), `reactions`, `profiles`, `follows`, `conversations`, `messages`, `user_blocks`, `cases`, `case_images`, `case_comments`, `tickets` e `ticket_messages` (lado do aluno), `notifications` (marca de lida), `notification_prefs`, `reports` (criação), `images` enviadas por alunos e `webhook_events` (recebimento).

O estado de pagamento, as assinaturas e os direitos derivados são escritos pelo `worker` ([005](005-worker-e-fila.md)); o catálogo, pela `admin-api` ([003](003-admin-api.md)).

## Critérios de aceite

- [ ] Toda rota registrada existe em `apps/classroom-api/openapi.yaml` e vice-versa (teste de contrato).
- [ ] Visitante sem login acessa vitrine, cases públicos e validação de certificado, e recebe `401` nas demais rotas.
- [ ] Aula de curso `paid` sem direito responde `403` com `entitlement_required`; aula com `is_sample` é entregue a qualquer usuário logado.
- [ ] Mensagem direta enviada chega por SSE ao destinatário em até 2 s.
- [ ] 500 conexões SSE simultâneas mantidas em teste de carga, dentro de RNF-02.
- [ ] Conteúdo com `<script>` em tópico, case, mensagem ou perfil é neutralizado na gravação e na leitura.
- [ ] Webhook com assinatura inválida é recusado e registrado.
- [ ] Limites de taxa de RNF-04 respondem `429` com `Retry-After`.
- [ ] Definition of Done ([002](002-organizacao-do-trabalho.md)) atendida.

## Fora de escopo

- WebSocket, indicador de "digitando" e canais de chat ([0008](decisions/0008-fila-e-sse-no-postgres.md), [0017](decisions/0017-escopo-do-mvp.md)).
- Renderização no servidor da vitrine ([0018](decisions/0018-vitrine-spa.md)).
- Qualquer rota administrativa.

## Decisões relacionadas

- [0004 — Duas APIs, um banco](decisions/0004-duas-apis-um-banco.md)
- [0008 — Fila e SSE no PostgreSQL](decisions/0008-fila-e-sse-no-postgres.md)
- [0009 — Stack TypeScript, Fastify e Kysely](decisions/0009-stack-typescript-fastify-kysely.md)
- [0011 — Autenticação, sessão e vínculo social](decisions/0011-autenticacao-sessao-e-vinculo-social.md)
