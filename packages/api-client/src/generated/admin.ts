// ARQUIVO GERADO. Não edite à mão.
// Origem: apps/admin-api/openapi.yaml
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
         * Login da equipe por e-mail e senha
         * @description Abre a sessão do site admin (`specs/007-contas-e-autenticacao.md`, "Login por senha") e
         *     grava o cookie `nuva_admin_session`.
         *
         *     - Qualquer falha de credencial: `401` `invalid_credentials`, no mesmo tempo.
         *     - Conta com suspensão `full`, só depois de a senha conferir: `403` `account_suspended`.
         *     - Senha certa de quem tem papel `student`: `403` `staff_only`, sem abrir sessão.
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
         * @description Encerra a sessão atual do site admin e apaga o cookie.
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
         * @description Dono da sessão, token CSRF e ações permitidas, que o site usa para montar o menu
         *     (`specs/008-papeis-e-permissoes.md`). Sem sessão válida: `401` `unauthenticated`, e o
         *     cookie é apagado.
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
    "/api/v1/auth/{provider}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Início do login social da equipe
         * @description O site **navega** para esta URL (navegação de página, não `fetch`;
         *     `specs/007-contas-e-autenticacao.md`, "Fluxo do provedor"). A API gera `state`, `nonce` e
         *     o verificador PKCE, grava o cookie de retorno `nuva_admin_oauth` (10 minutos) e
         *     redireciona para a autorização do provedor. No admin só existe login: não há cadastro
         *     nem vínculo. Provedor desligado nesta instalação: `404`.
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
         *     o provedor envie são ignorados. A identidade precisa já estar vinculada, ou casar por
         *     e-mail verificado com uma conta da equipe (`specs/007-contas-e-autenticacao.md`, "Login
         *     social e vínculo"). Provedor desligado: `404`.
         *
         *     Com o provedor ligado, sempre responde `302` para o próprio site, nunca com corpo de erro:
         *
         *     | Resultado | `Location` |
         *     | --- | --- |
         *     | Entrou (sessão aberta, `Set-Cookie` da sessão) | `returnTo` |
         *     | Erro | `/entrar?erro=<code>` |
         *
         *     Códigos na URL: `oauth_state_invalid`, `oauth_denied`, `oauth_provider_error`,
         *     `account_suspended`, `staff_only` (sem conta da equipe). O cookie de retorno é apagado.
         *     A Apple volta por `POST` (`oauthCallbackForm`).
         */
        get: operations["oauthCallback"];
        put?: never;
        /**
         * Retorno do provedor por formulário (Apple)
         * @description Retorno da Apple com `response_mode=form_post`: `POST`
         *     `application/x-www-form-urlencoded` vindo do site da Apple. Mesmo tratamento e mesmos
         *     destinos de `oauthCallback`. Só `apple` usa este método; outro provedor recebe `302` para
         *     `/entrar?erro=oauth_provider_error`.
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
    "/api/v1/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Listar alunos e equipe
         * @description Busca por nome ou e-mail (`q`), filtros por papel e situação, paginação por cursor. Na
         *     Fase 1 exige `users.list` com alcance total (`manager` e `admin`); o `instructor` recebe
         *     `403` (`specs/008-papeis-e-permissoes.md`).
         */
        get: operations["listUsers"];
        put?: never;
        /**
         * Criar conta (equipe)
         * @description Só `admin` (`specs/007-contas-e-autenticacao.md`, "Equipe criada pelo admin"). A conta
         *     nasce com o e-mail não confirmado e recebe `account.verify_email`; o admin informa a
         *     senha à pessoa por fora do sistema.
         *
         *     - Senha fora de 8 a 128 caracteres: `400` `password_invalid`.
         *     - E-mail já cadastrado: `409` `email_taken` (para promover uma conta existente, muda-se o
         *       papel).
         */
        post: operations["createUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Ficha de um usuário
         * @description A ficha completa. `users.view` é a mesma ação de `users.list`
         *     (`specs/008-papeis-e-permissoes.md`, "Identificadores das ações").
         */
        get: operations["getUser"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Editar dados de um usuário
         * @description Nome, nome completo e e-mail. Conta de aluno: `users.edit` (`manager` e `admin`); conta
         *     da equipe: `staff.manage` (só `admin`). Trocar o e-mail anula a confirmação e envia
         *     `account.verify_email` ao novo endereço.
         *
         *     - `version` diferente da gravada: `409` `version_conflict`.
         *     - E-mail já cadastrado em outra conta: `409` `email_taken`.
         */
        patch: operations["updateUser"];
        trace?: never;
    };
    "/api/v1/users/{id}/role": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Mudar o papel
         * @description Só `admin` (`specs/008-papeis-e-permissoes.md`, "Mudança de papel"). Encerra as sessões
         *     do usuário no site admin e o avisa por e-mail (`account.role_changed`).
         *
         *     - Rebaixar o último `admin` ativo: `422` `last_admin`.
         *     - Mudar o próprio papel: `422` `self_action_not_allowed`.
         */
        patch: operations["setUserRole"];
        trace?: never;
    };
    "/api/v1/users/{id}/suspend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Suspender
         * @description Aluno: `users.suspend` (`manager` e `admin`); equipe: `staff.manage` (só `admin`;
         *     `manager` recebe `403` `permission_denied`). `full` encerra todas as sessões e recusa o
         *     login; `posting` só impede publicar (`specs/008-papeis-e-permissoes.md`, "Suspensão").
         *     `durationDays` nulo é por tempo indeterminado. O usuário é avisado por e-mail, sem o
         *     motivo.
         *
         *     - Já suspenso: `409` `already_suspended` (para mudar tipo ou prazo, reativa e suspende).
         *     - Último `admin` ativo: `422` `last_admin`. A si mesmo: `422` `self_action_not_allowed`.
         */
        post: operations["suspendUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{id}/reactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reativar
         * @description Encerra a suspensão vigente. Aluno: `users.suspend`; equipe: `staff.manage`. Sessões e
         *     chaves MCP não voltam sozinhas. Sem suspensão vigente: `409` `not_suspended`.
         */
        post: operations["reactivateUser"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{id}/password/reveal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Exibir a senha de um usuário
         * @description Só `admin` (`specs/007-contas-e-autenticacao.md`, "Exibição da senha";
         *     ADR 0002). É a **única** resposta de API com o campo de senha. Exige a senha do
         *     próprio admin em `adminPassword`; errada, `422` `password_confirmation_invalid`, e a
         *     tentativa conta no bloqueio da conta do admin (`429` `too_many_attempts`). Grava
         *     `user.password_view` na auditoria, sem o valor. É `POST` para o valor não ficar em
         *     cache nem em histórico.
         */
        post: operations["revealUserPassword"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{id}/password": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Definir a senha de um usuário
         * @description Só `admin`. Encerra todas as sessões do usuário, grava `user.password_set` na auditoria
         *     e avisa o usuário por e-mail. Senha fora de 8 a 128 caracteres: `400` `password_invalid`.
         */
        put: operations["setUserPassword"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{id}/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Sessões abertas de um usuário
         * @description As sessões do usuário nos dois sites. Conta de aluno: `users.sessions.revoke`; conta da
         *     equipe: `staff.manage`. `current` é sempre falso aqui (nenhuma é a do admin).
         */
        get: operations["listUserSessions"];
        put?: never;
        post?: never;
        /**
         * Encerrar as sessões de um usuário
         * @description Encerra todas as sessões do usuário, nos dois sites. Conta de aluno:
         *     `users.sessions.revoke`; conta da equipe: `staff.manage`.
         */
        delete: operations["revokeUserSessions"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Consultar a auditoria
         * @description Só `admin` (`specs/028-auditoria.md`, "Consulta"). Do mais novo para o mais antigo, sem
         *     `details`, com o nome do ator e do alvo quando são usuários (`usuário removido` se a
         *     conta foi excluída). Sem `from` e `to`, os últimos 30 dias; janela acima de 366 dias:
         *     `400` `validation_failed`. Cada chamada grava `audit.search`, com os filtros.
         */
        get: operations["listAuditEntries"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/audit/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Um registro da auditoria
         * @description O registro com `details`. Abrir um registro não grava `audit.search`.
         */
        get: operations["getAuditEntry"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/terms": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Versões de um documento legal
         * @description Só `admin` (`specs/030-lgpd.md`, "Termos na Fase 1"). Rascunhos e publicadas do
         *     documento, mais nova primeiro, sem o texto.
         */
        get: operations["listTermsVersions"];
        put?: never;
        /**
         * Criar um rascunho
         * @description Cria um rascunho do documento. Rascunho não é editado: para mudar o texto, cria-se
         *     outro. O número da versão só é dado na publicação.
         */
        post: operations["createTermsDraft"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/terms/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publicar um rascunho
         * @description O rascunho recebe o próximo `version` do documento, `effectiveAt = publishedAt = agora`,
         *     vira a versão vigente e fica imutável. Grava `terms.publish` na auditoria. Já publicado:
         *     `409` `terms_already_published`.
         */
        post: operations["publishTermsVersion"];
        delete?: never;
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
        /** @description Sessão do site admin (`specs/007-contas-e-autenticacao.md`, "Esquemas comuns"). */
        Session: {
            user: components["schemas"]["SessionUser"];
            /** @description Valor do cabeçalho `X-CSRF-Token` nas escritas desta sessão. */
            csrfToken: string;
            /**
             * @description Ações de `specs/008-papeis-e-permissoes.md` que o papel permite; o site monta o menu
             *     com elas. Ação permitida só em parte (◐) também vem na lista.
             */
            permissions: components["schemas"]["PermissionAction"][];
            expiresAt: components["schemas"]["DateTime"];
        };
        /**
         * @description `suspended` quando há suspensão vigente, de qualquer tipo.
         * @enum {string}
         */
        UserStatus: "active" | "suspended";
        /** @description Um usuário na lista. Sem campo de senha. */
        UserSummary: {
            id: components["schemas"]["Uuid"];
            name: string;
            email: components["schemas"]["Email"];
            emailVerified: boolean;
            role: components["schemas"]["UserRole"];
            /**
             * Format: uri-reference
             * @description Variante de 256 px do avatar; `null` sem avatar.
             */
            avatarUrl: string | null;
            status: components["schemas"]["UserStatus"];
            createdAt: components["schemas"]["DateTime"];
            /** @description Último login; `null` se nunca entrou. */
            lastLoginAt: components["schemas"]["DateTime"] | null;
        };
        UserSummaryPage: components["schemas"]["Page"] & {
            items: components["schemas"]["UserSummary"][];
        };
        /**
         * @description `posting` impede publicar; `full` encerra as sessões e recusa o login
         *     (`specs/008-papeis-e-permissoes.md`, "Suspensão").
         * @enum {string}
         */
        SuspensionKind: "posting" | "full";
        /** @description Um usuário citado por outro registro, com o nome atual (`usuário removido` se excluído). */
        UserRef: {
            id: components["schemas"]["Uuid"];
            name: string;
        };
        /** @description A suspensão vigente. */
        UserSuspension: {
            kind: components["schemas"]["SuspensionKind"];
            /** @description Motivo interno, visível só à equipe. */
            reason: string;
            startsAt: components["schemas"]["DateTime"];
            /** @description Fim do prazo; `null` é por tempo indeterminado. */
            endsAt: components["schemas"]["DateTime"] | null;
            /** @description Quem suspendeu; `null` quando não há usuário (comando de linha). */
            createdBy: components["schemas"]["UserRef"] | null;
        };
        /**
         * @description Ficha do usuário: os campos de `UserSummary` e mais os da ficha. Sem campo de senha; a
         *     senha só sai em `POST /api/v1/users/{id}/password/reveal`.
         */
        UserDetail: {
            id: components["schemas"]["Uuid"];
            name: string;
            email: components["schemas"]["Email"];
            emailVerified: boolean;
            role: components["schemas"]["UserRole"];
            /**
             * Format: uri-reference
             * @description Variante de 256 px do avatar; `null` sem avatar.
             */
            avatarUrl: string | null;
            status: components["schemas"]["UserStatus"];
            createdAt: components["schemas"]["DateTime"];
            lastLoginAt: components["schemas"]["DateTime"] | null;
            /** @description Nome completo, usado em pedidos e certificados. */
            fullName: string | null;
            /** @description Verdadeiro quando a conta tem senha definida. */
            hasPassword: boolean;
            identities: components["schemas"]["Identity"][];
            /** @description A suspensão vigente; `null` sem suspensão. */
            suspension: components["schemas"]["UserSuspension"] | null;
            /** @description Versão da ficha, enviada de volta em `PATCH /api/v1/users/{id}`. */
            version: number;
        };
        /**
         * @description Única resposta da API com o campo de senha (`specs/007-contas-e-autenticacao.md`, RF-09;
         *     ADR 0002). Não vai para log, auditoria nem cache.
         */
        PasswordReveal: {
            /** @description A senha em texto; `null` quando o usuário não tem senha definida. */
            password: string | null;
        };
        /**
         * @description Por onde a ação foi feita (`specs/028-auditoria.md`).
         * @enum {string}
         */
        AuditOrigin: "admin_panel" | "mcp" | "classroom" | "worker" | "cli";
        /** @enum {string} */
        AuditOutcome: "ok" | "denied" | "error";
        /**
         * @description Um registro da auditoria, sem `details`. `actor` e `target` trazem o nome atual quando o
         *     alvo é um usuário (`usuário removido` se excluído).
         */
        AuditEntry: {
            id: components["schemas"]["Uuid"];
            createdAt: components["schemas"]["DateTime"];
            /** @description Quem agiu; `null` em `worker` e `cli`. No MCP, o emissor da chave. */
            actor: components["schemas"]["UserRef"] | null;
            /** @description Papel do ator no momento da ação. */
            actorRole: components["schemas"]["UserRole"] | null;
            origin: components["schemas"]["AuditOrigin"];
            mcpKeyId: components["schemas"]["Uuid"] | null;
            /**
             * @description Código da ação (`specs/028-auditoria.md`, "O que é registrado").
             * @example user.password_view
             */
            action: string;
            /** @example user */
            targetType: string | null;
            targetId: string | null;
            /** @description Nome do alvo quando é um usuário; `null` nos demais. */
            targetName: string | null;
            outcome: components["schemas"]["AuditOutcome"];
            /** @description IP real do cliente; `null` depois da exclusão da conta. */
            ip: string | null;
            userAgent: string | null;
            requestId: string | null;
        };
        /**
         * @description Um registro com `details` (antes e depois dos campos alterados, até 8 KB; campos
         *     sensíveis aparecem como `"[alterado]"`).
         */
        AuditEntryDetail: {
            id: components["schemas"]["Uuid"];
            createdAt: components["schemas"]["DateTime"];
            actor: components["schemas"]["UserRef"] | null;
            actorRole: components["schemas"]["UserRole"] | null;
            origin: components["schemas"]["AuditOrigin"];
            mcpKeyId: components["schemas"]["Uuid"] | null;
            action: string;
            targetType: string | null;
            targetId: string | null;
            targetName: string | null;
            outcome: components["schemas"]["AuditOutcome"];
            ip: string | null;
            userAgent: string | null;
            requestId: string | null;
            /** @description JSON livre, conforme a ação; com `truncated: true` quando passou de 8 KB. */
            details: {
                [key: string]: unknown;
            } | null;
        };
        AuditEntryPage: components["schemas"]["Page"] & {
            items: components["schemas"]["AuditEntry"][];
        };
        /** @enum {string} */
        TermsStatus: "draft" | "published";
        /**
         * @description Uma versão de um documento legal na lista do admin, sem o texto (`specs/030-lgpd.md`,
         *     "Termos na Fase 1"). Rascunho tem `version`, `effectiveAt` e `publishedAt` nulos.
         */
        TermsVersionEntry: {
            id: components["schemas"]["Uuid"];
            document: components["schemas"]["TermsDocument"];
            /** @description Número sequencial por documento, dado na publicação. */
            version: number | null;
            status: components["schemas"]["TermsStatus"];
            requiresReacceptance: boolean;
            effectiveAt: components["schemas"]["DateTime"] | null;
            publishedAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
        };
        TermsVersionList: {
            /** @description Mais nova primeiro. */
            items: components["schemas"]["TermsVersionEntry"][];
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
        /**
         * @description Volta ao próprio site (`Location`), conforme a tabela da descrição da operação. Abre a
         *     sessão (`Set-Cookie` de `nuva_admin_session`) quando entrou, e apaga o cookie de retorno
         *     (`nuva_admin_oauth`).
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
    startOAuth: {
        parameters: {
            query?: {
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
    listUsers: {
        parameters: {
            query?: {
                /** @description Trecho do nome ou do e-mail. */
                q?: string;
                role?: components["schemas"]["UserRole"];
                /**
                 * @description `active` (sem suspensão), `suspended` (com suspensão vigente) ou `unverified` (e-mail
                 *     não confirmado).
                 */
                status?: "active" | "suspended" | "unverified";
                sort?: "name" | "-createdAt" | "-lastLoginAt";
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
            /** @description Uma página de usuários. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserSummaryPage"];
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
    createUser: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    email: components["schemas"]["Email"];
                    role: components["schemas"]["UserRole"];
                    /** @description 8 a 128 caracteres; fora disso, `password_invalid`. */
                    password: string;
                };
            };
        };
        responses: {
            /** @description Conta criada. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserDetail"];
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
    getUser: {
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
            /** @description A ficha. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserDetail"];
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
    updateUser: {
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
                    name?: string;
                    /** @description Nome completo, usado em pedidos e certificados; `null` apaga. */
                    fullName?: string | null;
                    email?: components["schemas"]["Email"];
                    /** @description O `version` da ficha lida. */
                    version: number;
                };
            };
        };
        responses: {
            /** @description Ficha atualizada. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    setUserRole: {
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
                    role: components["schemas"]["UserRole"];
                };
            };
        };
        responses: {
            /** @description Papel alterado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserDetail"];
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
    suspendUser: {
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
                    kind: components["schemas"]["SuspensionKind"];
                    /** @description Motivo interno, visível só à equipe. */
                    reason: string;
                    /**
                     * @description Prazo em dias; `null` é por tempo indeterminado.
                     * @enum {integer|null}
                     */
                    durationDays: 1 | 7 | 30 | null;
                };
            };
        };
        responses: {
            /** @description Usuário suspenso. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserDetail"];
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
    reactivateUser: {
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
            /** @description Usuário reativado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserDetail"];
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
    revealUserPassword: {
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
                    /** @description A senha do admin que pede a exibição. */
                    adminPassword: string;
                };
            };
        };
        responses: {
            /** @description A senha do usuário, ou `null` quando ele não tem senha definida. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    "Cache-Control": components["headers"]["NoStore"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PasswordReveal"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyAttempts"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    setUserPassword: {
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
                    /** @description 8 a 128 caracteres; fora disso, `password_invalid`. */
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
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listUserSessions: {
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
            404: components["responses"]["NotFound"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    revokeUserSessions: {
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
            /** @description Sessões encerradas. */
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
    listAuditEntries: {
        parameters: {
            query?: {
                /** @description Início do período (inclusive). */
                from?: components["schemas"]["DateTime"];
                /** @description Fim do período (exclusive). */
                to?: components["schemas"]["DateTime"];
                actorId?: components["schemas"]["Uuid"];
                /** @description Ação exata (`user.suspend`) ou prefixo terminado em `.*` (`user.*`). */
                action?: string;
                targetType?: string;
                targetId?: string;
                origin?: components["schemas"]["AuditOrigin"];
                mcpKeyId?: components["schemas"]["Uuid"];
                outcome?: components["schemas"]["AuditOutcome"];
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
            /** @description Uma página de registros. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEntryPage"];
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
    getAuditEntry: {
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
            /** @description O registro. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuditEntryDetail"];
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
    listTermsVersions: {
        parameters: {
            query: {
                document: components["schemas"]["TermsDocument"];
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description As versões do documento. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TermsVersionList"];
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
    createTermsDraft: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    document: components["schemas"]["TermsDocument"];
                    /** @description Texto em Markdown. */
                    bodyMd: string;
                    /**
                     * @description Publicada, bloqueia no classroom quem aceitou uma versão anterior até aceitar
                     *     esta.
                     */
                    requiresReacceptance: boolean;
                };
            };
        };
        responses: {
            /** @description Rascunho criado. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TermsVersionEntry"];
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
    publishTermsVersion: {
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
            /** @description Versão publicada. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["TermsVersionEntry"];
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
