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
    "/api/v1/courses": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Listar cursos
         * @description Cursos do catálogo, com filtros e paginação por cursor. O `instructor` vê só os cursos de que é
         *     dono (`specs/008-papeis-e-permissoes.md`, "Regra do instrutor").
         */
        get: operations["listCourses"];
        put?: never;
        /**
         * Criar curso
         * @description Cria o curso em `draft`. O `instructor` vira o dono; `manager` e `admin` informam `ownerId`
         *     (ou nenhum). Sem `accessMode`, o curso nasce `private` e sem preço. `accessMode` exige
         *     `product.set_access` e `priceCents`, `product.set_price`: o `instructor` que os envia recebe
         *     `403`, e o `manager` que envia preço também. O `403` vem antes de qualquer regra do valor.
         *
         *     - `slug` ausente: gerado do título; se já existir, recebe o menor sufixo livre `-2`…`-99`
         *       (sem sufixo livre: `409` `slug_taken`). Informado e repetido: `409` `slug_taken`.
         *     - `ownerId` que não é `instructor` (ou foi excluído): `422` `owner_invalid`.
         */
        post: operations["createCourse"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/courses/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Curso com módulos e aulas
         * @description O curso para o editor: dados, módulos e aulas na ordem, os ebooks vinculados ao curso e o
         *     `version` da edição. Curso alheio ao `instructor`: `404`.
         */
        get: operations["getCourse"];
        put?: never;
        post?: never;
        /**
         * Excluir curso sem vínculos
         * @description Exclui o curso com módulos, aulas, links e o template de certificado dele. Curso com pedido,
         *     direito ou progresso: `409` `product_has_links`, para qualquer papel; o caminho é arquivar.
         */
        delete: operations["deleteCourse"];
        options?: never;
        head?: never;
        /**
         * Editar curso
         * @description Altera só os campos enviados. `accessMode` exige `product.set_access` (`manager` e `admin`) e
         *     `priceCents`, `product.set_price` (`admin`): sem a ação, `403`. `certificateEnabled` e
         *     `certificateHours` (`specs/015-certificados.md`) seguem `course.edit`. O template de
         *     certificado não é editado aqui (`/courses/{id}/certificate-template`); o dono, em
         *     `PATCH /courses/{id}/owner`. O `403` vem antes de qualquer regra do valor; campo enviado
         *     com o valor que o curso já tem não exige a ação.
         *
         *     - `version` obrigatória (`400` sem ela); diferente da gravada: `409` `version_conflict`.
         *     - Curso alheio ao `instructor`: `404`. Slug repetido: `409` `slug_taken`.
         *     - Publicado e `paid` sem preço: `422` `price_required`. Preço enviado para produto `open`: `422`
         *       `price_not_allowed`. Capa que não é `product_cover`: `422` `cover_image_invalid`.
         */
        patch: operations["updateCourse"];
        trace?: never;
    };
    "/api/v1/courses/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publicar
         * @description Publica o curso. Exige ao menos um módulo com uma aula publicada (`422`
         *     `course_has_no_published_lesson`). O `instructor` só publica curso `open` de que é dono; curso
         *     `paid` ou `private` dele responde `403` (o caminho é `request-review`). Limpa
         *     `reviewRequestedAt`. `paid` sem preço: `422` `price_required`. Produto arquivado: `422`
         *     `product_archived`.
         */
        post: operations["publishCourse"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/courses/{id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Despublicar
         * @description Volta a `draft`. Não revoga direitos: o item some da vitrine e da estante até voltar a ser
         *     publicado. O site mostra antes o número de alunos afetados (`studentCount` do detalhe).
         */
        post: operations["unpublishCourse"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/courses/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Arquivar
         * @description Só `admin` (`product.archive`). Equivale a despublicar em definitivo: grava `archivedAt` e
         *     some do classroom. É o caminho para produto com pedido, direito ou progresso, que ninguém
         *     exclui.
         *     Já arquivado: devolve o produto como está, sem gravar.
         */
        post: operations["archiveCourse"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/courses/{id}/unarchive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Desarquivar
         * @description Só `admin` (`product.archive`). Volta como `draft`. Não arquivado: devolve como está, sem gravar.
         */
        post: operations["unarchiveCourse"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/courses/{id}/request-review": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Enviar para publicação
         * @description Grava `reviewRequestedAt` (auditoria `course.request_review`) para o curso e as aulas `draft`
         *     dele; gerente ou admin publicam. Repetir não muda a data. Arquivado: `422` `product_archived`.
         */
        post: operations["requestCourseReview"];
        /**
         * Cancelar o pedido de publicação
         * @description Limpa `reviewRequestedAt`. Sem pedido, responde o curso como está.
         */
        delete: operations["cancelCourseReview"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/courses/{id}/owner": {
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
         * Trocar o dono do curso
         * @description `manager` e `admin` (`specs/008-papeis-e-permissoes.md`). `ownerId: null` deixa o curso sem
         *     dono, gerido só por gerente e admin. Usuário que não é `instructor` (ou foi excluído): `422`
         *     `owner_invalid`. `version` opcional; enviada e diferente da gravada: `409` `version_conflict`.
         */
        patch: operations["setCourseOwner"];
        trace?: never;
    };
    "/api/v1/courses/{id}/modules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Criar módulo
         * @description Acrescenta um módulo ao fim do curso. Acima de 100 módulos: `422` `catalog_limit_exceeded`
         *     (`limit: modulesPerCourse`).
         */
        post: operations["createModule"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/courses/{id}/modules/order": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Reordenar módulos
         * @description Recebe todos os módulos do curso na ordem nova. Lista que não tem exatamente os módulos do
         *     curso:
         *     `422` `order_mismatch`.
         */
        put: operations["reorderModules"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/{id}": {
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
         * Excluir módulo vazio
         * @description Só módulo sem aulas; com aulas: `409` `module_not_empty` (as aulas saem antes).
         */
        delete: operations["deleteModule"];
        options?: never;
        head?: never;
        /**
         * Renomear módulo
         * @description Módulo de curso alheio ao `instructor`: `404`. `version` obrigatória (`400` sem ela);
         *     diferente da gravada: `409` `version_conflict`.
         */
        patch: operations["updateModule"];
        trace?: never;
    };
    "/api/v1/modules/{id}/lessons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Criar aula
         * @description Acrescenta uma aula `draft` ao fim do módulo. Acima de 500 aulas no curso: `422`
         *     `catalog_limit_exceeded` (`limit: lessonsPerCourse`). URL de vídeo fora das regras: `422` `content_url_invalid`.
         */
        post: operations["createLesson"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/modules/{id}/lessons/order": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Reordenar aulas do módulo
         * @description Recebe as aulas do módulo na ordem nova. A lista contém todas as aulas que já estão no módulo;
         *     uma aula de outro módulo do mesmo curso, na lista, é movida para este, na posição indicada, e
         *     o módulo de origem fecha a numeração. Aula de outro curso, aula inexistente ou aula do módulo
         *     que falta na lista: `422` `order_mismatch`. Sem `version`: a lista é conferida contra as
         *     aulas atuais.
         */
        put: operations["reorderLessons"];
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
         * Aula para edição
         * @description A aula com vídeo, links de apoio e ebooks vinculados. Curso alheio ao `instructor`: `404`.
         */
        get: operations["getLesson"];
        put?: never;
        post?: never;
        /**
         * Excluir aula
         * @description Exclui a aula e os links dela. Progresso e notas dos alunos ficam (a nota guarda o título,
         *     `specs/016-anotacoes.md`). Aula de curso publicado enfileira `course.completion_check`.
         */
        delete: operations["deleteLesson"];
        options?: never;
        head?: never;
        /**
         * Editar, publicar ou despublicar aula
         * @description Altera só os campos enviados. `status` publica ou despublica a aula, com a regra do curso: o
         *     `instructor` só o faz em curso `open` de que é dono (`403` nos demais). Despublicar aula de
         *     curso publicado enfileira `course.completion_check`. Publicar a última aula `draft` limpa o
         *     pedido de publicação do curso. `version` obrigatória (`400` sem ela); diferente da gravada:
         *     `409` `version_conflict`.
         */
        patch: operations["updateLesson"];
        trace?: never;
    };
    "/api/v1/lessons/{id}/links": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Definir os links de apoio
         * @description Substitui a lista inteira, na ordem enviada (até 20). URL fora das regras: `422`
         *     `content_url_invalid`, com o índice do link. `version` opcional; enviada e diferente da
         *     gravada: `409` `version_conflict`.
         */
        put: operations["setLessonLinks"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ebooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Listar ebooks
         * @description Ebooks do catálogo. O `instructor` lê a lista para vincular ebooks existentes aos próprios
         *     cursos e aulas; criar e editar é de `manager` e `admin`.
         */
        get: operations["listEbooks"];
        put?: never;
        /**
         * Criar ebook
         * @description Cria o ebook em `draft`. Sem `accessMode`, nasce `private`. `accessMode` e `accessDays`
         *     exigem `product.set_access`; `priceCents`, `product.set_price`: sem a ação, `403`, antes de
         *     qualquer regra do valor. URL fora das regras: `422` `content_url_invalid`.
         *
         *     - `slug` ausente: gerado do título; se já existir, recebe o menor sufixo livre `-2`…`-99`
         *       (sem sufixo livre: `409` `slug_taken`). Informado e repetido: `409` `slug_taken`.
         */
        post: operations["createEbook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ebooks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Um ebook
         * @description Com os vínculos; o `instructor` vê só os vínculos com os próprios cursos e aulas.
         */
        get: operations["getEbook"];
        put?: never;
        post?: never;
        /**
         * Excluir ebook sem vínculos
         * @description Ebook com pedido ou direito: `409` `product_has_links`; o caminho é arquivar.
         */
        delete: operations["deleteEbook"];
        options?: never;
        head?: never;
        /**
         * Editar ebook
         * @description Altera só os campos enviados. `accessMode` e `accessDays` exigem `product.set_access`;
         *     `priceCents`, `product.set_price`: sem a ação, `403`, antes de qualquer regra do valor.
         *     Slug repetido: `409` `slug_taken`. `version` obrigatória (`400` sem ela); diferente da
         *     gravada: `409` `version_conflict`.
         */
        patch: operations["updateEbook"];
        trace?: never;
    };
    "/api/v1/ebooks/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publicar
         * @description Publica o ebook. Exige `fileUrl` válida (`422` `ebook_file_required`). `paid` sem preço: `422`
         *     `price_required`. Arquivado: `422` `product_archived`.
         */
        post: operations["publishEbook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ebooks/{id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Despublicar
         * @description Volta a `draft`. Não revoga direitos: o item some da vitrine e da estante até voltar a ser
         *     publicado. O site mostra antes o número de alunos afetados (`studentCount` do detalhe).
         */
        post: operations["unpublishEbook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ebooks/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Arquivar
         * @description Só `admin` (`product.archive`). Equivale a despublicar em definitivo: grava `archivedAt` e
         *     some do classroom. É o caminho para produto com pedido, direito ou progresso, que ninguém
         *     exclui.
         *     Já arquivado: devolve o produto como está, sem gravar.
         */
        post: operations["archiveEbook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ebooks/{id}/unarchive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Desarquivar
         * @description Só `admin` (`product.archive`). Volta como `draft`. Não arquivado: devolve como está, sem gravar.
         */
        post: operations["unarchiveEbook"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ebooks/{id}/targets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Vincular o ebook a cursos e aulas
         * @description Substitui os vínculos de `product_ebooks` com alvo `course` ou `lesson`. Para o
         *     `instructor`, a lista substitui só os vínculos com os próprios cursos e aulas; os demais ficam
         *     como estão, e alvo alheio responde `404`. A mudança enfileira o recálculo da cascata
         *     (`entitlement.recompute`, `specs/010-direitos-de-acesso.md`).
         *
         *     - Os vínculos `bundle` do ebook nunca são criados, removidos nem recalculados por aqui, para
         *       nenhum papel: continuam como estão e aparecem em `targets` da resposta, só para leitura.
         *       `targetType: bundle` no corpo: `400`. Pôr um ebook num pacote é `PUT /bundles/{id}/items`.
         *     - Alvo inexistente: `422` `catalog_item_not_found`, com o campo. Os 500 vínculos por ebook
         *       contam todos os vínculos do ebook depois da gravação, inclusive os que a troca não alcança
         *       (os `bundle` e, para o `instructor`, os de cursos alheios); acima disso, `422`
         *       `catalog_limit_exceeded`.
         *     - `version` opcional; enviada e diferente da gravada: `409` `version_conflict`.
         *     - Para vincular ou desvincular um alvo só, sem reenviar a lista:
         *       `PUT|DELETE /ebooks/{id}/targets/{targetType}/{targetId}`.
         */
        put: operations["setEbookTargets"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ebooks/{id}/targets/{targetType}/{targetId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Vincular o ebook a um curso ou aula
         * @description Acrescenta um vínculo, sem tocar nos outros vínculos do ebook e sem `version`
         *     (`specs/009-catalogo-e-conteudo.md`, "Ebooks vinculados"). Idempotente: vínculo que já existe
         *     responde `204` sem gravar nem auditar. A mudança avança o `version` do ebook, enfileira o
         *     recálculo da cascata (`entitlement.recompute`) e grava a auditoria `ebook.set_targets`.
         *
         *     - Ebook inexistente, ou alvo de curso alheio ao `instructor`: `404`.
         *     - Alvo inexistente: `422` `catalog_item_not_found`. O 501º vínculo do ebook (de qualquer
         *       tipo): `422` `catalog_limit_exceeded` (`limit: targetsPerEbook`).
         */
        put: operations["linkEbookTarget"];
        post?: never;
        /**
         * Desvincular o ebook de um curso ou aula
         * @description Desfaz um vínculo, sem tocar nos outros vínculos do ebook e sem `version`. Idempotente:
         *     vínculo que não existe responde `204` sem gravar nem auditar. A mudança avança o `version`
         *     do ebook, enfileira o recálculo da cascata e grava a auditoria `ebook.set_targets`.
         *
         *     - Ebook inexistente, ou alvo de curso alheio ao `instructor`: `404`.
         *     - Alvo inexistente: `422` `catalog_item_not_found`.
         */
        delete: operations["unlinkEbookTarget"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/bundles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Listar pacotes
         * @description Pacotes do catálogo, com filtros e paginação por cursor.
         */
        get: operations["listBundles"];
        put?: never;
        /**
         * Criar pacote
         * @description Cria o pacote em `draft`, sem itens. Sem `accessMode`, nasce `private`. `accessMode` e
         *     `accessDays` exigem `product.set_access`; `priceCents`, `product.set_price`: sem a ação,
         *     `403`, antes de qualquer regra do valor.
         *
         *     - `slug` ausente: gerado do título; se já existir, recebe o menor sufixo livre `-2`…`-99`
         *       (sem sufixo livre: `409` `slug_taken`). Informado e repetido: `409` `slug_taken`.
         */
        post: operations["createBundle"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/bundles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Um pacote, com os itens
         * @description O pacote, os itens na ordem e a soma dos preços avulsos dos itens `paid`.
         */
        get: operations["getBundle"];
        put?: never;
        post?: never;
        /**
         * Excluir pacote sem vínculos
         * @description Pacote com pedido ou direito: `409` `product_has_links`; o caminho é arquivar.
         */
        delete: operations["deleteBundle"];
        options?: never;
        head?: never;
        /**
         * Editar pacote
         * @description Altera só os campos enviados. `accessMode` e `accessDays` exigem `product.set_access`;
         *     `priceCents`, `product.set_price`: sem a ação, `403`, antes de qualquer regra do valor.
         *     Slug repetido: `409` `slug_taken`. `version` obrigatória (`400` sem ela); diferente da
         *     gravada: `409` `version_conflict`.
         */
        patch: operations["updateBundle"];
        trace?: never;
    };
    "/api/v1/bundles/{id}/publish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publicar
         * @description Publica o pacote. Exige ao menos um item (`422` `bundle_has_no_items`). `paid` sem preço: `422`
         *     `price_required`. Arquivado: `422` `product_archived`.
         */
        post: operations["publishBundle"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/bundles/{id}/unpublish": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Despublicar
         * @description Volta a `draft`. Não revoga direitos: o item some da vitrine e da estante até voltar a ser
         *     publicado. O site mostra antes o número de alunos afetados (`studentCount` do detalhe).
         */
        post: operations["unpublishBundle"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/bundles/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Arquivar
         * @description Só `admin` (`product.archive`). Equivale a despublicar em definitivo: grava `archivedAt` e
         *     some do classroom. É o caminho para produto com pedido, direito ou progresso, que ninguém
         *     exclui.
         *     Já arquivado: devolve o produto como está, sem gravar.
         */
        post: operations["archiveBundle"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/bundles/{id}/unarchive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Desarquivar
         * @description Só `admin` (`product.archive`). Volta como `draft`. Não arquivado: devolve como está, sem gravar.
         */
        post: operations["unarchiveBundle"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/bundles/{id}/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Definir os itens do pacote
         * @description Substitui a lista inteira, na ordem enviada: cursos e ebooks, nunca outro pacote. Em pacote já
         *     vendido, a mudança enfileira o recálculo da cascata de quem o tem
         *     (`specs/010-direitos-de-acesso.md`); o site confirma antes a remoção com o `studentCount`.
         *
         *     - `productType` fora de `course` e `ebook` (`bundle` inclusive): `400`.
         *     - Produto inexistente, inclusive o id de um pacote enviado como `course` ou `ebook`: `422`
         *       `catalog_item_not_found`, com o campo.
         *     - `version` opcional; enviada e diferente da gravada: `409` `version_conflict`.
         */
        put: operations["setBundleItems"];
        post?: never;
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
         *     `purpose` primeiro, depois `file` (um arquivo só). No admin há duas finalidades:
         *     `product_cover` (16:9, cortada, variantes 480 e 1280), de `instructor`, `manager` e `admin`,
         *     e `school_logo` (proporção original, sem corte, variantes 64, 256 e 512), só do `admin`. A
         *     imagem passa a ter referência quando vira capa (`coverImageId` de curso, ebook ou pacote)
         *     ou o logotipo da escola (`settings` `school.logo_image_id`, gravado por
         *     `PUT /api/v1/settings/branding`); sem referência, o expurgo a apaga em 24 h.
         *
         *     Nas finalidades de proporção original a imagem não é cortada: o nome da variante é o
         *     maior lado do arquivo gerado, então `width` é o nome e `height` a altura real. Nenhuma
         *     variante gravada passa de 1600 px no maior lado nem de 400 KB (RNF-03). O `logoUrl` do
         *     `/meta` e a marca dos e-mails usam a variante de 256.
         *
         *     - Campo a mais, segundo arquivo ou `purpose` ausente: `400` `validation_failed`.
         *     - Corpo acima de 5 MB: `413` `payload_too_large`. Tipo que não é JPEG, PNG nem WebP: `415`
         *       `image_type_unsupported`.
         *     - Acima de 8000 px ou de 40 megapixels: `422` `image_dimensions_exceeded`; variante acima de
         *       400 KB: `422` `image_too_heavy`.
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
         * @description Apaga uma capa enviada pelo próprio usuário e ainda sem referência. Imagem inexistente, de outro
         *     usuário ou já em uso: `404`.
         */
        delete: operations["deleteImage"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{id}/entitlements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Árvore de direitos de um usuário
         * @description As raízes (`order`, `subscription`, `grant`) com os derivados de cascata em `children`, com
         *     fonte, validade e estado (`specs/010-direitos-de-acesso.md`). Inclui vencidos e revogados.
         */
        get: operations["listUserEntitlements"];
        put?: never;
        /**
         * Conceder acesso manual
         * @description Cria a raiz `grant` com a cascata do produto, numa transação, grava a auditoria e envia o e-mail
         *     `access.granted`. Idempotente: a mesma concessão (usuário, quem concede, produto) ainda ativa
         *     responde `200` com o direito existente. Produto inexistente: `404`. `expiresAt` no passado:
         *     `422` `expires_at_in_past`.
         */
        post: operations["grantEntitlement"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/entitlements/{id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Revogar concessão manual
         * @description Revoga a raiz `grant` e toda a sua cascata, com `revokeReason = manual`, e grava a auditoria.
         *     Raiz de pedido ou de assinatura, ou direito derivado: `409` `entitlement_not_revocable`. Já
         *     revogado: `409` `entitlement_already_revoked`.
         */
        post: operations["revokeEntitlement"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/products/{type}/{id}/entitlements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Quem tem acesso a um produto
         * @description Um item por direito ao produto, raiz ou derivado, mais recente primeiro. Sem `state`, só os
         *     ativos.
         */
        get: operations["listProductEntitlements"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/{id}/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Progresso de um usuário
         * @description Um item por curso que o usuário iniciou ou a que tem acesso. O `instructor` vê só os próprios
         *     cursos; usuário sem nenhum deles: `404`.
         */
        get: operations["getUserProgress"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/courses/{id}/progress-summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Resumo de progresso do curso
         * @description Alunos com acesso por faixa de progresso e taxa de conclusão. Curso alheio ao `instructor`:
         *     `404`.
         */
        get: operations["getCourseProgressSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/courses/{id}/students": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Alunos do curso
         * @description Alunos com acesso ao curso, com nome, avatar, progresso e última atividade, sem e-mail nem
         *     compras
         *     (`specs/008-papeis-e-permissoes.md`). É a lista de alunos do `instructor`, só nos próprios
         *     cursos (`404` nos demais).
         */
        get: operations["listCourseStudents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/certificates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Listar certificados
         * @description Mais recentes primeiro. O `instructor` vê só os dos próprios cursos.
         */
        get: operations["listCertificates"];
        put?: never;
        /**
         * Emitir certificado manualmente
         * @description `manager` e `admin`, para aluno que não concluiu pelo sistema, com motivo; marca
         *     `issuedManually` e enfileira `certificate.render`. Curso sem template efetivo: `422`
         *     `certificate_template_missing`. O aluno já tem certificado do curso: `409`
         *     `certificate_exists`. Usuário ou curso inexistente: `404`.
         */
        post: operations["issueCertificate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/certificates/{id}/revoke": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Revogar certificado
         * @description Só `admin`, com motivo. A validação pública passa a mostrar "certificado revogado". Já revogado:
         *     `409` `certificate_already_revoked`.
         */
        post: operations["revokeCertificate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/certificates/{id}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Desfazer a revogação
         * @description Só `admin`. Não revogado: `409` `certificate_not_revoked`.
         */
        post: operations["restoreCertificate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/certificates/{id}/reissue": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reemitir certificado
         * @description Congela de novo o nome atual do aluno e a versão do template efetivo atual, mantém o código e
         *     enfileira `certificate.render` (o certificado volta a `preparing` até o PDF novo). Curso sem
         *     template efetivo: `422` `certificate_template_missing`. Revogado: `409`
         *     `certificate_already_revoked`.
         */
        post: operations["reissueCertificate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/certificates/{id}/pdf": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * PDF do certificado
         * @description O PDF que o aluno recebeu, para a equipe conferir. O `instructor` só nos próprios cursos (de
         *     outro curso, `404`). Certificado revogado continua disponível à equipe. PDF ainda não gerado:
         *     `409` `certificate_preparing`. Certificado inexistente, ou PDF apagado pela exclusão da conta
         *     do titular: `404`. Leitura comum: não grava auditoria.
         */
        get: operations["getCertificatePdf"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/courses/{id}/certificates/backfill": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Emitir para quem já concluiu
         * @description Enfileira `certificate.backfill` para o curso: emite para quem tem, na hora do lote, 100% das
         *     aulas publicadas e acesso ao curso. Curso com certificado desabilitado: `422`
         *     `certificate_disabled`; sem template efetivo: `422` `certificate_template_missing`.
         */
        post: operations["backfillCourseCertificates"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/courses/{id}/certificate-template": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Template de certificado do curso
         * @description O template próprio do curso (`html` nulo quando não tem), a origem do template efetivo
         *     (`course`, `school` ou `none`, `specs/015-certificados.md`) e a versão atual, com quem e
         *     quando gravou. Curso alheio ao `instructor`: `404`.
         */
        get: operations["getCourseCertificateTemplate"];
        /**
         * Gravar o template do curso
         * @description Valida (palavras-chave e lista de permissões, `specs/015-certificados.md`, "Template") e grava
         *     uma versão nova e imutável. Recusa o template inteiro com a lista de problemas, sem corrigir
         *     nada:
         *     `422` `certificate_template_invalid` com `details.problems`. `expectedVersionId` é a versão que
         *     o editor abriu (`null` quando não havia template); se mudou: `409` `version_conflict`.
         *
         *     Quando o curso passa de "sem template efetivo" a "com template efetivo", enfileira
         *     `certificate.backfill`, e `backfillQueued` é verdadeiro. Editar um
         *     template que já existia não emite nada. Grava a auditoria.
         */
        put: operations["saveCourseCertificateTemplate"];
        post?: never;
        /**
         * Excluir o template do curso
         * @description O curso volta ao padrão da escola; sem padrão, as próximas conclusões ficam aguardando template.
         *     Certificados emitidos não mudam. Responde o estado novo; sem template próprio, nada muda.
         */
        delete: operations["deleteCourseCertificateTemplate"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/certificate-template": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Template padrão da escola
         * @description O template padrão da escola (`html` nulo quando não há), no mesmo formato do template do curso;
         *     `source` é `school` ou `none`. Só `admin` (`settings.manage`).
         */
        get: operations["getSchoolCertificateTemplate"];
        /**
         * Gravar o template padrão
         * @description Valida (palavras-chave e lista de permissões, `specs/015-certificados.md`, "Template") e grava
         *     uma versão nova e imutável. Recusa o template inteiro com a lista de problemas, sem corrigir
         *     nada:
         *     `422` `certificate_template_invalid` com `details.problems`. `expectedVersionId` é a versão que
         *     o editor abriu (`null` quando não havia template); se mudou: `409` `version_conflict`.
         *
         *     Quando um curso passa de "sem template efetivo" a "com template efetivo", enfileira
         *     `certificate.backfill` para cada curso com certificado habilitado e sem template próprio, e
         *     `backfillQueued` é verdadeiro. Editar um
         *     template que já existia não emite nada. Grava a auditoria.
         */
        put: operations["saveSchoolCertificateTemplate"];
        post?: never;
        /**
         * Excluir o template padrão
         * @description Os cursos sem template próprio passam a não ter template efetivo. Certificados emitidos não
         *     mudam.
         *     Responde o estado novo.
         */
        delete: operations["deleteSchoolCertificateTemplate"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/certificate-templates/reference": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Palavras-chave e modelo inicial
         * @description A lista fechada de palavras-chave (nome, como escrever, descrição, valor de exemplo no idioma e
         *     no fuso da escola, se é obrigatória) e o HTML do modelo inicial ("Começar do modelo").
         */
        get: operations["getCertificateTemplateReference"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/certificate-templates/previews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pedir PDF de exemplo
         * @description Valida o HTML ainda não salvo (mesmas regras e mesmo `422` `certificate_template_invalid` da
         *     gravação), grava o pedido e enfileira `certificate.preview`. O PDF sai com dados de exemplo
         *     (`specs/015-certificados.md`, "Pré-visualização"). `courseId` dá o título e o instrutor do
         *     exemplo; curso alheio ao `instructor`: `404`. Acima de 20 pedidos na hora por usuário: `429`
         *     `rate_limited`. Só quem pediu vê o pedido; ele some em 24 horas.
         */
        post: operations["createCertificatePreview"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/certificate-templates/previews/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Estado do PDF de exemplo
         * @description `pending`, `ready` ou `failed` com o motivo. Pedido de outro usuário ou já expirado: `404`.
         */
        get: operations["getCertificatePreview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/certificate-templates/previews/{id}/pdf": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * PDF de exemplo
         * @description O PDF do exemplo, para abrir numa aba nova. Pedido de outro usuário ou expirado: `404`. Ainda em
         *     `pending` ou em `failed`: `409` `certificate_preview_not_ready`.
         */
        get: operations["getCertificatePreviewPdf"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/certificates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Signatário do certificado
         * @description `certificate.signer_name` e `certificate.signer_role` (`specs/031-infraestrutura-e-deploy.md`,
         *     "Configurações da escola") e, só para leitura, `school.name`.
         */
        get: operations["getCertificateSettings"];
        /**
         * Gravar o signatário do certificado
         * @description Grava os dois campos (`null` omite a assinatura no certificado). O nome da escola não é gravado
         *     aqui. Vale para os certificados emitidos depois; os emitidos têm os dados congelados.
         */
        put: operations["saveCertificateSettings"];
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
         * Listar pedidos
         * @description Pedidos da escola, do mais novo para o mais antigo (`specs/011-vendas-e-checkout.md`,
         *     "Consulta e exportação"), com filtros por período, estado, produto, cupom e comprador. Os
         *     `draft` aparecem para quem filtra por `status=draft`; sem filtro de estado, a lista traz
         *     todos, inclusive eles. `manager` e `admin` consultam; `instructor` recebe `403`
         *     `permission_denied` (`specs/008-papeis-e-permissoes.md`).
         *
         *     `totals` soma todos os pedidos que casam com o filtro, não só a página: `subtotalCents`
         *     (bruto), `discountCents`, `refundedCents` e `totalCents` (cobrado); `netCents` é o cobrado
         *     menos os reembolsos. O documento fiscal do comprador não sai na lista, só no detalhe e no
         *     CSV.
         */
        get: operations["listOrders"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/export.csv": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Exportar vendas em CSV
         * @description Exportação de vendas (`specs/011-vendas-e-checkout.md`, "Consulta e exportação"), só do
         *     `admin`: `sales.export` é exclusiva dele e o `manager` recebe `403` `permission_denied` e
         *     não vê a ação no menu (`specs/008-papeis-e-permissoes.md`). A tentativa recusada também é
         *     auditada (`specs/028-auditoria.md`).
         *
         *     Uma linha por item de pedido, em fluxo contínuo (sem carregar tudo em memória; 50.000 itens
         *     em menos de 30 s). UTF-8 com BOM, separador `;`, CRLF e cabeçalho com as colunas, nesta
         *     ordem: `order_id`, `order_number`, `created_at`, `paid_at`, `status`, `buyer_name`,
         *     `buyer_email`, `tax_id_type`, `tax_id`, `product_type`, `product_title`, `unit_price`,
         *     `discount`, `paid_amount`, `refunded_amount`, `coupon_code`, `payment_method`, `provider`,
         *     `provider_payment_id`. Datas em ISO 8601 UTC; valores monetários com duas casas e vírgula
         *     decimal (`199,00`); campos vazios quando o dado não existe. Filtros iguais aos da lista. O
         *     conteúdo e os filtros não vão para logs.
         */
        get: operations["exportOrdersCsv"];
        put?: never;
        post?: never;
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
         * Um pedido
         * @description O pedido com comprador (nome, e-mail e documento fiscal), itens e valores congelados,
         *     cobranças e reembolsos (`specs/011-vendas-e-checkout.md`). `manager` e `admin` veem;
         *     `instructor` recebe `403`. O documento fiscal só sai aqui e no CSV, nunca nos logs.
         */
        get: operations["getOrder"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/orders/{id}/refunds": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Pedir reembolso do pedido
         * @description Só o `admin` reembolsa (`specs/011-vendas-e-checkout.md`, "Reembolso"); `manager` recebe
         *     `403` `permission_denied`. O pedido inteiro (`items` ausente ou nulo) ou itens escolhidos,
         *     sempre com motivo. Cria o `refunds` em `requested` e enfileira `refund.execute`; a resposta
         *     é `202` e o desfecho (estorno no provedor, revogação da cascata e estado do pedido) chega
         *     depois, pelo worker, e aparece no detalhe do pedido. O valor de cada item é o pago por ele
         *     (preço menos o desconto rateado), e um item pode ser reembolsado em parte, desde que a soma
         *     não passe do valor pago e ainda não reembolsado.
         *
         *     `Idempotency-Key` é aceita: a repetição devolve o primeiro reembolso por 24 h.
         *
         *     Recusas, pelo `code`: `409` `order_not_refundable` (pedido que não está `paid` nem
         *     `partially_refunded`); `422` `refund_exceeds_paid` (valor acima do pago e não reembolsado do
         *     item, ou item de outro pedido). Falha do estorno não é resposta desta rota: o reembolso
         *     fica `failed` com a mensagem do provedor e pode ser tentado de novo.
         */
        post: operations["requestOrderRefund"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/refunds/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Tentar o reembolso de novo
         * @description Repete o estorno de um reembolso `failed` (`specs/011-vendas-e-checkout.md`, "Reembolso"),
         *     com a mesma cobrança e os mesmos itens; volta a `requested` e enfileira `refund.execute`.
         *     Só o `admin` (`order.refund`). Reembolso em `requested` ou `done`: `409`
         *     `refund_not_retryable`.
         */
        post: operations["retryRefund"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coupons": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Listar cupons
         * @description Cupons da escola, do mais novo para o mais antigo (`specs/011-vendas-e-checkout.md`,
         *     "Cupons"). Só o `admin` (`coupon.manage`); `manager` e `instructor` recebem `403`
         *     `permission_denied`. Busca pelo código (sem diferenciar maiúsculas) e filtros por situação
         *     e por `appliesTo`.
         */
        get: operations["listCoupons"];
        put?: never;
        /**
         * Criar cupom
         * @description Só o `admin` (`specs/011-vendas-e-checkout.md`, "Cupons"). O código é único sem diferenciar
         *     maiúsculas: repetido, `409` `coupon_code_taken`. `percent` exige `percentOff` de 1 a 100 e
         *     `fixed` exige `amountOffCents` maior que zero; combinação diferente disso, inclusive os dois
         *     ou nenhum campo: `422` `coupon_invalid`. `maxUses` nulo é ilimitado e `maxUsesPerUser` tem
         *     padrão 1; `appliesTo` tem padrão `orders` e `active` tem padrão `true`. `products` vazia ou
         *     ausente vale para todos os produtos; produtos inexistentes: `422` `coupon_invalid`.
         */
        post: operations["createCoupon"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/coupons/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Um cupom
         * @description Só o `admin` (`coupon.manage`); inexistente: `404` `not_found`.
         */
        get: operations["getCoupon"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Editar ou desativar cupom
         * @description Só o `admin` (`specs/011-vendas-e-checkout.md`); a desativação é `active: false`, não há
         *     exclusão. Só os campos enviados mudam; `products` enviada substitui a lista inteira e
         *     `products: []` volta a valer para todos. O código novo é único sem diferenciar maiúsculas:
         *     repetido, `409` `coupon_code_taken`. A combinação resultante precisa continuar válida
         *     (desconto casando com `kind`, `endsAt` depois de `startsAt`, limites dentro da faixa):
         *     senão, `422` `coupon_invalid`. Baixar `maxUses` abaixo do já usado é permitido: os pedidos
         *     pagos são honrados e o excesso fica registrado.
         */
        patch: operations["updateCoupon"];
        trace?: never;
    };
    "/api/v1/payments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Listar cobranças
         * @description Cobranças conhecidas (`specs/013-pagamentos-mercado-pago.md`), do mais recente ao mais
         *     antigo, de pedidos e de assinaturas; `manager` e `admin` consultam (`specs/008-papeis-e-permissoes.md`).
         *     Cada item traz `orderId`/`orderNumber` quando é de pedido e `subscriptionId` quando é de
         *     assinatura, nunca os dois. Nenhum dado de cartão, token ou corpo do provedor.
         */
        get: operations["listPayments"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/payments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Uma cobrança
         * @description A cobrança, com o estado normalizado, o estado original do provedor e os reembolsos
         *     relacionados (`specs/013-pagamentos-mercado-pago.md`). `manager` e `admin`; inexistente:
         *     `404` `not_found`.
         */
        get: operations["getPayment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/webhook-events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Avisos de pagamento com falha
         * @description Só o `admin` (`ops.manage`, `specs/008-papeis-e-permissoes.md`; `specs/013-pagamentos-mercado-pago.md`,
         *     "Webhook"). `status=failed` (padrão) é a fila de falhas operacionais, cujo evento pode ser
         *     reprocessado. `status=rejected` mostra a trilha de segurança das assinaturas recusadas,
         *     somente leitura: sem corpo, sem cabeçalhos e sem assinatura, e sem ação de reprocessar. Um
         *     evento `rejected` não entra na fila de falhas. Os dois filtros trazem do mais recente ao
         *     mais antigo e a trilha `rejected` fica retida por 90 dias.
         */
        get: operations["listWebhookEvents"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/webhook-events/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reprocessar aviso com falha
         * @description Só o `admin` (`ops.manage`) e somente evento `failed` (`specs/013-pagamentos-mercado-pago.md`):
         *     volta a `received` e enfileira `payment.webhook` de novo. Evento `rejected` nunca é
         *     reprocessado, e `processed`, `ignored` ou `received` também não: `409`
         *     `webhook_event_not_retryable`. O evento volta com o estado novo.
         */
        post: operations["retryWebhookEvent"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/payments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Estado da integração de pagamento
         * @description Só o `admin` (`settings.manage`, `specs/007-contas-e-autenticacao.md` e
         *     `specs/013-pagamentos-mercado-pago.md`, "Modo de teste"): o provedor em uso, se o token é de
         *     teste, o aviso de produção com token de teste e a última reconciliação. Nunca devolve
         *     token, chave pública, segredo do webhook nem URL com credencial.
         */
        get: operations["getPaymentSettings"];
        put?: never;
        post?: never;
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
         * Listar planos
         * @description Planos da escola, por `position` e depois pelo título (`specs/012-assinaturas.md`,
         *     "Planos"). Só o `admin` (`plan.manage`); `manager` e `instructor` recebem `403`
         *     `permission_denied`. Busca por título ou slug, filtros por situação, periodicidade e
         *     `groupKey`. Cada plano traz os itens que libera e quantas assinaturas tem.
         *
         *     `subscriptionCount` conta todas as assinaturas do plano, inclusive `ended` e `expired`:
         *     é o vínculo que impede excluir o plano, por isso ele só é desativado (`active: false`).
         */
        get: operations["listPlans"];
        put?: never;
        /**
         * Criar plano
         * @description Cria um plano de assinatura (`specs/012-assinaturas.md`, "Planos"). Só o `admin`
         *     (`plan.manage`); `manager` e `instructor` recebem `403` `permission_denied`. A ação é
         *     registrada na auditoria (`specs/028-auditoria.md`).
         *
         *     `groupKey` agrupa as periodicidades do mesmo conteúdo na vitrine: os planos mensal e
         *     anual do mesmo conteúdo usam a mesma chave, e `(groupKey, interval)` é única — repetida:
         *     `409 plan_group_conflict`. `slug` é o identificador público e, quando ausente, é gerado de
         *     `groupKey` e `interval`; repetido: `409 plan_slug_taken`. `slug`, `groupKey` e `interval`
         *     não mudam depois da criação.
         *
         *     `includesAll` verdadeiro libera todo produto publicado `paid` ou `open`, atual e futuro,
         *     e exige `items` vazia; `includesPrivate` só é aceito junto de `includesAll`. Violação:
         *     `422 plan_invalid`. Item com produto inexistente, tipo que não seja curso, pacote ou
         *     ebook, ou repetido: `422 plan_item_invalid`. `items` vazia com `includesAll` falso é
         *     aceita: o admin pode completar a lista antes de ativar o plano.
         *
         *     A criação não depende do provedor (`specs/013-pagamentos-mercado-pago.md`, "Interface
         *     `PaymentProvider`"): o plano é gravado e o `ensurePlan` roda em segundo plano, então
         *     `providerPlanId` vem `null` até o provedor devolver o identificador. Provedor fora do ar
         *     não impede criar nem editar plano.
         */
        post: operations["createPlan"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/plans/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Um plano
         * @description O plano com os itens e a contagem de assinaturas (`specs/012-assinaturas.md`). Só o
         *     `admin` (`plan.manage`); inexistente: `404 not_found`.
         */
        get: operations["getPlan"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /**
         * Editar ou desativar plano
         * @description Edição parcial (`specs/012-assinaturas.md`, "Planos"): só os campos enviados mudam. Só o
         *     `admin` (`plan.manage`); a ação é registrada na auditoria (`specs/028-auditoria.md`).
         *     `slug`, `groupKey` e `interval` não mudam depois da criação: outro conteúdo ou outra
         *     periodicidade é um plano novo. Desativar é `active: false`; não há exclusão.
         *
         *     Mudar `priceCents` vale para novas assinaturas, e as existentes mantêm o preço contratado
         *     (o `priceCents` copiado para a assinatura). Mudar `includesAll` ou `includesPrivate`
         *     recalcula os direitos das assinaturas ativas pelo worker
         *     (`specs/010-direitos-de-acesso.md`); passar `includesAll` a verdadeiro limpa os itens.
         *     `includesPrivate` verdadeiro com `includesAll` falso: `422 plan_invalid`. O `ensurePlan`
         *     no provedor roda em segundo plano quando o preço muda; provedor fora do ar não impede a
         *     edição (`specs/013-pagamentos-mercado-pago.md`).
         */
        patch: operations["updatePlan"];
        trace?: never;
    };
    "/api/v1/plans/{id}/items": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /**
         * Definir os itens do plano
         * @description Substitui a lista de cursos, pacotes e ebooks que o plano libera
         *     (`specs/012-assinaturas.md`, "Planos"). Só o `admin` (`plan.manage`); a ação é registrada
         *     na auditoria (`specs/028-auditoria.md`). `items: []` esvazia a lista. Os direitos das
         *     assinaturas ativas são recalculados pelo worker (`specs/010-direitos-de-acesso.md`), sem
         *     mudar o preço contratado.
         *
         *     Plano com `includesAll` verdadeiro não usa lista: `422 plan_invalid`. Produto
         *     inexistente, tipo fora de curso, pacote e ebook, ou item repetido: `422
         *     plan_item_invalid`. Plano inexistente: `404 not_found`.
         */
        put: operations["replacePlanItems"];
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
        /**
         * Listar assinaturas
         * @description Assinaturas da escola, da mais nova para a mais antiga (`specs/012-assinaturas.md`,
         *     "Interfaces e contratos"), com filtros por período, estado, plano, assinante e busca por
         *     nome ou e-mail. `manager` e `admin` consultam (`sales.view`); `instructor` recebe `403`
         *     `permission_denied` (`specs/008-papeis-e-permissoes.md`). O documento fiscal do assinante
         *     não sai aqui, só na ficha do usuário.
         */
        get: operations["listSubscriptions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/subscriptions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Uma assinatura
         * @description A assinatura com o assinante, o plano atual (preço, itens e periodicidade), o período, a
         *     carência e as cobranças com os reembolsos de cada uma
         *     (`specs/012-assinaturas.md`, "Interfaces e contratos"). `manager` e `admin` veem;
         *     `instructor` recebe `403`. `currentPeriodPaymentId` aponta a cobrança que abriu o período
         *     em curso: reembolsá-la por inteiro encerra a assinatura na hora. Inexistente: `404
         *     not_found`.
         *     O documento fiscal do assinante não sai aqui.
         */
        get: operations["getSubscription"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/subscriptions/{id}/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Cancelar assinatura de um aluno
         * @description Cancela a assinatura de um aluno (`specs/012-assinaturas.md`, "Cancelamento"). Só o
         *     `admin` (`subscription.cancel`); `manager` recebe `403` `permission_denied`
         *     (`specs/008-papeis-e-permissoes.md`). A ação é registrada na auditoria
         *     (`specs/028-auditoria.md`), com o motivo obrigatório.
         *
         *     Em `active` ou `past_due`, cancela a recorrência no provedor na hora e a assinatura vai a
         *     `canceling`; o acesso segue até `currentPeriodEnd`, sem carência adicional, e o worker a
         *     encerra em `ended`. Em `past_due`, o cancelamento encerra a carência. Em `suspended`,
         *     encerra a assinatura na hora (`ended`) e cancela a recorrência no provedor, sem esperar
         *     os 30 dias. Não há reativação antes do fim do período: o aluno assina de novo.
         *
         *     `pending` e `expired` respondem `409 subscription_not_cancelable`: a `pending` expira em
         *     30 min e o próprio aluno pode cancelá-la; a `expired` nunca foi paga. Se o provedor não
         *     confirmar o cancelamento, a resposta é `503 payment_provider_unavailable` e nada muda: a
         *     tentativa pode ser repetida.
         */
        post: operations["cancelSubscription"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/subscriptions/{id}/payments/{paymentId}/refund": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reembolsar cobrança da assinatura
         * @description Reembolsa uma cobrança recorrente (`specs/012-assinaturas.md`, "Reembolso de cobrança";
         *     `specs/011-vendas-e-checkout.md`, "Reembolso"). Só o `admin` (`order.refund`); `manager`
         *     recebe `403` `permission_denied`. Usa o mesmo fluxo de `refunds`: cria o reembolso em
         *     `requested` e enfileira `refund.execute`; a resposta é `202` e o desfecho chega depois,
         *     pelo worker, no detalhe da assinatura. O reembolso de cobrança recorrente tem `orderId`
         *     nulo e a lista de itens vazia.
         *
         *     `amountCents` ausente ou nulo estorna o saldo não reembolsado da cobrança inteira; valor
         *     parcial é aceito, desde que não passe desse saldo. Reembolsar por inteiro a cobrança do
         *     período em curso encerra a assinatura na hora (`ended`) e revoga os direitos com motivo
         *     `refund`; o reembolso parcial devolve o valor e a assinatura segue no estado em que está,
         *     com acesso até o fim do período pago. A cobrança de um período passado não altera o
         *     estado atual, qualquer que seja o valor.
         *
         *     `Idempotency-Key` é aceita: a repetição devolve o primeiro reembolso por 24 h.
         *
         *     Recusas, pelo `code`: `404 not_found` (assinatura ou cobrança inexistente, ou cobrança de
         *     outra assinatura); `409 payment_not_refundable` (cobrança que não está `approved` nem
         *     `partially_refunded`, ou já reembolsada por inteiro); `422 refund_exceeds_paid` (valor
         *     acima do saldo não reembolsado). Falha do estorno não é resposta desta rota: o reembolso
         *     fica `failed` com a mensagem do provedor e pode ser tentado de novo. A ação é registrada
         *     na auditoria (`specs/028-auditoria.md`).
         */
        post: operations["requestSubscriptionRefund"];
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
         * Fluxo do sino da equipe (SSE)
         * @description Conexão `text/event-stream` do sino do admin (`specs/003-admin-api.md`, "Fluxo SSE da
         *     equipe"; ADR 0028), aberta com a sessão do próprio host: uma conexão por aba e no máximo
         *     três por usuário, derrubando a mais antiga na quarta. Sem sessão: `401 unauthenticated`;
         *     sessão apenas `student`: `403 permission_denied`; suspensão `full` fecha a conexão.
         *
         *     Entrega somente `notification.created` destinado ao usuário da sessão, com o contador de
         *     não lidas; nenhum evento de outro usuário, mensagem direta ou conteúdo da comunidade. Os
         *     demais tipos do canal são descartados, sem entrega nem reenvio. O nome, os campos
         *     `id`/`event`/`data`, o `ping` de 25 s, o limite de 3 conexões, o reenvio por
         *     `Last-Event-ID` e a recarga na reconexão são os do classroom
         *     (`specs/004-classroom-api.md`, "Fluxo SSE"). Resposta sem compressão.
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
    "/api/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Central da equipe
         * @description Notificações do usuário da sessão, da mais nova para a mais antiga
         *     (`specs/024-notificacoes-e-email.md`, "Central"), paginadas por cursor. A equipe recebe
         *     aqui também as do grupo `staff` (`ticket.opened`, `report.created`, `ops.job_failed`...),
         *     no mesmo sino do site admin. O item traz o autor quando houver, `count` quando
         *     notificações do mesmo tipo e alvo foram fundidas e `data` com o conteúdo do tipo. Nunca
         *     devolve notificação de outra pessoa.
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
         * @description Não lidas do usuário da sessão: o número que o sino do admin mostra e que o evento SSE
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
         * Preferências da equipe por grupo
         * @description Canais efetivos dos onze grupos (`specs/024-notificacoes-e-email.md`, "Tipos e grupos"),
         *     para o usuário da sessão. Grupo obrigatório devolve `emailRequired: true`, com o e-mail
         *     sempre ligado; o grupo `account` não tem canal plataforma (`inAppAvailable: false`).
         *     Grupo `staff` só tem efeito para a equipe, que é quem usa esta API.
         */
        get: operations["getNotificationPrefs"];
        /**
         * Gravar preferências da equipe por grupo
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
    "/api/v1/ops/summary": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Resumo da operação
         * @description Números da tela "Operação" e do selo do menu
         *     (`specs/033-observabilidade-retencao-backup.md`, "Tela Operação"): a fila por tipo com a
         *     idade da tarefa pendente mais antiga, os e-mails pendentes e com falha, os webhooks com
         *     falha e o bloco do sistema. `failures` soma o que o selo mostra; zero significa nenhuma
         *     falha. Só o `admin` (`ops.manage`).
         */
        get: operations["getOpsSummary"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ops/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Fila por estado
         * @description Tarefas da fila, da mais antiga para a mais nova (`specs/005-worker-e-fila.md`,
         *     "Dados"): pendentes (`queued`), em execução (`running`) e com falha (`failed`). Tarefas
         *     concluídas não aparecem. `payload` e dados de trava não saem; `lastError` já vem
         *     mascarado pelo worker.
         */
        get: operations["listOpsJobs"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ops/jobs/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reenfileirar tarefa com falha
         * @description A tarefa `failed` volta a `queued` para agora, com `attempts = 0`; `lastError` fica como
         *     registro (`specs/005-worker-e-fila.md`, "Interfaces e contratos"). A ação grava
         *     auditoria. `404 not_found` se não existe; `409 job_not_failed` se não está `failed`;
         *     `409 job_already_active` se já existe tarefa `queued` ou `running` com a mesma
         *     `uniqueKey`.
         */
        post: operations["retryOpsJob"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ops/jobs/{id}": {
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
         * Descartar tarefa com falha
         * @description Apaga a tarefa `failed` (`specs/005-worker-e-fila.md`). `404 not_found` se não existe;
         *     `409 job_not_failed` se não está `failed`. A ação grava auditoria.
         */
        delete: operations["discardOpsJob"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ops/emails": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * E-mails pendentes e com falha
         * @description Linhas de `email_outbox` que ainda não saíram: `queued` e `failed`
         *     (`specs/024-notificacoes-e-email.md`, "E-mail"; `specs/033-observabilidade-retencao-backup.md`,
         *     "Tela Operação"). O destinatário sai mascarado, e `lastError` traz o motivo do SMTP. O
         *     corpo renderizado do e-mail não é guardado e não aparece aqui.
         */
        get: operations["listOpsEmails"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/ops/emails/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reenviar e-mail com falha
         * @description O "reenviar" da tela de operação devolve o e-mail `failed` a `queued`
         *     (`specs/024-notificacoes-e-email.md`, "E-mail"): a tarefa `email.send` é enfileirada de
         *     novo com as tentativas da RNF-02. A ação grava auditoria. `404 not_found` se não existe;
         *     `409 email_not_failed` se a linha não está `failed`.
         */
        post: operations["retryOpsEmail"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/settings/branding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Identidade da escola nos e-mails
         * @description Nome, logotipo, cor de destaque e rodapé usados nos e-mails de notificação
         *     (`specs/024-notificacoes-e-email.md`, "E-mail"). O admin edita só a identidade; os
         *     modelos completos ficam no código do worker e não são editáveis por aqui. Leitura e
         *     escrita são do `admin` (`settings.manage`).
         */
        get: operations["getBranding"];
        /**
         * Gravar a identidade da escola nos e-mails
         * @description Grava os quatro campos juntos (`specs/024-notificacoes-e-email.md`): nome, logotipo, cor
         *     de destaque e rodapé. O rodapé tem até 500 caracteres e aceita quebras de linha; nulo
         *     remove. Nome e cor passam pelas mesmas validações do `/meta`; valor inválido é
         *     `400 validation_failed` com o campo em `errors[]`.
         *
         *     O logotipo é enviado antes por `POST /api/v1/images` com `purpose` `school_logo`, e
         *     `logoImageId` é o identificador devolvido, não o caminho; o `logoUrl` da leitura aponta
         *     para a variante de 256. `logoImageId` precisa ser uma imagem existente, não oculta e de
         *     finalidade `school_logo` (ou nulo): outro valor é `422` `image_purpose_mismatch` e nada é
         *     gravado. A ação grava auditoria.
         */
        put: operations["saveBranding"];
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
         * @description Nome da variante na URL (`specs/029-imagens.md`): a largura do arquivo gerado nas
         *     finalidades com corte e o maior lado nas de proporção original.
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
        /**
         * @description Finalidade da imagem enviada pelo admin (`specs/029-imagens.md`). `product_cover` é a capa
         *     de curso, ebook e pacote, de `instructor`, `manager` e `admin`; `school_logo` é o logotipo
         *     da escola, só do `admin`, enviado antes de `PUT /api/v1/settings/branding`.
         * @enum {string}
         */
        ImagePurpose: "product_cover" | "school_logo";
        /**
         * @description Uma variante gerada da imagem enviada. `width` é o nome da variante — a largura nas
         *     finalidades com corte e o maior lado do arquivo gerado nas de proporção original —, e
         *     `height` é a altura real gravada.
         */
        ImageVariantInfo: {
            width: components["schemas"]["ImageVariantWidth"];
            /**
             * @description Altura real do arquivo gerado. Na variante retrato de finalidade de proporção
             *     original, a largura real não é gravada: sai da proporção de `width`/`height` da
             *     imagem enviada.
             */
            height: number;
            /**
             * Format: uri-reference
             * @description Caminho de entrega (`/api/v1/images/{imageId}/{variant}.webp`).
             * @example /api/v1/images/0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70/480.webp
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
        /** @description Um curso na lista do admin. */
        CourseSummary: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            summary: string | null;
            cover: components["schemas"]["ProductCover"] | null;
            accessMode: components["schemas"]["AccessMode"];
            /** @description Preço em centavos; `null` fora do modo `paid`. */
            priceCents: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays: number | null;
            status: components["schemas"]["PublicationStatus"];
            level: components["schemas"]["CourseLevel"] | null;
            /** @description Instrutor dono; `null` sem dono. */
            owner: components["schemas"]["UserRef"] | null;
            /** @description Pedido de publicação pendente (`request-review`). */
            reviewRequestedAt: components["schemas"]["DateTime"] | null;
            moduleCount: number;
            /** @description Aulas publicadas. */
            lessonCount: number;
            /** @description Soma das durações das aulas publicadas. */
            durationSeconds: number;
            publishedAt: components["schemas"]["DateTime"] | null;
            /** @description Preenchido quando arquivado: fora do classroom em definitivo. */
            archivedAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        CourseSummaryPage: components["schemas"]["Page"] & {
            items: components["schemas"]["CourseSummary"][];
        };
        /** @description O curso para o editor, com módulos e aulas na ordem. */
        CourseDetail: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            summary: string | null;
            cover: components["schemas"]["ProductCover"] | null;
            accessMode: components["schemas"]["AccessMode"];
            /** @description Preço em centavos; `null` fora do modo `paid`. */
            priceCents: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays: number | null;
            status: components["schemas"]["PublicationStatus"];
            level: components["schemas"]["CourseLevel"] | null;
            owner: components["schemas"]["UserRef"] | null;
            reviewRequestedAt: components["schemas"]["DateTime"] | null;
            moduleCount: number;
            /** @description Aulas publicadas. */
            lessonCount: number;
            durationSeconds: number;
            publishedAt: components["schemas"]["DateTime"] | null;
            /** @description Preenchido quando arquivado: fora do classroom em definitivo. */
            archivedAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
            /** @description Markdown. */
            description: string | null;
            certificateEnabled: boolean;
            /** @description Carga horária fixada; `null` é calculada pelas aulas publicadas. */
            certificateHours: number | null;
            version: components["schemas"]["CatalogVersion"];
            /** @description Alunos com direito ativo ao produto, para os avisos de despublicar e de remover item. */
            studentCount: number;
            modules: components["schemas"]["CourseModule"][];
            /**
             * @description Ebooks vinculados ao curso (`product_ebooks` com alvo `course`), em qualquer estado, por
             *     título. Os das aulas vêm no detalhe de cada aula.
             */
            ebooks: components["schemas"]["EbookRef"][];
        };
        CourseCreate: {
            slug?: components["schemas"]["Slug"];
            title: string;
            summary?: string | null;
            /** @description Markdown, exibido sanitizado. */
            description?: string | null;
            /** @description Imagem `product_cover` enviada antes por `POST /api/v1/images`; `null` remove. */
            coverImageId?: components["schemas"]["Uuid"] | null;
            level?: components["schemas"]["CourseLevel"] | null;
            accessMode?: components["schemas"]["AccessMode"];
            /**
             * @description Preço em centavos; exige `product.set_price` (só `admin`; outro papel: `403`). Obrigatório
             *     (≥ 0) quando o modo é `paid`; `null` nos demais.
             */
            priceCents?: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays?: number | null;
            /** @description Só `manager` e `admin`. */
            ownerId?: components["schemas"]["Uuid"] | null;
        };
        /**
         * @description Só os campos enviados mudam; além de `version` (obrigatória), ao menos um campo. Sem
         *     `version`: `400`; diferente da gravada: `409` `version_conflict`.
         */
        CourseUpdate: {
            slug?: components["schemas"]["Slug"];
            title?: string;
            summary?: string | null;
            /** @description Markdown, exibido sanitizado. */
            description?: string | null;
            /** @description Imagem `product_cover` enviada antes por `POST /api/v1/images`; `null` remove. */
            coverImageId?: components["schemas"]["Uuid"] | null;
            level?: components["schemas"]["CourseLevel"] | null;
            accessMode?: components["schemas"]["AccessMode"];
            /**
             * @description Preço em centavos; exige `product.set_price` (só `admin`; outro papel: `403`). Obrigatório
             *     (≥ 0) quando o modo é `paid`; `null` nos demais.
             */
            priceCents?: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays?: number | null;
            certificateEnabled?: boolean;
            certificateHours?: number | null;
            version: components["schemas"]["CatalogVersionInput"];
        };
        /** @description Um módulo, com as aulas na ordem (rascunhos inclusive). */
        CourseModule: {
            id: components["schemas"]["Uuid"];
            courseId: components["schemas"]["Uuid"];
            title: string;
            position: number;
            version: components["schemas"]["CatalogVersion"];
            lessons: components["schemas"]["LessonSummary"][];
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        CourseModuleList: {
            items: components["schemas"]["CourseModule"][];
        };
        LessonSummary: {
            id: components["schemas"]["Uuid"];
            moduleId: components["schemas"]["Uuid"];
            title: string;
            status: components["schemas"]["PublicationStatus"];
            isSample: boolean;
            /** @description `0`: não informada. */
            durationSeconds: number;
            videoProvider: components["schemas"]["VideoProvider"] | null;
            position: number;
        };
        /** @description A aula para o editor. */
        LessonDetail: {
            id: components["schemas"]["Uuid"];
            courseId: components["schemas"]["Uuid"];
            moduleId: components["schemas"]["Uuid"];
            title: string;
            /** @description Markdown. */
            description: string | null;
            /**
             * @description No MVP, só `video`.
             * @constant
             */
            type: "video";
            status: components["schemas"]["PublicationStatus"];
            isSample: boolean;
            videoUrl: string | null;
            videoProvider: components["schemas"]["VideoProvider"] | null;
            /** @description `0`: não informada. */
            durationSeconds: number;
            position: number;
            version: components["schemas"]["CatalogVersion"];
            links: components["schemas"]["LessonLink"][];
            /** @description Ebooks vinculados à aula (`product_ebooks` com alvo `lesson`). */
            ebooks: components["schemas"]["EbookRef"][];
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        LessonCreate: {
            title: string;
            /** @description Markdown, exibido sanitizado. */
            description?: string | null;
            /**
             * @description Vídeo principal. Regras de URL de conteúdo (`specs/009-catalogo-e-conteudo.md`): `https` (`http`
             *     só em
             *     `*.localhost`), sem credenciais, sem espaços, até 2.000 caracteres; fora delas, `422`
             *     `content_url_invalid` com o campo e o motivo. A URL nunca é buscada pelo servidor.
             */
            videoUrl?: string | null;
            /**
             * @description Informada pelo autor; o sistema não mede vídeo externo. Ausente ou `null` grava `0`
             *     ("não informada"); a resposta traz sempre o inteiro.
             */
            durationSeconds?: number | null;
            /** @default false */
            isSample: boolean;
        };
        /**
         * @description Só os campos enviados mudam; além de `version` (obrigatória), ao menos um campo. Sem
         *     `version`: `400`; diferente da gravada: `409` `version_conflict`.
         */
        LessonUpdate: {
            title?: string;
            /** @description Markdown, exibido sanitizado. */
            description?: string | null;
            /**
             * @description Vídeo principal. Regras de URL de conteúdo (`specs/009-catalogo-e-conteudo.md`): `https` (`http`
             *     só em
             *     `*.localhost`), sem credenciais, sem espaços, até 2.000 caracteres; fora delas, `422`
             *     `content_url_invalid` com o campo e o motivo. A URL nunca é buscada pelo servidor.
             */
            videoUrl?: string | null;
            /** @description `null` grava `0` ("não informada"); a resposta traz sempre o inteiro. */
            durationSeconds?: number | null;
            isSample?: boolean;
            status?: components["schemas"]["PublicationStatus"];
            version: components["schemas"]["CatalogVersionInput"];
        };
        /**
         * @description Versão do item do catálogo (`specs/009-catalogo-e-conteudo.md`, "Criação e edição"): começa
         *     em 1 e avança a cada gravação no item, inclusive ações e trocas de lista. Quem edita envia a
         *     da última resposta.
         */
        CatalogVersion: number;
        /**
         * @description O `version` da última resposta do item. Diferente do gravado: `409` `version_conflict`,
         *     sem gravar; o site relê o item e a pessoa refaz a edição.
         */
        CatalogVersionInput: number;
        EbookRef: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            status: components["schemas"]["PublicationStatus"];
        };
        /** @description Um ebook na lista do admin. */
        EbookSummary: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            summary: string | null;
            cover: components["schemas"]["ProductCover"] | null;
            accessMode: components["schemas"]["AccessMode"];
            /** @description Preço em centavos; `null` fora do modo `paid`. */
            priceCents: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays: number | null;
            status: components["schemas"]["PublicationStatus"];
            authorName: string | null;
            pages: number | null;
            publishedAt: components["schemas"]["DateTime"] | null;
            /** @description Preenchido quando arquivado: fora do classroom em definitivo. */
            archivedAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        EbookSummaryPage: components["schemas"]["Page"] & {
            items: components["schemas"]["EbookSummary"][];
        };
        /**
         * @description Alvo de um vínculo de ebook (`product_ebooks`), na leitura. `bundle` vem só de carga direta
         *     no banco e vale na cascata (`specs/010-direitos-de-acesso.md`): o admin não o cria nem o
         *     remove (pôr um ebook num pacote é `PUT /bundles/{id}/items`), só o lê. Na escrita de
         *     vínculos, o alvo é `course` ou `lesson`.
         * @enum {string}
         */
        EbookTargetType: "course" | "bundle" | "lesson";
        EbookTarget: {
            targetType: components["schemas"]["EbookTargetType"];
            targetId: components["schemas"]["Uuid"];
            /** @description Título do curso, do pacote ou da aula. */
            title: string;
            /** @description O curso da aula, em vínculo `lesson`; `null` nos demais. */
            course: components["schemas"]["ProductRef"] | null;
        };
        EbookDetail: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            summary: string | null;
            cover: components["schemas"]["ProductCover"] | null;
            accessMode: components["schemas"]["AccessMode"];
            /** @description Preço em centavos; `null` fora do modo `paid`. */
            priceCents: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays: number | null;
            status: components["schemas"]["PublicationStatus"];
            authorName: string | null;
            pages: number | null;
            publishedAt: components["schemas"]["DateTime"] | null;
            /** @description Preenchido quando arquivado: fora do classroom em definitivo. */
            archivedAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
            /** @description Markdown. */
            description: string | null;
            /** @description Link externo do arquivo. */
            fileUrl: string | null;
            version: components["schemas"]["CatalogVersion"];
            /**
             * @description Os vínculos que quem pede alcança: o `instructor`, só os dos próprios cursos e aulas;
             *     `manager` e `admin`, todos, inclusive os `bundle` (só leitura).
             */
            targets: components["schemas"]["EbookTarget"][];
            /** @description Alunos com direito ativo ao produto, para os avisos de despublicar e de remover item. */
            studentCount: number;
        };
        EbookCreate: {
            slug?: components["schemas"]["Slug"];
            title: string;
            summary?: string | null;
            /** @description Markdown, exibido sanitizado. */
            description?: string | null;
            /** @description Imagem `product_cover` enviada antes por `POST /api/v1/images`; `null` remove. */
            coverImageId?: components["schemas"]["Uuid"] | null;
            authorName?: string | null;
            /**
             * @description Arquivo do ebook. Regras de URL de conteúdo (`specs/009-catalogo-e-conteudo.md`): `https`
             *     (`http` só em
             *     `*.localhost`), sem credenciais, sem espaços, até 2.000 caracteres; fora delas, `422`
             *     `content_url_invalid` com o campo e o motivo. A URL nunca é buscada pelo servidor.
             */
            fileUrl?: string | null;
            pages?: number | null;
            accessMode?: components["schemas"]["AccessMode"];
            /**
             * @description Preço em centavos; exige `product.set_price` (só `admin`; outro papel: `403`). Obrigatório
             *     (≥ 0) quando o modo é `paid`; `null` nos demais.
             */
            priceCents?: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays?: number | null;
        };
        /**
         * @description Só os campos enviados mudam; além de `version` (obrigatória), ao menos um campo. Sem
         *     `version`: `400`; diferente da gravada: `409` `version_conflict`.
         */
        EbookUpdate: {
            slug?: components["schemas"]["Slug"];
            title?: string;
            summary?: string | null;
            /** @description Markdown, exibido sanitizado. */
            description?: string | null;
            /** @description Imagem `product_cover` enviada antes por `POST /api/v1/images`; `null` remove. */
            coverImageId?: components["schemas"]["Uuid"] | null;
            authorName?: string | null;
            /**
             * @description Arquivo do ebook. Regras de URL de conteúdo (`specs/009-catalogo-e-conteudo.md`): `https`
             *     (`http` só em
             *     `*.localhost`), sem credenciais, sem espaços, até 2.000 caracteres; fora delas, `422`
             *     `content_url_invalid` com o campo e o motivo. A URL nunca é buscada pelo servidor.
             */
            fileUrl?: string | null;
            pages?: number | null;
            accessMode?: components["schemas"]["AccessMode"];
            /**
             * @description Preço em centavos; exige `product.set_price` (só `admin`; outro papel: `403`). Obrigatório
             *     (≥ 0) quando o modo é `paid`; `null` nos demais.
             */
            priceCents?: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays?: number | null;
            version: components["schemas"]["CatalogVersionInput"];
        };
        /** @description Um produto citado por outro registro. */
        ProductRef: {
            type: components["schemas"]["ProductType"];
            id: components["schemas"]["Uuid"];
            title: string;
        };
        /** @description Um pacote na lista do admin. */
        BundleSummary: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            summary: string | null;
            cover: components["schemas"]["ProductCover"] | null;
            accessMode: components["schemas"]["AccessMode"];
            /** @description Preço em centavos; `null` fora do modo `paid`. */
            priceCents: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays: number | null;
            status: components["schemas"]["PublicationStatus"];
            itemCount: number;
            publishedAt: components["schemas"]["DateTime"] | null;
            /** @description Preenchido quando arquivado: fora do classroom em definitivo. */
            archivedAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        BundleSummaryPage: components["schemas"]["Page"] & {
            items: components["schemas"]["BundleSummary"][];
        };
        BundleItem: {
            /** @enum {string} */
            productType: "course" | "ebook";
            productId: components["schemas"]["Uuid"];
            title: string;
            accessMode: components["schemas"]["AccessMode"];
            priceCents: number | null;
            status: components["schemas"]["PublicationStatus"];
            archived: boolean;
            position: number;
        };
        BundleDetail: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            title: string;
            summary: string | null;
            cover: components["schemas"]["ProductCover"] | null;
            accessMode: components["schemas"]["AccessMode"];
            /** @description Preço em centavos; `null` fora do modo `paid`. */
            priceCents: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays: number | null;
            status: components["schemas"]["PublicationStatus"];
            itemCount: number;
            publishedAt: components["schemas"]["DateTime"] | null;
            /** @description Preenchido quando arquivado: fora do classroom em definitivo. */
            archivedAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
            /** @description Markdown. */
            description: string | null;
            version: components["schemas"]["CatalogVersion"];
            items: components["schemas"]["BundleItem"][];
            /** @description Soma dos preços avulsos dos itens `paid`, para mostrar a economia. */
            itemsPriceCents: number;
            /** @description Alunos com direito ativo ao produto, para os avisos de despublicar e de remover item. */
            studentCount: number;
        };
        BundleCreate: {
            slug?: components["schemas"]["Slug"];
            title: string;
            summary?: string | null;
            /** @description Markdown, exibido sanitizado. */
            description?: string | null;
            /** @description Imagem `product_cover` enviada antes por `POST /api/v1/images`; `null` remove. */
            coverImageId?: components["schemas"]["Uuid"] | null;
            accessMode?: components["schemas"]["AccessMode"];
            /**
             * @description Preço em centavos; exige `product.set_price` (só `admin`; outro papel: `403`). Obrigatório
             *     (≥ 0) quando o modo é `paid`; `null` nos demais.
             */
            priceCents?: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays?: number | null;
        };
        /**
         * @description Só os campos enviados mudam; além de `version` (obrigatória), ao menos um campo. Sem
         *     `version`: `400`; diferente da gravada: `409` `version_conflict`.
         */
        BundleUpdate: {
            slug?: components["schemas"]["Slug"];
            title?: string;
            summary?: string | null;
            /** @description Markdown, exibido sanitizado. */
            description?: string | null;
            /** @description Imagem `product_cover` enviada antes por `POST /api/v1/images`; `null` remove. */
            coverImageId?: components["schemas"]["Uuid"] | null;
            accessMode?: components["schemas"]["AccessMode"];
            /**
             * @description Preço em centavos; exige `product.set_price` (só `admin`; outro papel: `403`). Obrigatório
             *     (≥ 0) quando o modo é `paid`; `null` nos demais.
             */
            priceCents?: number | null;
            /** @description Dias de acesso a partir da compra; `null` é vitalício. */
            accessDays?: number | null;
            version: components["schemas"]["CatalogVersionInput"];
        };
        /**
         * @description Fonte do direito (`specs/010-direitos-de-acesso.md`, "Fontes").
         * @enum {string}
         */
        EntitlementSource: "order" | "subscription" | "grant" | "cascade";
        /**
         * @description `active` (vigente), `scheduled` (`startsAt` no futuro), `expired` (passou de `expiresAt`) ou
         *     `revoked`.
         * @enum {string}
         */
        EntitlementState: "active" | "scheduled" | "expired" | "revoked";
        /** @enum {string} */
        RevokeReason: "refund" | "chargeback" | "subscription_ended" | "manual" | "recalculation" | "account_deleted";
        /** @description Um direito com os derivados dele. */
        EntitlementNode: {
            id: components["schemas"]["Uuid"];
            product: components["schemas"]["ProductRef"];
            source: components["schemas"]["EntitlementSource"];
            sourceId: components["schemas"]["Uuid"];
            parentEntitlementId: components["schemas"]["Uuid"] | null;
            state: components["schemas"]["EntitlementState"];
            startsAt: components["schemas"]["DateTime"];
            /** @description `null` é vitalício. */
            expiresAt: components["schemas"]["DateTime"] | null;
            revokedAt: components["schemas"]["DateTime"] | null;
            revokeReason: components["schemas"]["RevokeReason"] | null;
            /** @description Motivo, só em `grant`. */
            grantedReason: string | null;
            /** @description Quem concedeu, só em `grant`. */
            grantedBy: components["schemas"]["UserRef"] | null;
            createdAt: components["schemas"]["DateTime"];
            /** @description Direitos derivados (cascata), até a profundidade 2. */
            children: components["schemas"]["EntitlementNode"][];
        };
        EntitlementTree: {
            /** @description As raízes, mais recentes primeiro. */
            items: components["schemas"]["EntitlementNode"][];
        };
        /** @description Aluno citado em listas de curso: nome e avatar, sem e-mail. */
        StudentRef: {
            id: components["schemas"]["Uuid"];
            name: string;
            /**
             * Format: uri-reference
             * @description Variante de 256 px do avatar; `null` sem avatar.
             */
            avatarUrl: string | null;
        };
        ProductEntitlement: {
            id: components["schemas"]["Uuid"];
            user: components["schemas"]["StudentRef"];
            source: components["schemas"]["EntitlementSource"];
            /** @description Produto da raiz, quando o direito é derivado (pacote ou curso). */
            via: components["schemas"]["ProductRef"] | null;
            state: components["schemas"]["EntitlementState"];
            startsAt: components["schemas"]["DateTime"];
            expiresAt: components["schemas"]["DateTime"] | null;
            revokedAt: components["schemas"]["DateTime"] | null;
        };
        ProductEntitlementPage: components["schemas"]["Page"] & {
            items: components["schemas"]["ProductEntitlement"][];
        };
        /**
         * @description Estado do curso para o aluno (`specs/014-aprendizado-e-progresso.md`, "Progresso").
         * @enum {string}
         */
        CourseProgressState: "not_started" | "in_progress" | "completed";
        /** @description Progresso de um aluno num curso, sobre as aulas publicadas. */
        ProgressCounts: {
            completedLessons: number;
            /** @description Aulas publicadas. */
            totalLessons: number;
            percent: number;
            state: components["schemas"]["CourseProgressState"];
        };
        UserCourseProgress: {
            course: components["schemas"]["ProductRef"];
            progress: components["schemas"]["ProgressCounts"];
            lastActivityAt: components["schemas"]["DateTime"] | null;
            /** @description O certificado do curso, quando existe. */
            certificate: components["schemas"]["CertificateRef"] | null;
        };
        UserProgressList: {
            items: components["schemas"]["UserCourseProgress"][];
        };
        /** @description Resumo de progresso de um curso. */
        CourseProgressSummary: {
            courseId: components["schemas"]["Uuid"];
            totalLessons: number;
            /** @description Alunos com acesso ao curso. */
            studentCount: number;
            /** @description Alunos por faixa de progresso. */
            buckets: {
                notStarted: number;
                /** @description De 1% a 25%. */
                upTo25: number;
                /** @description De 26% a 50%. */
                upTo50: number;
                /** @description De 51% a 75%. */
                upTo75: number;
                /** @description De 76% a 99%. */
                upTo99: number;
                completed: number;
            };
            /** @description Concluídos ÷ alunos com acesso; 0 sem alunos. */
            completionRate: number;
        };
        CourseStudent: {
            user: components["schemas"]["StudentRef"];
            progress: components["schemas"]["ProgressCounts"];
            lastActivityAt: components["schemas"]["DateTime"] | null;
            /** @description Fim do acesso mais longo; `null` vitalício ou curso `open`. */
            accessExpiresAt: components["schemas"]["DateTime"] | null;
        };
        CourseStudentPage: components["schemas"]["Page"] & {
            items: components["schemas"]["CourseStudent"][];
        };
        CertificateRef: {
            id: components["schemas"]["Uuid"];
            /** @description Código com hífens (`XXXX-XXXX-XXXX`). */
            code: string;
            state: components["schemas"]["CertificateState"];
        };
        /** @description Um certificado, com os dados congelados na emissão. */
        Certificate: {
            id: components["schemas"]["Uuid"];
            /**
             * @description Código com hífens, sem `0`, `O`, `1`, `I` nem `L`.
             * @example ABCD-EFGH-JKMN
             */
            code: string;
            state: components["schemas"]["CertificateState"];
            user: components["schemas"]["UserRef"];
            course: components["schemas"]["ProductRef"];
            /** @description Congelado; `null` se a conta foi excluída. */
            studentName: string | null;
            /** @description Congelado na emissão. */
            courseTitle: string;
            instructorName: string | null;
            hours: number;
            completedAt: components["schemas"]["DateTime"];
            issuedAt: components["schemas"]["DateTime"];
            issuedManually: boolean;
            issuedBy: components["schemas"]["UserRef"] | null;
            issueReason: string | null;
            revokedAt: components["schemas"]["DateTime"] | null;
            revokedBy: components["schemas"]["UserRef"] | null;
            revokeReason: string | null;
            pdfRenderedAt: components["schemas"]["DateTime"] | null;
            templateVersionId: components["schemas"]["Uuid"];
        };
        CertificatePage: components["schemas"]["Page"] & {
            items: components["schemas"]["Certificate"][];
        };
        CertificateBackfillQueued: {
            courseId: components["schemas"]["Uuid"];
            /** @constant */
            queued: true;
        };
        /**
         * @description Origem do template efetivo: o do curso, o padrão da escola ou nenhum (o curso não emite
         *     certificado).
         * @enum {string}
         */
        CertificateTemplateSource: "course" | "school" | "none";
        /** @description Um template de certificado e a origem do efetivo. */
        CertificateTemplate: {
            source: components["schemas"]["CertificateTemplateSource"];
            /** @description O template deste recurso (do curso ou o padrão); `null` quando não tem. */
            html: string | null;
            /** @description Versão atual, enviada de volta em `expectedVersionId`. */
            versionId: components["schemas"]["Uuid"] | null;
            updatedAt: components["schemas"]["DateTime"] | null;
            updatedBy: components["schemas"]["UserRef"] | null;
        };
        /** @description O template gravado. */
        CertificateTemplateSaved: {
            source: components["schemas"]["CertificateTemplateSource"];
            html: string;
            versionId: components["schemas"]["Uuid"];
            updatedAt: components["schemas"]["DateTime"];
            updatedBy: components["schemas"]["UserRef"] | null;
            /** @description Verdadeiro quando a gravação enfileirou a emissão retroativa. */
            backfillQueued: boolean;
        };
        CertificateTemplateSave: {
            /**
             * @description Documento HTML completo ou fragmento, até 768 KiB em UTF-8, com as imagens embutidas (acima:
             *     problema `too_large`).
             */
            html: string;
            /** @description A versão que o editor abriu; `null` quando não havia template. */
            expectedVersionId: components["schemas"]["Uuid"] | null;
        };
        /**
         * @description Regra violada (`specs/015-certificados.md`, "Template").
         * @enum {string}
         */
        CertificateTemplateProblemRule: "parse_error" | "too_large" | "element_not_allowed" | "attribute_not_allowed" | "url_not_allowed" | "css_not_allowed" | "image_not_found" | "unknown_key" | "unclosed_key" | "key_in_attribute" | "missing_required_key";
        CertificateTemplateProblem: {
            rule: components["schemas"]["CertificateTemplateProblemRule"];
            message: string;
            /** @description Linha no HTML enviado, a partir de 1; problema do documento inteiro vem em 1:1. */
            line: number;
            column: number;
        };
        /**
         * @description `Problem` de `422` `certificate_template_invalid`, com a lista de problemas em
         *     `details.problems`, na ordem em que foram encontrados e até 200 itens: com 200, pode haver
         *     mais problemas além dos listados. Outro `422` da operação não traz `details`.
         */
        CertificateTemplateInvalidProblem: components["schemas"]["Problem"] & {
            details?: {
                problems: components["schemas"]["CertificateTemplateProblem"][];
            };
        };
        /**
         * @description Palavra-chave do template (`specs/015-certificados.md`, "Template").
         * @enum {string}
         */
        CertificateTemplateKeyName: "aluno.nome" | "curso.titulo" | "curso.carga_horaria" | "curso.instrutor" | "certificado.data_conclusao" | "certificado.data_conclusao_curta" | "certificado.data_emissao" | "certificado.codigo" | "certificado.url_validacao" | "certificado.qrcode" | "escola.nome" | "assinatura.nome" | "assinatura.cargo";
        CertificateTemplateKey: {
            key: components["schemas"]["CertificateTemplateKeyName"];
            /**
             * @description Como escrever no template.
             * @example {{aluno.nome}}
             */
            placeholder: string;
            description: string;
            /**
             * @description Valor usado no PDF de exemplo. Em `certificado.qrcode`, um texto que descreve o código QR,
             *     não o SVG.
             */
            example: string;
            /** @description Sempre obrigatória (`aluno.nome`, `curso.titulo`, `certificado.codigo`). */
            required: boolean;
            /**
             * @description Verdadeiro nas que se alternam (`certificado.url_validacao` e `certificado.qrcode`): o
             *     template precisa de ao menos uma delas.
             */
            requiredOneOf: boolean;
        };
        CertificateTemplateReference: {
            /** @description As 13 palavras-chave, na ordem da spec. */
            keys: components["schemas"]["CertificateTemplateKey"][];
            /** @description O modelo inicial, que passa na própria validação. */
            modelHtml: string;
        };
        /** @enum {string} */
        CertificatePreviewStatus: "pending" | "ready" | "failed";
        CertificatePreview: {
            id: components["schemas"]["Uuid"];
            courseId: components["schemas"]["Uuid"] | null;
            status: components["schemas"]["CertificatePreviewStatus"];
            /** @description Motivo, em `failed`. */
            error: string | null;
            createdAt: components["schemas"]["DateTime"];
            renderedAt: components["schemas"]["DateTime"] | null;
            /** @description Quando o pedido é apagado (24 h). */
            expiresAt: components["schemas"]["DateTime"];
        };
        CertificateSettings: {
            /** @description `certificate.signer_name`. */
            signerName: string | null;
            /** @description `certificate.signer_role`. */
            signerRole: string | null;
            /** @description `school.name`, só leitura aqui. */
            schoolName: string;
        };
        /**
         * @description Tipo do documento fiscal do comprador (`specs/011-vendas-e-checkout.md`).
         * @enum {string}
         */
        TaxIdType: "cpf" | "cnpj";
        /**
         * @description `percent` desconta uma porcentagem de cada item elegível; `fixed` desconta um valor em
         *     centavos rateado entre os itens elegíveis (`specs/011-vendas-e-checkout.md`, "Cupons").
         * @enum {string}
         */
        CouponKind: "percent" | "fixed";
        /**
         * @description A que o cupom se aplica (`specs/012-assinaturas.md`, "Cupom na assinatura"): pedidos
         *     avulsos (`orders`), assinaturas (`subscriptions`) ou os dois (`both`). Na assinatura, o
         *     cupom vale só na primeira cobrança.
         * @enum {string}
         */
        CouponAppliesTo: "orders" | "subscriptions" | "both";
        /** @description Produto restringindo o cupom; vazio é o mesmo que todos. */
        CouponProductInput: {
            productType: components["schemas"]["ProductType"];
            productId: components["schemas"]["Uuid"];
        };
        /** @description Produto elegível do cupom, com o título atual. */
        CouponProduct: {
            productType: components["schemas"]["ProductType"];
            productId: components["schemas"]["Uuid"];
            title: string;
        };
        /**
         * @description Definição de um cupom novo (`specs/011-vendas-e-checkout.md`, "Cupons"). `appliesTo` tem
         *     padrão `orders` e `active`, `true`.
         */
        CouponInput: {
            /** @description Comparado sem diferenciar maiúsculas. */
            code: string;
            kind: components["schemas"]["CouponKind"];
            /** @description Obrigatório em `percent`; proibido em `fixed`. */
            percentOff?: number | null;
            /** @description Obrigatório em `fixed`; proibido em `percent`. */
            amountOffCents?: number | null;
            /** @description Início da validade; `null` sem prazo para começar. */
            startsAt?: components["schemas"]["DateTime"] | null;
            /** @description Fim da validade; `null` sem prazo para acabar. */
            endsAt?: components["schemas"]["DateTime"] | null;
            /** @description Total de usos; `null` ilimitado. */
            maxUses?: number | null;
            /** @default 1 */
            maxUsesPerUser: number;
            appliesTo?: components["schemas"]["CouponAppliesTo"];
            /**
             * @description Restrição de produtos; vazia vale para todos.
             * @default []
             */
            products: components["schemas"]["CouponProductInput"][];
            /** @default true */
            active: boolean;
        };
        /**
         * @description Edição parcial: só os campos enviados mudam. `products` enviada substitui a lista inteira
         *     e `products: []` volta a valer para todos (`specs/011-vendas-e-checkout.md`).
         */
        CouponUpdate: {
            code?: string;
            kind?: components["schemas"]["CouponKind"];
            percentOff?: number | null;
            amountOffCents?: number | null;
            startsAt?: components["schemas"]["DateTime"] | null;
            endsAt?: components["schemas"]["DateTime"] | null;
            maxUses?: number | null;
            maxUsesPerUser?: number;
            appliesTo?: components["schemas"]["CouponAppliesTo"];
            products?: components["schemas"]["CouponProductInput"][];
            active?: boolean;
        };
        /** @description Um cupom da escola (`specs/011-vendas-e-checkout.md`, "Cupons"). */
        Coupon: {
            id: components["schemas"]["Uuid"];
            code: string;
            kind: components["schemas"]["CouponKind"];
            percentOff: number | null;
            amountOffCents: number | null;
            startsAt: components["schemas"]["DateTime"] | null;
            endsAt: components["schemas"]["DateTime"] | null;
            /** @description `null` ilimitado. */
            maxUses: number | null;
            maxUsesPerUser: number;
            /**
             * @description Usos contabilizados. Pode passar de `maxUses`: pedido pago com o limite estourado é
             *     honrado e o excesso fica registrado (spec 011).
             */
            usesCount: number;
            appliesTo: components["schemas"]["CouponAppliesTo"];
            products: components["schemas"]["CouponProduct"][];
            active: boolean;
            createdBy: components["schemas"]["UserRef"];
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        CouponPage: components["schemas"]["Page"] & {
            items: components["schemas"]["Coupon"][];
        };
        /**
         * @description Estado do pedido (`specs/011-vendas-e-checkout.md`, "Pedido e seus estados"). `draft` é
         *     resto de tentativa que não chegou ao provedor: aparece na consulta do admin, não na do
         *     aluno.
         * @enum {string}
         */
        OrderStatus: "draft" | "pending" | "paid" | "partially_refunded" | "refunded" | "canceled" | "expired" | "chargeback";
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
         * @description Provedor da cobrança; `none` no pedido de total zero, que não passa pelo provedor
         *     (`NUVA_PAYMENT_PROVIDER`).
         * @enum {string}
         */
        PaymentProviderName: "mercadopago" | "fake" | "none";
        /**
         * @description `requested` enquanto o estorno não voltou; `done` com o estorno confirmado; `failed` com o
         *     motivo em `error`, podendo ser tentado de novo (`specs/011-vendas-e-checkout.md`).
         * @enum {string}
         */
        RefundStatus: "requested" | "done" | "failed";
        /**
         * @description Estado do aviso em `webhook_events` (`specs/013-pagamentos-mercado-pago.md`). `rejected` é
         *     a trilha de assinatura recusada, só leitura; `failed` é a falha operacional que aceita
         *     reprocessamento.
         * @enum {string}
         */
        WebhookEventStatus: "received" | "rejected" | "processed" | "ignored" | "failed";
        /**
         * @description Tipo do recurso citado no aviso.
         * @enum {string}
         */
        WebhookResourceType: "payment" | "subscription";
        /** @description O comprador na lista de pedidos, sem o documento fiscal. */
        OrderBuyer: {
            id: components["schemas"]["Uuid"];
            name: string;
            email: components["schemas"]["Email"];
        };
        /**
         * @description O comprador no detalhe do pedido. O documento fiscal só aparece aqui e no CSV, nunca nos
         *     logs (`specs/011-vendas-e-checkout.md`).
         */
        OrderBuyerDetail: {
            id: components["schemas"]["Uuid"];
            name: string;
            email: components["schemas"]["Email"];
            taxIdType: components["schemas"]["TaxIdType"];
            /** @description Só os caracteres do documento, sem pontuação. */
            taxId: string;
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
        /**
         * @description Somas de todos os pedidos que casam com o filtro, não só da página
         *     (`specs/011-vendas-e-checkout.md`, "Consulta e exportação").
         */
        OrderTotals: {
            /** @description Bruto, antes dos descontos. */
            subtotalCents: components["schemas"]["MoneyCents"];
            discountCents: components["schemas"]["MoneyCents"];
            refundedCents: components["schemas"]["MoneyCents"];
            /** @description Cobrado, depois dos descontos. */
            totalCents: components["schemas"]["MoneyCents"];
            /** @description Cobrado menos os reembolsos. */
            netCents: components["schemas"]["MoneyCents"];
        };
        /** @description Um pedido na lista do admin, sem o documento fiscal. */
        OrderSummary: {
            id: components["schemas"]["Uuid"];
            /** @description Número legível e sequencial do pedido, com saltos aceitos. */
            number: number;
            status: components["schemas"]["OrderStatus"];
            buyer: components["schemas"]["OrderBuyer"];
            itemCount: number;
            items: components["schemas"]["OrderProductRef"][];
            subtotalCents: components["schemas"]["MoneyCents"];
            discountCents: components["schemas"]["MoneyCents"];
            refundedCents: components["schemas"]["MoneyCents"];
            totalCents: components["schemas"]["MoneyCents"];
            currency: components["schemas"]["CurrencyCode"];
            /** @description Código do cupom congelado no pedido; `null` sem cupom. */
            couponCode: string | null;
            provider: components["schemas"]["PaymentProviderName"];
            /** @description Meio da cobrança conhecida; `null` antes da primeira cobrança. */
            paymentMethod: components["schemas"]["PaymentMethod"] | null;
            createdAt: components["schemas"]["DateTime"];
            paidAt: components["schemas"]["DateTime"] | null;
            /** @description Prazo do `pending`; `null` fora dele. */
            expiresAt: components["schemas"]["DateTime"] | null;
        };
        OrderSummaryPage: components["schemas"]["Page"] & {
            items: components["schemas"]["OrderSummary"][];
            totals: components["schemas"]["OrderTotals"];
        };
        /**
         * @description O pedido completo, com comprador, valores congelados, cobranças e reembolsos
         *     (`specs/011-vendas-e-checkout.md`). O documento fiscal só sai aqui e no CSV.
         */
        OrderDetail: {
            id: components["schemas"]["Uuid"];
            number: number;
            status: components["schemas"]["OrderStatus"];
            buyer: components["schemas"]["OrderBuyerDetail"];
            itemCount: number;
            subtotalCents: components["schemas"]["MoneyCents"];
            discountCents: components["schemas"]["MoneyCents"];
            refundedCents: components["schemas"]["MoneyCents"];
            totalCents: components["schemas"]["MoneyCents"];
            currency: components["schemas"]["CurrencyCode"];
            /** @description Código do cupom congelado no pedido; `null` sem cupom. */
            couponCode: string | null;
            provider: components["schemas"]["PaymentProviderName"];
            createdAt: components["schemas"]["DateTime"];
            paidAt: components["schemas"]["DateTime"] | null;
            /** @description Prazo do `pending` (30 min no cartão e no Pix, 3 dias no boleto); `null` fora dele. */
            expiresAt: components["schemas"]["DateTime"] | null;
            items: components["schemas"]["OrderItem"][];
            /** @description Cobranças conhecidas do pedido, da mais recente à mais antiga. */
            payments: components["schemas"]["Payment"][];
            /** @description Reembolsos do pedido, do mais recente ao mais antigo. */
            refunds: components["schemas"]["Refund"][];
        };
        /** @description Item e valor a reembolsar (`specs/011-vendas-e-checkout.md`, "Reembolso"). */
        RefundItemInput: {
            orderItemId: components["schemas"]["Uuid"];
            /** @description Em centavos; no máximo o pago e ainda não reembolsado do item. */
            amountCents: number;
        };
        /** @description Item reembolsado, com o título congelado do pedido. */
        RefundItem: {
            orderItemId: components["schemas"]["Uuid"];
            title: string;
            amountCents: components["schemas"]["MoneyCents"];
        };
        /** @description Um reembolso pedido, em execução ou concluído. */
        Refund: {
            id: components["schemas"]["Uuid"];
            /** @description Pedido reembolsado; `null` no reembolso de cobrança recorrente. */
            orderId?: components["schemas"]["Uuid"] | null;
            paymentId: components["schemas"]["Uuid"];
            /** @description Itens e valores do pedido; vazia no reembolso de cobrança recorrente. */
            items: components["schemas"]["RefundItem"][];
            amountCents: components["schemas"]["MoneyCents"];
            /** @description Motivo informado pelo admin. */
            reason: string;
            status: components["schemas"]["RefundStatus"];
            /** @description Identificador do estorno no provedor; `null` até a confirmação. */
            providerRefundId: string | null;
            /** @description Motivo da falha, quando `status` é `failed`; nunca o corpo do provedor. */
            error: string | null;
            requestedBy: components["schemas"]["UserRef"];
            createdAt: components["schemas"]["DateTime"];
            /** @description Quando o estorno foi confirmado; `null` fora de `done`. */
            doneAt: components["schemas"]["DateTime"] | null;
        };
        /**
         * @description Uma cobrança conhecida (`specs/013-pagamentos-mercado-pago.md`). Sem dado de cartão e sem
         *     o corpo devolvido pelo provedor; só o estado original em `rawStatus`.
         */
        Payment: {
            id: components["schemas"]["Uuid"];
            /** @description Pedido da cobrança; `null` em cobrança de assinatura. */
            orderId: components["schemas"]["Uuid"] | null;
            /** @description Número legível do pedido; `null` em cobrança de assinatura. */
            orderNumber: number | null;
            /** @description Assinatura da cobrança; `null` em cobrança de pedido. */
            subscriptionId: components["schemas"]["Uuid"] | null;
            /** @enum {string} */
            provider: "mercadopago" | "fake";
            providerPaymentId: string;
            status: components["schemas"]["PaymentStatus"];
            method: components["schemas"]["PaymentMethod"];
            amountCents: components["schemas"]["MoneyCents"];
            refundedCents: components["schemas"]["MoneyCents"];
            currency: components["schemas"]["CurrencyCode"];
            /** @description Estado original devolvido pelo provedor, para diagnóstico. */
            rawStatus: string;
            paidAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        PaymentPage: components["schemas"]["Page"] & {
            items: components["schemas"]["Payment"][];
        };
        /** @description A cobrança com os reembolsos relacionados. */
        PaymentDetail: {
            id: components["schemas"]["Uuid"];
            orderId: components["schemas"]["Uuid"] | null;
            orderNumber: number | null;
            subscriptionId: components["schemas"]["Uuid"] | null;
            /** @enum {string} */
            provider: "mercadopago" | "fake";
            providerPaymentId: string;
            status: components["schemas"]["PaymentStatus"];
            method: components["schemas"]["PaymentMethod"];
            amountCents: components["schemas"]["MoneyCents"];
            refundedCents: components["schemas"]["MoneyCents"];
            currency: components["schemas"]["CurrencyCode"];
            rawStatus: string;
            paidAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
            refunds: components["schemas"]["Refund"][];
        };
        /**
         * @description Um aviso de pagamento recebido (`specs/013-pagamentos-mercado-pago.md`). Nunca traz o corpo
         *     nem os cabeçalhos; em `rejected`, só os metadados mínimos da trilha de segurança.
         */
        WebhookEvent: {
            id: components["schemas"]["Uuid"];
            /** @enum {string} */
            provider: "mercadopago" | "fake";
            /** @description Identificador do evento; `null` quando não foi extraído. */
            eventId: string | null;
            resourceType: components["schemas"]["WebhookResourceType"] | null;
            /** @description Identificador do recurso; `null` quando não foi extraído. */
            resourceId: string | null;
            status: components["schemas"]["WebhookEventStatus"];
            /** @description Tentativas de processamento; zero na trilha `rejected`. */
            attempts: number;
            /** @description `invalid_signature` em `rejected`; motivo da falha em `failed`. */
            error: string | null;
            receivedAt: components["schemas"]["DateTime"];
            /** @description Quando o evento foi processado ou ignorado; `null` nos demais estados. */
            processedAt: components["schemas"]["DateTime"] | null;
        };
        WebhookEventPage: components["schemas"]["Page"] & {
            items: components["schemas"]["WebhookEvent"][];
        };
        /**
         * @description Estado da integração de pagamento (`specs/013-pagamentos-mercado-pago.md`, "Modo de
         *     teste"). Nunca devolve token, chave pública, segredo do webhook nem URL com credencial.
         */
        PaymentSettings: {
            /**
             * @description `NUVA_PAYMENT_PROVIDER` em uso.
             * @enum {string}
             */
            provider: "mercadopago" | "fake";
            /** @description O token configurado é de teste; nenhuma cobrança real. */
            testMode: boolean;
            /**
             * @description Verdadeiro só quando `NUVA_ENV=production` e o token é de teste: o admin vê o aviso em
             *     vermelho.
             */
            productionWarning: boolean;
            /**
             * @description Fim da última execução bem-sucedida de `payment.reconcile_orders`; `null` quando ainda
             *     não houve nenhuma.
             */
            lastReconciliationAt: components["schemas"]["DateTime"] | null;
        };
        /**
         * @description Periodicidade da cobrança do plano (`specs/012-assinaturas.md`, "Planos").
         * @enum {string}
         */
        PlanInterval: "month" | "year";
        /** @description Produto liberado por um plano. */
        PlanItemInput: {
            productType: components["schemas"]["ProductType"];
            productId: components["schemas"]["Uuid"];
        };
        /** @description Produto liberado por um plano, com o título atual. */
        PlanItem: {
            productType: components["schemas"]["ProductType"];
            productId: components["schemas"]["Uuid"];
            title: string;
        };
        /**
         * @description Um plano de assinatura com os itens que libera (`specs/012-assinaturas.md`, "Planos").
         *     O preço do plano vale para novas assinaturas; as existentes mantêm o preço contratado.
         */
        Plan: {
            id: components["schemas"]["Uuid"];
            slug: components["schemas"]["Slug"];
            /** @description Chave que agrupa as periodicidades do mesmo conteúdo na vitrine. */
            groupKey: components["schemas"]["Slug"];
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
            /** @description Só com `includesAll`; inclui também os produtos `private`. */
            includesPrivate: boolean;
            /**
             * @description Plano inativo sai da vitrine e não aceita assinatura nova; as assinaturas existentes
             *     continuam.
             */
            active: boolean;
            /** @description Ordem na vitrine. */
            position: number;
            /**
             * @description Identificador do plano no provedor (`ensurePlan`); `null` até o `ensurePlan` rodar
             *     (`specs/013-pagamentos-mercado-pago.md`).
             */
            providerPlanId: string | null;
            /**
             * @description Assinaturas do plano, inclusive `ended` e `expired`; é o vínculo que impede excluir o
             *     plano.
             */
            subscriptionCount: number;
            /** @description Produtos explícitos quando `includesAll` é falso; vazia quando verdadeiro. */
            items: components["schemas"]["PlanItem"][];
            createdAt: components["schemas"]["DateTime"];
            updatedAt: components["schemas"]["DateTime"];
        };
        PlanPage: components["schemas"]["Page"] & {
            items: components["schemas"]["Plan"][];
        };
        /**
         * @description Definição de um plano novo (`specs/012-assinaturas.md`, "Planos"). `includesAll`,
         *     `includesPrivate`, `active` e `position` têm padrão falso, falso, verdadeiro e zero;
         *     `items` tem padrão vazio.
         */
        PlanCreate: {
            /**
             * @description Identificador público; gerado de `groupKey` e `interval` quando ausente e imutável
             *     depois da criação.
             */
            slug?: components["schemas"]["Slug"];
            /**
             * @description Chave que agrupa as periodicidades na vitrine: a mesma nos planos mensal e anual do
             *     mesmo conteúdo. Imutável.
             */
            groupKey: components["schemas"]["Slug"];
            title: string;
            description?: string | null;
            interval: components["schemas"]["PlanInterval"];
            /** @description Preço por período. */
            priceCents: number;
            /** @default false */
            includesAll: boolean;
            /** @default false */
            includesPrivate: boolean;
            /** @default true */
            active: boolean;
            /** @default 0 */
            position: number;
            /** @default [] */
            items: components["schemas"]["PlanItemInput"][];
        };
        /**
         * @description Edição parcial do plano: só os campos enviados mudam. `slug`, `groupKey` e `interval` não
         *     mudam depois da criação.
         */
        PlanUpdate: {
            title?: string;
            description?: string | null;
            priceCents?: number;
            includesAll?: boolean;
            includesPrivate?: boolean;
            active?: boolean;
            position?: number;
        };
        /** @description Lista completa que substitui os itens do plano. */
        PlanItemsUpdate: {
            items: components["schemas"]["PlanItemInput"][];
        };
        /**
         * @description Estado da assinatura (`specs/012-assinaturas.md`, "Ciclo de vida"). `pending` aguarda a
         *     primeira cobrança; `active` está em dia; `past_due` está em carência, com acesso;
         *     `suspended` perdeu o acesso; `canceling` foi cancelada e mantém o acesso até
         *     `currentPeriodEnd`; `ended` encerrou; `expired` nunca foi paga, inclusive a `pending`
         *     cancelada pelo aluno.
         * @enum {string}
         */
        SubscriptionStatus: "pending" | "active" | "past_due" | "suspended" | "canceling" | "ended" | "expired";
        /** @description O plano da assinatura, na forma resumida. */
        SubscriptionPlanRef: {
            id: components["schemas"]["Uuid"];
            title: string;
            interval: components["schemas"]["PlanInterval"];
        };
        /** @description O assinante na lista e no detalhe da assinatura. */
        Subscriber: {
            id: components["schemas"]["Uuid"];
            name: string;
            email: components["schemas"]["Email"];
        };
        /** @description Uma assinatura na lista do admin. */
        AdminSubscriptionSummary: {
            id: components["schemas"]["Uuid"];
            subscriber: components["schemas"]["Subscriber"];
            plan: components["schemas"]["SubscriptionPlanRef"];
            status: components["schemas"]["SubscriptionStatus"];
            /**
             * @description Preço contratado, copiado do plano na criação; mudança posterior do plano não o
             *     altera.
             */
            priceCents: components["schemas"]["MoneyCents"];
            currency: components["schemas"]["CurrencyCode"];
            currentPeriodStart: components["schemas"]["DateTime"] | null;
            /** @description Fim do período pago; com a carência, a referência do acesso. */
            currentPeriodEnd: components["schemas"]["DateTime"] | null;
            graceUntil: components["schemas"]["DateTime"] | null;
            /** @description Próxima renovação prevista: `currentPeriodEnd` em `active`; `null` nos demais. */
            nextChargeAt: components["schemas"]["DateTime"] | null;
            canceledAt: components["schemas"]["DateTime"] | null;
            /** @description Motivo do cancelamento informado pelo admin ou pelo aluno. */
            cancelReason: string | null;
            endedAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
        };
        AdminSubscriptionPage: components["schemas"]["Page"] & {
            items: components["schemas"]["AdminSubscriptionSummary"][];
        };
        /**
         * @description A assinatura com o plano atual, as cobranças e os reembolsos de cada uma
         *     (`specs/012-assinaturas.md`, "Reembolso de cobrança").
         */
        AdminSubscriptionDetail: {
            id: components["schemas"]["Uuid"];
            subscriber: components["schemas"]["Subscriber"];
            /**
             * @description O plano agora, com preço e itens atuais; o preço contratado é `priceCents` desta
             *     assinatura.
             */
            plan: components["schemas"]["Plan"];
            status: components["schemas"]["SubscriptionStatus"];
            /** @description Preço contratado na criação da assinatura. */
            priceCents: components["schemas"]["MoneyCents"];
            currency: components["schemas"]["CurrencyCode"];
            currentPeriodStart: components["schemas"]["DateTime"] | null;
            currentPeriodEnd: components["schemas"]["DateTime"] | null;
            graceUntil: components["schemas"]["DateTime"] | null;
            nextChargeAt: components["schemas"]["DateTime"] | null;
            canceledAt: components["schemas"]["DateTime"] | null;
            cancelReason: string | null;
            endedAt: components["schemas"]["DateTime"] | null;
            createdAt: components["schemas"]["DateTime"];
            /** @enum {string} */
            provider: "mercadopago" | "fake";
            /** @description Identificador da adesão no provedor; `null` até o provedor devolvê-lo. */
            providerSubscriptionId: string | null;
            /**
             * @description Código do cupom usado na primeira cobrança; `null` sem cupom ou se o cupom foi
             *     excluído.
             */
            couponCode: string | null;
            /**
             * @description A cobrança que abriu o período em curso; reembolsá-la por inteiro encerra a
             *     assinatura na hora. `null` quando ainda não há cobrança aprovada no período (por
             *     exemplo, `pending`).
             */
            currentPeriodPaymentId: components["schemas"]["Uuid"] | null;
            /** @description Cobranças da assinatura, da mais recente para a mais antiga, com reembolsos. */
            payments: components["schemas"]["PaymentDetail"][];
        };
        /** @description Pedido de reembolso de uma cobrança recorrente. */
        SubscriptionRefundInput: {
            /** @description Motivo informado pelo admin. */
            reason: string;
            /**
             * @description Valor a estornar; ausente ou `null` estorna o saldo não reembolsado da cobrança.
             *     Acima do saldo: `422 refund_exceeds_paid`. O valor que fecha o saldo da cobrança do
             *     período em curso encerra a assinatura; um valor menor não a encerra.
             */
            amountCents?: number | null;
        };
        /**
         * @description Grupo de preferência (`specs/024-notificacoes-e-email.md`, "Tipos e grupos"); o grupo de
         *     cada tipo está na mesma tabela.
         * @enum {string}
         */
        NotificationGroup: "account" | "purchase" | "courses" | "forum" | "messages" | "community" | "events" | "support" | "announcements" | "moderation" | "staff";
        /**
         * @description Conteúdo do tipo, definido na spec do recurso (o `ticket.opened` traz o protocolo; o
         *     `ops.job_failed`, o tipo da tarefa). Nunca contém senha, token nem segredo.
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
             * @example ticket.opened
             */
            type: string;
            group: components["schemas"]["NotificationGroup"];
            /** @description Quem gerou o fato; nulo em aviso do sistema. */
            actor: components["schemas"]["NotificationActor"] | null;
            /**
             * @description Tipo do alvo (`ticket`, `report`, `job`...), sempre junto de `targetId`; nulo quando a
             *     notificação não aponta para um recurso.
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
        /**
         * @description Campo `id` do SSE: inteiro em texto, tirado de uma sequência do banco. Crescente para
         *     cada usuário, não consecutivo.
         * @example 42
         */
        StreamEventId: string;
        StreamNotificationCreatedData: {
            notificationId: components["schemas"]["Uuid"];
            /** @description Tipo da notificação (`specs/024-notificacoes-e-email.md`). */
            type: string;
            /** @description Notificações não lidas do usuário depois desta. */
            unreadCount: number;
        };
        /** @description Sempre vazio. */
        StreamPingData: Record<string, never>;
        /** @description Nova notificação para quem está conectado. */
        StreamEventNotificationCreated: {
            id: components["schemas"]["StreamEventId"];
            /**
             * @description discriminator enum property added by openapi-typescript
             * @enum {string}
             */
            event: "notification.created";
            data: components["schemas"]["StreamNotificationCreatedData"];
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
        /**
         * @description Um evento do fluxo do admin depois de lido (campos `id`, `event` e `data` do SSE). Só o
         *     `notification.created` do titular e o `ping`; os demais tipos do canal são descartados
         *     (ADR 0028).
         */
        StreamEvent: components["schemas"]["StreamEventNotificationCreated"] | components["schemas"]["StreamEventPing"];
        /**
         * @description Tipo da tarefa (`specs/005-worker-e-fila.md`), no formato `palavra.palavra` em minúsculas.
         *     Fica em texto, e não em `enum`, porque o worker pode ganhar tipo que esta API ainda não
         *     conhece.
         * @example email.send
         * @example retention.purge
         */
        JobType: string;
        /**
         * @description Estado da tarefa na tela de operação: pendente, em execução ou com falha. Tarefas
         *     concluídas não aparecem.
         * @enum {string}
         */
        OpsJobStatus: "queued" | "running" | "failed";
        /**
         * @description Uma tarefa da fila (`specs/005-worker-e-fila.md`, "Dados"). `payload` e dados de trava não
         *     saem; `lastError` já vem mascarado pelo worker.
         */
        OpsJob: {
            id: components["schemas"]["Uuid"];
            type: components["schemas"]["JobType"];
            status: components["schemas"]["OpsJobStatus"];
            /** @description Prioridade; maior executa antes. */
            priority: number;
            /** @description Tentativas já gastas; sobe quando o worker pega a tarefa. */
            attempts: number;
            maxAttempts: number;
            /** @description Quando pode executar (ou voltar a executar). */
            runAt: components["schemas"]["DateTime"];
            createdAt: components["schemas"]["DateTime"];
            /** @description Fim da última execução; nulo enquanto não terminou. */
            finishedAt: components["schemas"]["DateTime"] | null;
            /** @description Motivo da última falha, mascarado; `null` quando nunca falhou. */
            lastError: string | null;
        };
        OpsJobPage: components["schemas"]["Page"] & {
            items: components["schemas"]["OpsJob"][];
        };
        /**
         * @description Estado do e-mail na tela de operação; enviados não aparecem.
         * @enum {string}
         */
        OpsEmailStatus: "queued" | "failed";
        /**
         * @description Uma linha de `email_outbox` ainda não enviada (`specs/024-notificacoes-e-email.md`,
         *     "E-mail"). O destinatário sai mascarado e o corpo renderizado não é guardado.
         */
        OpsEmail: {
            id: components["schemas"]["Uuid"];
            /**
             * @description Tipo do e-mail, no mesmo formato dos códigos do catálogo.
             * @example ticket.reply
             */
            type: string;
            /** @description Destinatário mascarado (por exemplo `a***@exemplo.com`). */
            to: string;
            /** @description Assunto; nulo até o envio montar o e-mail. */
            subject: string | null;
            status: components["schemas"]["OpsEmailStatus"];
            /** @description Tentativas já gastas. */
            attempts: number;
            /** @description Motivo da última falha do SMTP; `null` quando nunca falhou. */
            lastError: string | null;
            createdAt: components["schemas"]["DateTime"];
        };
        OpsEmailPage: components["schemas"]["Page"] & {
            items: components["schemas"]["OpsEmail"][];
        };
        /** @description Contagem da fila por tipo, para o resumo e o selo do menu. */
        OpsJobTypeSummary: {
            type: components["schemas"]["JobType"];
            queued: number;
            running: number;
            failed: number;
            /**
             * @description Idade, em segundos, da tarefa pendente mais antiga deste tipo; nulo quando não há
             *     nenhuma.
             */
            oldestPendingSeconds: number | null;
        };
        /**
         * @description Números da tela "Operação" e do selo do menu
         *     (`specs/033-observabilidade-retencao-backup.md`, "Tela Operação").
         */
        OpsSummary: {
            /** @description A fila por tipo, com pendentes, em execução e com falha. */
            jobs: components["schemas"]["OpsJobTypeSummary"][];
            emails: {
                queued: number;
                failed: number;
            };
            webhooks: {
                /** @description Eventos de webhook com falha de processamento, reprocessáveis. */
                failed: number;
            };
            system: components["schemas"]["OpsSystemSummary"];
            /**
             * @description Soma do que o selo do menu mostra: tarefas, e-mails e webhooks com falha. Zero
             *     significa nenhuma falha.
             */
            failures: number;
        };
        /**
         * @description Bloco "Sistema" da tela de operação (`specs/033-observabilidade-retencao-backup.md`).
         *     Cifras em bytes.
         */
        OpsSystemSummary: {
            /**
             * @description Versão instalada do nuva-edu (SemVer).
             * @example 0.1.0
             */
            version: string;
            /**
             * @description Última migration aplicada.
             * @example 0019
             */
            migrationVersion: string;
            databaseBytes: number;
            /** @description Espaço ocupado pelas imagens das variantes (`specs/029-imagens.md`). */
            imageBytes: number;
            /**
             * @description Última execução de backup; nulo quando ainda não houve. Mais de 26 horas desde
             *     `finishedAt` aparece como atrasado.
             */
            lastBackup: {
                finishedAt: components["schemas"]["DateTime"];
                sizeBytes: number;
                /** @enum {string} */
                status: "ok" | "failed";
            } | null;
            /** @description Fim do último expurgo (`retention.purge`); nulo quando ainda não houve. */
            lastPurgeAt: components["schemas"]["DateTime"] | null;
        };
        /**
         * @description Identidade da escola usada nos e-mails de notificação
         *     (`specs/024-notificacoes-e-email.md`, "E-mail"). Todos os campos estão sempre presentes;
         *     `logoUrl`, `accentColor` e `footer` podem ser `null`.
         */
        SchoolBranding: {
            /** @description Nome da escola, o mesmo do `/meta`. */
            schoolName: string;
            /**
             * Format: uri-reference
             * @description Caminho do logotipo na própria API, ou nulo sem logotipo.
             * @example /api/v1/images/0193a5b2-7c1e-7d3a-9f4b-2a6c8e1d5f70/256.webp
             * @example null
             */
            logoUrl: string | null;
            /**
             * @description Cor de destaque em `#RRGGBB`, ou nulo para a cor padrão da interface.
             * @example #1F6FEB
             * @example null
             */
            accentColor: string | null;
            /** @description Rodapé dos e-mails, com quebras de linha; nulo quando não definido. */
            footer: string | null;
        };
        /**
         * @description Os quatro campos gravados juntos; `logoImageId` é o identificador da imagem do logotipo
         *     (`specs/029-imagens.md`), não o caminho.
         */
        SchoolBrandingInput: {
            schoolName: string;
            logoImageId: components["schemas"]["Uuid"] | null;
            accentColor: string | null;
            footer: string | null;
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
         * @description Template fora das regras (`certificate_template_invalid`, com `details.problems`) ou outra regra
         *     de negócio com `code` próprio.
         */
        CertificateTemplateInvalid: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["CertificateTemplateInvalidProblem"];
            };
        };
        /**
         * @description As vendas em CSV, uma linha por item de pedido (`specs/011-vendas-e-checkout.md`,
         *     "Consulta e exportação"), em fluxo contínuo: a resposta começa antes de ler todos os
         *     pedidos e não é guardada em memória. UTF-8 com BOM, separador `;`, CRLF, decimais com
         *     vírgula; o nome sugerido do arquivo é `vendas-AAAA-MM-DD.csv`. O conteúdo e os filtros não
         *     vão para logs.
         */
        SalesCsv: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                "Cache-Control": components["headers"]["NoStore"];
                "Content-Disposition": components["headers"]["ContentDisposition"];
                "X-Content-Type-Options": components["headers"]["ContentTypeOptions"];
                [name: string]: unknown;
            };
            content: {
                "text/csv": string;
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
        /** @description Tipo do alvo do vínculo: `course` ou `lesson` (`bundle` e outros: `400`). */
        EbookTargetTypePath: "course" | "lesson";
        /** @description Identificador do curso ou da aula. */
        EbookTargetIdPath: components["schemas"]["Uuid"];
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
         * @description Último `id` recebido antes da queda (`specs/004-classroom-api.md`, "Fluxo SSE"): o fluxo
         *     reenvia os eventos daquele usuário com `id` maior. Ausente na primeira conexão.
         */
        LastEventId: components["schemas"]["StreamEventId"];
        /** @description Itens por página da central (padrão 20, máximo 50). */
        NotificationLimit: number;
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
    listCourses: {
        parameters: {
            query?: {
                /** @description Trecho do título ou do resumo. */
                q?: string;
                /** @description `archived` lista só os arquivados; os outros dois, só os não arquivados. */
                status?: "draft" | "published" | "archived";
                accessMode?: components["schemas"]["AccessMode"];
                /** @description Só os cursos deste dono. */
                ownerId?: components["schemas"]["Uuid"];
                /** @description `true`: só os cursos com pedido de publicação (`reviewRequestedAt`). */
                awaitingReview?: boolean;
                sort?: "title" | "-createdAt" | "-updatedAt";
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
            /** @description Uma página de cursos. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseSummaryPage"];
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
    createCourse: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CourseCreate"];
            };
        };
        responses: {
            /** @description Curso criado. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
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
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
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
                    "application/json": components["schemas"]["CourseDetail"];
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
    deleteCourse: {
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
            /** @description Curso excluído. */
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
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateCourse: {
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
                "application/json": components["schemas"]["CourseUpdate"];
            };
        };
        responses: {
            /** @description Curso atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseDetail"];
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
    publishCourse: {
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
            /** @description Curso atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    unpublishCourse: {
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
            /** @description Curso atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseDetail"];
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
    archiveCourse: {
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
            /** @description Curso atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseDetail"];
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
    unarchiveCourse: {
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
            /** @description Curso atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseDetail"];
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
    requestCourseReview: {
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
            /** @description Pedido registrado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseDetail"];
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
    cancelCourseReview: {
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
                    "application/json": components["schemas"]["CourseDetail"];
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
    setCourseOwner: {
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
                    ownerId: components["schemas"]["Uuid"] | null;
                    /**
                     * @description Opcional: o `version` do curso na última resposta. Enviado, é conferido
                     *     (`409` `version_conflict`); o site admin sempre o envia.
                     */
                    version?: number;
                };
            };
        };
        responses: {
            /** @description Dono alterado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseDetail"];
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
    createModule: {
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
                    title: string;
                };
            };
        };
        responses: {
            /** @description Módulo criado. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseModule"];
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
    reorderModules: {
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
                    moduleIds: components["schemas"]["Uuid"][];
                };
            };
        };
        responses: {
            /** @description Módulos na ordem nova. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseModuleList"];
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
    deleteModule: {
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
            /** @description Módulo excluído. */
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
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateModule: {
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
                    title: string;
                    version: components["schemas"]["CatalogVersionInput"];
                };
            };
        };
        responses: {
            /** @description Módulo atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseModule"];
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
    createLesson: {
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
                "application/json": components["schemas"]["LessonCreate"];
            };
        };
        responses: {
            /** @description Aula criada. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LessonDetail"];
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
    reorderLessons: {
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
                    lessonIds: components["schemas"]["Uuid"][];
                };
            };
        };
        responses: {
            /** @description O módulo, com as aulas na ordem nova. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseModule"];
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
                    "application/json": components["schemas"]["LessonDetail"];
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
    deleteLesson: {
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
            /** @description Aula excluída. */
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
    updateLesson: {
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
                "application/json": components["schemas"]["LessonUpdate"];
            };
        };
        responses: {
            /** @description Aula atualizada. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LessonDetail"];
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
    setLessonLinks: {
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
                    links: {
                        label: string;
                        /**
                         * @description URL do material. Regras de URL de conteúdo (`specs/009-catalogo-e-conteudo.md`): `https` (`http`
                         *     só em
                         *     `*.localhost`), sem credenciais, sem espaços, até 2.000 caracteres; fora delas, `422`
                         *     `content_url_invalid` com o campo e o motivo. A URL nunca é buscada pelo servidor.
                         */
                        url: string | null;
                        kind: components["schemas"]["LessonLinkKind"];
                    }[];
                    /**
                     * @description Opcional: o `version` da aula na última resposta. Enviado, é conferido
                     *     (`409` `version_conflict`); o site admin sempre o envia.
                     */
                    version?: number;
                };
            };
        };
        responses: {
            /** @description A aula com os links novos. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["LessonDetail"];
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
    listEbooks: {
        parameters: {
            query?: {
                /** @description Trecho do título ou do resumo. */
                q?: string;
                /** @description `archived` lista só os arquivados; os outros dois, só os não arquivados. */
                status?: "draft" | "published" | "archived";
                accessMode?: components["schemas"]["AccessMode"];
                sort?: "title" | "-createdAt" | "-updatedAt";
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
            /** @description Uma página de ebooks. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EbookSummaryPage"];
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
    createEbook: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EbookCreate"];
            };
        };
        responses: {
            /** @description Ebook criado. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EbookDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
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
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
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
                    "application/json": components["schemas"]["EbookDetail"];
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
    deleteEbook: {
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
            /** @description Ebook excluído. */
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
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateEbook: {
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
                "application/json": components["schemas"]["EbookUpdate"];
            };
        };
        responses: {
            /** @description Ebook atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EbookDetail"];
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
    publishEbook: {
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
            /** @description Ebook atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EbookDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    unpublishEbook: {
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
            /** @description Ebook atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EbookDetail"];
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
    archiveEbook: {
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
            /** @description Ebook atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EbookDetail"];
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
    unarchiveEbook: {
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
            /** @description Ebook atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EbookDetail"];
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
    setEbookTargets: {
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
                    targets: {
                        /** @enum {string} */
                        targetType: "course" | "lesson";
                        targetId: components["schemas"]["Uuid"];
                    }[];
                    /**
                     * @description Opcional: o `version` do ebook na última resposta. Enviado, é conferido
                     *     (`409` `version_conflict`); o site admin sempre o envia.
                     */
                    version?: number;
                };
            };
        };
        responses: {
            /** @description O ebook com os vínculos novos. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EbookDetail"];
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
    linkEbookTarget: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
                /** @description Tipo do alvo do vínculo: `course` ou `lesson` (`bundle` e outros: `400`). */
                targetType: components["parameters"]["EbookTargetTypePath"];
                /** @description Identificador do curso ou da aula. */
                targetId: components["parameters"]["EbookTargetIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Vínculo presente. */
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
    unlinkEbookTarget: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
                /** @description Tipo do alvo do vínculo: `course` ou `lesson` (`bundle` e outros: `400`). */
                targetType: components["parameters"]["EbookTargetTypePath"];
                /** @description Identificador do curso ou da aula. */
                targetId: components["parameters"]["EbookTargetIdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Vínculo ausente. */
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
    listBundles: {
        parameters: {
            query?: {
                /** @description Trecho do título ou do resumo. */
                q?: string;
                /** @description `archived` lista só os arquivados; os outros dois, só os não arquivados. */
                status?: "draft" | "published" | "archived";
                accessMode?: components["schemas"]["AccessMode"];
                sort?: "title" | "-createdAt" | "-updatedAt";
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
            /** @description Uma página de pacotes. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BundleSummaryPage"];
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
    createBundle: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BundleCreate"];
            };
        };
        responses: {
            /** @description Pacote criado. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BundleDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getBundle: {
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
            /** @description O pacote. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BundleDetail"];
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
    deleteBundle: {
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
            /** @description Pacote excluído. */
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
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    updateBundle: {
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
                "application/json": components["schemas"]["BundleUpdate"];
            };
        };
        responses: {
            /** @description Pacote atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BundleDetail"];
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
    publishBundle: {
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
            /** @description Pacote atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BundleDetail"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    unpublishBundle: {
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
            /** @description Pacote atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BundleDetail"];
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
    archiveBundle: {
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
            /** @description Pacote atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BundleDetail"];
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
    unarchiveBundle: {
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
            /** @description Pacote atualizado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BundleDetail"];
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
    setBundleItems: {
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
                    items: {
                        /** @enum {string} */
                        productType: "course" | "ebook";
                        productId: components["schemas"]["Uuid"];
                    }[];
                    /**
                     * @description Opcional: o `version` do pacote na última resposta. Enviado, é conferido
                     *     (`409` `version_conflict`); o site admin sempre o envia.
                     */
                    version?: number;
                };
            };
        };
        responses: {
            /** @description O pacote com os itens novos. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BundleDetail"];
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
             * @description Processamento de imagens sobrecarregado (`image_processing_busy`, com `Retry-After`) ou banco
             *     indisponível (`database_unavailable`).
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
    listUserEntitlements: {
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
            /** @description Os direitos do usuário. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntitlementTree"];
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
    grantEntitlement: {
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
                    productType: components["schemas"]["ProductType"];
                    productId: components["schemas"]["Uuid"];
                    /** @description Fim do acesso; `null` ou ausente é vitalício. */
                    expiresAt?: components["schemas"]["DateTime"] | null;
                    /** @description Motivo, obrigatório; vai para a auditoria. */
                    reason: string;
                };
            };
        };
        responses: {
            /** @description A mesma concessão já existia; nada foi criado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntitlementNode"];
                };
            };
            /** @description Acesso concedido. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntitlementNode"];
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
    revokeEntitlement: {
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
                    /** @description Motivo, para a auditoria. */
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Direito revogado, com a cascata. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["EntitlementNode"];
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
    listProductEntitlements: {
        parameters: {
            query?: {
                state?: components["schemas"]["EntitlementState"];
                /** @description Quantidade de itens por página. */
                limit?: components["parameters"]["Limit"];
                /** @description Valor de `nextCursor` da página anterior. Ausente na primeira página. */
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path: {
                type: components["schemas"]["ProductType"];
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Uma página de direitos. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ProductEntitlementPage"];
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
    getUserProgress: {
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
            /** @description O progresso por curso. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UserProgressList"];
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
    getCourseProgressSummary: {
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
            /** @description O resumo. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseProgressSummary"];
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
    listCourseStudents: {
        parameters: {
            query?: {
                /** @description Trecho do nome. */
                q?: string;
                state?: components["schemas"]["CourseProgressState"];
                sort?: "name" | "-lastActivityAt" | "-percent";
                /** @description Quantidade de itens por página. */
                limit?: components["parameters"]["Limit"];
                /** @description Valor de `nextCursor` da página anterior. Ausente na primeira página. */
                cursor?: components["parameters"]["Cursor"];
            };
            header?: never;
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Uma página de alunos. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CourseStudentPage"];
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
    listCertificates: {
        parameters: {
            query?: {
                courseId?: components["schemas"]["Uuid"];
                userId?: components["schemas"]["Uuid"];
                state?: components["schemas"]["CertificateState"];
                /** @description Código, com ou sem hífens, sem diferenciar maiúsculas. */
                code?: string;
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
            /** @description Uma página de certificados. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificatePage"];
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
    issueCertificate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    userId: components["schemas"]["Uuid"];
                    courseId: components["schemas"]["Uuid"];
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Certificado criado, em preparação. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Certificate"];
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
    revokeCertificate: {
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
                    reason: string;
                };
            };
        };
        responses: {
            /** @description Certificado revogado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Certificate"];
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
    restoreCertificate: {
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
            /** @description Revogação desfeita. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Certificate"];
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
    reissueCertificate: {
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
            /** @description Reemissão enfileirada. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Certificate"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCertificatePdf: {
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
    backfillCourseCertificates: {
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
            /** @description Lote enfileirado. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificateBackfillQueued"];
                };
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
    getCourseCertificateTemplate: {
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
            /** @description O template. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificateTemplate"];
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
    saveCourseCertificateTemplate: {
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
                "application/json": components["schemas"]["CertificateTemplateSave"];
            };
        };
        responses: {
            /** @description Template gravado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificateTemplateSaved"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["CertificateTemplateInvalid"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    deleteCourseCertificateTemplate: {
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
            /** @description O estado depois da exclusão. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificateTemplate"];
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
    getSchoolCertificateTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O template. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificateTemplate"];
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
    saveSchoolCertificateTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CertificateTemplateSave"];
            };
        };
        responses: {
            /** @description Template gravado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificateTemplateSaved"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["CertificateTemplateInvalid"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    deleteSchoolCertificateTemplate: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O estado depois da exclusão. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificateTemplate"];
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
    getCertificateTemplateReference: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A referência. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificateTemplateReference"];
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
    createCertificatePreview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description O template, até 768 KiB em UTF-8 (acima: problema `too_large`). */
                    html: string;
                    courseId?: components["schemas"]["Uuid"] | null;
                };
            };
        };
        responses: {
            /** @description Pedido aceito, em `pending`. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificatePreview"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["CertificateTemplateInvalid"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCertificatePreview: {
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
                    "application/json": components["schemas"]["CertificatePreview"];
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
    getCertificatePreviewPdf: {
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
    getCertificateSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description As configurações. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificateSettings"];
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
    saveCertificateSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    signerName: string | null;
                    signerRole: string | null;
                };
            };
        };
        responses: {
            /** @description Configurações gravadas. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CertificateSettings"];
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
    listOrders: {
        parameters: {
            query?: {
                /** @description Início do período (inclusive), sobre `createdAt`. */
                from?: components["schemas"]["DateTime"];
                /** @description Fim do período (exclusive), sobre `createdAt`. */
                to?: components["schemas"]["DateTime"];
                status?: components["schemas"]["OrderStatus"];
                /** @description Filtro por produto; exige `productId`. */
                productType?: components["schemas"]["ProductType"];
                /** @description Filtro por produto; exige `productType`. */
                productId?: components["schemas"]["Uuid"];
                couponId?: components["schemas"]["Uuid"];
                /** @description Trecho do nome ou do e-mail do comprador. */
                q?: string;
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
            /** @description Uma página de pedidos, com os totais do filtro. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OrderSummaryPage"];
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
    exportOrdersCsv: {
        parameters: {
            query?: {
                /** @description Início do período (inclusive), sobre `createdAt`. */
                from?: components["schemas"]["DateTime"];
                /** @description Fim do período (exclusive), sobre `createdAt`. */
                to?: components["schemas"]["DateTime"];
                status?: components["schemas"]["OrderStatus"];
                /** @description Filtro por produto; exige `productId`. */
                productType?: components["schemas"]["ProductType"];
                /** @description Filtro por produto; exige `productType`. */
                productId?: components["schemas"]["Uuid"];
                couponId?: components["schemas"]["Uuid"];
                /** @description Trecho do nome ou do e-mail do comprador. */
                q?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: components["responses"]["SalesCsv"];
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getOrder: {
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
                    "application/json": components["schemas"]["OrderDetail"];
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
    requestOrderRefund: {
        parameters: {
            query?: never;
            header?: {
                /** @description Chave escolhida pelo cliente; a repetição devolve a primeira resposta por 24 h. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Motivo informado pelo admin. */
                    reason: string;
                    /**
                     * @description Itens e valores do pedido; ausente ou `null` reembolsa o pedido inteiro, pelo
                     *     saldo não reembolsado de cada item.
                     */
                    items?: components["schemas"]["RefundItemInput"][] | null;
                };
            };
        };
        responses: {
            /** @description Reembolso pedido; o estorno é executado em segundo plano. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Refund"];
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
    retryRefund: {
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
            /** @description Reembolso devolvido à fila. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Refund"];
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
    listCoupons: {
        parameters: {
            query?: {
                /** @description Trecho do código. */
                q?: string;
                active?: boolean;
                appliesTo?: components["schemas"]["CouponAppliesTo"];
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
            /** @description Uma página de cupons. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CouponPage"];
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
    createCoupon: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CouponInput"];
            };
        };
        responses: {
            /** @description Cupom criado. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Coupon"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getCoupon: {
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
            /** @description O cupom. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Coupon"];
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
    updateCoupon: {
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
                "application/json": components["schemas"]["CouponUpdate"];
            };
        };
        responses: {
            /** @description Cupom gravado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Coupon"];
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
    listPayments: {
        parameters: {
            query?: {
                status?: components["schemas"]["PaymentStatus"];
                method?: components["schemas"]["PaymentMethod"];
                provider?: "mercadopago" | "fake";
                /** @description Início do período (inclusive), sobre `createdAt`. */
                from?: components["schemas"]["DateTime"];
                /** @description Fim do período (exclusive), sobre `createdAt`. */
                to?: components["schemas"]["DateTime"];
                orderId?: components["schemas"]["Uuid"];
                subscriptionId?: components["schemas"]["Uuid"];
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
            /** @description Uma página de cobranças. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaymentPage"];
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
    getPayment: {
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
            /** @description A cobrança. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaymentDetail"];
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
    listWebhookEvents: {
        parameters: {
            query?: {
                /** @description `failed`: fila operacional; `rejected`: trilha de segurança, só leitura. */
                status?: "failed" | "rejected";
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
            /** @description Uma página de avisos. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookEventPage"];
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
    retryWebhookEvent: {
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
            /** @description Aviso devolvido à fila. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WebhookEvent"];
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
    getPaymentSettings: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O estado da integração. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PaymentSettings"];
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
    listPlans: {
        parameters: {
            query?: {
                /** @description Trecho do título ou do slug. */
                q?: string;
                active?: boolean;
                interval?: components["schemas"]["PlanInterval"];
                groupKey?: string;
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
            /** @description Uma página de planos. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PlanPage"];
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
    createPlan: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PlanCreate"];
            };
        };
        responses: {
            /** @description Plano criado. */
            201: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Plan"];
                };
            };
            400: components["responses"]["BadRequest"];
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            409: components["responses"]["Conflict"];
            413: components["responses"]["PayloadTooLarge"];
            415: components["responses"]["UnsupportedMediaType"];
            422: components["responses"]["UnprocessableEntity"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    getPlan: {
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
            /** @description O plano. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Plan"];
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
    updatePlan: {
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
                "application/json": components["schemas"]["PlanUpdate"];
            };
        };
        responses: {
            /** @description Plano gravado. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Plan"];
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
    replacePlanItems: {
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
                "application/json": components["schemas"]["PlanItemsUpdate"];
            };
        };
        responses: {
            /** @description Lista substituída. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Plan"];
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
    listSubscriptions: {
        parameters: {
            query?: {
                /** @description Início do período (inclusive), sobre `createdAt`. */
                from?: components["schemas"]["DateTime"];
                /** @description Fim do período (exclusive), sobre `createdAt`. */
                to?: components["schemas"]["DateTime"];
                status?: components["schemas"]["SubscriptionStatus"];
                planId?: components["schemas"]["Uuid"];
                userId?: components["schemas"]["Uuid"];
                /** @description Trecho do nome ou do e-mail do assinante. */
                q?: string;
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
                    "application/json": components["schemas"]["AdminSubscriptionPage"];
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
    getSubscription: {
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
                    "application/json": components["schemas"]["AdminSubscriptionDetail"];
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
    cancelSubscription: {
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
                    /** @description Motivo informado pelo admin; vai para a assinatura e a auditoria. */
                    reason: string;
                };
            };
        };
        responses: {
            /**
             * @description Assinatura cancelada: `canceling` (de `active` ou `past_due`) ou `ended` (de
             *     `suspended`).
             */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminSubscriptionDetail"];
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
    requestSubscriptionRefund: {
        parameters: {
            query?: never;
            header?: {
                /** @description Chave escolhida pelo cliente; a repetição devolve a primeira resposta por 24 h. */
                "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            path: {
                /** @description Identificador do recurso. */
                id: components["parameters"]["IdPath"];
                /** @description A cobrança da assinatura. */
                paymentId: components["schemas"]["Uuid"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SubscriptionRefundInput"];
            };
        };
        responses: {
            /** @description Reembolso pedido; o estorno é executado em segundo plano. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Refund"];
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
    openStream: {
        parameters: {
            query?: never;
            header?: {
                /**
                 * @description Último `id` recebido antes da queda (`specs/004-classroom-api.md`, "Fluxo SSE"): o fluxo
                 *     reenvia os eventos daquele usuário com `id` maior. Ausente na primeira conexão.
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
    getOpsSummary: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description O resumo. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OpsSummary"];
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
    listOpsJobs: {
        parameters: {
            query?: {
                /** @description Estado da tarefa; sem ele, os três aparecem. */
                status?: components["schemas"]["OpsJobStatus"];
                /** @description Tipo da tarefa (por exemplo `email.send`). */
                type?: components["schemas"]["JobType"];
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
            /** @description Uma página de tarefas. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OpsJobPage"];
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
    retryOpsJob: {
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
            /** @description Tarefa devolvida à fila. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OpsJob"];
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
    discardOpsJob: {
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
            /** @description Tarefa apagada. */
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
            409: components["responses"]["Conflict"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    listOpsEmails: {
        parameters: {
            query?: {
                /** @description Estado do e-mail; sem ele, pendentes e com falha aparecem. */
                status?: components["schemas"]["OpsEmailStatus"];
                /** @description Tipo do e-mail (por exemplo `forum.reply`). */
                type?: string;
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
            /** @description Uma página de e-mails. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OpsEmailPage"];
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
    retryOpsEmail: {
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
            /** @description E-mail devolvido à fila. */
            202: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["OpsEmail"];
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
    getBranding: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description A identidade da escola. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchoolBranding"];
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
    saveBranding: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SchoolBrandingInput"];
            };
        };
        responses: {
            /** @description Identidade gravada e devolvida. */
            200: {
                headers: {
                    "X-Request-Id": components["headers"]["XRequestId"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SchoolBranding"];
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
}
