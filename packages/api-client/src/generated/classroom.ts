// ARQUIVO GERADO. Não edite à mão.
// Origem: apps/classroom-api/openapi.yaml
// Para atualizar: pnpm --filter @nuva-edu/api-client generate

export interface paths {
    "/healthz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Processo vivo
         * @description Responde sem tocar no banco. Usada pelo `healthcheck` do Docker.
         */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/readyz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Pronto para atender
         * @description Confere a conexão com o banco e se as migrations estão na versão esperada. Não é roteada
         *     pelo proxy: serve ao `depends_on` do Compose e ao diagnóstico.
         */
        get: operations["getReadiness"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/meta": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Dados públicos da instalação
         * @description Dados públicos da instalação e da marca da escola: nome, versão, moeda, idioma, provedores
         *     de login social ativos, logotipo, cor de destaque e endereço do código-fonte. Não exige
         *     sessão. É o único endpoint de marca: os dois sites o chamam ao carregar, e as duas APIs
         *     devolvem o mesmo esquema `Meta`. Nome, logotipo, cor e endereço do código-fonte vêm da
         *     configuração da escola (`settings`), com o padrão quando não há nada gravado.
         */
        get: operations["getMeta"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Fluxo de eventos do usuário (SSE)
         * @description Conexão `text/event-stream` que entrega mensagens diretas e notificações sem recarregar a
         *     página. O envio continua por HTTP comum.
         *
         *     Cada evento tem três campos SSE: `id`, `event` (o nome) e `data` (um objeto JSON numa
         *     linha). No fio:
         *
         *     ```
         *     id: 42
         *     event: dm.message.created
         *     data: {"conversationId":"0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70","messageId":"0193a5b2-8e2f-7a11-b0c3-5d7e9f1a2b3c"}
         *
         *     ```
         *
         *     Nomes de evento e o esquema do `data` de cada um estão em `StreamEvent` (`oneOf` com
         *     discriminador em `event`). O evento carrega só identificadores; o conteúdo é buscado pela
         *     rota normal, que checa permissão.
         *
         *     - O `id` vem de uma sequência do banco, uma só para todos os usuários e para todos os
         *       processos que publicam (ADR 0020): para cada usuário ele é crescente, mas não
         *       consecutivo. O cliente só o compara e o devolve em `Last-Event-ID`; lacuna entre dois
         *       `id` não indica evento perdido.
         *     - `ping` é enviado a cada 25 s, com `data: {}` e sem `id` (não altera o `Last-Event-ID`).
         *     - Ao abrir, a API envia o comentário `: ok`, para os cabeçalhos saírem de imediato.
         *     - Reenvio na reconexão: a API guarda em memória, por processo, os eventos de cada usuário
         *       dos últimos 5 minutos, até 500 por usuário (os mais antigos saem primeiro). Com
         *       `Last-Event-ID`, reenvia os guardados de `id` maior, em ordem, antes dos novos.
         *     - O reenvio cobre a queda de rede do navegador; não cobre o reinício da API nem a troca
         *       de processo. Por isso o fluxo é só um atalho: o estado está no banco, e a interface
         *       recarrega as listas afetadas a cada reconexão, com ou sem reenvio.
         *     - Limite de 3 conexões por usuário; a quarta derruba a mais antiga.
         *     - Sessão encerrada, suspensão `full` ou banco indisponível: o servidor fecha a conexão.
         *     - Resposta sem compressão.
         */
        get: operations["openStream"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/register": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cadastro por e-mail e senha
         * @description Cria a conta `student` (`specs/007-contas-e-autenticacao.md`, "Cadastro por e-mail e
         *     senha"). **Não abre sessão**: responde `204` também quando o e-mail já tem conta (o dono
         *     recebe o e-mail `account.exists` e nada muda na conta), para a resposta não revelar se o
         *     e-mail existe. Em seguida o site chama `POST /api/v1/auth/login` com o mesmo e-mail e a
         *     mesma senha.
         *
         *     Validação, nesta ordem: formato dos campos (`400`; senha fora de 8 a 128 caracteres é
         *     `400` com `code: password_invalid`, conferida pela regra e não pelo esquema), aceite dos
         *     termos vigentes quando houver versão publicada (`422` `terms_acceptance_required`, com
         *     `errors[]` indicando o documento). Sem versão publicada, `acceptedTerms` vai vazio.
         *
         *     **Exceção de CSRF.** Não declara `csrfToken`: não há sessão, e portanto não há token. A
         *     proteção é o corpo só em `application/json` (outro tipo: `415`; um formulário de outro
         *     site não envia JSON sem CORS, que a API não habilita).
         */
        post: operations["register"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Login por e-mail e senha
         * @description Abre a sessão do classroom (`specs/007-contas-e-autenticacao.md`, "Login por senha") e
         *     grava o cookie `nuva_classroom_session`.
         *
         *     - Qualquer falha de credencial (senha errada, vazia, só de espaços, conta sem senha,
         *       e-mail inexistente ou conta excluída): `401` `invalid_credentials`, no mesmo tempo.
         *     - Conta com suspensão `full`, só depois de a senha conferir: `403` `account_suspended`.
         *     - Conta ou IP bloqueado por tentativas erradas: `429` `too_many_attempts`, com
         *       `Retry-After`.
         *
         *     **Exceção de CSRF.** Não declara `csrfToken`: ainda não há sessão. A proteção é o corpo só
         *     em `application/json` (outro tipo: `415`) e o cookie de sessão `SameSite=Lax`.
         */
        post: operations["login"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Sair
         * @description Encerra a sessão atual e apaga o cookie. Aceita mesmo com termos pendentes.
         */
        post: operations["logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Sessão atual
         * @description Dono da sessão, token CSRF, ações permitidas e termos pendentes. Sem sessão válida:
         *     `401` `unauthenticated`, e o cookie é apagado.
         */
        get: operations["getSession"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/email/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Confirmar o e-mail
         * @description Confirma o e-mail com o token do link `<classroomUrl>/confirmar?token=<token>`
         *     (`specs/007-contas-e-autenticacao.md`, "Confirmação de e-mail"). Token vencido, já usado
         *     ou desconhecido: `410` `token_expired`.
         *
         *     **Exceção de CSRF.** Não declara `csrfToken`: quem abre o link pode não ter sessão. A
         *     proteção é o corpo só em `application/json` (outro tipo: `415`) e o token de uso único.
         */
        post: operations["verifyEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/email/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reenviar o link de confirmação
         * @description Enfileira um novo link de confirmação; o anterior deixa de valer. Até 3 por hora por
         *     usuário (`429` `rate_limited`). E-mail já confirmado: `204` sem envio.
         */
        post: operations["resendVerificationEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password/forgot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Esqueci a senha
         * @description Responde sempre `204`. Se a conta existir (e não estiver excluída), enfileira o e-mail
         *     `account.password_reset` com link de 24 h para `<classroomUrl>/redefinir?token=<token>`.
         *     Conta só com provedor também recebe o link: usá-lo define a primeira senha.
         *
         *     **Exceção de CSRF.** Não declara `csrfToken`: quem esqueceu a senha não tem sessão. A
         *     proteção é o corpo só em `application/json` (outro tipo: `415`).
         */
        post: operations["requestPasswordReset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/password/reset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Redefinir a senha
         * @description Define a senha com o token do link, confirma o e-mail, marca o token como usado e
         *     invalida os outros tokens de redefinição da conta; encerra todas as sessões do usuário.
         *     Não abre sessão: o site leva a `/entrar`.
         *
         *     - Senha fora de 8 a 128 caracteres: `400` `password_invalid`.
         *     - Token vencido, já usado ou desconhecido: `410` `token_expired`.
         *
         *     **Exceção de CSRF.** Não declara `csrfToken`: quem redefine a senha não tem sessão. A
         *     proteção é o corpo só em `application/json` (outro tipo: `415`) e o token de uso único.
         */
        post: operations["resetPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/{provider}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Início do login social
         * @description O site **navega** para esta URL (navegação de página, não `fetch`;
         *     `specs/007-contas-e-autenticacao.md`, "Fluxo do provedor"). A API gera `state`, `nonce` e
         *     o verificador PKCE, grava o cookie de retorno `nuva_classroom_oauth` (10 minutos) e
         *     redireciona para a autorização do provedor.
         *
         *     - `intent=login` (padrão): entra ou cadastra. `intent=link`: vincula o provedor à conta
         *       da sessão; sem sessão válida, `401` `unauthenticated`. Por isso a operação é pública
         *       no contrato: a sessão só é lida quando `intent=link`.
         *     - Provedor desligado nesta instalação: `404`.
         */
        get: operations["startOAuth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/{provider}/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Retorno do provedor (Google, Facebook)
         * @description Retorno do provedor com `code` e `state` (ou `error`) na consulta. Parâmetros a mais que
         *     o provedor envie são ignorados. A API confere o `state` com o do cookie de retorno,
         *     troca o código e aplica a tabela de "Login social e vínculo"
         *     (`specs/007-contas-e-autenticacao.md`). Provedor desligado: `404`.
         *
         *     Com o provedor ligado, sempre responde `302` para o próprio site, nunca com corpo de
         *     erro:
         *
         *     | Resultado | `Location` |
         *     | --- | --- |
         *     | Entrou (sessão aberta, `Set-Cookie` da sessão) ou vinculou | `returnTo` |
         *     | Cadastro pendente (cookie de retorno regravado, 30 minutos) | `/cadastro/social` |
         *     | Erro no login | `/entrar?erro=<code>` |
         *     | Erro no vínculo | `/conta/acesso?erro=<code>` |
         *
         *     Códigos na URL: `oauth_state_invalid`, `oauth_denied`, `oauth_provider_error`,
         *     `account_suspended`, `identity_in_use` e `provider_already_linked` (vínculo). O cookie de
         *     retorno é apagado, exceto no cadastro pendente. A Apple volta por `POST`
         *     (`oauthCallbackForm`).
         */
        get: operations["oauthCallback"];
        put?: never;
        /**
         * Retorno do provedor por formulário (Apple)
         * @description Retorno da Apple com `response_mode=form_post`: `POST`
         *     `application/x-www-form-urlencoded` vindo do site da Apple. Mesmo tratamento e mesmos
         *     destinos de `oauthCallback`. Só `apple` usa este método; outro provedor recebe `302` para
         *     `/entrar?erro=oauth_provider_error`. `user` (JSON em texto, com o nome) só vem na
         *     primeira autorização.
         *
         *     **Exceção de CSRF.** Não declara `csrfToken`: o `POST` vem de outro site, sem sessão nem
         *     token. A proteção é o `state`, conferido em tempo constante com o do cookie de retorno
         *     (`SameSite=None`, `Path=/api/v1/auth`).
         */
        post: operations["oauthCallbackForm"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/social/pending": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Cadastro social pendente
         * @description O que o provedor informou, guardado no cookie de retorno (sem o identificador do
         *     provedor), e as versões vigentes dos termos. Sem cookie de retorno válido: `404`.
         */
        get: operations["getSocialPending"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/social/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Concluir o cadastro social
         * @description Cria a conta e o vínculo com o provedor, grava os aceites, apaga o cookie de retorno e
         *     abre a sessão (`specs/007-contas-e-autenticacao.md`, "Cadastro pendente").
         *
         *     - `email` só quando o provedor não enviou (`SocialPending.email` nulo); com e-mail do
         *       provedor, é ignorado.
         *     - Sem cookie de retorno válido: `404`.
         *     - Termos vigentes fora de `acceptedTerms`: `422` `terms_acceptance_required`.
         *     - E-mail informado que já pertence a outra conta: `409` `email_taken`.
         *
         *     **Exceção de CSRF.** Não declara `csrfToken`: a sessão ainda não existe. A proteção é o
         *     corpo só em `application/json` (outro tipo: `415`) e o cookie de retorno assinado.
         */
        post: operations["completeSocialSignup"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/account/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Definir ou trocar a própria senha
         * @description Conta sem senha: basta a sessão. Conta com senha: `currentPassword` é exigida; errada,
         *     `422` `current_password_invalid`, e a tentativa conta no bloqueio da conta (`429`
         *     `too_many_attempts`). Nova senha fora de 8 a 128 caracteres: `400` `password_invalid`.
         *     Encerra as outras sessões do usuário.
         */
        put: operations["setAccountPassword"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/account/identities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Métodos de acesso da conta
         * @description Se a conta tem senha e os provedores vinculados.
         */
        get: operations["listAccountIdentities"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/account/identities/{provider}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Desvincular um provedor
         * @description Remove o vínculo com o provedor. Provedor não vinculado: `404`. Remover o último método
         *     de acesso (sem senha e sem outro provedor): `422` `last_login_method`.
         */
        delete: operations["unlinkAccountIdentity"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/account/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Sessões abertas da conta
         * @description As sessões do usuário nos dois sites; `current` marca a desta requisição.
         */
        get: operations["listAccountSessions"];
        put?: never;
        post?: never;
        /**
         * Encerrar as outras sessões
         * @description Encerra todas as sessões do usuário, nos dois sites, exceto a desta requisição. Aceita
         *     mesmo com termos pendentes.
         */
        delete: operations["revokeOtherAccountSessions"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/account/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Encerrar uma sessão
         * @description Encerra uma sessão do próprio usuário, em qualquer dos dois sites. Sessão de outro
         *     usuário ou inexistente: `404`. Aceita mesmo com termos pendentes.
         */
        delete: operations["revokeAccountSession"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/profile/avatar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Definir ou remover o avatar
         * @description Associa ao perfil uma imagem enviada antes por `POST /api/v1/images` com
         *     `purpose = avatar`; `imageId: null` remove o avatar (`specs/007-contas-e-autenticacao.md`,
         *     "Avatar"). Imagem inexistente ou de outro usuário: `404`. Imagem de outra finalidade:
         *     `422` `image_purpose_mismatch`.
         */
        put: operations["setAvatar"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/legal/{document}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Versão vigente de um documento legal
         * @description A versão vigente (a publicada de maior `version`) dos Termos de Uso ou da Política de
         *     Privacidade, com o texto (`specs/030-lgpd.md`, "Termos na Fase 1"). Sem versão publicada:
         *     `404`.
         */
        get: operations["getLegalDocument"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/terms-acceptance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Aceitar os termos vigentes
         * @description Grava um aceite por versão, com IP e navegador; aceitar de novo a mesma versão não
         *     duplica. `id` que não é o vigente do documento: `422` `terms_version_outdated`. É a
         *     escrita que resolve `termsPending` da sessão, e é aceita com termos pendentes.
         */
        post: operations["acceptTerms"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/images": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Envio de imagem
         * @description Recebe uma imagem em `multipart/form-data` (`specs/029-imagens.md`, "Fluxo de envio"):
         *     `purpose` primeiro, depois `file` (um arquivo só). Campo a mais, segundo arquivo ou
         *     `purpose` ausente: `400` `validation_failed`. Na Fase 1 a única finalidade é `avatar`.
         *
         *     A API detecta o tipo pelo conteúdo, remove os metadados, gera as variantes em WebP e
         *     responde com elas. A imagem só passa a ter referência quando usada (no avatar, por
         *     `PUT /api/v1/me/profile/avatar`); sem referência, o expurgo a apaga em 24 h.
         *
         *     - Finalidade que o papel não pode enviar: `403` `permission_denied`.
         *     - Corpo acima de 5 MB (`NUVA_IMAGE_MAX_UPLOAD_MB`): `413` `payload_too_large`, antes de
         *       ler o corpo inteiro.
         *     - Tipo que não é JPEG, PNG nem WebP (pelo conteúdo): `415` `image_type_unsupported`.
         *       Corpo que não é `multipart/form-data`: `415` `unsupported_media_type`.
         *     - Acima de 8000 px no maior lado ou de 40 megapixels: `422` `image_dimensions_exceeded`.
         *       Variante acima de 400 KB mesmo na qualidade 50: `422` `image_too_heavy`.
         *     - Mais de 30 envios na hora (`NUVA_IMAGE_UPLOADS_PER_HOUR`; a equipe não tem limite):
         *       `429` `rate_limited`.
         *     - Processamento sobrecarregado: `503` `image_processing_busy`, com `Retry-After`.
         */
        post: operations["uploadImage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/images/{imageId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Apagar uma imagem ainda sem uso
         * @description Apaga uma imagem enviada pelo próprio usuário e ainda sem referência (por exemplo, um
         *     avatar enviado e não usado). Imagem inexistente, de outro usuário ou já em uso: `404`.
         */
        delete: operations["deleteImage"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/images/{imageId}/{variant}.webp": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Entrega de uma variante de imagem
         * @description Entrega pública de uma variante (`specs/029-imagens.md`, "Entrega"), sem sessão: o
         *     identificador é um UUID que não se adivinha. As duas APIs servem a mesma rota.
         *
         *     - `Cache-Control: public, max-age=31536000, immutable` e `ETag` com o hash do conteúdo;
         *       `If-None-Match` igual ao `ETag` responde `304`.
         *     - Imagem inexistente, ocultada pela moderação ou largura que a finalidade não tem: `404`.
         */
        get: operations["getImageVariant"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Vitrine
         * @description Cursos, pacotes e ebooks `published` com modo `open` ou `paid`, sem exigir login
         *     (`specs/009-catalogo-e-conteudo.md`, "Vitrine pública"). Produto `private` nunca aparece, nem na
         *     busca. Nenhum item traz URL de vídeo, de arquivo ou de apoio. Segue o limite de visitante
         *     (`specs/004-classroom-api.md`).
         */
        get: operations["listCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/catalog/{type}/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Página do produto
         * @description Descrição completa, programa (curso: módulos, títulos e durações das aulas publicadas), itens
         *     (pacote) ou dados do ebook, sem login e sem nenhuma URL de conteúdo. Produto `private`, em
         *     rascunho ou arquivado: `404`. Na Fase 2 não há botão de compra: o produto `paid` mostra o preço
         *     e "Acesso liberado pela escola".
         */
        get: operations["getCatalogProduct"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/courses/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Curso com o estado do usuário
         * @description O programa com o estado de acesso do usuário (`specs/010-direitos-de-acesso.md`, "Verificação de
         *     acesso"), o progresso, a aula para "Continuar" e o estado do certificado. Sem acesso, o programa
         *     continua visível, sem URL de conteúdo. Curso `private` sem direito, rascunho ou inexistente:
         *     `404`.
         */
        get: operations["getCourse"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/lessons/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Aula
         * @description O conteúdo da aula (vídeo, descrição, links de apoio, ebooks vinculados), as vizinhas e o estado
         *     do usuário. Grava a abertura (`lastOpenedAt`, `specs/014-aprendizado-e-progresso.md`, "Continuar
         *     de onde parou"). Sem acesso: `403` `access_denied` com `reason`, sem nenhuma URL. Aula ou curso
         *     despublicado, ou inexistente: `404`. Em aula amostra de curso que o aluno não tem, `ebooks` vem
         *     vazio.
         */
        get: operations["getLesson"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/samples": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Aulas liberadas
         * @description Aulas amostra (`isSample`) de cursos publicados e não privados, para "Aulas liberadas". Por
         *     padrão, só as de cursos que o usuário não tem.
         */
        get: operations["listSampleLessons"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ebooks/{slug}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Ebook com o estado do usuário
         * @description O ebook com o estado de acesso do usuário, sem a URL do arquivo (ela sai só em
         *     `GET /api/v1/ebooks/{id}/download`). `private` sem direito, rascunho ou inexistente: `404`.
         */
        get: operations["getEbook"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ebooks/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Link do arquivo do ebook
         * @description Devolve a URL externa do arquivo a quem tem acesso ao ebook (`specs/010-direitos-de-acesso.md`).
         *     Sem acesso: `403` `access_denied` com `reason`. O site abre a URL numa aba nova.
         */
        get: operations["getEbookDownload"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/entitlements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * O que o aluno tem
         * @description Os direitos do usuário, com validade e origem, para "Minha assinatura" e a estante. Inclui os
         *     vencidos; não inclui os revogados.
         */
        get: operations["listMyEntitlements"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/courses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Estante "Meus cursos"
         * @description Todo curso a que o aluno tem direito ativo ou já teve (`access.state = expired`), mais os cursos
         *     `open` que ele abriu, com progresso, ação e estado do certificado
         *     (`specs/014-aprendizado-e-progresso.md`, "Estante"). Os contadores valem para o conjunto todo,
         *     antes do filtro e da busca. Sem paginação (até 200 cursos).
         */
        get: operations["listMyCourses"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/continue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * "Continue assistindo"
         * @description Até 3 cursos em andamento, do mais recente ao mais antigo, com a aula de "Continuar".
         */
        get: operations["listContinueWatching"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/courses/{slug}/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Progresso no curso
         * @description Progresso por módulo e aula, sobre as aulas publicadas. `private` sem direito: `404`.
         */
        get: operations["getCourseProgress"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/lessons/{id}/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Marcar conclusão e gravar a posição do vídeo
         * @description Grava só os campos enviados (`specs/014-aprendizado-e-progresso.md`). `completed: true` conclui
         *     (idempotente; `completedVia` diz se foi pelo botão ou pelo fim do vídeo); `false` desmarca.
         *     `positionSeconds` é enviado no máximo a cada 15 s e ao sair da página, por `fetch` com
         *     `keepalive` e `X-CSRF-Token`. A passagem de menos de 100% a 100% enfileira `course.completed`
         *     na mesma transação.
         *
         *     - Sem acesso à aula: `403` `access_denied` com `reason`. Aula despublicada ou inexistente:
         *       `404`.
         *     - `positionSeconds` negativo ou acima da duração + 60 s: `422` `position_out_of_range`.
         */
        put: operations["saveLessonProgress"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * "Meu progresso"
         * @description Para cada curso iniciado, um quadrado por aula, agrupado por módulo, e o percentual.
         */
        get: operations["getMyProgress"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Mapa de atividade
         * @description Últimas 53 semanas, dia a dia, no fuso do usuário (`school.timezone` até a Fase 6). Só os dias
         *     com atividade vêm em `days`; os demais contam zero. Na Fase 2 conta só aulas concluídas.
         */
        get: operations["getMyActivity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/ebooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * "Meus ebooks"
         * @description Ebooks com direito ativo, com a validade; o download é `GET /api/v1/ebooks/{id}/download`.
         */
        get: operations["listMyEbooks"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Página "Anotações"
         * @description Todas as notas do próprio usuário, da alteração mais recente à mais antiga
         *     (`specs/016-anotacoes.md`). Busca textual no título e no corpo: `q` exige todas as palavras; só
         *     espaços conta como ausente. `kind=lesson` inclui a nota cuja aula foi excluída. Ninguém lê nota
         *     alheia, nem a equipe.
         */
        get: operations["listNotes"];
        put?: never;
        /**
         * Criar nota
         * @description Nota de aula (com `lessonId`) ou avulsa (sem). Nota de aula exige acesso à aula no momento:
         *     `403` `access_denied` com `reason`; aula inexistente ou despublicada: `404`. Título sem os
         *     espaços das pontas; só espaços vira `null`; acima de 160: `400`.
         *
         *     `422`, pelo `code`: `note_empty` (corpo só com espaços); `note_too_long` (acima de 20.000
         *     caracteres); `note_limit_reached` (o usuário já tem 5.000 notas); `note_lesson_limit_reached`
         *     (já tem 100 notas nesta aula); `note_video_seconds_invalid` (`videoSeconds` negativo, não
         *     finito, acima de 2.147.483.647, ou enviado em nota avulsa).
         */
        post: operations["createNote"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notes/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Uma nota
         * @description Nota de outro usuário ou inexistente: `404`.
         */
        get: operations["getNote"];
        put?: never;
        post?: never;
        /**
         * Excluir nota
         * @description Definitivo, sem lixeira. Nota de outro usuário: `404`.
         */
        delete: operations["deleteNote"];
        options?: never;
        head?: never;
        /**
         * Editar nota
         * @description Salvamento automático. `updatedAt` é o da versão que o cliente conhece; se a nota mudou em outro
         *     dispositivo: `409` `version_conflict` com a versão atual em `current`, mesmo que o pedido não
         *     mude nada. Perder o acesso ao curso não impede editar. Campo ausente mantém o valor; pedido que
         *     não altera nenhum campo devolve `200` com a nota como está, sem nova versão (mesmo `updatedAt`).
         *     Toda gravação avança `updatedAt` (precisão de milissegundos): o cliente usa o da última resposta
         *     no pedido seguinte.
         *
         *     `422`, pelo `code`: `note_empty`, `note_too_long` e `note_video_seconds_invalid`
         *     (`videoSeconds` negativo, não finito, acima de 2.147.483.647, ou enviado em nota avulsa), como
         *     na criação. Título acima de 160: `400`.
         */
        patch: operations["updateNote"];
        trace?: never;
    };
    "/api/v1/lessons/{id}/notes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Notas da aula
         * @description As notas do usuário naquela aula, da mais antiga à mais recente, para a aba "Minhas notas".
         *     Sem paginação: são no máximo 100, o teto de notas por aula (`note_lesson_limit_reached` na
         *     criação). Não exige acesso à aula: as notas seguem legíveis depois de perdê-lo. `404` só quando
         *     o usuário não tem nota ali e a aula não existe ou está despublicada.
         */
        get: operations["listLessonNotes"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/certificates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Meus certificados
         * @description Os certificados do aluno e, à parte, os cursos concluídos que aguardam template
         *     (`awaiting_template`), com o nome que sairá no certificado (`specs/015-certificados.md`).
         */
        get: operations["listMyCertificates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/certificates/{id}/pdf": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * PDF do certificado
         * @description Só o dono. Certificado de outro aluno ou inexistente: `404`. PDF ainda não gerado: `409`
         *     `certificate_preparing` ("em preparação").
         */
        get: operations["getMyCertificatePdf"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/certificate-name": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Nome no certificado
         * @description Grava `users.full_name`, o nome que sai nos próximos certificados, sem confirmação com prazo.
         *     `null` apaga, e vale o nome de exibição. Certificado já emitido não muda (a correção é a
         *     reemissão pela equipe).
         */
        put: operations["setCertificateName"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/certificates/verify/{code}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Validação pública
         * @description Sem login (`specs/015-certificados.md`, "Validação pública"). Código com ou sem hífens, sem
         *     diferenciar maiúsculas. Código inexistente ou fora do formato: `404` `certificate_not_found`,
         *     com a mesma resposta e o mesmo tempo para qualquer código. Não expõe e-mail, foto, perfil nem o
         *     PDF. Acima de 30 consultas por minuto do mesmo IP: `429`.
         */
        get: operations["verifyCertificate"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cart": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Cesta do aluno
         * @description A cesta aberta do próprio usuário (`specs/011-vendas-e-checkout.md`, "Cesta"), vazia quando
         *     ele ainda não acrescentou nada. Traz, por item, o preço atual do produto, o desconto do cupom rateado
         *     nele, os avisos que não bloqueiam a compra e a cascata que a compra libera. O preço da cesta
         *     é sempre o do produto agora: como o pedido é que congela os preços, reabrir a cesta depois
         *     de uma alteração mostra o preço novo. Produto despublicado, arquivado ou fora do modo `paid`
         *     continua na cesta com `sellable: false` e o motivo; quem recusa a compra é a finalização.
         *     Cupom que deixou de valer também continua na cesta, com `valid: false` e o motivo.
         *
         *     Os totais da cesta somam só os itens vendáveis (`sellable: true`). Item cobrado por
         *     assinatura ativa, coberto por pacote já comprado ou com direito a prazo vem com aviso e
         *     continua sendo cobrado: a compra é permitida.
         */
        get: operations["getCart"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cart/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Acrescentar produto à cesta
         * @description Acrescenta um produto avulso `paid` e publicado (`specs/011-vendas-e-checkout.md`,
         *     "Cesta"). Devolve a cesta inteira, já com o rateio do cupom e a cascata do item novo.
         *
         *     Recusas, pelo `code`: `403` `email_not_verified` (e-mail da conta não confirmado);
         *     `409` `product_not_sellable` (inexistente, despublicado, arquivado, `open` ou `private`);
         *     `409` `product_already_in_cart`; `409` `product_already_owned` (direito ativo e vitalício
         *     ao produto); `409` `cart_full` (a cesta já tem 50 itens).
         */
        post: operations["addCartItem"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cart/items/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Remover produto da cesta
         * @description Remove o item da própria cesta. Item de outra cesta ou já removido: `404` `not_found`.
         */
        delete: operations["removeCartItem"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/cart/coupon": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Aplicar cupom à cesta
         * @description Um cupom por cesta (`specs/011-vendas-e-checkout.md`, "Cupons"). O código é comparado sem
         *     diferenciar maiúsculas e substitui o cupom anterior. Devolve a cesta com o desconto
         *     rateado nos itens elegíveis.
         *
         *     `422` `coupon_invalid` quando o código não existe, está fora da janela, esgotado, inativo,
         *     não vale para pedidos avulsos (`applies_to` sem `orders`) ou não tem item elegível. A
         *     mensagem é a mesma em todos os casos, para não revelar se o código existe em outro
         *     contexto (`specs/011-vendas-e-checkout.md`, "Casos de erro"). Cupom recusado não altera a
         *     cesta: o cupom anterior continua aplicado.
         */
        put: operations["setCartCoupon"];
        post?: never;
        /**
         * Remover o cupom da cesta
         * @description Tira o cupom da cesta e devolve a cesta recalculada. Sem cupom aplicado, responde `200` com
         *     a cesta como está.
         */
        delete: operations["clearCartCoupon"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/billing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Dados de comprador
         * @description Nome completo e CPF/CNPJ já informados (`specs/011-vendas-e-checkout.md`, "Dados do
         *     comprador"), para o formulário do primeiro checkout vir preenchido e os seguintes
         *     reutilizarem o que foi informado (RF-05). A spec 011 lista só a escrita; esta leitura é o
         *     que permite reutilizar os dados sem pedi-los de novo. O documento fiscal só aparece para o
         *     próprio usuário e nunca vai para logs.
         */
        get: operations["getMyBilling"];
        /**
         * Gravar dados de comprador
         * @description Grava nome completo, tipo e número do documento no próprio usuário; o pedido copia os
         *     valores na finalização. CPF/CNPJ validado por dígito verificador e guardado só com os
         *     dígitos, como a conta (`specs/007-contas-e-autenticacao.md`); o CNPJ alfanumérico é aceito,
         *     em maiúsculas. Nome fora de 1 a 200 caracteres: `400` `validation_failed`. Documento
         *     inválido: `422` `tax_id_invalid`. O documento nunca vai para logs.
         */
        put: operations["saveMyBilling"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Pedidos do aluno
         * @description Os pedidos do próprio usuário, do mais recente ao mais antigo (`specs/011-vendas-e-checkout.md`,
         *     RF-08), sem os `draft` (restos de tentativa que não chegaram ao provedor). Filtro por
         *     estado e paginação por cursor.
         */
        get: operations["listMyOrders"];
        put?: never;
        /**
         * Fechar a cesta e criar o pedido
         * @description Fecha a cesta do próprio usuário (`specs/011-vendas-e-checkout.md`, "Pedido e seus
         *     estados"). Numa transação, valida a cesta e o cupom, cria o pedido e os itens com preços,
         *     desconto e total congelados, esvazia a cesta e cria o checkout no provedor; devolve o pedido
         *     e a `checkoutUrl` para onde o navegador vai.
         *
         *     `Idempotency-Key` é aceita: a repetição devolve o primeiro pedido por 24 h. Sem cupom
         *     válido, a cesta e o pedido não mudam.
         *
         *     Recusas, pelo `code`: `403` `email_not_verified`; `409` `billing_required` (falta nome ou
         *     documento de comprador); `409` `cart_empty`; `409` `cart_invalid` (item que deixou de ser
         *     vendável; a cesta continua, com o item marcado); `409` `order_pending_limit` (o aluno já tem
         *     3 pedidos `pending`; precisa cancelar um); `422` `coupon_invalid`; `503`
         *     `payment_provider_unavailable` (provedor fora; o pedido fica `draft`, a cesta é restaurada e
         *     a mensagem é "pagamento indisponível, tente em instantes").
         *
         *     Pedido de total zero (cupom de 100% ou produto `paid` de preço 0) já nasce `paid`, com
         *     `provider: none` e `checkoutUrl: null`, sem chamar o provedor.
         */
        post: operations["createOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Um pedido do aluno
         * @description O pedido do próprio usuário, com itens, valores congelados, estado e a cobrança conhecida
         *     (`specs/011-vendas-e-checkout.md`, "Retorno do checkout"). Pedido de outra pessoa ou `draft`:
         *     `404` `not_found`. Enquanto `pending` em provedor, `checkoutUrl` permite voltar à página de
         *     pagamento; `payment` é nulo até o worker gravar a primeira cobrança.
         */
        get: operations["getMyOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancelar pedido pendente
         * @description Cancela um pedido `pending` do próprio usuário antes do pagamento (`specs/011-vendas-e-checkout.md`,
         *     "Pedido e seus estados") e pede o cancelamento do checkout ao provedor. Pedido pago,
         *     reembolsado, expirado ou já cancelado: `409` `order_not_cancelable`. Pedido de outra pessoa
         *     ou `draft`: `404` `not_found`. Devolve o pedido já com `status: canceled`.
         */
        post: operations["cancelMyOrder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/plans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Vitrine de planos
         * @description Planos `active` agrupados por `groupKey`, para a página alternar mensal e anual
         *     (`specs/012-assinaturas.md`, "Planos"), sem login. Plano inativo sai da vitrine e não
         *     aceita assinatura nova; as assinaturas existentes continuam. Os grupos seguem a menor
         *     `position` dos planos e, dentro do grupo, vêm `month` e depois `year`.
         *
         *     Cada plano diz o que libera: `includesAll` (todo produto publicado `paid` ou `open`,
         *     atual e futuro) ou os itens explícitos. Na vitrine, item não publicado ou `private` é
         *     omitido da lista; ele continua no plano e no admin, e o acesso segue a
         *     `specs/010-direitos-de-acesso.md`. Segue o limite de visitante
         *     (`specs/004-classroom-api.md`).
         */
        get: operations["listPlans"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/subscriptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Assinar um plano
         * @description Assina um plano em checkout próprio, fora da cesta (`specs/012-assinaturas.md`,
         *     "Assinar"). Exige sessão e e-mail confirmado; o nome e o CPF/CNPJ vêm de
         *     `GET /api/v1/me/billing` e, se faltarem, a resposta é `409 billing_required` antes de
         *     qualquer cobrança. Cria a assinatura em `pending`, com o preço do plano copiado, e a
         *     adesão no provedor; devolve a assinatura e a URL para onde o navegador vai autorizar a
         *     cobrança recorrente e pagar a primeira cobrança. A ativação acontece quando a primeira
         *     cobrança é aprovada, pelo worker.
         *
         *     Um usuário pode ter assinaturas ativas de planos diferentes; repetir o mesmo plano em
         *     `pending`, `active`, `past_due` ou `suspended` responde `409 subscription_already_exists`
         *     (em `canceling`, a spec manda assinar de novo para desfazer o cancelamento). O cupom
         *     precisa de `appliesTo` `subscriptions` ou `both`, vale só na primeira cobrança e é
         *     contabilizado na ativação; cupom de 100% zera a primeira cobrança e a recorrência começa
         *     no período seguinte (`specs/012-assinaturas.md`, "Cupom na assinatura").
         *
         *     Recusas, pelo `code`: `403 email_not_verified`; `404 not_found` (plano inexistente ou
         *     inativo — plano inativo não aceita assinatura nova); `409 billing_required`;
         *     `409 subscription_already_exists`; `422 coupon_invalid` (cupom inexistente, expirado,
         *     esgotado, inativo ou sem `subscriptions` em `appliesTo`); `503
         *     payment_provider_unavailable` (provedor fora: nenhuma assinatura é criada e nada é
         *     cobrado; a mensagem é "pagamento indisponível, tente em instantes").
         */
        post: operations["createSubscription"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/subscriptions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Assinaturas do aluno
         * @description As assinaturas do próprio usuário, da mais nova para a mais antiga
         *     (`specs/012-assinaturas.md`, RF-08): a atual e o histórico, inclusive `ended` e `expired`.
         *     Filtro por estado e paginação por cursor. "Minha assinatura" mostra plano, estado,
         *     próxima cobrança e histórico a partir daqui e do detalhe.
         */
        get: operations["listMySubscriptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/subscriptions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Uma assinatura do aluno
         * @description A assinatura do próprio usuário com o plano atual (título, periodicidade e itens que
         *     libera), o preço contratado, o período, a carência e todos os estados do ciclo de vida,
         *     além do histórico de cobranças, da mais recente para a mais antiga
         *     (`specs/012-assinaturas.md`, RF-08). Assinatura de outra pessoa: `404 not_found`.
         */
        get: operations["getMySubscription"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/subscriptions/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancelar a própria assinatura
         * @description Cancela a assinatura do próprio usuário (`specs/012-assinaturas.md`, "Cancelamento"):
         *     cancela a recorrência no provedor na hora e a assinatura vai a `canceling`; o acesso
         *     segue até `currentPeriodEnd`, sem carência adicional, e ao fim o worker a encerra em
         *     `ended`. Em `past_due`, o cancelamento encerra a carência: o acesso vai só até
         *     `currentPeriodEnd`. Desfazer o cancelamento não é oferecido no MVP: o aluno assina de
         *     novo.
         *
         *     Só `active` e `past_due` aceitam o pedido; `pending`, `suspended`, `canceling`, `ended` e
         *     `expired` respondem `409 subscription_not_cancelable`. Assinatura de outra pessoa:
         *     `404 not_found`. Se o provedor não confirmar o cancelamento, a resposta é `503
         *     payment_provider_unavailable` e nada muda: a tentativa pode ser repetida.
         */
        post: operations["cancelMySubscription"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/webhooks/mercadopago": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Aviso de pagamento do Mercado Pago
         * @description Endpoint público do aviso de pagamento (`specs/013-pagamentos-mercado-pago.md`, "Webhook"),
         *     sem sessão e **sem CSRF**: quem chama é o provedor, não um navegador com a sessão do aluno; a
         *     autenticação é a assinatura do cabeçalho `x-signature`. Por isso a operação não declara
         *     `csrfToken` e entra na lista de exceções da API.
         *
         *     Lê o corpo bruto (limite de 64 KB) e valida a assinatura HMAC-SHA256 com
         *     `MP_WEBHOOK_SECRET` sobre o manifesto do provedor, em tempo constante, recusando carimbo com
         *     mais de 5 minutos. Assinatura inválida ou ausente: `401` `payment_webhook_invalid_signature`,
         *     grava `webhook_events` com `status: rejected` e `error: invalid_signature`, conta a métrica
         *     de rejeição e registra log sem corpo, assinatura ou segredo; **não** enfileira
         *     `payment.webhook` nem consulta o provedor. A rejeição não ocupa a chave idempotente
         *     (`provider`, `event_id`), então um evento válido posterior com o mesmo identificador é
         *     gravado e processado normalmente. A trilha `rejected` fica 90 dias
         *     (`NUVA_RETENTION_WEBHOOK_DAYS`) e não aceita reprocessamento.
         *
         *     Assinatura válida: grava em `webhook_events` com a chave única; evento já recebido e não
         *     rejeitado responde `200` sem enfileirar de novo; evento novo enfileira `payment.webhook` e
         *     responde `200`. A resposta não espera o processamento (p95 < 200 ms). O conteúdo do aviso
         *     não é confiável: o worker usa só o identificador e consulta o estado real no provedor.
         *
         *     Assinatura válida com aviso fora do formato esperado: `422` `payment_webhook_invalid`.
         *     Limite de 300 requisições por minuto por IP, contando também a gravação da rejeição; o IP
         *     real respeita `TRUSTED_PROXIES`.
         */
        post: operations["receiveMercadoPagoWebhook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Central do usuário
         * @description Notificações do usuário da sessão, da mais nova para a mais antiga
         *     (`specs/024-notificacoes-e-email.md`, "Central"), paginadas por cursor. O item traz o
         *     autor quando houver, `count` quando notificações do mesmo tipo e alvo foram fundidas
         *     ("Ana e mais 3 responderam em…") e `data` com o conteúdo do tipo, definido na spec do
         *     recurso. Nunca devolve notificação de outra pessoa; abrir o item é
         *     `POST /api/v1/notifications/{id}/read`.
         */
        get: operations["listNotifications"];
        put?: never;
        post?: never;
        /**
         * Limpar todas
         * @description "Limpar todas": apaga lidas e não lidas do usuário da sessão (o histórico lido também
         *     some). Nunca alcança notificação de outra pessoa; devolve quantas foram apagadas.
         */
        delete: operations["clearNotifications"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/unread-count": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Contador do sino
         * @description Não lidas do usuário da sessão: o número que o sino mostra e que o evento SSE
         *     `notification.created` atualiza sem recarregar.
         */
        get: operations["getNotificationUnreadCount"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Marcar uma notificação como lida
         * @description Marca a notificação do usuário da sessão como lida e devolve o item atualizado com o
         *     contador do sino. Idempotente: já lida devolve o mesmo item. Notificação inexistente ou
         *     de outra pessoa: `404 not_found`.
         */
        post: operations["markNotificationRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/notifications/read-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Marcar todas como lidas
         * @description Marca todas as não lidas do usuário da sessão como lidas. `updated` é quantas linhas
         *     mudaram; o contador do sino fica zero.
         */
        post: operations["markAllNotificationsRead"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/notification-prefs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Preferências por grupo
         * @description Canais efetivos dos onze grupos (`specs/024-notificacoes-e-email.md`, "Tipos e grupos").
         *     Grupo obrigatório devolve `emailRequired: true`, com o e-mail sempre ligado; o grupo
         *     `account` não tem canal plataforma (`inAppAvailable: false`, `inApp` desligado). O grupo
         *     `staff` só tem efeito para a equipe.
         */
        get: operations["getNotificationPrefs"];
        /**
         * Gravar preferências por grupo
         * @description Muda só os canais enviados; grupo omitido e canal omitido ficam como estão. Recusa com
         *     `400 validation_failed` o e-mail desligado em grupo obrigatório (`account`, `purchase`,
         *     `support` e `moderation`, RF-04) e o canal plataforma no grupo `account`. Devolve as
         *     preferências efetivas depois da mudança.
         */
        put: operations["updateNotificationPrefs"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/unsubscribe/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Descadastro de um grupo pelo token
         * @description Link de descadastro de um clique dos e-mails não obrigatórios
         *     (`specs/024-notificacoes-e-email.md`, RF-07 e "Links com token"): sem login e **sem
         *     CSRF**, porque quem abre vem do cliente de e-mail. O token identifica usuário e grupo,
         *     não expira e vale para todos os e-mails seguintes do grupo. Desliga só o e-mail do grupo
         *     do token e mantém o canal plataforma como estava; repetir a chamada não muda nada. Token
         *     fora do formato ou desconhecido: `404 not_found`. Por isso a operação não declara
         *     `csrfToken` e entra na lista de exceções da API.
         */
        post: operations["unsubscribe"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * Format: uuid
         * @description Identificador de recurso.
         * @example 0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70
         */
        Uuid: string;
        /**
         * Format: date-time
         * @description Instante em ISO 8601, sempre em UTC (sufixo `Z`).
         * @example 2026-11-24T13:45:00Z
         */
        DateTime: string;
        /**
         * Format: date
         * @description Data de calendário em ISO 8601, sem hora.
         * @example 2026-11-24
         */
        Date: string;
        /** @description Cursor opaco de paginação; o cliente só o devolve como recebeu. */
        Cursor: string;
        /**
         * @description Valor em centavos inteiros, na moeda da instalação.
         * @example 19900
         */
        MoneyCents: number;
        /**
         * @description Moeda da instalação em ISO 4217 (`NUVA_CURRENCY`).
         * @example BRL
         */
        CurrencyCode: string;
        /**
         * @description Idioma em BCP 47 (`NUVA_LOCALE`).
         * @example pt-BR
         */
        Locale: string;
        /**
         * @description Parte comum da resposta de listagem paginada por cursor. Traz só `nextCursor`: cada
         *     listagem a compõe com `allOf` e declara `items`, obrigatório, no próprio membro, com o
         *     esquema dos itens:
         *
         *     ```yaml
         *     UserPage:
         *       allOf:
         *         - $ref: "#/components/schemas/Page"
         *         - type: object
         *           required: [items]
         *           properties:
         *             items:
         *               type: array
         *               items:
         *                 $ref: "#/components/schemas/User"
         *     ```
         *
         *     `items` não é declarado aqui porque a interseção de um `items` genérico com o da
         *     listagem tiparia o cliente gerado como `unknown[] & User[]`. Nem este esquema nem o
         *     membro da listagem usam `additionalProperties: false`, que invalidaria a composição.
         */
        Page: {
            /** @description Cursor da próxima página; `null` na última. */
            nextCursor: components["schemas"]["Cursor"] | null;
        };
        /** @description Um campo recusado na validação. */
        ProblemFieldError: {
            /**
             * @description Caminho do campo na requisição.
             * @example body.email
             */
            path: string;
            message: string;
        };
        /**
         * @description Erro no formato RFC 9457. Pode trazer campos extras conforme o `code`; os comuns estão
         *     declarados aqui (`errors`, `retryAfterSeconds`).
         */
        Problem: {
            /**
             * Format: uri-reference
             * @description Identifica o tipo do problema; `about:blank` quando não há página própria.
             * @default about:blank
             */
            type: string;
            /** @description Resumo curto, igual para todas as ocorrências do tipo. */
            title: string;
            /** @description O mesmo código de status da resposta HTTP. */
            status: number;
            /** @description Explicação desta ocorrência. */
            detail?: string;
            /**
             * Format: uri-reference
             * @description Caminho da requisição que falhou.
             */
            instance?: string;
            /**
             * @description Identificador estável do erro, para o cliente decidir o que fazer. A lista é aberta:
             *     um `code` só muda ou some com mudança de versão da API, e código novo pode surgir.
             *
             *     Códigos gerais, iguais nas duas APIs (`specs/003-admin-api.md`):
             *
             *     | `code` | Status | Quando |
             *     | --- | --- | --- |
             *     | `validation_failed` | 400 | Requisição fora do contrato; `errors` lista os campos |
             *     | `unauthenticated` | 401 | Sem sessão válida |
             *     | `permission_denied` | 403 | Sessão válida, sem permissão para a operação |
             *     | `csrf_token_invalid` | 403 | Escrita sem `X-CSRF-Token` ou com token diferente do da sessão |
             *     | `not_found` | 404 | Recurso inexistente ou fora do alcance de quem pede |
             *     | `version_conflict` | 409 | `version` enviada diferente da gravada |
             *     | `payload_too_large` | 413 | Corpo acima do limite da rota |
             *     | `unsupported_media_type` | 415 | `Content-Type` que a operação não declara, ou que o serviço não sabe ler |
             *     | `rate_limited` | 429 | Limite de taxa; traz `retryAfterSeconds` |
             *     | `internal_error` | 500 | Erro inesperado; sem `detail` |
             *     | `database_unavailable` | 503 | Banco indisponível |
             *     | `payment_provider_unavailable` | 503 | Provedor de pagamento indisponível |
             *
             *     Os demais `403`, `409`, `422` e `503` usam um código próprio da regra, definido na
             *     spec do recurso e citado na descrição da operação (por exemplo, `entitlement_required`).
             * @example permission_denied
             * @example validation_failed
             * @example database_unavailable
             */
            code: string;
            /** @description Presente em erro de validação (`400`). */
            errors?: components["schemas"]["ProblemFieldError"][];
            /**
             * @description Segundos até poder tentar de novo; o mesmo valor do cabeçalho `Retry-After`.
             *     Presente em `rate_limited` (`429`).
             */
            retryAfterSeconds?: number;
        } & {
            [key: string]: unknown;
        };
        Health: {
            /** @constant */
            status: "ok";
        };
        /** @enum {string} */
        ReadinessCheck: "ok" | "fail";
        Readiness: {
            /** @enum {string} */
            status: "ready" | "not_ready";
            checks: {
                /** @description Conexão com o PostgreSQL. */
                database: components["schemas"]["ReadinessCheck"];
                /** @description Banco na versão de migration esperada pelo serviço. */
                migrations: components["schemas"]["ReadinessCheck"];
            };
        };
        /**
         * @description Provedor de login social.
         * @enum {string}
         */
        AuthProvider: "google" | "facebook" | "apple";
        /**
         * @description Dados públicos da instalação e da marca da escola (`specs/003-admin-api.md`, "Meta").
         *     Todos os campos estão sempre presentes; `logoUrl` e `accentColor` podem ser `null`.
         */
        Meta: {
            /** @description Nome da escola, definido na configuração do admin; padrão `nuva-edu`. */
            schoolName: string;
            /**
             * @description Versão instalada do nuva-edu (SemVer).
             * @example 0.1.0
             */
            version: string;
            currency: components["schemas"]["CurrencyCode"];
            locale: components["schemas"]["Locale"];
            /**
             * @description Provedores de login social configurados nesta instalação; vazio quando nenhum.
             *     Login por e-mail e senha está sempre disponível e não aparece na lista.
             */
            authProviders: components["schemas"]["AuthProvider"][];
            /**
             * Format: uri-reference
             * @description Caminho do logotipo na própria API, na variante de 256 px
             *     (`specs/029-imagens.md`). `null` sem logotipo: os sites mostram só o nome.
             * @example /api/v1/images/0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70/256.webp
             * @example null
             */
            logoUrl: string | null;
            /**
             * @description Cor de destaque da escola, em `#RRGGBB`. `null` usa a cor de destaque padrão de
             *     `packages/ui`.
             * @example #1F6FEB
             * @example null
             */
            accentColor: string | null;
            /**
             * Format: uri
             * @description Endereço do código-fonte desta instalação, exigido pela AGPL-3.0. Sempre presente;
             *     padrão `https://github.com/patrickbrandao/nuva-edu`.
             * @example https://github.com/patrickbrandao/nuva-edu
             */
            sourceCodeUrl: string;
        };
        /**
         * Format: email
         * @description Endereço de e-mail. A API o normaliza (minúsculas) antes de gravar ou comparar.
         * @example ana@example.com
         */
        Email: string;
        /**
         * @description Papel do usuário (`specs/008-papeis-e-permissoes.md`).
         * @enum {string}
         */
        UserRole: "student" | "instructor" | "manager" | "admin";
        /**
         * @description Identificador de uma ação da matriz de permissões (`specs/008-papeis-e-permissoes.md`,
         *     "Identificadores das ações"), o mesmo de `x-permission`. A lista é aberta: ação nova
         *     entra pela spec 008.
         * @example users.list
         * @example account.self_service
         */
        PermissionAction: string;
        /**
         * @description Site em que a sessão foi aberta.
         * @enum {string}
         */
        SessionSite: "classroom" | "admin";
        /** @description Dono da sessão. Não tem campo de senha; `hasPassword` só diz se há uma definida. */
        SessionUser: {
            id: components["schemas"]["Uuid"];
            /** @description Nome de exibição. */
            name: string;
            email: components["schemas"]["Email"];
            emailVerified: boolean;
            role: components["schemas"]["UserRole"];
            /**
             * Format: uri-reference
             * @description Caminho da variante de 256 px do avatar na própria API; `null` sem avatar (o site
             *     mostra as iniciais do nome).
             * @example /api/v1/images/0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70/256.webp
             * @example null
             */
            avatarUrl: string | null;
            /** @description Verdadeiro quando a conta tem senha definida. */
            hasPassword: boolean;
        };
        /** @description Uma sessão aberta, nos dois sites. */
        SessionInfo: {
            /** @description Identificador público da sessão (não é o valor do cookie). */
            id: components["schemas"]["Uuid"];
            site: components["schemas"]["SessionSite"];
            /**
             * @description IP de onde a sessão foi aberta.
             * @example 203.0.113.10
             */
            ip: string | null;
            /**
             * @description Família do navegador, lida do `User-Agent`; `null` quando não reconhecida.
             * @example Chrome
             */
            browser: string | null;
            /**
             * @description Sistema, lido do `User-Agent`; `null` quando não reconhecido.
             * @example macOS
             */
            os: string | null;
            createdAt: components["schemas"]["DateTime"];
            lastUsedAt: components["schemas"]["DateTime"];
            /** @description Verdadeiro na sessão que fez a requisição. */
            current: boolean;
        };
        SessionInfoList: {
            /** @description Mais recente primeiro (`lastUsedAt`). */
            items: components["schemas"]["SessionInfo"][];
        };
        /** @description Provedor de login social vinculado à conta. */
        Identity: {
            provider: components["schemas"]["AuthProvider"];
            /** @description E-mail informado pelo provedor; `null` quando ele não enviou. */
            email: string | null;
            createdAt: components["schemas"]["DateTime"];
        };
        /**
         * @description Documento legal (`specs/030-lgpd.md`), Termos de Uso ou Política de Privacidade.
         * @enum {string}
         */
        TermsDocument: "terms" | "privacy";
        /**
         * @description Largura de uma variante de imagem, em pixels (`specs/029-imagens.md`).
         * @enum {integer}
         */
        ImageVariantWidth: 64 | 256 | 480 | 512 | 1280 | 1600;
        /** @description Token do link enviado por e-mail (32 bytes em base64url), como veio na URL. */
        EmailToken: string;
        EmailTokenRequest: {
            token: components["schemas"]["EmailToken"];
        };
        /** @description Uma versão publicada de um documento legal, sem o texto (`specs/030-lgpd.md`). */
        TermsVersion: {
            id: components["schemas"]["Uuid"];
            document: components["schemas"]["TermsDocument"];
            /** @description Número sequencial da versão, por documento. */
            version: number;
            effectiveAt: components["schemas"]["DateTime"];
        };
        /** @description A versão vigente de um documento legal, com o texto. */
        LegalDocument: {
            id: components["schemas"]["Uuid"];
            document: components["schemas"]["TermsDocument"];
            version: number;
            /** @description Texto em Markdown. */
            bodyMd: string;
            effectiveAt: components["schemas"]["DateTime"];
        };
        /**
         * @description Sessão do classroom (`specs/007-contas-e-autenticacao.md`, "Esquemas comuns"). Com
         *     `termsPending` não vazio, as escritas respondem `403` `terms_acceptance_pending`, exceto
         *     `POST /api/v1/me/terms-acceptance`, `POST /api/v1/auth/logout` e as de
         *     `/api/v1/account/sessions`.
         */
        Session: {
            user: components["schemas"]["SessionUser"];
            /** @description Valor do cabeçalho `X-CSRF-Token` nas escritas desta sessão. */
            csrfToken: string;
            /** @description Ações de `specs/008-papeis-e-permissoes.md` que o papel permite. */
            permissions: components["schemas"]["PermissionAction"][];
            expiresAt: components["schemas"]["DateTime"];
            /** @description Versões vigentes que o usuário ainda precisa aceitar; vazia quando nenhuma. */
            termsPending: components["schemas"]["TermsVersion"][];
        };
        /**
         * @description Cadastro social pendente, com o que o provedor informou e os termos vigentes
         *     (`specs/007-contas-e-autenticacao.md`, "Cadastro pendente").
         */
        SocialPending: {
            provider: components["schemas"]["AuthProvider"];
            /**
             * @description E-mail informado pelo provedor; `null` quando ele não enviou: o site pede o e-mail e
             *     o manda em `POST /api/v1/auth/social/complete`.
             */
            email: string | null;
            /** @description Se o provedor atestou o e-mail como verificado. */
            emailVerified: boolean;
            name: string | null;
            /** @description Versões vigentes a aceitar; vazia quando não há versão publicada. */
            terms: components["schemas"]["TermsVersion"][];
        };
        IdentityList: {
            /** @description Verdadeiro quando a conta tem senha definida. */
            hasPassword: boolean;
            items: components["schemas"]["Identity"][];
        };
        AvatarResult: {
            /**
             * Format: uri-reference
             * @description Variante de 256 px do avatar; `null` quando removido.
             */
            avatarUrl: string | null;
        };
        /**
         * @description Finalidade da imagem (`specs/029-imagens.md`). Na Fase 1 só existe `avatar`; as demais
         *     entram com os recursos que as usam.
         * @enum {string}
         */
        ImagePurpose: "avatar";
        ImageVariantInfo: {
            width: components["schemas"]["ImageVariantWidth"];
            height: number;
            /**
             * Format: uri-reference
             * @description Caminho de entrega (`/api/v1/images/{imageId}/{variant}.webp`).
             * @example /api/v1/images/0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70/64.webp
             */
            url: string;
        };
        /** @description Imagem enviada, com as variantes geradas. */
        Image: {
            id: components["schemas"]["Uuid"];
            purpose: components["schemas"]["ImagePurpose"];
            /** @description Largura do arquivo enviado, em pixels. */
            width: number;
            /** @description Altura do arquivo enviado, em pixels. */
            height: number;
            variants: components["schemas"]["ImageVariantInfo"][];
        };
        /**
         * @description Campo `id` do SSE: inteiro em texto, tirado de uma sequência do banco. Crescente para
         *     cada usuário, não consecutivo.
         * @example 42
         */
        StreamEventId: string;
        StreamDmMessageRef: {
            conversationId: components["schemas"]["Uuid"];
            messageId: components["schemas"]["Uuid"];
        };
        StreamNotificationCreatedData: {
            notificationId: components["schemas"]["Uuid"];
            /** @description Tipo da notificação (`specs/024-notificacoes-e-email.md`). */
            type: string;
            /** @description Notificações não lidas do usuário depois desta. */
            unreadCount: number;
        };
        StreamForumPostCreatedData: {
            topicId: components["schemas"]["Uuid"];
            postId: components["schemas"]["Uuid"];
        };
        StreamAnnouncementPublishedData: {
            announcementId: components["schemas"]["Uuid"];
            /** @description Novidades não lidas do usuário depois desta. */
            unreadCount: number;
        };
        StreamPresenceData: {
            userId: components["schemas"]["Uuid"];
            online: boolean;
        };
        /** @description Sempre vazio. */
        StreamPingData: Record<string, never>;
        /** @description Nova mensagem direta recebida. */
        StreamEventDmMessageCreated: {
            id: components["schemas"]["StreamEventId"];
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "dm.message.created";
            data: components["schemas"]["StreamDmMessageRef"];
        };
        /** @description O destinatário leu a mensagem. */
        StreamEventDmMessageRead: {
            id: components["schemas"]["StreamEventId"];
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "dm.message.read";
            data: components["schemas"]["StreamDmMessageRef"];
        };
        /** @description Mensagem apagada. */
        StreamEventDmMessageDeleted: {
            id: components["schemas"]["StreamEventId"];
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "dm.message.deleted";
            data: components["schemas"]["StreamDmMessageRef"];
        };
        /** @description Nova notificação. */
        StreamEventNotificationCreated: {
            id: components["schemas"]["StreamEventId"];
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "notification.created";
            data: components["schemas"]["StreamNotificationCreatedData"];
        };
        /** @description Nova resposta num tópico aberto na tela. */
        StreamEventForumPostCreated: {
            id: components["schemas"]["StreamEventId"];
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "forum.post.created";
            data: components["schemas"]["StreamForumPostCreatedData"];
        };
        /** @description Nova novidade publicada. */
        StreamEventAnnouncementPublished: {
            id: components["schemas"]["StreamEventId"];
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "announcement.published";
            data: components["schemas"]["StreamAnnouncementPublishedData"];
        };
        /** @description Mudança de presença de alguém numa conversa aberta. */
        StreamEventPresence: {
            id: components["schemas"]["StreamEventId"];
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "presence";
            data: components["schemas"]["StreamPresenceData"];
        };
        /** @description Mantém a conexão viva; enviado a cada 25 s, sem `id`. */
        StreamEventPing: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "ping";
            data: components["schemas"]["StreamPingData"];
        };
        /** @description Um evento do fluxo depois de lido (campos `id`, `event` e `data` do SSE). */
        StreamEvent: components["schemas"]["StreamEventDmMessageCreated"] | components["schemas"]["StreamEventDmMessageRead"] | components["schemas"]["StreamEventDmMessageDeleted"] | components["schemas"]["StreamEventNotificationCreated"] | components["schemas"]["StreamEventForumPostCreated"] | components["schemas"]["StreamEventAnnouncementPublished"] | components["schemas"]["StreamEventPresence"] | components["schemas"]["StreamEventPing"];
        /**
         * @description Grupo de preferência (`specs/024-notificacoes-e-email.md`, "Tipos e grupos"); o grupo de
         *     cada tipo está na mesma tabela.
         * @enum {string}
         */
        NotificationGroup: "account" | "purchase" | "courses" | "forum" | "messages" | "community" | "events" | "support" | "announcements" | "moderation" | "staff";
        /**
         * @description Conteúdo do tipo, definido na spec do recurso (o `forum.reply` traz o tópico e a
         *     resposta; o `order.approved`, o pedido). Nunca contém senha, token nem segredo.
         */
        NotificationData: {
            [key: string]: unknown;
        };
        /** @description Quem gerou o fato; ausente em aviso do sistema. */
        NotificationActor: {
            id: components["schemas"]["Uuid"];
            /** @description Nome de exibição; `usuário removido` quando a conta foi excluída. */
            name: string;
            /** @description Caminho da foto de perfil na API, ou nulo. */
            avatarUrl: string | null;
        };
        /**
         * @description Um item da central (`specs/024-notificacoes-e-email.md`, "Central"): ícone do tipo, foto,
         *     título, texto curto, tempo e link para o alvo são montados a partir de `type`, `actor`,
         *     `data` e do alvo.
         */
        NotificationItem: {
            id: components["schemas"]["Uuid"];
            /**
             * @description Tipo da notificação (`specs/024-notificacoes-e-email.md`). Fica em texto, e não em
             *     `enum`, porque um worker mais novo pode gravar tipo que esta API ainda não conhece.
             * @example forum.reply
             */
            type: string;
            group: components["schemas"]["NotificationGroup"];
            /** @description Quem gerou o fato; nulo em aviso do sistema. */
            actor: components["schemas"]["NotificationActor"] | null;
            /**
             * @description Tipo do alvo (`topic`, `course`, `order`...), sempre junto de `targetId`; nulo quando
             *     a notificação não aponta para um recurso.
             */
            targetType: string | null;
            targetId: components["schemas"]["Uuid"] | null;
            data: components["schemas"]["NotificationData"];
            /** @description Quantas notificações do mesmo tipo e alvo foram fundidas nesta linha. */
            count: number;
            /** @description Quando foi lida; nulo enquanto não lida. */
            readAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
        };
        NotificationPage: components["schemas"]["Page"] & {
            items: components["schemas"]["NotificationItem"][];
        };
        /** @description Não lidas do usuário, para o sino. */
        NotificationUnreadCount: {
            unreadCount: number;
        };
        /** @description Item marcado como lido e o contador do sino depois da leitura. */
        NotificationReadResult: {
            notification: components["schemas"]["NotificationItem"];
            unreadCount: number;
        };
        /** @description Resultado de "marcar todas como lidas". */
        NotificationsReadAllResult: {
            /** @description Quantas notificações passaram de não lidas a lidas nesta chamada. */
            updated: number;
            /** @constant */
            unreadCount: 0;
        };
        /** @description Resultado de "limpar todas". */
        NotificationsCleared: {
            /** @description Quantas notificações foram apagadas. */
            deleted: number;
        };
        /** @description Canais efetivos de um grupo. */
        NotificationChannelPrefs: {
            /** @description Canal plataforma (central e sino). */
            inApp: boolean;
            /** @description Canal e-mail. */
            email: boolean;
        };
        /**
         * @description Canais efetivos de um grupo e as regras que a interface precisa para desabilitar o que
         *     não pode mudar.
         */
        NotificationGroupPrefs: {
            inApp: boolean;
            email: boolean;
            /**
             * @description `true` nos grupos obrigatórios (`account`, `purchase`, `support` e `moderation`): o
             *     e-mail não pode ser desligado (RF-04).
             */
            emailRequired: boolean;
            /** @description `false` só no grupo `account`, que não tem canal plataforma. */
            inAppAvailable: boolean;
        };
        /**
         * @description Canais efetivos dos onze grupos (`specs/024-notificacoes-e-email.md`, "Tipos e grupos"),
         *     na ordem da tabela.
         */
        NotificationPrefs: {
            account: components["schemas"]["NotificationGroupPrefs"];
            purchase: components["schemas"]["NotificationGroupPrefs"];
            courses: components["schemas"]["NotificationGroupPrefs"];
            forum: components["schemas"]["NotificationGroupPrefs"];
            messages: components["schemas"]["NotificationGroupPrefs"];
            community: components["schemas"]["NotificationGroupPrefs"];
            events: components["schemas"]["NotificationGroupPrefs"];
            support: components["schemas"]["NotificationGroupPrefs"];
            announcements: components["schemas"]["NotificationGroupPrefs"];
            moderation: components["schemas"]["NotificationGroupPrefs"];
            staff: components["schemas"]["NotificationGroupPrefs"];
        };
        /** @description Canais a mudar num grupo; canal omitido fica como está. */
        NotificationChannelUpdate: {
            inApp?: boolean;
            email?: boolean;
        };
        /**
         * @description Grupos a mudar; grupo omitido fica como está. Grupo obrigatório com `email: false` e
         *     grupo `account` com `inApp: true` são recusados com `400 validation_failed`.
         */
        NotificationPrefsUpdate: {
            account?: components["schemas"]["NotificationChannelUpdate"];
            purchase?: components["schemas"]["NotificationChannelUpdate"];
            courses?: components["schemas"]["NotificationChannelUpdate"];
            forum?: components["schemas"]["NotificationChannelUpdate"];
            messages?: components["schemas"]["NotificationChannelUpdate"];
            community?: components["schemas"]["NotificationChannelUpdate"];
            events?: components["schemas"]["NotificationChannelUpdate"];
            support?: components["schemas"]["NotificationChannelUpdate"];
            announcements?: components["schemas"]["NotificationChannelUpdate"];
            moderation?: components["schemas"]["NotificationChannelUpdate"];
            staff?: components["schemas"]["NotificationChannelUpdate"];
        };
        /** @description Resultado do descadastro; só o e-mail do grupo do token muda. */
        UnsubscribeResult: {
            group: components["schemas"]["NotificationGroup"];
            prefs: components["schemas"]["NotificationChannelPrefs"];
        };
        /**
         * @description Tipo de produto do catálogo (`specs/009-catalogo-e-conteudo.md`).
         * @enum {string}
         */
        ProductType: "course" | "bundle" | "ebook";
        /**
         * @description Modo de acesso do produto (`specs/009-catalogo-e-conteudo.md`, "Modos de acesso"): `open` para
         *     qualquer usuário logado, `paid` para quem tem direito ativo, `private` só por concessão, pacote
         *     ou
         *     plano, e nunca na vitrine.
         * @enum {string}
         */
        AccessMode: "open" | "paid" | "private";
        /**
         * @description Estado de publicação de produto e de aula; só `published` aparece no classroom.
         * @enum {string}
         */
        PublicationStatus: "draft" | "published";
        /**
         * @description Nível do curso.
         * @enum {string}
         */
        CourseLevel: "beginner" | "intermediate" | "advanced";
        /**
         * @description Provedor do vídeo, classificado pela API a partir da URL na gravação
         *     (`specs/009-catalogo-e-conteudo.md`,
         *     "Vídeo e links externos"). URL fora dos padrões da tabela, inclusive `.m3u8` de outro host, vira
         *     `link` (botão "Abrir vídeo", sem conclusão automática).
         * @enum {string}
         */
        VideoProvider: "youtube" | "vimeo" | "bunny" | "panda" | "file" | "link";
        /**
         * @description Tipo de link de apoio: arquivo ou página.
         * @enum {string}
         */
        LessonLinkKind: "file" | "page";
        /** @description Link de apoio de uma aula, na ordem de `position`. */
        LessonLink: {
            id: components["schemas"]["Uuid"];
            label: string;
            /** @description URL externa do material; só vai a quem tem acesso à aula. */
            url: string;
            kind: components["schemas"]["LessonLinkKind"];
            position: number;
        };
        /** @description Capa de um produto, imagem de finalidade `product_cover` em 16:9 (`specs/029-imagens.md`). */
        ProductCover: {
            imageId: components["schemas"]["Uuid"];
            /**
             * Format: uri-reference
             * @description Variante de 480 px (`/api/v1/images/{imageId}/480.webp`).
             */
            url: string;
            /**
             * Format: uri-reference
             * @description Variante de 1280 px (`/api/v1/images/{imageId}/1280.webp`).
             */
            largeUrl: string;
        };
        /**
         * @description Estado de um certificado existente: `preparing` (registro criado, PDF ainda não gerado),
         *     `issued` (com PDF) ou `revoked` (`specs/015-certificados.md`).
         * @enum {string}
         */
        CertificateState: "preparing" | "issued" | "revoked";
        /**
         * @description Identificador legível na URL: minúsculas, dígitos e hífens.
         * @example introducao-ao-python
         */
        Slug: string;
        /** @description Um produto na vitrine, sem nenhuma URL de conteúdo. */
        CatalogItem: {
            type: components["schemas"]["ProductType"];
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            summary: string | null;
            cover: components["schemas"]["ProductCover"] | null;
            /** @description Só em curso. */
            level: components["schemas"]["CourseLevel"] | null;
            /**
             * @description Modo de acesso; produto `private` nunca aparece na vitrine.
             * @enum {string}
             */
            accessMode: "open" | "paid";
            /** @description Preço em centavos no modo `paid`; `null` em `open`. */
            priceCents: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays: number | null;
            /** @description Só em curso. */
            moduleCount: number | null;
            /** @description Só em curso. */
            lessonCount: number | null;
            /** @description Só em curso. */
            durationSeconds: number | null;
            /** @description Só em pacote. */
            itemCount: number | null;
            /** @description Só em ebook. */
            pages: number | null;
            publishedAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        CatalogItemPage: components["schemas"]["Page"] & {
            items: components["schemas"]["CatalogItem"][];
        };
        /** @description Uma aula publicada no programa: título e duração, sem URL. */
        ProgramLesson: {
            id: components["schemas"]["Uuid"];
            title: string;
            durationSeconds: number | null;
            isSample: boolean;
            position: number;
        };
        ProgramModule: {
            id: components["schemas"]["Uuid"];
            title: string;
            position: number;
            lessonCount: number;
            durationSeconds: number;
            lessons: components["schemas"]["ProgramLesson"][];
        };
        /** @description Página de curso na vitrine, com o programa. */
        CatalogCourse: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "course";
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            summary: string | null;
            /** @description Markdown. */
            description: string | null;
            cover: components["schemas"]["ProductCover"] | null;
            level: components["schemas"]["CourseLevel"] | null;
            /**
             * @description Modo de acesso; produto `private` nunca aparece na vitrine.
             * @enum {string}
             */
            accessMode: "open" | "paid";
            /** @description Preço em centavos no modo `paid`; `null` em `open`. */
            priceCents: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays: number | null;
            moduleCount: number;
            /** @description Aulas publicadas. */
            lessonCount: number;
            /** @description Soma das aulas publicadas. */
            durationSeconds: number;
            /** @description Nome de exibição do dono. */
            instructorName: string | null;
            program: components["schemas"]["ProgramModule"][];
            publishedAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        /** @description Um item de pacote. */
        CatalogBundleItem: {
            /** @enum {string} */
            type: "course" | "ebook";
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            summary: string | null;
            cover: components["schemas"]["ProductCover"] | null;
            accessMode: components["schemas"]["AccessMode"];
            priceCents: number | null;
            /** @description Falso em item `private`: aparece só o título, sem link para a página dele. */
            visible: boolean;
        };
        /** @description Página de pacote na vitrine. */
        CatalogBundle: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "bundle";
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            summary: string | null;
            /** @description Markdown. */
            description: string | null;
            cover: components["schemas"]["ProductCover"] | null;
            /**
             * @description Modo de acesso; produto `private` nunca aparece na vitrine.
             * @enum {string}
             */
            accessMode: "open" | "paid";
            /** @description Preço em centavos no modo `paid`; `null` em `open`. */
            priceCents: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays: number | null;
            items: components["schemas"]["CatalogBundleItem"][];
            /** @description Soma dos preços avulsos dos itens `paid`, para mostrar a economia. */
            itemsPriceCents: number;
            publishedAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        /** @description Página de ebook na vitrine, sem a URL do arquivo. */
        CatalogEbook: {
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            type: "ebook";
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            summary: string | null;
            /** @description Markdown. */
            description: string | null;
            cover: components["schemas"]["ProductCover"] | null;
            /**
             * @description Modo de acesso; produto `private` nunca aparece na vitrine.
             * @enum {string}
             */
            accessMode: "open" | "paid";
            /** @description Preço em centavos no modo `paid`; `null` em `open`. */
            priceCents: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays: number | null;
            authorName: string | null;
            pages: number | null;
            publishedAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        /** @description Página do produto, conforme `type`. */
        CatalogProduct: components["schemas"]["CatalogCourse"] | components["schemas"]["CatalogBundle"] | components["schemas"]["CatalogEbook"];
        /**
         * @description Motivo da negativa de `canAccess` (`specs/010-direitos-de-acesso.md`), usado pelo site para
         *     escolher a mensagem.
         * @enum {string}
         */
        AccessDenialReason: "not_authenticated" | "suspended" | "no_entitlement" | "expired" | "unpublished";
        /** @description Estado de acesso do usuário a um produto. */
        AccessState: {
            /** @description O usuário acessa o conteúdo agora. */
            allowed: boolean;
            /** @description `null` quando `allowed`. */
            reason: components["schemas"]["AccessDenialReason"] | null;
            /** @description Fim do acesso mais longo; `null` vitalício, `open` ou sem acesso. */
            expiresAt: components["schemas"]["DateTime"] | null;
        };
        /**
         * @description Estado do curso para o aluno (`specs/014-aprendizado-e-progresso.md`, "Progresso").
         * @enum {string}
         */
        CourseProgressState: "not_started" | "in_progress" | "completed";
        /** @description Progresso num curso ou módulo, sobre as aulas publicadas. */
        ProgressCounts: {
            completedLessons: number;
            /** @description Aulas publicadas. */
            totalLessons: number;
            percent: number;
            state: components["schemas"]["CourseProgressState"];
        };
        /**
         * @description Estado do certificado para o aluno (`specs/015-certificados.md`, "Estado do certificado para o
         *     aluno").
         * @enum {string}
         */
        CourseCertificateStateName: "in_progress" | "awaiting_template" | "preparing" | "issued" | "revoked";
        /**
         * @description Estado do certificado de um curso com certificado habilitado. Nos campos que o usam, `null` é
         *     certificado desabilitado: a página não menciona certificado.
         */
        CourseCertificateState: {
            state: components["schemas"]["CourseCertificateStateName"];
            /** @description Presente quando o certificado existe. */
            certificateId: components["schemas"]["Uuid"] | null;
            /** @description Código, em `issued` e `revoked`. */
            code: string | null;
            /**
             * @description O nome que sai (ou saiu) no certificado: `users.full_name` ou, vazio, o nome de exibição; o
             *     congelado, quando já emitido.
             */
            studentName: string;
        };
        CourseViewLesson: {
            id: components["schemas"]["Uuid"];
            title: string;
            durationSeconds: number | null;
            isSample: boolean;
            position: number;
            /** @description O usuário abre a aula agora. */
            accessible: boolean;
            completed: boolean;
        };
        CourseViewModule: {
            id: components["schemas"]["Uuid"];
            title: string;
            position: number;
            progress: components["schemas"]["ProgressCounts"];
            durationSeconds: number;
            lessons: components["schemas"]["CourseViewLesson"][];
        };
        /** @description Ebook vinculado a curso ou aula, sem a URL do arquivo. */
        EbookRef: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            cover: components["schemas"]["ProductCover"] | null;
            /** @description O usuário baixa o ebook agora. */
            accessible: boolean;
        };
        /** @description O curso com o estado do usuário; sem URL de conteúdo. */
        CourseView: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            summary: string | null;
            /** @description Markdown. */
            description: string | null;
            cover: components["schemas"]["ProductCover"] | null;
            level: components["schemas"]["CourseLevel"] | null;
            accessMode: components["schemas"]["AccessMode"];
            /** @description Preço em centavos no modo `paid`; `null` em `open`. */
            priceCents: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays: number | null;
            moduleCount: number;
            /** @description Aulas publicadas. */
            lessonCount: number;
            /** @description Soma das aulas publicadas. */
            durationSeconds: number;
            instructorName: string | null;
            access: components["schemas"]["AccessState"];
            progress: components["schemas"]["ProgressCounts"];
            /** @description Aula do botão "Continuar"; `null` sem acesso. */
            continueLessonId: components["schemas"]["Uuid"] | null;
            modules: components["schemas"]["CourseViewModule"][];
            /** @description Ebooks vinculados ao curso. */
            ebooks: components["schemas"]["EbookRef"][];
            /** @description Estado do certificado; `null` com certificado desabilitado. */
            certificate: components["schemas"]["CourseCertificateState"] | null;
            updatedAt: components["schemas"]["DateTime"];
        };
        /**
         * @description Como a aula foi concluída: pelo botão ou pelo fim do vídeo.
         * @enum {string}
         */
        CompletionVia: "manual" | "video_end";
        LessonUserState: {
            completedAt: components["schemas"]["DateTime"] | null;
            completedVia: components["schemas"]["CompletionVia"] | null;
            positionSeconds: number | null;
            lastOpenedAt: components["schemas"]["DateTime"] | null;
        };
        /** @description A aula, para quem tem acesso. */
        LessonView: {
            id: components["schemas"]["Uuid"];
            title: string;
            /** @description Markdown, exibido sanitizado. */
            description: string | null;
            durationSeconds: number | null;
            isSample: boolean;
            videoProvider: components["schemas"]["VideoProvider"] | null;
            /** @description Só sai a quem tem acesso à aula. */
            videoUrl: string | null;
            course: {
                id: components["schemas"]["Uuid"];
                slug: components["schemas"]["Slug"];
                title: string;
            };
            module: {
                id: components["schemas"]["Uuid"];
                title: string;
            };
            links: components["schemas"]["LessonLink"][];
            /** @description Ebooks vinculados à aula; vazio em amostra de curso que o aluno não tem. */
            ebooks: components["schemas"]["EbookRef"][];
            previousLessonId: components["schemas"]["Uuid"] | null;
            nextLessonId: components["schemas"]["Uuid"] | null;
            /** @description Mostra "Concluir curso" no rodapé. */
            isLastLesson: boolean;
            userState: components["schemas"]["LessonUserState"];
        };
        /**
         * @description `Problem` de `403`. Em `access_denied` traz `reason`, o motivo da negativa; nos demais
         *     `403` (`permission_denied`, `csrf_token_invalid`), não.
         */
        AccessDeniedProblem: components["schemas"]["Problem"] & {
            reason?: components["schemas"]["AccessDenialReason"];
        };
        SampleLesson: {
            id: components["schemas"]["Uuid"];
            title: string;
            durationSeconds: number | null;
            course: {
                id: components["schemas"]["Uuid"];
                slug: components["schemas"]["Slug"];
                title: string;
                cover: components["schemas"]["ProductCover"] | null;
            };
        };
        SampleLessonPage: components["schemas"]["Page"] & {
            items: components["schemas"]["SampleLesson"][];
        };
        /** @description O ebook com o estado do usuário, sem a URL do arquivo. */
        EbookView: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            summary: string | null;
            /** @description Markdown. */
            description: string | null;
            cover: components["schemas"]["ProductCover"] | null;
            accessMode: components["schemas"]["AccessMode"];
            /** @description Preço em centavos no modo `paid`; `null` em `open`. */
            priceCents: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays: number | null;
            authorName: string | null;
            pages: number | null;
            access: components["schemas"]["AccessState"];
            updatedAt: components["schemas"]["DateTime"];
        };
        EbookDownload: {
            /** @description URL externa do arquivo. */
            url: string;
        };
        /**
         * @description Fonte do direito (`specs/010-direitos-de-acesso.md`, "Fontes").
         * @enum {string}
         */
        EntitlementSource: "order" | "subscription" | "grant" | "cascade";
        MyEntitlement: {
            id: components["schemas"]["Uuid"];
            productType: components["schemas"]["ProductType"];
            productId: components["schemas"]["Uuid"];
            productSlug: components["schemas"]["Slug"];
            productTitle: string;
            source: components["schemas"]["EntitlementSource"];
            /** @description Produto de origem, quando o direito vem em cascata. */
            via: components["schemas"]["MyEntitlementVia"] | null;
            /** @enum {string} */
            state: "active" | "scheduled" | "expired";
            startsAt: components["schemas"]["DateTime"];
            /** @description `null` é vitalício. */
            expiresAt: components["schemas"]["DateTime"] | null;
        };
        MyEntitlementVia: {
            productType: components["schemas"]["ProductType"];
            productTitle: string;
        };
        MyEntitlementList: {
            items: components["schemas"]["MyEntitlement"][];
        };
        ShelfAccess: {
            /**
             * @description `open`: curso aberto, sem direito; `expired`: selo "acesso vencido".
             * @enum {string}
             */
            state: "active" | "expired" | "open";
            expiresAt: components["schemas"]["DateTime"] | null;
        };
        ShelfCourse: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            level: components["schemas"]["CourseLevel"] | null;
            cover: components["schemas"]["ProductCover"] | null;
            progress: components["schemas"]["ProgressCounts"];
            access: components["schemas"]["ShelfAccess"];
            /**
             * @description "Começar", "Continuar", "Rever" ou "Renovar acesso".
             * @enum {string}
             */
            action: "start" | "continue" | "review" | "renew";
            continueLessonId: components["schemas"]["Uuid"] | null;
            lastAccessedAt: components["schemas"]["DateTime"] | null;
            acquiredAt: components["schemas"]["DateTime"] | null;
            publishedAt: components["schemas"]["DateTime"];
            /** @description Estado do certificado; `null` com certificado desabilitado. */
            certificate: components["schemas"]["CourseCertificateState"] | null;
        };
        ShelfCounts: {
            all: number;
            inProgress: number;
            notStarted: number;
            completed: number;
            /** @description Horas de aula concluídas, em segundos. */
            completedLessonSeconds: number;
        };
        Shelf: {
            counts: components["schemas"]["ShelfCounts"];
            /** @description "Comece por aqui": com cursos e nenhum iniciado, o de aquisição mais recente. */
            startHereCourseId: components["schemas"]["Uuid"] | null;
            items: components["schemas"]["ShelfCourse"][];
        };
        ContinueItem: {
            course: {
                id: components["schemas"]["Uuid"];
                slug: components["schemas"]["Slug"];
                title: string;
                cover: components["schemas"]["ProductCover"] | null;
            };
            lesson: {
                id: components["schemas"]["Uuid"];
                title: string;
                positionSeconds: number | null;
            };
            progress: components["schemas"]["ProgressCounts"];
            lastOpenedAt: components["schemas"]["DateTime"];
        };
        ContinueList: {
            items: components["schemas"]["ContinueItem"][];
        };
        ProgressLesson: {
            id: components["schemas"]["Uuid"];
            title: string;
            completedAt: components["schemas"]["DateTime"] | null;
        };
        ProgressModule: {
            id: components["schemas"]["Uuid"];
            title: string;
            progress: components["schemas"]["ProgressCounts"];
            lessons: components["schemas"]["ProgressLesson"][];
        };
        CourseProgress: {
            courseId: components["schemas"]["Uuid"];
            progress: components["schemas"]["ProgressCounts"];
            modules: components["schemas"]["ProgressModule"][];
        };
        /** @description O estado gravado e o progresso recalculado do módulo e do curso. */
        LessonProgressResult: {
            lessonId: components["schemas"]["Uuid"];
            userState: components["schemas"]["LessonUserState"];
            module: {
                id: components["schemas"]["Uuid"];
                progress: components["schemas"]["ProgressCounts"];
            };
            course: {
                id: components["schemas"]["Uuid"];
                progress: components["schemas"]["ProgressCounts"];
            };
            /** @description Falso em aula amostra de curso que o aluno não tem: não entra no progresso. */
            countsForCourse: boolean;
        };
        MyProgressCourse: {
            course: {
                id: components["schemas"]["Uuid"];
                slug: components["schemas"]["Slug"];
                title: string;
            };
            progress: components["schemas"]["ProgressCounts"];
            modules: components["schemas"]["ProgressModule"][];
        };
        MyProgress: {
            items: components["schemas"]["MyProgressCourse"][];
        };
        ActivityDay: {
            date: components["schemas"]["Date"];
            total: number;
            lessonsCompleted: number;
            forumPosts: number;
            communityActions: number;
            /** @description Intensidade do quadrado (0 é o dia sem atividade, fora da lista). */
            level: number;
        };
        ActivityMap: {
            /** @description Fuso IANA usado no cálculo dos dias. */
            timezone: string;
            from: components["schemas"]["Date"];
            to: components["schemas"]["Date"];
            days: components["schemas"]["ActivityDay"][];
        };
        MyEbook: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            cover: components["schemas"]["ProductCover"] | null;
            authorName: string | null;
            pages: number | null;
            /** @description Fim do acesso; `null` é vitalício. */
            expiresAt: components["schemas"]["DateTime"] | null;
        };
        MyEbookList: {
            items: components["schemas"]["MyEbook"][];
        };
        /** @description A aula de uma nota, para o link de volta. */
        NoteLesson: {
            /** @description `null` quando a aula foi excluída. */
            id: components["schemas"]["Uuid"] | null;
            /**
             * @description Título atual enquanto `available`; o guardado na criação da nota quando a aula está
             *     despublicada, o curso despublicado ou arquivado, ou a aula foi excluída. `courseTitle`
             *     segue a mesma regra.
             */
            title: string;
            courseId: components["schemas"]["Uuid"] | null;
            courseSlug: string | null;
            courseTitle: string;
            /**
             * @description Falso com a aula despublicada ou excluída, ou o curso despublicado ou arquivado: a nota
             *     não tem link de volta. Verdadeiro não garante acesso: o link pode levar à tela de "sem
             *     acesso" da aula.
             */
            available: boolean;
        };
        /** @description Uma nota, privada do dono. */
        Note: {
            id: components["schemas"]["Uuid"];
            /** @description `null` na nota avulsa. */
            lesson: components["schemas"]["NoteLesson"] | null;
            videoSeconds: number | null;
            title: string | null;
            /** @description Markdown. */
            body: string;
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        NoteSummary: {
            id: components["schemas"]["Uuid"];
            lesson: components["schemas"]["NoteLesson"] | null;
            videoSeconds: number | null;
            title: string | null;
            /** @description Início do corpo, sem Markdown, até 300 caracteres. */
            excerpt: string;
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        NoteSummaryPage: components["schemas"]["Page"] & {
            items: components["schemas"]["NoteSummary"][];
        };
        NoteList: {
            items: components["schemas"]["Note"][];
        };
        /** @description `Problem` de `409` `version_conflict`, com a versão gravada da nota em `current`. */
        NoteConflictProblem: components["schemas"]["Problem"] & {
            current?: components["schemas"]["Note"];
        };
        MyCertificate: {
            id: components["schemas"]["Uuid"];
            /** @description Código com hífens. */
            code: string;
            state: components["schemas"]["CertificateState"];
            course: {
                id: components["schemas"]["Uuid"];
                slug: components["schemas"]["Slug"];
                title: string;
            };
            /** @description Título congelado na emissão. */
            courseTitle: string;
            /** @description Nome congelado na emissão. */
            studentName: string;
            hours: number;
            completedAt: components["schemas"]["DateTime"];
            issuedAt: components["schemas"]["DateTime"];
            revokedAt: components["schemas"]["DateTime"] | null;
            /**
             * Format: uri
             * @description Página pública de validação (`/certificados/<código>`).
             */
            validationUrl: string;
        };
        AwaitingCertificate: {
            course: {
                id: components["schemas"]["Uuid"];
                slug: components["schemas"]["Slug"];
                title: string;
            };
            completedAt: components["schemas"]["DateTime"];
        };
        MyCertificates: {
            /** @description O nome que sairá nos próximos certificados. */
            studentName: string;
            items: components["schemas"]["MyCertificate"][];
            /** @description Cursos concluídos cujo certificado ainda não foi liberado pelo instrutor. */
            awaitingTemplate: components["schemas"]["AwaitingCertificate"][];
        };
        CertificateName: {
            fullName: string | null;
            /** @description O nome que sairá no certificado. */
            studentName: string;
        };
        /**
         * @description `holder_removed`: o titular excluiu a conta; o nome não aparece.
         * @enum {string}
         */
        CertificateVerificationStatus: "valid" | "revoked" | "holder_removed";
        /** @description Resultado da validação pública. Revogado mostra só o estado e a data, sem o motivo. */
        CertificateVerification: {
            status: components["schemas"]["CertificateVerificationStatus"];
            code: string;
            /** @description Só em `valid`. */
            studentName: string | null;
            /** @description Em `valid` e `holder_removed`. */
            courseTitle: string | null;
            /** @description Só em `valid`. */
            hours: number | null;
            /** @description Em `valid` e `holder_removed`. */
            completedAt: components["schemas"]["DateTime"] | null;
            /** @description Em `valid` e `holder_removed`. */
            issuedAt: components["schemas"]["DateTime"] | null;
            /** @description Só em `valid`. */
            schoolName: string | null;
            /** @description Só em `revoked`. */
            revokedAt: components["schemas"]["DateTime"] | null;
        };
        /**
         * @description Tipo do documento fiscal do comprador (`specs/011-vendas-e-checkout.md`).
         * @enum {string}
         */
        TaxIdType: "cpf" | "cnpj";
        /**
         * @description Provedor de pagamento do pedido ou da cobrança (`NUVA_PAYMENT_PROVIDER`); `none` no pedido de
         *     total zero, que não passa pelo provedor.
         * @enum {string}
         */
        PaymentProviderName: "mercadopago" | "fake" | "none";
        /**
         * @description Estado normalizado da cobrança no provedor (`specs/013-pagamentos-mercado-pago.md`).
         * @enum {string}
         */
        PaymentStatus: "pending" | "approved" | "rejected" | "canceled" | "refunded" | "partially_refunded" | "charged_back";
        /**
         * @description Meio de pagamento informado pelo provedor; `other` quando não é um dos três.
         * @enum {string}
         */
        PaymentMethod: "card" | "pix" | "boleto" | "other";
        /**
         * @description Estado do pedido do comprador (`specs/011-vendas-e-checkout.md`, "Pedido e seus estados").
         *     `draft` não aparece aqui: é resto de tentativa que não chegou ao provedor e não é pedido do
         *     aluno. `chargeback` revoga o acesso.
         * @enum {string}
         */
        OrderStatus: "pending" | "paid" | "partially_refunded" | "refunded" | "canceled" | "expired" | "chargeback";
        /**
         * @description Aviso que não bloqueia a compra (`specs/011-vendas-e-checkout.md`, "Cesta"):
         *     `bundle_item_owned` (o aluno já tem um dos itens do pacote), `subscription_covered` (o
         *     produto já é coberto por assinatura ativa; o avulso sobrevive ao fim dela) ou
         *     `time_limited_access` (o aluno já tem o produto com validade; a compra estende o acesso).
         * @enum {string}
         */
        CartItemWarning: "bundle_item_owned" | "subscription_covered" | "time_limited_access";
        /**
         * @description Por que o item não pode ser comprado agora: despublicado, arquivado ou fora do modo `paid`.
         *     O item continua na cesta para o aluno decidir entre remover ou esperar a republicação.
         * @enum {string}
         */
        CartItemUnsellableReason: "unpublished" | "archived" | "not_paid";
        /** @description Produto de onde o direito em cascata vem, para explicar a árvore na cesta. */
        CartUnlockVia: {
            productType: components["schemas"]["ProductType"];
            title: string;
        };
        /** @description Produto que a compra do item libera, além do próprio item (`specs/010-direitos-de-acesso.md`, "Algoritmo de concessão"). */
        CartUnlock: {
            productType: components["schemas"]["ProductType"];
            productId: components["schemas"]["Uuid"];
            title: string;
            /**
             * @description Curso do pacote de onde vem o ebook, quando é o caso; `null` para o próprio item e para
             *     os filhos diretos dele (cursos e ebooks do pacote, ebooks do curso).
             */
            via: components["schemas"]["CartUnlockVia"] | null;
        };
        /** @description Um produto na cesta, com o preço atual e o que a compra libera. */
        CartItem: {
            id: components["schemas"]["Uuid"];
            productType: components["schemas"]["ProductType"];
            productId: components["schemas"]["Uuid"];
            title: string;
            cover: components["schemas"]["ProductCover"] | null;
            accessMode: components["schemas"]["AccessMode"];
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays: number | null;
            /** @description Preço atual do produto; `null` quando o produto deixou de ter preço. */
            unitPriceCents: number | null;
            /**
             * @description Parte do desconto do cupom rateada neste item, pela regra de `specs/011-vendas-e-checkout.md`
             *     ("Cupons"); zero sem cupom válido ou com item fora da restrição de produtos.
             */
            discountCents: number;
            /** @description O cupom aplicado vale para este produto. */
            couponEligible: boolean;
            /** @description O item pode ser comprado agora. */
            sellable: boolean;
            /** @description `null` quando `sellable`. */
            unsellableReason: components["schemas"]["CartItemUnsellableReason"] | null;
            /** @description Avisos que não impedem a compra; vazio quando não há. */
            warnings: components["schemas"]["CartItemWarning"][];
            /** @description O que a compra libera além do item, na ordem do algoritmo de concessão; vazio em ebook. */
            unlocks: components["schemas"]["CartUnlock"][];
            addedAt: components["schemas"]["DateTime"];
        };
        /** @description Cupom aplicado à cesta, com o estado atual da validade. */
        CartCoupon: {
            code: string;
            /** @enum {string} */
            kind: "percent" | "fixed";
            percentOff: number | null;
            amountOffCents: number | null;
            /** @description O cupom ainda vale para esta cesta; quando falso, nenhum desconto é aplicado. */
            valid: boolean;
            /** @description `null` quando `valid`. */
            invalidReason: ("expired" | "exhausted" | "inactive" | "not_eligible") | null;
        };
        /** @description A cesta aberta do aluno. */
        Cart: {
            items: components["schemas"]["CartItem"][];
            /** @description `null` sem cupom aplicado. */
            coupon: components["schemas"]["CartCoupon"] | null;
            itemCount: number;
            subtotalCents: components["schemas"]["MoneyCents"];
            discountCents: components["schemas"]["MoneyCents"];
            totalCents: components["schemas"]["MoneyCents"];
            currency: components["schemas"]["CurrencyCode"];
            updatedAt: components["schemas"]["DateTime"];
        };
        /** @description Dados de comprador guardados no usuário (`specs/011-vendas-e-checkout.md`, "Dados do comprador"). */
        Billing: {
            fullName: string | null;
            taxIdType: components["schemas"]["TaxIdType"] | null;
            /** @description Só os caracteres do documento, sem pontuação; nunca vai para logs. */
            taxId: string | null;
            /** @description Nome e documento válidos guardados; a finalização exige `true`. */
            complete: boolean;
        };
        /** @description Um item do pedido, só com o necessário para a lista. */
        OrderProductRef: {
            productType: components["schemas"]["ProductType"];
            productId: components["schemas"]["Uuid"];
            /** @description Título congelado no fechamento do pedido. */
            title: string;
        };
        /** @description Um item do pedido, com os valores congelados no fechamento. */
        OrderItem: {
            id: components["schemas"]["Uuid"];
            productType: components["schemas"]["ProductType"];
            productId: components["schemas"]["Uuid"];
            title: string;
            /** @description Dias de acesso congelados; `null` é vitalício. */
            accessDays: number | null;
            unitPriceCents: components["schemas"]["MoneyCents"];
            discountCents: components["schemas"]["MoneyCents"];
            /** @description Preço menos o desconto rateado; o valor efetivamente pago. */
            paidCents: components["schemas"]["MoneyCents"];
            refundedCents: components["schemas"]["MoneyCents"];
        };
        /** @description A cobrança conhecida do pedido (a mais recente). */
        MyPayment: {
            method: components["schemas"]["PaymentMethod"];
            status: components["schemas"]["PaymentStatus"];
            amountCents: components["schemas"]["MoneyCents"];
            refundedCents: components["schemas"]["MoneyCents"];
            currency: components["schemas"]["CurrencyCode"];
            /** @enum {string} */
            provider: "mercadopago" | "fake";
            /** @description Identificador da cobrança no provedor; serve de comprovante junto da página dele. */
            providerPaymentId: string;
            paidAt: components["schemas"]["DateTime"] | null;
        };
        /** @description Um pedido do aluno na lista. */
        MyOrderSummary: {
            id: components["schemas"]["Uuid"];
            /** @description Número legível e sequencial do pedido, com saltos aceitos. */
            number: number;
            status: components["schemas"]["OrderStatus"];
            itemCount: number;
            items: components["schemas"]["OrderProductRef"][];
            subtotalCents: components["schemas"]["MoneyCents"];
            discountCents: components["schemas"]["MoneyCents"];
            totalCents: components["schemas"]["MoneyCents"];
            currency: components["schemas"]["CurrencyCode"];
            createdAt: components["schemas"]["DateTime"];
            paidAt: components["schemas"]["DateTime"] | null;
            /** @description Prazo do `pending`; `null` fora dele. */
            expiresAt: components["schemas"]["DateTime"] | null;
            /** @description Meio da cobrança conhecida; `null` antes da primeira cobrança. */
            paymentMethod: components["schemas"]["PaymentMethod"] | null;
        };
        MyOrderPage: components["schemas"]["Page"] & {
            items: components["schemas"]["MyOrderSummary"][];
        };
        /** @description O pedido do aluno, com os valores congelados e a cobrança conhecida. */
        MyOrderDetail: {
            id: components["schemas"]["Uuid"];
            number: number;
            status: components["schemas"]["OrderStatus"];
            subtotalCents: components["schemas"]["MoneyCents"];
            discountCents: components["schemas"]["MoneyCents"];
            totalCents: components["schemas"]["MoneyCents"];
            currency: components["schemas"]["CurrencyCode"];
            /** @description Código do cupom congelado no pedido; `null` sem cupom. */
            couponCode: string | null;
            buyerName: string;
            buyerTaxIdType: components["schemas"]["TaxIdType"];
            /** @description Documento do próprio comprador, sem pontuação; nunca vai para logs. */
            buyerTaxId: string;
            provider: components["schemas"]["PaymentProviderName"];
            /**
             * Format: uri
             * @description Página de pagamento do provedor enquanto o pedido está `pending` e o provedor não é
             *     `none`; `null` depois de pago, reembolsado, cancelado, expirado ou em pedido de total
             *     zero. Com Checkout Pro, Pix e boleto são pagos nessa página: a API não recebe QR nem
             *     código de barras.
             */
            checkoutUrl: string | null;
            createdAt: components["schemas"]["DateTime"];
            paidAt: components["schemas"]["DateTime"] | null;
            /** @description Prazo do `pending` (30 min no cartão e no Pix, 3 dias no boleto); `null` fora dele. */
            expiresAt: components["schemas"]["DateTime"] | null;
            items: components["schemas"]["OrderItem"][];
            /** @description `null` até a primeira cobrança ser conhecida. */
            payment: components["schemas"]["MyPayment"] | null;
        };
        /** @description Resultado de fechar a cesta. */
        OrderCheckout: {
            order: components["schemas"]["MyOrderDetail"];
            /**
             * Format: uri
             * @description Para onde o navegador vai pagar; `null` no pedido de total zero, já `paid` com
             *     `provider: none`.
             */
            checkoutUrl: string | null;
        };
        /**
         * @description Periodicidade da cobrança do plano (`specs/012-assinaturas.md`, "Planos").
         * @enum {string}
         */
        PlanInterval: "month" | "year";
        /** @description Produto liberado por um plano, com o título atual. */
        PlanItem: {
            productType: components["schemas"]["ProductType"];
            productId: components["schemas"]["Uuid"];
            title: string;
        };
        /**
         * @description Um plano na vitrine (`specs/012-assinaturas.md`, "Planos"). Sem `includesPrivate`: plano
         *     que inclui produtos `private` não os anuncia (`specs/009-catalogo-e-conteudo.md`).
         */
        PublicPlan: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            description: string | null;
            interval: components["schemas"]["PlanInterval"];
            /** @description Preço por período, maior que zero. */
            priceCents: components["schemas"]["MoneyCents"];
            /**
             * @description Verdadeiro = todo produto publicado `paid` ou `open`, atual e futuro; nesse caso
             *     `items` vem vazia.
             */
            includesAll: boolean;
            /**
             * @description Produtos explícitos quando `includesAll` é falso. Item não publicado ou `private` é
             *     omitido.
             */
            items: components["schemas"]["PlanItem"][];
            position: number;
        };
        /** @description Periodicidades do mesmo conteúdo (`groupKey`), para a vitrine alternar mensal e anual. */
        PlanGroup: {
            /** @description Chave que agrupa os planos; a mesma nas duas periodicidades. */
            groupKey: string;
            /** @description Um plano por periodicidade, `month` antes de `year`. */
            plans: components["schemas"]["PublicPlan"][];
        };
        /** @description A vitrine de planos, agrupada por conteúdo. */
        PlanCatalog: {
            /** @description Grupos dos planos ativos; vazio quando não há plano ativo. */
            groups: components["schemas"]["PlanGroup"][];
            currency: components["schemas"]["CurrencyCode"];
        };
        /**
         * @description Estado da assinatura (`specs/012-assinaturas.md`, "Ciclo de vida"). `pending` aguarda a
         *     primeira cobrança; `active` está em dia; `past_due` está em carência, com acesso;
         *     `suspended` perdeu o acesso; `canceling` foi cancelada e mantém o acesso até
         *     `currentPeriodEnd`; `ended` encerrou; `expired` nunca foi paga.
         * @enum {string}
         */
        SubscriptionStatus: "pending" | "active" | "past_due" | "suspended" | "canceling" | "ended" | "expired";
        /** @description O plano da assinatura, na forma resumida. */
        SubscriptionPlanRef: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            interval: components["schemas"]["PlanInterval"];
        };
        /** @description Uma assinatura do aluno na lista. */
        MySubscriptionSummary: {
            id: components["schemas"]["Uuid"];
            plan: components["schemas"]["SubscriptionPlanRef"];
            status: components["schemas"]["SubscriptionStatus"];
            /**
             * @description Preço contratado, copiado do plano na criação; mudança posterior do plano não o
             *     altera (`specs/012-assinaturas.md`, "Planos").
             */
            priceCents: components["schemas"]["MoneyCents"];
            currency: components["schemas"]["CurrencyCode"];
            /** @description `null` em `pending` e `expired`. */
            currentPeriodStart: components["schemas"]["DateTime"] | null;
            /**
             * @description Fim do período pago; com a carência, é a referência do acesso em `active`,
             *     `past_due` e `canceling`. É também quando o acesso cai sozinho, mesmo com o worker
             *     parado.
             */
            currentPeriodEnd: components["schemas"]["DateTime"] | null;
            /**
             * @description Fim da carência de 3 dias (`NUVA_SUBSCRIPTION_GRACE_DAYS`); preenchido em `past_due`
             *     e `suspended`, `null` nos demais.
             */
            graceUntil: components["schemas"]["DateTime"] | null;
            /**
             * @description Próxima renovação prevista: `currentPeriodEnd` em `active`; `null` nos demais (em
             *     `past_due`, o provedor tenta de novo conforme a política dele e não há data exposta;
             *     em `canceling`, não há próxima cobrança).
             */
            nextChargeAt: components["schemas"]["DateTime"] | null;
            /** @description Quando o cancelamento foi pedido; `null` sem cancelamento. */
            canceledAt: components["schemas"]["DateTime"] | null;
            /** @description `null` fora de `ended`. */
            endedAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
        };
        MySubscriptionPage: components["schemas"]["Page"] & {
            items: components["schemas"]["MySubscriptionSummary"][];
        };
        /**
         * @description Uma cobrança da assinatura (`specs/013-pagamentos-mercado-pago.md`), sem dado de cartão e
         *     sem o corpo do provedor.
         */
        SubscriptionCharge: {
            id: components["schemas"]["Uuid"];
            status: components["schemas"]["PaymentStatus"];
            method: components["schemas"]["PaymentMethod"];
            amountCents: components["schemas"]["MoneyCents"];
            refundedCents: components["schemas"]["MoneyCents"];
            currency: components["schemas"]["CurrencyCode"];
            /** @enum {string} */
            provider: "mercadopago" | "fake";
            providerPaymentId: string;
            paidAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
        };
        /**
         * @description A assinatura do aluno com o plano atual, o período e o histórico de cobranças
         *     (`specs/012-assinaturas.md`, "Minha assinatura").
         */
        MySubscriptionDetail: {
            id: components["schemas"]["Uuid"];
            /**
             * @description O plano agora, com os itens que ele libera; o preço contratado é `priceCents` desta
             *     assinatura, não o do plano.
             */
            plan: components["schemas"]["PublicPlan"];
            status: components["schemas"]["SubscriptionStatus"];
            /** @description Preço contratado na criação da assinatura. */
            priceCents: components["schemas"]["MoneyCents"];
            currency: components["schemas"]["CurrencyCode"];
            currentPeriodStart: components["schemas"]["DateTime"] | null;
            currentPeriodEnd: components["schemas"]["DateTime"] | null;
            graceUntil: components["schemas"]["DateTime"] | null;
            nextChargeAt: components["schemas"]["DateTime"] | null;
            canceledAt: components["schemas"]["DateTime"] | null;
            endedAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
            /** @description Histórico de cobranças, da mais recente para a mais antiga. */
            payments: components["schemas"]["SubscriptionCharge"][];
        };
        /** @description Resultado de assinar um plano. */
        SubscriptionCheckout: {
            /** @description A assinatura recém-criada, em `pending`, sem cobranças ainda. */
            subscription: components["schemas"]["MySubscriptionDetail"];
            /**
             * Format: uri
             * @description Página do provedor para o aluno autorizar a cobrança recorrente e pagar a primeira
             *     cobrança. O arranjo do provedor para a primeira cobrança com cupom é interno a ele
             *     (`specs/013-pagamentos-mercado-pago.md`, "Implementação Mercado Pago"); o retorno
             *     leva o aluno à página da assinatura, em `/conta/compras`.
             */
            checkoutUrl: string;
        };
    };
    responses: {
        /**
         * @description Requisição fora do contrato (`validation_failed`); `errors` lista os campos. Vale também
         *     para operação sem parâmetros: cabeçalho ou URL malformados são recusados antes da rota.
         */
        BadRequest: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Sem sessão válida. */
        Unauthorized: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description Sem permissão para a operação (`permission_denied`), escrita sem `X-CSRF-Token` válido
         *     (`csrf_token_invalid`) ou outra recusa de acesso com `code` próprio.
         */
        Forbidden: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Recurso inexistente ou fora do alcance de quem pede. */
        NotFound: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Conflito de estado, com `code` próprio (por exemplo, `version_conflict`). */
        Conflict: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description Corpo acima do limite da rota (`payload_too_large`): 1 MB, ou 5 MB no envio de imagem.
         *     A rota não roda.
         */
        PayloadTooLarge: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description `Content-Type` que a operação não declara em `requestBody.content`, ou que o serviço não
         *     sabe ler (`unsupported_media_type`). A rota não roda.
         */
        UnsupportedMediaType: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Regra de negócio impede a operação; o `code` é o da regra. */
        UnprocessableEntity: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Limite de taxa atingido (`rate_limited`); `retryAfterSeconds` repete o `Retry-After`. */
        TooManyRequests: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                "Retry-After": components["headers"]["RetryAfter"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Erro inesperado (`internal_error`), sem `detail`. */
        InternalError: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Dependência indisponível (banco ou provedor externo). */
        ServiceUnavailable: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description Limite de taxa (`rate_limited`) ou bloqueio por tentativas erradas de senha, da conta ou
         *     do IP (`too_many_attempts`; `specs/007-contas-e-autenticacao.md`, "Bloqueio e dispositivo
         *     novo"). `Retry-After` e `retryAfterSeconds` trazem os segundos até poder tentar de novo.
         */
        TooManyAttempts: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                "Retry-After": components["headers"]["RetryAfter"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description A variante, em WebP. */
        ImageVariant: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                ETag: components["headers"]["ETag"];
                "Cache-Control": components["headers"]["ImageCacheControl"];
                "X-Content-Type-Options": components["headers"]["ContentTypeOptions"];
                [name: string]: unknown;
            };
            content: {
                "image/webp": string;
            };
        };
        /** @description O `If-None-Match` é igual ao `ETag` atual; sem corpo. */
        ImageNotModified: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                ETag: components["headers"]["ETag"];
                "Cache-Control": components["headers"]["ImageCacheControl"];
                [name: string]: unknown;
            };
            content?: never;
        };
        /** @description Link vencido, já usado ou desconhecido (`token_expired`). */
        Gone: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /**
         * @description Volta ao próprio site (`Location`), conforme a tabela da descrição da operação. Abre a
         *     sessão (`Set-Cookie` de `nuva_classroom_session`) quando entrou, e regrava ou apaga o
         *     cookie de retorno (`nuva_classroom_oauth`).
         */
        OAuthReturn: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                Location: components["headers"]["Location"];
                "Set-Cookie": components["headers"]["SetCookie"];
                [name: string]: unknown;
            };
            content?: never;
        };
        /**
         * @description O arquivo PDF. `Content-Disposition` sugere o nome do arquivo; a resposta não é guardada em
         *     cache.
         */
        Pdf: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                "Cache-Control": components["headers"]["NoStore"];
                "Content-Disposition": components["headers"]["ContentDisposition"];
                "X-Content-Type-Options": components["headers"]["ContentTypeOptions"];
                [name: string]: unknown;
            };
            content: {
                "application/pdf": string;
            };
        };
        /**
         * @description Sem acesso ao conteúdo (`access_denied`, com `reason`), sem permissão (`permission_denied`) ou
         *     escrita sem `X-CSRF-Token` válido (`csrf_token_invalid`).
         */
        AccessDenied: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["AccessDeniedProblem"];
            };
        };
        /** @description A nota mudou em outro dispositivo (`version_conflict`), com a versão atual. */
        NoteConflict: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["NoteConflictProblem"];
            };
        };
    };
    parameters: {
        /** @description Quantidade de itens por página. */
        Limit: number;
        /** @description Valor de `nextCursor` da página anterior. Ausente na primeira página. */
        Cursor: components["schemas"]["Cursor"];
        /** @description Chave escolhida pelo cliente; a repetição devolve a primeira resposta por 24 h. */
        IdempotencyKey: string;
        /** @description Identificador do recurso. */
        IdPath: components["schemas"]["Uuid"];
        /**
         * @description Provedor de login social. Provedor sem as variáveis configuradas nesta instalação (fora de
         *     `authProviders` em `GET /api/v1/meta`) responde `404`.
         */
        AuthProviderPath: components["schemas"]["AuthProvider"];
        /**
         * @description Caminho do próprio site para onde o navegador volta depois do login (começa com `/`, não
         *     com `//`). Outro valor, ou ausente, vira `/`; nunca é recusado.
         */
        ReturnTo: string;
        /** @description Identificador da imagem. */
        ImageIdPath: components["schemas"]["Uuid"];
        /**
         * @description Largura da variante, em pixels. Cada imagem só tem as variantes da sua finalidade
         *     (`specs/029-imagens.md`, "Finalidades e variantes"); outra largura responde `404`.
         */
        ImageVariantPath: components["schemas"]["ImageVariantWidth"];
        /** @description `ETag` de uma entrega anterior. Igual ao atual, a resposta é `304`, sem corpo. */
        IfNoneMatch: string;
        /**
         * @description `id` do último evento recebido; o navegador o envia sozinho ao reconectar. Valor que não
         *     é um inteiro em texto: `400`.
         */
        LastEventId: components["schemas"]["StreamEventId"];
        /** @description Itens por página da central (padrão 20, máximo 50). */
        NotificationLimit: number;
        /**
         * @description Token do link de descadastro: 64 caracteres hexadecimais, gravado em
         *     `notification_unsubscribe_tokens`. Outro formato ou token desconhecido responde `404`.
         */
        UnsubscribeTokenPath: string;
        /** @description Identificador legível do produto na URL (único por tipo de produto). */
        SlugPath: components["schemas"]["Slug"];
    };
    requestBodies: never;
    headers: {
        /** @description Identificador da requisição, o mesmo que aparece nos logs. */
        XRequestId: string;
        /** @description Segundos até poder tentar de novo. */
        RetryAfter: number;
        /** @description Endereço para onde o navegador é redirecionado. */
        Location: string;
        /**
         * @description Grava ou apaga um cookie do site: o da sessão ou o de retorno do login social
         *     (`specs/007-contas-e-autenticacao.md`, "Cookies"). Os dois são `HttpOnly`: o site não os
         *     lê; o navegador os guarda e reenvia sozinho.
         */
        SetCookie: string;
        /** @description Sempre `no-store`; a resposta não é guardada em cache. */
        NoStore: "no-store";
        /** @description Hash do conteúdo da variante; muda quando o conteúdo muda. */
        ETag: string;
        /** @description Sempre `public, max-age=31536000, immutable`: a URL de uma imagem nunca muda de conteúdo. */
        ImageCacheControl: "public, max-age=31536000, immutable";
        /** @description Sempre `nosniff`. */
        ContentTypeOptions: "nosniff";
        /** @description Sempre `attachment`, com o nome sugerido do arquivo (`filename`). */
        ContentDisposition: string;
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O processo responde. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    getReadiness: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pronto. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Readiness"];
                };
            };
            /** @description Não pronto; `checks` indica o que falhou. */
            503: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Readiness"];
                };
            };
        };
    };
    getMeta: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Dados da instalação. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Meta"];
                };
            };
            400: components["responses"]["BadRequest"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    openStream: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description `id` do último evento recebido; o navegador o envia sozinho ao reconectar. Valor que não
                 *     é um inteiro em texto: `400`.
                 */
                "Last-Event-ID"?: components["parameters"]["LastEventId"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Fluxo aberto; a resposta só termina quando a conexão cai. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    /** @description Sempre `no-store`. */
                    "Cache-Control"?: "no-store";
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    register: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Nome de exibição. */
                    name: string;
                    email: components["schemas"]["Email"];
                    /** @description 8 a 128 caracteres, sem outra regra; fora disso, `password_invalid`. */
                    password: string;
                    /**
                     * @description `id` das versões vigentes (`terms` e `privacy`) que o usuário aceitou, como
                     *     vêm em `GET /api/v1/legal/{document}`.
                     */
                    acceptedTerms: components["schemas"]["Uuid"][];
                };
            };
        };
        responses: {
            /** @description Pedido aceito (conta nova ou e-mail já cadastrado; a resposta é a mesma). */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    login: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: components["schemas"]["Email"];
                    /** @description Sem regra de tamanho aqui; qualquer valor errado é `invalid_credentials`. */
                    password: string;
                };
            };
        };
        responses: {
            /** @description Sessão aberta. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    "Set-Cookie": components["headers"]["SetCookie"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            429: components["responses"]["TooManyAttempts"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sessão encerrada; o cookie é apagado. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    "Set-Cookie": components["headers"]["SetCookie"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A sessão atual. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    "Cache-Control": components["headers"]["NoStore"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    verifyEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EmailTokenRequest"];
            };
        };
        responses: {
            /** @description E-mail confirmado. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    resendVerificationEmail: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pedido aceito. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    requestPasswordReset: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: components["schemas"]["Email"];
                };
            };
        };
        responses: {
            /** @description Pedido aceito (a resposta não diz se a conta existe). */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    resetPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    token: components["schemas"]["EmailToken"];
                    /** @description Nova senha, 8 a 128 caracteres; fora disso, `password_invalid`. */
                    password: string;
                };
            };
        };
        responses: {
            /** @description Senha definida. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            410: components["responses"]["Gone"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    startOAuth: {
        parameters: {
            query?: {
                /** @description `login` entra ou cadastra; `link` vincula à conta da sessão. */
                intent?: "login" | "link";
                /**
                 * @description Caminho do próprio site para onde o navegador volta depois do login (começa com `/`, não
                 *     com `//`). Outro valor, ou ausente, vira `/`; nunca é recusado.
                 */
                returnTo?: components["parameters"]["ReturnTo"];
            };
            header?: never;
            path: {
                /**
                 * @description Provedor de login social. Provedor sem as variáveis configuradas nesta instalação (fora de
                 *     `authProviders` em `GET /api/v1/meta`) responde `404`.
                 */
                provider: components["parameters"]["AuthProviderPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Redireciona para a autorização do provedor. */
            302: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    Location: components["headers"]["Location"];
                    "Set-Cookie": components["headers"]["SetCookie"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    oauthCallback: {
        parameters: {
            query?: {
                code?: string;
                state?: string;
                /** @description Enviado pelo provedor quando o usuário recusa ou algo falha lá. */
                error?: string;
            };
            header?: never;
            path: {
                /**
                 * @description Provedor de login social. Provedor sem as variáveis configuradas nesta instalação (fora de
                 *     `authProviders` em `GET /api/v1/meta`) responde `404`.
                 */
                provider: components["parameters"]["AuthProviderPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            302: components["responses"]["OAuthReturn"];
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    oauthCallbackForm: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Provedor de login social. Provedor sem as variáveis configuradas nesta instalação (fora de
                 *     `authProviders` em `GET /api/v1/meta`) responde `404`.
                 */
                provider: components["parameters"]["AuthProviderPath"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/x-www-form-urlencoded": {
                    code?: string;
                    state?: string;
                    id_token?: string;
                    /** @description JSON em texto com `name` e `email`, enviado só na primeira vez. */
                    user?: string;
                    error?: string;
                };
            };
        };
        responses: {
            302: components["responses"]["OAuthReturn"];
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getSocialPending: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O cadastro pendente. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    "Cache-Control": components["headers"]["NoStore"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SocialPending"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    completeSocialSignup: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    acceptedTerms: components["schemas"]["Uuid"][];
                    email?: components["schemas"]["Email"];
                };
            };
        };
        responses: {
            /** @description Conta criada e sessão aberta. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    "Set-Cookie": components["headers"]["SetCookie"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Session"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    setAccountPassword: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description 8 a 128 caracteres; fora disso, `password_invalid`. */
                    newPassword: string;
                    /** @description Exigida quando a conta já tem senha. */
                    currentPassword?: string;
                };
            };
        };
        responses: {
            /** @description Senha definida. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyAttempts"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listAccountIdentities: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Métodos de acesso. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["IdentityList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    unlinkAccountIdentity: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Provedor de login social. Provedor sem as variáveis configuradas nesta instalação (fora de
                 *     `authProviders` em `GET /api/v1/meta`) responde `404`.
                 */
                provider: components["parameters"]["AuthProviderPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Vínculo removido. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listAccountSessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sessões abertas. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionInfoList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    revokeOtherAccountSessions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Outras sessões encerradas. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    revokeAccountSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Sessão encerrada. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    setAvatar: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    imageId: components["schemas"]["Uuid"] | null;
                };
            };
        };
        responses: {
            /** @description Avatar atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AvatarResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getLegalDocument: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                document: components["schemas"]["TermsDocument"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A versão vigente. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LegalDocument"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    acceptTerms: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    termsVersionIds: components["schemas"]["Uuid"][];
                };
            };
        };
        responses: {
            /** @description Aceites gravados. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    uploadImage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    purpose: components["schemas"]["ImagePurpose"];
                    /** @description O arquivo da imagem (JPEG, PNG ou WebP), até 5 MB. */
                    file: string;
                };
            };
        };
        responses: {
            /** @description Imagem gravada. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Image"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            /**
             * @description Processamento de imagens sobrecarregado (`image_processing_busy`, com `Retry-After`)
             *     ou banco indisponível (`database_unavailable`).
             */
            503: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    "Retry-After": components["headers"]["RetryAfter"];
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    deleteImage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador da imagem. */
                imageId: components["parameters"]["ImageIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Imagem apagada. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getImageVariant: {
        parameters: {
            query?: never;
            header?: {
                /** @description `ETag` de uma entrega anterior. Igual ao atual, a resposta é `304`, sem corpo. */
                "If-None-Match"?: components["parameters"]["IfNoneMatch"];
            };
            path: {
                /** @description Identificador da imagem. */
                imageId: components["parameters"]["ImageIdPath"];
                /**
                 * @description Largura da variante, em pixels. Cada imagem só tem as variantes da sua finalidade
                 *     (`specs/029-imagens.md`, "Finalidades e variantes"); outra largura responde `404`.
                 */
                variant: components["parameters"]["ImageVariantPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["ImageVariant"];
            304: components["responses"]["ImageNotModified"];
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listCatalog: {
        parameters: {
            query?: {
                type?: components["schemas"]["ProductType"];
                level?: components["schemas"]["CourseLevel"];
                /** @description `free`: modo `open` ou preço 0; `paid`: preço acima de 0. */
                price?: "free" | "paid";
                /** @description Busca no título e no resumo. */
                q?: string;
                sort?: "-publishedAt" | "title" | "priceCents" | "-priceCents";
                /** @description Quantidade de itens por página. */
                limit?: components["parameters"]["Limit"];
                /** @description Valor de `nextCursor` da página anterior. Ausente na primeira página. */
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Uma página da vitrine. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogItemPage"];
                };
            };
            400: components["responses"]["BadRequest"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCatalogProduct: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                type: components["schemas"]["ProductType"];
                /** @description Identificador legível do produto na URL (único por tipo de produto). */
                slug: components["parameters"]["SlugPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O produto. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CatalogProduct"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCourse: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador legível do produto na URL (único por tipo de produto). */
                slug: components["parameters"]["SlugPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O curso. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseView"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getLesson: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A aula. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LessonView"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["AccessDenied"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listSampleLessons: {
        parameters: {
            query?: {
                /** @description `false` inclui as de cursos a que o usuário já tem acesso. */
                excludeOwned?: boolean;
                /** @description Quantidade de itens por página. */
                limit?: components["parameters"]["Limit"];
                /** @description Valor de `nextCursor` da página anterior. Ausente na primeira página. */
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Uma página de aulas amostra. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SampleLessonPage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getEbook: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador legível do produto na URL (único por tipo de produto). */
                slug: components["parameters"]["SlugPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O ebook. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EbookView"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getEbookDownload: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A URL do arquivo. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    "Cache-Control": components["headers"]["NoStore"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EbookDownload"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["AccessDenied"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listMyEntitlements: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Os direitos. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyEntitlementList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listMyCourses: {
        parameters: {
            query?: {
                filter?: "all" | "in_progress" | "not_started" | "completed";
                /** @description Trecho do título. */
                q?: string;
                sort?: "-lastAccessedAt" | "-publishedAt" | "title" | "-percent";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A estante. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Shelf"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listContinueWatching: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Os cursos em andamento. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContinueList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCourseProgress: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador legível do produto na URL (único por tipo de produto). */
                slug: components["parameters"]["SlugPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O progresso. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseProgress"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    saveLessonProgress: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    completed?: boolean;
                    /** @description Obrigatório com `completed: true`; ignorado nos demais. */
                    completedVia?: components["schemas"]["CompletionVia"];
                    /** @description Posição do vídeo, em segundos. */
                    positionSeconds?: number | null;
                };
            };
        };
        responses: {
            /** @description Progresso gravado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LessonProgressResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["AccessDenied"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getMyProgress: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O progresso por curso. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyProgress"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getMyActivity: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O mapa. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActivityMap"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listMyEbooks: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Os ebooks. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyEbookList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listNotes: {
        parameters: {
            query?: {
                q?: string;
                /** @description `lesson`: só as de aula; `standalone`: só as avulsas. */
                kind?: "lesson" | "standalone";
                courseId?: components["schemas"]["Uuid"];
                /** @description Quantidade de notas por página. */
                limit?: number;
                /** @description Valor de `nextCursor` da página anterior. Ausente na primeira página. */
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Uma página de notas. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoteSummaryPage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createNote: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    lessonId?: components["schemas"]["Uuid"] | null;
                    title?: string | null;
                    /** @description Markdown, até 20.000 caracteres. */
                    body: string;
                    /**
                     * @description Instante do vídeo em segundos, só em nota de aula. A fração é descartada (`83.9`
                     *     vira `83`). Inválido: `422` `note_video_seconds_invalid`.
                     */
                    videoSeconds?: number | null;
                };
            };
        };
        responses: {
            /** @description Nota criada. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Note"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["AccessDenied"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getNote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A nota. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Note"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    deleteNote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Nota excluída. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateNote: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title?: string | null;
                    body?: string;
                    /**
                     * @description `null` remove o instante. Só em nota de aula; a fração é descartada. Inválido:
                     *     `422` `note_video_seconds_invalid`.
                     */
                    videoSeconds?: number | null;
                    /** @description O `updatedAt` da nota lida. */
                    updatedAt: components["schemas"]["DateTime"];
                };
            };
        };
        responses: {
            /** @description Nota gravada. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Note"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["NoteConflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listLessonNotes: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description As notas da aula. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NoteList"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listMyCertificates: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Os certificados. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyCertificates"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getMyCertificatePdf: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["Pdf"];
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    setCertificateName: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    fullName: string | null;
                };
            };
        };
        responses: {
            /** @description Nome gravado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificateName"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    verifyCertificate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description O código do certificado. */
                code: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O certificado existe. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificateVerification"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCart: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A cesta aberta. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Cart"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    addCartItem: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    productType: components["schemas"]["ProductType"];
                    productId: components["schemas"]["Uuid"];
                };
            };
        };
        responses: {
            /** @description Item acrescentado; a resposta é a cesta inteira. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Cart"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    removeCartItem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Item removido; a cesta fica sem ele. */
            204: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    setCartCoupon: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    code: string;
                };
            };
        };
        responses: {
            /** @description Cupom aplicado; a resposta é a cesta recalculada. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Cart"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    clearCartCoupon: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Cesta sem cupom. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Cart"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getMyBilling: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Os dados guardados; campos nulos enquanto não informados. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Billing"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    saveMyBilling: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    fullName: string;
                    taxIdType: components["schemas"]["TaxIdType"];
                    /**
                     * @description CPF (11 dígitos) ou CNPJ (14 caracteres, podendo ser alfanumérico), com ou sem
                     *     pontuação; a API guarda só os caracteres, sem pontos, traços ou barras.
                     */
                    taxId: string;
                };
            };
        };
        responses: {
            /** @description Dados gravados. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Billing"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listMyOrders: {
        parameters: {
            query?: {
                status?: components["schemas"]["OrderStatus"];
                /** @description Quantidade de itens por página. */
                limit?: components["parameters"]["Limit"];
                /** @description Valor de `nextCursor` da página anterior. Ausente na primeira página. */
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Uma página de pedidos. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyOrderPage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createOrder: {
        parameters: {
            query?: never;
            header?: {
                /** @description Chave escolhida pelo cliente; a repetição devolve a primeira resposta por 24 h. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pedido criado. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderCheckout"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getMyOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O pedido. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyOrderDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    cancelMyOrder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pedido cancelado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MyOrderDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listPlans: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Os planos ativos, agrupados. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanCatalog"];
                };
            };
            400: components["responses"]["BadRequest"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    createSubscription: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    planId: components["schemas"]["Uuid"];
                    /**
                     * @description Código do cupom, comparado sem diferenciar maiúsculas; `null` ou ausente sem
                     *     cupom.
                     */
                    couponCode?: string | null;
                };
            };
        };
        responses: {
            /** @description Assinatura criada; o aluno segue para o checkout do provedor. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SubscriptionCheckout"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listMySubscriptions: {
        parameters: {
            query?: {
                status?: components["schemas"]["SubscriptionStatus"];
                /** @description Quantidade de itens por página. */
                limit?: components["parameters"]["Limit"];
                /** @description Valor de `nextCursor` da página anterior. Ausente na primeira página. */
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Uma página de assinaturas. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MySubscriptionPage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getMySubscription: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A assinatura. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MySubscriptionDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    cancelMySubscription: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Assinatura em `canceling`. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MySubscriptionDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    receiveMercadoPagoWebhook: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description Assinatura do provedor (`ts`, `v1`). Ausente ou diferente do manifesto: `401`
                 *     `payment_webhook_invalid_signature`.
                 */
                "x-signature"?: string;
                /** @description Identificador da entrega, parte do manifesto assinado. */
                "x-request-id"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    [key: string]: unknown;
                };
            };
        };
        responses: {
            /** @description Aviso autenticado; recebido agora ou já recebido antes. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: components["responses"]["BadRequest"];
            /**
             * @description Assinatura do aviso inválida, ausente ou com carimbo fora dos 5 minutos
             *     (`payment_webhook_invalid_signature`); o evento é gravado como `rejected`.
             */
            401: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listNotifications: {
        parameters: {
            query?: {
                /** @description Itens por página da central (padrão 20, máximo 50). */
                limit?: components["parameters"]["NotificationLimit"];
                /** @description Valor de `nextCursor` da página anterior. Ausente na primeira página. */
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Uma página da central. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationPage"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    clearNotifications: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Quantas notificações foram apagadas. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationsCleared"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getNotificationUnreadCount: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O contador. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationUnreadCount"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    markNotificationRead: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Item lido e o contador atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationReadResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    markAllNotificationsRead: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Quantas notificações passaram a lidas. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationsReadAllResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getNotificationPrefs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description As preferências efetivas. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationPrefs"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateNotificationPrefs: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["NotificationPrefsUpdate"];
            };
        };
        responses: {
            /** @description Preferências gravadas e devolvidas. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["NotificationPrefs"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    unsubscribe: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /**
                 * @description Token do link de descadastro: 64 caracteres hexadecimais, gravado em
                 *     `notification_unsubscribe_tokens`. Outro formato ou token desconhecido responde `404`.
                 */
                token: components["parameters"]["UnsubscribeTokenPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Grupo descadastrado e os canais efetivos depois da mudança. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UnsubscribeResult"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
}
