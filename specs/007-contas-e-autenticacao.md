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
- RNF-01: Senha com 8 a 128 caracteres; sem outras regras de composição.
- RNF-02: 5 erros de senha em 15 minutos bloqueiam por 15 minutos (por conta e por IP, contados separadamente).
- RNF-03: Sessão expira com 30 dias sem uso (`NUVA_RETENTION_SESSION_DAYS`); links de confirmação e redefinição valem 24 h e uso único.
- RNF-04: Comparação de senha e de tokens em tempo constante; resposta de login leva o mesmo tempo para conta existente e inexistente (variação inferior a 50 ms no p95).
- RNF-05: A senha não aparece em logs, erros, `audit_log`, `jobs.payload`, exportações (CSV e LGPD), respostas do MCP nem em qualquer resposta de API além da rota de RF-09.

## Comportamento

### Cadastro por e-mail e senha

1. Informa nome, e-mail, senha e aceita os termos.
2. E-mail é normalizado (minúsculas, sem espaços). Se já existir conta com o e-mail, a resposta é a mesma de sucesso e o dono do e-mail recebe um aviso "já existe conta, entre ou redefina a senha" (não revela cadastro a terceiros).
3. Conta criada com `email_verified_at` nulo e papel `student`; sessão aberta; e-mail de confirmação enviado.
4. Sem e-mail confirmado o usuário navega e assiste a conteúdo aberto, mas não compra, não publica e não envia mensagem.

### Login por senha

- Recusado se a conta não tem senha (`password IS NULL`), se a senha enviada é vazia ou se não confere.
- Mensagem única para qualquer falha: "e-mail ou senha incorretos". Conta só com provedor recebe a mesma mensagem.
- Conta com suspensão `full`: `403` com `account_suspended`. Suspensão `posting` não impede o login ([008](008-papeis-e-permissoes.md), [026](026-moderacao-e-denuncias.md)).
- Cada tentativa grava em `login_attempts` (e-mail, IP, sucesso, data).

### Login social e vínculo

| Situação | Resultado |
| --- | --- |
| Identidade do provedor já vinculada | Entra na conta. |
| Não vinculada, provedor atesta e-mail verificado, existe conta com esse e-mail | Vincula e entra. Se a conta local não tinha e-mail confirmado, passa a ter, e a senha definida antes da confirmação é apagada (`password = NULL`), para impedir que alguém que "reservou" o e-mail mantenha acesso. |
| Não vinculada, e-mail verificado, sem conta | Cria conta `student` com e-mail confirmado, sem senha; pede aceite dos termos antes de concluir. |
| Provedor não atesta e-mail verificado ou não envia e-mail | Cria conta sem vínculo por e-mail; pede e-mail e confirmação por link antes de comprar ou publicar. |
| Apple com e-mail oculto (`privaterelay`) | Conta própria com o e-mail de retransmissão; pode ser unida a outra só pelo vínculo manual no perfil. |

- E-mail "verificado": Google `email_verified = true`; Apple `email_verified = true`; Facebook só quando a API devolve e-mail (tratado como verificado).
- Vínculo manual: em Configurações > Acesso, o usuário logado adiciona ou remove provedores. Não é permitido remover o último método de acesso (precisa restar senha ou um provedor).
- Provedor fora do ar: o botão mostra erro e os demais métodos seguem funcionando.
- No site admin, os mesmos métodos estão disponíveis; quem não é da equipe recebe "sem acesso ao painel".

### Definir, trocar e redefinir senha

- Definir (conta sem senha): exige sessão ativa; envia e-mail de aviso.
- Trocar: exige a senha atual.
- Redefinir: `POST /auth/password/forgot` responde sempre igual; se a conta existir, envia link de 24 h. Usar o link define a nova senha e confirma o e-mail.
- Qualquer mudança de senha encerra as outras sessões do usuário e envia aviso por e-mail.

### Exibição da senha (RF-09)

