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
    };
    parameters: {
        /** @description Quantidade de itens por página. */
        Limit: number;
        /** @description Valor de `nextCursor` da página anterior. Ausente na primeira página. */
        Cursor: components["schemas"]["Cursor"];
        /** @description Chave escolhida pelo cliente; a repetição devolve a primeira resposta por 24 h. */
        IdempotencyKey: string;
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
}
