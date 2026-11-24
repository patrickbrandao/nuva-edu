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
}