- Rota: `POST /api/v1/users/{id}/password/reveal` na `admin-api`. Apenas `admin`; `manager` e `instructor` recebem `403`. Não existe ferramenta MCP equivalente ([027](027-mcp.md)).
- Exige confirmar a senha do próprio admin na requisição.
- Resposta com a senha em texto ou a indicação "sem senha definida"; cabeçalho `Cache-Control: no-store`.
- Grava em `audit_log`: admin, usuário alvo, data, IP. O valor da senha não é gravado.
- Na interface: botão "mostrar senha" na ficha do aluno; o valor some ao sair da tela.
- O admin também pode definir uma nova senha para o usuário (auditado; usuário avisado por e-mail).

### Bloqueio por tentativas

- 5 falhas em 15 minutos para o mesmo e-mail: novas tentativas recusadas por 15 minutos, mesmo com a senha certa. Login social não é afetado.
- 5 falhas em 15 minutos do mesmo IP (qualquer e-mail): mesmo bloqueio para o IP.
- O dono da conta recebe e-mail no primeiro bloqueio de cada janela. Redefinir a senha libera a conta.
- Login em dispositivo novo (combinação de navegador e sistema nunca vista para a conta): e-mail de aviso com data, IP e navegador.

### Sessões

- Cookie com identificador aleatório de 256 bits; o banco guarda só o SHA-256 dele.
- Cookies: `nuva_classroom_session` e `nuva_admin_session`, cada um no próprio domínio, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- `sessions` guarda usuário, site (`classroom` ou `admin`), IP, navegador, criada em, usada em, expira em. `last_used_at` é atualizado no máximo uma vez por minuto.
- Encerram sessões: sair, mudança de senha (as outras), suspensão `full` (todas), mudança de papel (todas do site admin), exclusão de conta (todas).
- Token CSRF por sessão, devolvido em `GET /api/v1/session`.

### Admin inicial

