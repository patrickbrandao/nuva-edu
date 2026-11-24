# 007 — Contas e autenticação

Status: aprovada
Depende de: 000, 001

## Contexto

Qualquer pessoa pode se cadastrar no classroom. A mesma conta serve a alunos e à equipe; o papel decide o que ela faz ([008](008-papeis-e-permissoes.md)). O login aceita e-mail e senha, Google, Facebook e Apple, e os métodos convivem na mesma conta. A senha é guardada em texto legível por decisão do dono do produto, registrada como inquestionável em [0002](decisions/0002-senha-em-texto-legivel.md); esta spec define as proteções em volta dela.

## Requisitos

- RF-01: Cadastro por e-mail e senha, com nome, e aceite dos termos vigentes quando houver versão publicada; sem versão publicada o cadastro conclui sem aceite ([030](030-lgpd.md)).
- RF-02: Login por e-mail e senha.
- RF-03: Login e cadastro por Google, Facebook e Apple (OAuth 2.0 / OpenID Connect, fluxo de código com PKCE e `state`).
- RF-04: Conta criada por provedor pode definir senha depois; conta com senha pode vincular provedores. Todos os métodos vinculados funcionam ao mesmo tempo.
- RF-05: Usuário sem senha definida nunca autentica por senha; senha vazia, só de espaços ou ausente é sempre recusada.
- RF-06: A senha é gravada em texto legível na coluna `users.password` (nula quando não definida). Não há hash, cifra nem derivação.
- RF-07: Confirmação de e-mail por link para contas criadas por senha.
- RF-08: "Esqueci a senha" envia link de redefinição; nunca envia a senha.
- RF-09: Exibição da senha de um usuário apenas para `admin`, em rota dedicada, com registro em auditoria.
- RF-10: Bloqueio temporário por tentativas erradas e aviso por e-mail de login em dispositivo novo.
- RF-11: Sessões em tabela, revogáveis; o usuário vê e encerra as próprias sessões.
- RF-12: Admin inicial criado por variáveis de ambiente na primeira subida; comando de linha para emergência.
- RF-13: Métodos de login social só aparecem se as variáveis do provedor estiverem configuradas. Os sites leem a lista em `authProviders` de `GET /api/v1/meta`.
- RF-14: Foto de perfil (avatar) enviada pelo próprio usuário, guardada como imagem ([029](029-imagens.md)).
- RF-15: Os três provedores sociais podem ser trocados por um provedor simulado no desenvolvimento e nos testes, com o mesmo código de produção ([Provedor simulado](#provedor-simulado); [0024](decisions/0024-provedor-oauth-simulado.md)).
- RNF-01: Senha com 8 a 128 caracteres; sem outras regras de composição.
- RNF-02: 5 erros de senha em 15 minutos bloqueiam por 15 minutos (por conta e por IP, contados separadamente).
- RNF-03: Sessão expira com 30 dias sem uso (`NUVA_RETENTION_SESSION_DAYS`); links de confirmação e redefinição valem 24 h e uso único.
- RNF-04: Comparação de senha e de tokens em tempo constante; resposta de login leva o mesmo tempo para conta existente e inexistente (variação inferior a 50 ms no p95).
- RNF-05: A senha não aparece em logs, erros, `audit_log`, `jobs.payload`, `email_outbox`, exportações (CSV e LGPD), respostas do MCP nem em qualquer resposta de API além da rota de RF-09.

## Comportamento

### Cadastro por e-mail e senha

1. Informa nome, e-mail, senha e aceita os termos (`POST /auth/register`).
2. Validação, nesta ordem: formato dos campos (`400`), aceite dos termos vigentes quando houver versão publicada (`422` `terms_acceptance_required`). Só depois a existência do e-mail é consultada.
3. E-mail é normalizado (minúsculas, sem espaços nas pontas). Se já existir conta com o e-mail, a resposta é a mesma de sucesso e o dono do e-mail recebe o e-mail `account.exists` ("já existe conta, entre ou redefina a senha"), sem nenhuma alteração na conta.
4. Conta nova: `email_verified_at` nulo, papel `student`, aceites gravados, e-mail `account.verify_email` enfileirado, tudo numa transação.
5. A rota de cadastro **não abre sessão**, nos dois casos: responde `204`. O site, em seguida, chama `POST /auth/login` com o mesmo e-mail e a mesma senha. Assim a resposta do cadastro não revela se o e-mail já tinha conta; o login revela só o que qualquer login revela.
6. Sem e-mail confirmado o usuário entra, navega e assiste a conteúdo aberto, mas não compra, não publica e não envia mensagem (`403` `email_not_verified`, nas rotas das fases seguintes).

### Login por senha

- Recusado se a conta não tem senha (`password IS NULL`), se a senha enviada é vazia ou só de espaços, ou se não confere.
- Resposta única para qualquer falha: `401` `invalid_credentials`, título "e-mail ou senha incorretos". Conta só com provedor e e-mail inexistente recebem a mesma resposta, no mesmo tempo (RNF-04: a comparação roda também quando a conta não existe).
- Conta com suspensão `full`: `403` `account_suspended`, só depois de a senha conferir (quem não sabe a senha recebe `invalid_credentials`). Suspensão `posting` não impede o login ([008](008-papeis-e-permissoes.md), [026](026-moderacao-e-denuncias.md)).
- Conta excluída (`deleted_at` preenchido) se comporta como inexistente.
- Cada tentativa grava em `login_attempts` (e-mail normalizado, IP, sucesso, data), inclusive a de e-mail inexistente.
- Sucesso: abre a sessão do site, atualiza `users.last_login_at`, grava `auth.login` na auditoria ([028](028-auditoria.md)) e confere o dispositivo ([Bloqueio e dispositivo novo](#bloqueio-e-dispositivo-novo)).
- No site admin, login certo de quem tem papel `student`: `403` `staff_only`, sem abrir sessão. A tentativa conta como sucesso (a senha conferiu) e não entra no bloqueio.

### Login social e vínculo

| Situação | Resultado |
| --- | --- |
| Identidade do provedor já vinculada | Entra na conta. |
| Não vinculada, provedor atesta e-mail verificado, existe conta com esse e-mail | Vincula e entra. Se a conta local não tinha e-mail confirmado, passa a ter, e a senha definida antes da confirmação é apagada (`password = NULL`), para impedir que alguém que "reservou" o e-mail mantenha acesso. |
| Não vinculada, e-mail verificado, sem conta | Cadastro pendente: pede o aceite dos termos vigentes (se houver) e só então cria a conta `student` com e-mail confirmado, sem senha. |
| Provedor não atesta e-mail verificado ou não envia e-mail | Cadastro pendente sem vínculo por e-mail: pede o e-mail (quando o provedor não enviou) e o aceite; a conta nasce com o e-mail não confirmado e recebe `account.verify_email`. |
| Apple com e-mail oculto (`privaterelay.appleid.com`) | Conta própria com o e-mail de retransmissão, tratado como verificado; pode ser unida a outra só pelo vínculo manual no perfil. |

- E-mail "verificado": Google `email_verified = true`; Apple `email_verified = true` (no `id_token`, como booleano ou texto `"true"`); Facebook só quando a API devolve e-mail (tratado como verificado).
- Nome: o do provedor (Apple só o envia na primeira autorização, no campo `user` do retorno); sem nome, a parte local do e-mail.
- Vínculo manual: em Configurações > Acesso, o usuário logado adiciona (`intent=link`) ou remove provedores. Não é permitido remover o último método de acesso (precisa restar senha ou um provedor). Identidade que já está vinculada a outra conta: o vínculo é recusado com `identity_in_use`. A conta tem no máximo uma identidade por provedor (a remoção é por provedor, `DELETE /account/identities/{provider}`): vincular outra identidade de um provedor que a conta já tem é recusado com `provider_already_linked` (para trocar, remove-se a atual e vincula-se a nova); a mesma identidade já vinculada à própria conta conta como vínculo feito.
- Provedor fora do ar ou com erro: o retorno leva ao site com o código do erro; os demais métodos seguem funcionando.
- No site admin só existe `intent=login`: a identidade precisa já estar vinculada ou casar por e-mail verificado com uma conta da equipe. Não há cadastro pelo admin; quem não é da equipe volta com `staff_only`.

#### Fluxo do provedor

1. O site navega (navegação de página, não `fetch`) para `GET /api/v1/auth/{provider}/start?intent=login|link&returnTo=<caminho>`. `returnTo` é um caminho do próprio site (começa com `/`, não com `//`); outro valor vira `/`. `intent=link` exige sessão.
2. A API gera `state` (32 bytes aleatórios), `nonce` (OpenID) e o verificador PKCE (S256), grava-os no cookie de retorno ([Cookies](#cookies)) e responde `302` para o endereço de autorização do provedor.
3. O provedor volta em `/api/v1/auth/{provider}/callback`: `GET` com `code` e `state` (Google, Facebook) ou `POST` `application/x-www-form-urlencoded` com `code`, `state`, `id_token` e, na primeira vez, `user` (Apple, `response_mode=form_post`). O retorno não declara `csrfToken`: é protegido pelo `state`.
4. A API confere o `state` com o do cookie (tempo constante), troca o `code` (com o verificador PKCE) no servidor do provedor, valida o `id_token` quando houver (assinatura pela JWKS do provedor, `iss`, `aud`, `exp`, `nonce`), apaga o cookie de retorno e aplica a tabela acima.
5. O retorno sempre responde `302` para o próprio site, nunca com corpo de erro:

| Resultado | Destino |
| --- | --- |
| Entrou (sessão aberta) ou vinculou | `returnTo` |
| Cadastro pendente | `/cadastro/social` (só no classroom) |
| Erro | `/entrar?erro=<code>` no login; `/conta/acesso?erro=<code>` no vínculo |

Códigos do retorno: `oauth_state_invalid` (sem cookie, `state` diferente ou vencido), `oauth_denied` (o usuário recusou no provedor), `oauth_provider_error` (troca do código ou validação falhou, provedor fora do ar), `account_suspended`, `staff_only` (admin), `identity_in_use` e `provider_already_linked` (vínculo).

#### Cadastro pendente

- O que o provedor informou (provedor, identificador, e-mail, se é verificado, nome) fica no cookie de retorno, regravado com validade de 30 minutos. Não há tabela para isso.
- `GET /auth/social/pending` devolve esses dados (sem o identificador do provedor) e as versões vigentes dos termos; sem cookie válido, `404`.
- `POST /auth/social/complete` com `acceptedTerms` (e `email`, quando o provedor não enviou) cria a conta e o vínculo, grava os aceites, apaga o cookie e abre a sessão (`200` com a sessão). E-mail informado que já pertence a outra conta: `409` `email_taken` (o usuário entra na outra conta e vincula o provedor por lá).

### Definir, trocar e redefinir senha

- Definir (conta sem senha) e trocar: `PUT /account/password`. Com senha atual, ela é exigida (`currentPassword`; errada: `422` `current_password_invalid`, e a tentativa conta no bloqueio da conta); sem senha atual, basta a sessão.
- Redefinir: `POST /auth/password/forgot` responde sempre `204`; se a conta existir (e não estiver excluída), enfileira `account.password_reset` com link de 24 h. Conta só com provedor também recebe o link: usá-lo define a primeira senha.
- `POST /auth/password/reset` com o token e a nova senha: define a senha, confirma o e-mail, marca o token como usado e invalida os outros tokens `reset` da conta. Não abre sessão: o site leva a `/entrar`.
- Qualquer mudança de senha (definir, trocar, redefinir, definida pelo admin) encerra as outras sessões do usuário (redefinir e admin: todas), grava `auth.password_reset` ou `user.password_set` na auditoria e enfileira `account.password_changed`.

### Confirmação de e-mail

- O link é `<classroomUrl>/confirmar?token=<token>`; o site chama `POST /auth/email/verify` com o token. Sucesso: `email_verified_at = now()`, token usado, `204`. Token vencido, usado ou desconhecido: `410` `token_expired`.
- `POST /auth/email/resend` (com sessão) enfileira um novo link; até 3 por hora por usuário (`429` `rate_limited`). E-mail já confirmado: `204` sem envio.

### Tokens de e-mail

- Token: 32 bytes aleatórios em base64url; o banco guarda só o SHA-256 (`email_tokens.token_hash`). O token em claro existe só no e-mail enviado.
- Quem cria o token é a tarefa `email.send` do worker, no momento de montar o e-mail ([024](024-notificacoes-e-email.md), "Links com token"): a API só enfileira o e-mail com o propósito. Assim o token nunca passa por `jobs.payload` nem por `email_outbox`.
- Cada token novo de um propósito invalida os anteriores não usados do mesmo usuário e propósito: vale o último link enviado.
- Link de redefinição: `<classroomUrl>/redefinir?token=<token>`. O site admin não tem redefinição própria: o "esqueci a senha" do admin leva a `<classroomUrl>/redefinir`.

### Exibição da senha (RF-09)

- Rota: `POST /api/v1/users/{id}/password/reveal` na `admin-api`. Apenas `admin`; `manager` e `instructor` recebem `403`. Não existe ferramenta MCP equivalente ([027](027-mcp.md)).
- Exige confirmar a senha do próprio admin no corpo (`adminPassword`). Errada: `422` `password_confirmation_invalid`, e a tentativa conta no bloqueio da conta do admin.
- Resposta `200` com `{ "password": "<texto>" }` ou `{ "password": null }` (sem senha definida); cabeçalho `Cache-Control: no-store`.
- Grava `user.password_view` em `audit_log`: admin, usuário alvo, data, IP. O valor da senha não é gravado.
- Na interface: botão "mostrar senha" na ficha do usuário; o valor some ao sair da tela.
- O admin também pode definir uma nova senha para o usuário (`PUT /users/{id}/password`; auditado; todas as sessões do usuário encerradas; usuário avisado por e-mail).

### Bloqueio e dispositivo novo

- 5 falhas em 15 minutos para o mesmo e-mail: novas tentativas recusadas por 15 minutos, mesmo com a senha certa (`429` `too_many_attempts`, `Retry-After` com os segundos até a falha mais antiga da janela sair dela). Login social não é afetado.
- 5 falhas em 15 minutos do mesmo IP (qualquer e-mail): mesmo bloqueio para o IP.
- Falha = senha errada, conta sem senha ou e-mail inexistente, e as confirmações de senha erradas (`current_password_invalid`, `password_confirmation_invalid`). Tentativa recusada por já estar bloqueada não conta de novo.
- No primeiro bloqueio de cada janela, o dono da conta recebe `account.locked` e a auditoria recebe `auth.lockout`. Redefinir a senha libera a conta: as falhas daquele e-mail anteriores à redefinição deixam de contar.
- Dispositivo = família do navegador e sistema, lidos do `User-Agent` (ex.: `Chrome|macOS`). Login por qualquer método num dispositivo sem registro em `user_devices` da conta envia `account.new_login` (data, IP, navegador e sistema) e registra o dispositivo; dispositivo conhecido só atualiza `last_seen_at`. O primeiro login de uma conta não envia aviso.

### Sessões

- Cookie com identificador aleatório de 256 bits; o banco guarda só o SHA-256 dele (`sessions.id_hash`). Cada sessão tem também um `id` (UUID) público, usado nas listas e para encerrá-la.
- `sessions` guarda usuário, site (`classroom` ou `admin`), IP, navegador, token CSRF, criada em, usada em, expira em. `last_used_at` e `expires_at` (`last_used_at` + 30 dias) são atualizados no máximo uma vez por minuto.
- Encerram sessões: sair, mudança de senha (as outras), suspensão `full` (todas), mudança de papel (todas do site admin), exclusão de conta (todas).
- Token CSRF por sessão (32 bytes aleatórios em base64url), devolvido em `GET /api/v1/session`.
- Validação a cada requisição: sessão existe, não venceu, é do site da API e o usuário não está excluído nem com suspensão `full`. Caso contrário, `401` `unauthenticated` e o cookie é apagado.
- O usuário lista as próprias sessões dos dois sites (`GET /account/sessions`), encerra uma (`DELETE /account/sessions/{id}`) ou todas as outras (`DELETE /account/sessions`).

### Cookies

| Cookie | Valor | Atributos | Validade |
| --- | --- | --- | --- |
| `nuva_classroom_session`, `nuva_admin_session` | Identificador da sessão | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, sem `Domain` (só o host do site) | `Max-Age` de 30 dias, renovado junto com `expires_at` |
| `nuva_classroom_oauth`, `nuva_admin_oauth` | JSON com `state`, `nonce`, verificador PKCE, provedor, `intent`, `returnTo` e, no cadastro pendente, os dados do provedor; assinado com HMAC-SHA256 por `SESSION_SECRET` | `HttpOnly`, `Secure`, `SameSite=None` (o retorno da Apple é um `POST` vindo de outro site), `Path=/api/v1/auth` | 10 minutos; 30 minutos no cadastro pendente |

- `SESSION_SECRET` assina só o cookie de retorno; a sessão não é assinada (vale o identificador aleatório conferido no banco). Mínimo de 32 caracteres ([031](031-infraestrutura-e-deploy.md)).
- No desenvolvimento em `http://*.localhost`, os navegadores aceitam cookie `Secure` (endereço local é contexto seguro).
- São os únicos cookies do sistema, ambos estritamente necessários ([030](030-lgpd.md), RF-09).

### CSRF nas rotas públicas de autenticação

As escritas sem sessão (`/auth/register`, `/auth/login`, `/auth/email/verify`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/social/complete`) e os retornos OAuth não declaram `csrfToken`, porque ainda não há token. A proteção dessas rotas: o corpo só é aceito em `application/json` (outro tipo: `415`; um formulário de outro site não consegue enviar JSON sem CORS, que as APIs não habilitam), o cookie de sessão é `SameSite=Lax` e o retorno OAuth exige o `state`. Cada uma diz o motivo da exceção na descrição, como pede [003](003-admin-api.md), "CSRF no contrato".

### Termos no cadastro e aceite pendente

- `acceptedTerms` é a lista de `id` das versões vigentes (`terms` e `privacy`) que o usuário aceitou. Com versão publicada de um documento, a vigente dele precisa estar na lista; faltando, ou com `id` que não é o vigente: `422` `terms_acceptance_required`, com `errors[]` indicando o documento.
- Na sessão do classroom, `termsPending` lista as versões vigentes que o usuário ainda não aceitou: quem se cadastrou antes da primeira publicação, ou versão nova com `requires_reacceptance` ([030](030-lgpd.md)). Com a lista não vazia, as escritas do classroom respondem `403` `terms_acceptance_pending`, exceto `POST /me/terms-acceptance`, `POST /auth/logout` e as de `/account/sessions`. O site mostra a tela de aceite.
- No site admin não há bloqueio por termos.

### Avatar

- O usuário envia a imagem com `purpose = avatar` (`POST /api/v1/images`, [029](029-imagens.md)) e a associa com `PUT /api/v1/me/profile/avatar` (`{ "imageId": "<uuid>" }`; `null` remove). Imagem de outro usuário ou inexistente: `404`; de outra finalidade: `422` `image_purpose_mismatch`.
- O avatar fica em `profiles.avatar_image_id` ([019](019-perfil-e-diretorio.md)). Nesta fase `profiles` nasce só com `user_id` e `avatar_image_id`; as demais colunas do perfil entram na Fase 6. A linha é criada junto com a conta.
- `avatarUrl` (variante de 256 px, ou nulo) aparece na sessão e na ficha do usuário no admin. Sem avatar, os sites mostram as iniciais do nome.

### Admin inicial

- Na subida da `admin-api`: se não existir nenhum usuário com papel `admin` (excluído não conta) e `ADMIN_EMAIL` e `ADMIN_PASSWORD` estiverem definidos, cria o admin com e-mail confirmado, nome igual à parte local do e-mail e registro `user.create` na auditoria (`origin = cli`, sem ator). Se já existir conta com o e-mail, ela é promovida a `admin` e recebe a senha. Se já existir admin, as variáveis são ignoradas.
- `ADMIN_PASSWORD` fora de 8 a 128 caracteres impede a subida, com a variável citada no log.
- As variáveis não têm valor padrão. No Compose, `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `SESSION_SECRET` são exigidas (`${VAR:?}`) a partir desta fase, junto com o código que as usa ([031](031-infraestrutura-e-deploy.md), "Segredos exigidos"): instalação nova não sobe sem admin inicial definido. Fora do Compose (desenvolvimento e testes), sem `ADMIN_EMAIL` e `ADMIN_PASSWORD` e sem admin, a API sobe e registra aviso no log a cada inicialização.
- Emergência: o comando `create-admin` da imagem da `admin-api` ([003](003-admin-api.md), "Interfaces e contratos"), executado com `docker compose exec -it admin-api node src/create-admin.ts --email <e-mail>`, cria ou promove a conta, pede a senha no terminal duas vezes, sem eco (não aceita senha por argumento nem por variável), confirma o e-mail, encerra as sessões da conta e registra na auditoria com `origin = cli`.
- Sempre precisa existir ao menos um `admin` ativo (sem suspensão e não excluído): rebaixar, suspender ou excluir o último é recusado (`422` `last_admin`).

### Equipe criada pelo admin

- `POST /users` (só `admin`) com nome, e-mail, papel e senha (8 a 128). A conta nasce com o e-mail não confirmado e recebe `account.verify_email`; o admin informa a senha à pessoa por fora do sistema. E-mail já cadastrado: `409` `email_taken` (para promover uma conta existente, muda-se o papel).
- Editar dados (`PATCH /users/{id}`): nome, nome completo e e-mail. Trocar o e-mail anula `email_verified_at` e envia `account.verify_email` ao novo endereço. Aluno: `manager` e `admin`; equipe: só `admin` ([008](008-papeis-e-permissoes.md)).

### Casos de erro

| Caso | Resposta |
| --- | --- |
| Senha fora de 8 a 128 caracteres | `400` `password_invalid` |
| E-mail ou senha incorretos, conta sem senha | `401` `invalid_credentials` |
| Conta com suspensão `full` | `403` `account_suspended` |
| Login certo de `student` no admin | `403` `staff_only` |
| Escrita no classroom com termos pendentes | `403` `terms_acceptance_pending` |
| E-mail não confirmado ao comprar, publicar ou enviar mensagem | `403` `email_not_verified` |
| Link expirado, já usado ou desconhecido | `410` `token_expired` |
| Cadastro sem o aceite dos termos vigentes | `422` `terms_acceptance_required` |
| Senha atual errada ao trocar | `422` `current_password_invalid` |
| Senha do admin errada ao exibir senha | `422` `password_confirmation_invalid` |
| E-mail já cadastrado (equipe criada pelo admin, edição, cadastro social com e-mail digitado) | `409` `email_taken` |
| Identidade do provedor já vinculada a outra conta | `409` `identity_in_use` (no retorno OAuth, código na URL) |
| Vínculo de um provedor que a conta já tem (outra identidade do mesmo provedor) | `409` `provider_already_linked` (no retorno OAuth, código na URL) |
| Remover último método de acesso | `422` `last_login_method` |
| Conta ou IP bloqueado | `429` `too_many_attempts` com `Retry-After` |
| Retorno OAuth com `state` inválido | `302` para o site com `oauth_state_invalid` ([Fluxo do provedor](#fluxo-do-provedor)) |
| SMTP fora do ar | Cadastro e redefinição respondem normalmente; o e-mail fica na fila ([005](005-worker-e-fila.md)) |

### Provedor simulado

Os três provedores reais dependem de aplicativos registrados no Google, no Facebook e na Apple (credencial externa, escalonada ao humano). Para que o código e os testes não esperem por elas ([0024](decisions/0024-provedor-oauth-simulado.md)):

- Cada provedor é uma implementação de uma interface única de `packages/core` (endereço de autorização, troca do código, leitura da identidade), com os endereços do provedor como configuração. O código de produção é o mesmo nos testes; só os endereços e as credenciais mudam.
- `NUVA_OAUTH_MOCK_URL` (endereço público, visto pelo navegador) e `NUVA_OAUTH_MOCK_INTERNAL_URL` (endereço na rede interna, usado pela API para trocar o código; padrão igual ao público) ligam o provedor simulado: os três provedores passam a apontar para ele, com credenciais fixas de teste, e aparecem em `authProviders`. Com `NUVA_ENV=production` a variável impede a subida, com a variável citada no log. Com ela definida, as credenciais reais são ignoradas.
- O simulador é um serviço do Compose no perfil `oauth-mock` ([031](031-infraestrutura-e-deploy.md)), em `scripts/oauth-mock/`. Imita o necessário de cada provedor: autorização com tela própria, onde quem testa escolhe identificador, e-mail, se o e-mail é verificado e nome (ou recusa); troca do código com PKCE; `id_token` assinado e JWKS para Google e Apple; `form_post` para Apple; `/me` no formato do Graph para Facebook.
- Os testes de unidade e de integração de `packages/core` e das APIs usam um provedor falso em memória, sem rede.

## Interfaces e contratos

Rotas em `/api/v1`. "Público" = sem sessão (`security: []`). Corpos e respostas em JSON, exceto onde indicado.

### `apps/classroom-api/openapi.yaml`

| Operação | Acesso | Corpo | Sucesso | Erros próprios |
| --- | --- | --- | --- | --- |
| `POST /auth/register` | Público | `name` (1 a 80), `email`, `password`, `acceptedTerms` (uuid[]) | `204` | `password_invalid`, `terms_acceptance_required` |
| `POST /auth/login` | Público | `email`, `password` | `200` `Session` + cookie | `invalid_credentials`, `account_suspended`, `too_many_attempts` |
| `POST /auth/logout` | Sessão | — | `204`, cookie apagado | |
| `GET /session` | Sessão | — | `200` `Session` | |
| `POST /auth/email/verify` | Público | `token` | `204` | `token_expired` |
| `POST /auth/email/resend` | Sessão | — | `204` | `rate_limited` |
| `POST /auth/password/forgot` | Público | `email` | `204` | |
| `POST /auth/password/reset` | Público | `token`, `password` | `204` | `password_invalid`, `token_expired` |
| `GET /auth/{provider}/start` | Público (`intent=link`: sessão) | consulta: `intent`, `returnTo` | `302` | `404` provedor desligado |
| `GET /auth/{provider}/callback` | Público | consulta: `code`, `state`, `error` | `302` | |
| `POST /auth/{provider}/callback` | Público | formulário: `code`, `state`, `id_token`, `user`, `error` (só `apple`) | `302` | |
| `GET /auth/social/pending` | Público | — | `200` `SocialPending` | `404` |
| `POST /auth/social/complete` | Público | `acceptedTerms`, `email` (opcional) | `200` `Session` + cookie | `terms_acceptance_required`, `email_taken`, `404` |
| `PUT /account/password` | Sessão | `newPassword`, `currentPassword` (opcional) | `204` | `password_invalid`, `current_password_invalid`, `too_many_attempts` |
| `GET /account/identities` | Sessão | — | `200` `{ hasPassword, items: Identity[] }` | |
| `DELETE /account/identities/{provider}` | Sessão | — | `204` | `last_login_method` |
| `GET /account/sessions` | Sessão | — | `200` `{ items: SessionInfo[] }` | |
| `DELETE /account/sessions` | Sessão | — | `204` (encerra as outras) | |
| `DELETE /account/sessions/{id}` | Sessão | — | `204` | |
| `PUT /me/profile/avatar` | Sessão | `imageId` (uuid ou nulo) | `200` `{ avatarUrl }` | `image_purpose_mismatch` |

`provider` é `google`, `facebook` ou `apple`. `GET /session` sem sessão válida: `401` `unauthenticated`. As rotas de termos e de imagens estão em [030](030-lgpd.md) e [029](029-imagens.md).

### `apps/admin-api/openapi.yaml`

| Operação | Acesso | Corpo | Sucesso | Erros próprios |
| --- | --- | --- | --- | --- |
| `POST /auth/login` | Público | `email`, `password` | `200` `Session` + cookie | `invalid_credentials`, `account_suspended`, `staff_only`, `too_many_attempts` |
| `POST /auth/logout` | Sessão | — | `204` | |
| `GET /session` | Sessão (qualquer papel de equipe) | — | `200` `Session` | |
| `GET /auth/{provider}/start` | Público | consulta: `returnTo` | `302` | `404` provedor desligado |
| `GET`/`POST /auth/{provider}/callback` | Público | como no classroom | `302` | |
| `GET /users` | `users.list` | consulta: `q` (nome ou e-mail), `role`, `status` (`active`, `suspended`, `unverified`), `sort` (`name`, `-createdAt`, `-lastLoginAt`; padrão `-createdAt`), `limit`, `cursor` | `200` página de `UserSummary` | |
| `POST /users` | `staff.manage` | `name`, `email`, `role`, `password` | `201` `UserDetail` | `email_taken`, `password_invalid` |
| `GET /users/{id}` | `users.view` | — | `200` `UserDetail` | |
| `PATCH /users/{id}` | `users.edit` (aluno) ou `staff.manage` (equipe) | `name`, `fullName`, `email`, `version` | `200` `UserDetail` | `email_taken`, `version_conflict` |
| `PATCH /users/{id}/role` | `staff.manage` | `role` | `200` `UserDetail` | `last_admin`, `self_action_not_allowed` |
| `POST /users/{id}/suspend` | `users.suspend` (aluno) ou `staff.manage` (equipe) | `kind`, `reason` (1 a 500), `durationDays` (1, 7, 30 ou nulo) | `200` `UserDetail` | `already_suspended`, `last_admin`, `self_action_not_allowed` |
| `POST /users/{id}/reactivate` | idem | — | `200` `UserDetail` | `not_suspended` |
| `POST /users/{id}/password/reveal` | `users.password.view` | `adminPassword` | `200` `{ password }`, `no-store` | `password_confirmation_invalid`, `too_many_attempts` |
| `PUT /users/{id}/password` | `users.password.set` | `password` | `204` | `password_invalid` |
| `GET /users/{id}/sessions` | `users.sessions.revoke` | — | `200` `{ items: SessionInfo[] }` | |
| `DELETE /users/{id}/sessions` | `users.sessions.revoke` | — | `204` | |

A auditoria e os termos do admin estão em [028](028-auditoria.md) e [030](030-lgpd.md); a entrega de imagens, em [029](029-imagens.md).

### Esquemas comuns

| Esquema | Campos |
| --- | --- |
| `Session` | `user` (`id`, `name`, `email`, `emailVerified`, `role`, `avatarUrl`, `hasPassword`), `csrfToken`, `permissions` (ações de [008](008-papeis-e-permissoes.md) que o papel permite), `expiresAt`; no classroom, também `termsPending` (`TermsVersion[]`) |
| `SessionInfo` | `id`, `site`, `ip`, `browser`, `os`, `createdAt`, `lastUsedAt`, `current` |
| `Identity` | `provider`, `email`, `createdAt` |
| `SocialPending` | `provider`, `email` (ou nulo), `emailVerified`, `name` (ou nulo), `terms` (`TermsVersion[]` vigentes) |
| `UserSummary` | `id`, `name`, `email`, `emailVerified`, `role`, `avatarUrl`, `status` (`active`, `suspended`), `createdAt`, `lastLoginAt` |
| `UserDetail` | `UserSummary` mais `fullName`, `hasPassword`, `identities` (`Identity[]`), `suspension` (`kind`, `reason`, `startsAt`, `endsAt`, `createdBy` com `id` e `name`, ou nulo), `version` |

Nenhum esquema tem campo de senha, exceto a resposta da exibição.

### Variáveis e comandos

- Variáveis: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `NUVA_OAUTH_MOCK_URL`, `NUVA_OAUTH_MOCK_INTERNAL_URL`, `TRUSTED_PROXIES` ([031](031-infraestrutura-e-deploy.md)).
- Endereços de retorno a registrar em cada aplicativo de provedor: `<classroomUrl>/api/v1/auth/<provider>/callback` e `<adminUrl>/api/v1/auth/<provider>/callback`.
- Regras de autenticação implementadas uma única vez em `packages/core` (módulos `accounts` e `oauth`) e usadas pelas duas APIs.

## Dados

| Tabela | Campos principais | Dono |
| --- | --- | --- |
| `users` | `id`, `email` (único entre os não excluídos, minúsculas), `email_verified_at`, `name` (nome de exibição), `full_name` (nome completo, usado em pedidos e certificados), `password` (texto, nulo), `role`, `suspended_at`, `suspended_kind` (`posting` \| `full`, nulo), `suspended_reason`, `suspended_by`, `tax_id_type` (`cpf` \| `cnpj`, nulo), `tax_id`, `last_login_at`, `deletion_requested_at`, `deleted_at`, `version`, `created_at`, `updated_at` | `classroom-api` (cadastro e dados próprios); `admin-api` (papel, suspensão, senha definida pelo admin, equipe criada) |
| `profiles` | `user_id` (chave), `avatar_image_id` (nesta fase; o resto em [019](019-perfil-e-diretorio.md)) | `classroom-api` |
| `oauth_identities` | `user_id`, `provider`, `provider_user_id` (único por provedor), `email`, uma por provedor em cada conta (`user_id`, `provider` único), `email_verified`, `created_at` | `classroom-api`; `admin-api` só no vínculo por e-mail do login |
| `sessions` | `id`, `id_hash` (único), `user_id`, `site`, `ip`, `user_agent`, `csrf_token`, `created_at`, `last_used_at`, `expires_at` | API do respectivo site; `admin-api` encerra sessões dos dois sites (suspensão, papel, senha) |
| `email_tokens` | `token_hash` (único), `user_id`, `purpose` (`verify` \| `reset`), `expires_at`, `used_at`, `created_at` | `worker` (criação); `classroom-api` (uso) |
| `login_attempts` | `email`, `ip`, `success`, `site`, `created_at` | API do respectivo site |
| `user_devices` | `user_id`, `device_key` (único por usuário), `first_seen_at`, `last_seen_at` | API do respectivo site |

Restrições no banco: `CHECK (password IS NULL OR length(password) BETWEEN 8 AND 128)`; `role` nos quatro valores; `suspended_kind` amarrado a `suspended_at`; índice único de `email` parcial (`WHERE deleted_at IS NULL`).

Decisões de esquema da migration 0005 (aceitas na tarefa 198):

- A linha de `users` nunca é apagada: a exclusão anonimiza ([030](030-lgpd.md)). As tabelas que só existem por causa da conta (`profiles`, `oauth_identities`, `sessions`, `email_tokens`, `user_devices`) têm `ON DELETE CASCADE`; as que registram ação de terceiros (`user_suspensions`, `users.suspended_by`, `images.owner_user_id`) não deixam apagar o usuário. A cascata não substitui a anonimização, que apaga essas linhas explicitamente.
- `email` e `name` são `NOT NULL` (com `email` normalizado e `name` não vazio). A anonimização os substitui, não os anula ([030](030-lgpd.md), "O que acontece com cada dado").
- `version` começa em 1 e é incrementada pelo código (`UPDATE ... SET version = version + 1 WHERE id = $1 AND version = $n`; nenhuma linha atualizada: `409`); não há gatilho.
- `tax_id` não tem formato no banco (o CNPJ alfanumérico convive com o numérico); a validação é do código, e o banco só o amarra a `tax_id_type`.
- `sessions.id_hash` e `email_tokens.token_hash` são o SHA-256 em hexadecimal minúsculo (64 caracteres), conferido por `CHECK`.
- `oauth_identities`: `(provider, provider_user_id)` único (`identity_in_use`) e `(user_id, provider)` único (`provider_already_linked`).

Retenção: sessões 30 dias sem uso; `email_tokens` 24 h; `login_attempts` 30 dias; `user_devices` 1 ano sem uso ([033](033-observabilidade-retencao-backup.md)).

## Critérios de aceite

- [ ] Conta criada pelo Google, sem senha, é recusada no login por senha com senha vazia, com espaços e com qualquer texto.
- [ ] Mesma conta entra por senha e por Google depois de vincular; remover o último método é recusado.
- [ ] Vincular uma segunda conta Google à mesma conta é recusado com `provider_already_linked`, também pelo banco.
- [ ] Login social com e-mail verificado igual ao de conta existente entra na mesma conta; se a conta local não tinha e-mail confirmado, a senha anterior deixa de funcionar.
- [ ] Cadastro com e-mail já existente responde igual ao cadastro novo e envia `account.exists` ao dono, sem alterar a conta.
- [ ] Usuário com e-mail não confirmado não consegue comprar nem publicar (verificado nas fases que trazem essas rotas).
- [ ] 5 senhas erradas bloqueiam a conta por 15 minutos e geram e-mail de aviso; redefinir a senha libera.
- [ ] `manager` recebe `403` em `/users/{id}/password/reveal`; `admin` vê a senha e a visualização aparece na auditoria sem o valor.
- [ ] Varredura automática de logs, `audit_log`, `jobs.payload`, `email_outbox`, exportações e respostas de API (exceto a rota de exibição) não encontra a senha de teste.
- [ ] Redefinir a senha encerra as outras sessões.
- [ ] Primeira subida com `ADMIN_EMAIL` e `ADMIN_PASSWORD` cria o admin; segunda subida com valores diferentes não altera nada.
- [ ] Rebaixar o último admin é recusado.
- [ ] Retorno OAuth com `state` alterado leva a `/entrar?erro=oauth_state_invalid` sem abrir sessão.
- [ ] Os três provedores passam pelo fluxo completo contra o provedor simulado, nos dois sites, sem nenhuma credencial real.
- [ ] Definition of Done ([002](002-organizacao-do-trabalho.md)) atendida.

## Fora de escopo

- Verificação em duas etapas (decisão do usuário; risco registrado em [0011](decisions/0011-autenticacao-sessao-e-vinculo-social.md)).
- Login por link mágico, passkeys e SSO corporativo.
- Hash, cifra ou qualquer transformação da senha ([0002](decisions/0002-senha-em-texto-legivel.md)).
- Captcha.
- Troca do próprio e-mail pelo usuário (nesta versão, só a equipe altera o e-mail de uma conta).

## Decisões relacionadas

- [0002 — Senha em texto legível](decisions/0002-senha-em-texto-legivel.md)
- [0011 — Autenticação, sessão e vínculo social](decisions/0011-autenticacao-sessao-e-vinculo-social.md)
- [0024 — Provedor OAuth simulado](decisions/0024-provedor-oauth-simulado.md)
- [0004 — Duas APIs, um banco](decisions/0004-duas-apis-um-banco.md)
