# oauth-mock — provedor OAuth simulado

Imita o necessário do Google, do Facebook e da Apple para o login social rodar de ponta a ponta sem credencial real ([ADR 0024](../../specs/decisions/0024-provedor-oauth-simulado.md); [spec 007](../../specs/007-contas-e-autenticacao.md), "Provedor simulado"; [spec 031](../../specs/031-infraestrutura-e-deploy.md), serviço `oauth-mock`). Só para desenvolvimento e e2e: na tela de autorização qualquer um escolhe a identidade. As APIs recusam `NUVA_OAUTH_MOCK_URL` com `NUVA_ENV=production`.

`server.mjs` usa só módulos do Node. As chaves RSA que assinam os `id_token` são geradas a cada subida e publicadas na JWKS de cada provedor; códigos e tokens ficam na memória (reiniciar invalida tudo).

## Como rodar

- Compose: serviço `oauth-mock` no perfil `oauth-mock` (`docker-compose.yml` desta pasta; a inclusão no compose da raiz e no `dev:up` é da tarefa 157). Roda no `node:26-slim` com o `server.mjs` montado só para leitura, porta interna 8080, sem porta publicada: o navegador chega por `oauth-mock.<NUVA_DOMAIN>` no Traefik, e as APIs por `http://oauth-mock:8080` na rede interna.
- Avulso: `PORT=8089 node scripts/oauth-mock/server.mjs`.

| Variável | Padrão | Uso |
| --- | --- | --- |
| `PORT` | `8080` | Porta HTTP (fora do Compose) |
| `OAUTH_MOCK_PUBLIC_URL` | `http://localhost:<PORT>`; no Compose, `NUVA_OAUTH_MOCK_URL` ou `http://oauth-mock.<NUVA_DOMAIN>:<TRAEFIK_HTTP_PORT>` | Base dos endereços publicados e emissor (`iss`) dos `id_token`. Tem de ser o endereço visto pelo navegador, o mesmo de `NUVA_OAUTH_MOCK_URL` |
| `NUVA_OAUTH_MOCK_CPUS`, `NUVA_OAUTH_MOCK_MEMORY` | `1`, `64m` | Limites do contêiner |

## Credenciais fixas de teste

Exportadas em `TEST_CLIENTS` (`server.mjs`). O core usa as mesmas quando `NUVA_OAUTH_MOCK_URL` está definida (tarefa 141). Não são segredo: só valem aqui.

| Provedor | Valores |
| --- | --- |
| Google | `client_id` `nuva-edu-mock.apps.googleusercontent.com`, `client_secret` `nuva-edu-mock-google-secret` |
| Facebook | `client_id` (app id) `1000000000000001`, `client_secret` `nuva-edu-mock-facebook-secret` |
| Apple | `client_id` (Services ID) `br.com.tmsoft.nuva-edu.mock`, equipe `NUVAEDUTM1`, chave `NUVAEDUKY1` |

Apple: o `client_secret` é, como no real, um JWT ES256 com `kid` = chave, `iss` = equipe, `sub` = `client_id`, `aud` = emissor do simulador (`<BASE>/apple`, ou `https://appleid.apple.com`), `iat` e `exp` (no máximo 6 meses). O simulador confere cabeçalho e declarações, **não** a assinatura: o core pode assinar com uma chave P-256 qualquer, gerada na subida.

## Endereços

`BASE` = `OAUTH_MOCK_PUBLIC_URL`. `GET BASE/` lista tudo; `GET BASE/healthz` é a sonda.

| | Google | Facebook | Apple |
| --- | --- | --- | --- |
| Emissor (`iss`) | `BASE/google` | — | `BASE/apple` |
| Descoberta | `BASE/google/.well-known/openid-configuration` | — | `BASE/apple/.well-known/openid-configuration` |
| Autorização | `GET BASE/google/o/oauth2/v2/auth` | `GET BASE/facebook/v27.0/dialog/oauth` | `GET BASE/apple/auth/authorize` |
| Troca do código | `POST BASE/google/token` | `GET BASE/facebook/v27.0/oauth/access_token` | `POST BASE/apple/auth/token` |
| JWKS | `BASE/google/oauth2/v3/certs` | — | `BASE/apple/auth/keys` |
| Identidade | `id_token`; `BASE/google/v1/userinfo` | `GET BASE/facebook/v27.0/me?fields=id,name,email` | `id_token` e campo `user` do retorno |