- Na subida da `admin-api`: se não existir nenhum usuário com papel `admin` e `ADMIN_EMAIL` e `ADMIN_PASSWORD` estiverem definidos, cria o admin com e-mail confirmado. Se já existir admin, as variáveis são ignoradas.
- As variáveis não têm valor padrão. No Compose, `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `SESSION_SECRET` são exigidas (`${VAR:?}`) a partir desta fase, junto com o código que as usa ([031](031-infraestrutura-e-deploy.md), "Segredos exigidos"): instalação nova não sobe sem admin inicial definido. Fora do Compose (desenvolvimento e testes), sem `ADMIN_EMAIL` e `ADMIN_PASSWORD` e sem admin, a API sobe e registra aviso no log a cada inicialização.
- Emergência: o comando `create-admin` da imagem da `admin-api` ([003](003-admin-api.md), "Interfaces e contratos"), executado com `docker compose exec admin-api`, recebe `--email <e-mail>`, cria ou promove a conta e pede a senha no terminal (não aceita senha por argumento).
- Sempre precisa existir ao menos um `admin` ativo: rebaixar, suspender ou excluir o último é recusado.

### Casos de erro

| Caso | Resposta |
| --- | --- |
| Senha fora de 8 a 128 caracteres | `400` `password_invalid` |
| Link expirado ou já usado | `410` `token_expired` |
| Conta ou IP bloqueado | `429` `too_many_attempts` com `Retry-After` |
| Retorno OAuth com `state` inválido | `400` `oauth_state_invalid` |
| Remover último método de acesso | `422` `last_login_method` |
| SMTP fora do ar | Cadastro e redefinição respondem normalmente; o e-mail fica na fila ([005](005-worker-e-fila.md)) |

## Interfaces e contratos

- `apps/classroom-api/openapi.yaml`: `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/email/verify`, `/auth/email/resend`, `/auth/password/forgot`, `/auth/password/reset`, `/auth/{provider}/start`, `/auth/{provider}/callback`, `/session`, `/account/password`, `/account/identities`, `/account/sessions`.
- `apps/admin-api/openapi.yaml`: `/auth/login`, `/auth/logout`, `/auth/{provider}/start`, `/auth/{provider}/callback`, `/session`, `/users`, `/users/{id}`, `/users/{id}/password/reveal`, `/users/{id}/password`, `/users/{id}/sessions`.
- Variáveis: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `TRUSTED_PROXIES`.
- Regras de autenticação implementadas uma única vez em `packages/core` e usadas pelas duas APIs.

## Dados

| Tabela | Campos principais | Dono |
| --- | --- | --- |
| `users` | `id`, `email` (único, minúsculas), `email_verified_at`, `name` (nome de exibição), `full_name` (nome completo, usado em pedidos e certificados), `password` (texto, nulo), `role`, `suspended_at`, `suspended_kind` (`posting` \| `full`, nulo), `suspended_reason`, `suspended_by`, `tax_id_type` (`cpf` \| `cnpj`, nulo), `tax_id`, `last_login_at`, `deletion_requested_at`, `deleted_at` | `classroom-api` (cadastro e dados próprios); `admin-api` (papel, suspensão, senha definida pelo admin) |
| `oauth_identities` | `user_id`, `provider`, `provider_user_id` (único por provedor), `email`, `email_verified` | `classroom-api` |
| `sessions` | `id_hash`, `user_id`, `site`, `ip`, `user_agent`, `csrf_token`, `created_at`, `last_used_at`, `expires_at` | API do respectivo site |
| `email_tokens` | `token_hash`, `user_id`, `purpose` (`verify` \| `reset`), `expires_at`, `used_at` | `classroom-api` |
| `login_attempts` | `email`, `ip`, `success`, `created_at` | API do respectivo site |

Restrição no banco: `CHECK (password IS NULL OR length(password) BETWEEN 8 AND 128)`.

Retenção: sessões 30 dias sem uso; `email_tokens` 24 h; `login_attempts` 30 dias ([033](033-observabilidade-retencao-backup.md)).

## Critérios de aceite

- [ ] Conta criada pelo Google, sem senha, é recusada no login por senha com senha vazia, com espaços e com qualquer texto.
- [ ] Mesma conta entra por senha e por Google depois de vincular; remover o último método é recusado.
- [ ] Login social com e-mail verificado igual ao de conta existente entra na mesma conta; se a conta local não tinha e-mail confirmado, a senha anterior deixa de funcionar.
- [ ] Usuário com e-mail não confirmado não consegue comprar nem publicar.
- [ ] 5 senhas erradas bloqueiam a conta por 15 minutos e geram e-mail de aviso.
- [ ] `manager` recebe `403` em `/users/{id}/password/reveal`; `admin` vê a senha e a visualização aparece na auditoria sem o valor.
- [ ] Varredura automática de logs, `audit_log`, `jobs.payload`, exportações e respostas de API (exceto a rota de exibição) não encontra a senha de teste.
- [ ] Redefinir a senha encerra as outras sessões.
- [ ] Primeira subida com `ADMIN_EMAIL` e `ADMIN_PASSWORD` cria o admin; segunda subida com valores diferentes não altera nada.
- [ ] Rebaixar o último admin é recusado.
- [ ] Definition of Done ([002](002-organizacao-do-trabalho.md)) atendida.

## Fora de escopo

- Verificação em duas etapas (decisão do usuário; risco registrado em [0011](decisions/0011-autenticacao-sessao-e-vinculo-social.md)).
- Login por link mágico, passkeys e SSO corporativo.
- Hash, cifra ou qualquer transformação da senha ([0002](decisions/0002-senha-em-texto-legivel.md)).
- Captcha.

## Decisões relacionadas

- [0002 — Senha em texto legível](decisions/0002-senha-em-texto-legivel.md)
- [0011 — Autenticação, sessão e vínculo social](decisions/0011-autenticacao-sessao-e-vinculo-social.md)
- [0004 — Duas APIs, um banco](decisions/0004-duas-apis-um-banco.md)