O Facebook aceita qualquer versão `vNN.N` no caminho. A troca do código usa `application/x-www-form-urlencoded` (Google aceita também `client_secret_basic`); o Facebook, parâmetros na consulta, como no Graph.

## Comportamento

- **PKCE S256 obrigatório**: sem `code_challenge` de 43 caracteres e `code_challenge_method=S256` a autorização volta com `error=invalid_request`; a troca confere o `code_verifier`. O código vale 10 minutos, uma vez só, e só com o mesmo `client_id` e o mesmo `redirect_uri` da autorização. Qualquer `redirect_uri` `http(s)` é aceito (não há cadastro de endereços).
- **Cliente ou `redirect_uri` inválidos** param na tela de erro do provedor (`400`), sem voltar ao site, como nos reais. Google exige o escopo `openid`. Apple exige `response_mode=form_post` quando o escopo pede `name` ou `email`.
- **Tela de autorização**: campos com rótulo "Identificador", "E-mail", "E-mail verificado", "Nome"; na Apple, "Ocultar e-mail (retransmissão da Apple)" e "Primeira autorização (envia o campo user)"; "Simular falha"; botões "Autorizar" e "Recusar".
- **`id_token`** (RS256, `kid` da JWKS): `iss`, `aud` (= `client_id`), `sub`, `iat`, `exp` (1 h), `auth_time`, `nonce` (quando enviado).
  - Google: `azp`, `at_hash`, `email` e `email_verified` (booleano) com o escopo `email`, `name`, `given_name` e `family_name` com o escopo `profile`.
  - Apple: `email`, `email_verified` e `is_private_email` **como texto** (`"true"`/`"false"`, a forma documentada pela Apple; o core aceita as duas), `nonce_supported`, `real_user_status`; `at_hash` no da troca, `c_hash` no do `form_post` (com `response_type=code id_token`). Nunca traz o nome.
- **Apple `form_post`**: o retorno é uma página que envia `POST` ao `redirect_uri` com `code`, `state`, `id_token` (se pedido) e, só com "Primeira autorização" marcada, `user` = `{"name":{"firstName","lastName"},"email"}`.
- **E-mail oculto da Apple**: endereço `<10 letras>@privaterelay.appleid.com`, estável por usuário, com `email_verified` e `is_private_email` `"true"`.
- **E-mail não verificado**: Google e Apple mandam `email_verified` falso; o Facebook simplesmente não devolve `email` no `/me` (o Graph só o entrega quando há e-mail confirmado). E-mail vazio: o campo some.
- **Recusa**: Google `?error=access_denied&state=…`; Facebook `?error=access_denied&error_code=200&error_description=Permissions+error&error_reason=user_denied&state=…`; Apple, por `form_post`, `error=user_cancelled_authorize` e `state` (o valor real da Apple, não `access_denied`).
- **Simular falha**: "Devolver o state alterado" (o site deve responder `oauth_state_invalid`), "Falhar a troca do código" (Google `500`, Apple `503`, Facebook `500` no formato do Graph: `oauth_provider_error`), "id_token com assinatura inválida" e "id_token com nonce diferente" (Google e Apple).
- **Erros na troca**: Google `invalid_client` (401), `invalid_grant`, `redirect_uri_mismatch`; Apple `invalid_client`, `invalid_grant`; Facebook `{"error":{"message","type":"OAuthException","code","error_subcode","fbtrace_id"}}`, com `code` 190 para token inválido no `/me`.
- **Log**: uma linha JSON por requisição, só método e caminho (a consulta leva código, `state` e tokens). A sonda `/healthz` não entra.

## Testes

`node --test scripts/oauth-mock/` (entram no `pnpm test:scripts`): `server.test.mjs` percorre o fluxo dos três provedores com um cliente de teste, inclusive recusa, e-mail não verificado, e-mail oculto e as falhas simuladas; `compose.test.mjs` confere o serviço contra o padrão de contêiner da 031 pelo `docker compose config` (pulado sem Docker).
