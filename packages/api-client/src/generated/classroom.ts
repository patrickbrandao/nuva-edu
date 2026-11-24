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
         * @description Nome da escola, versão, moeda, idioma e provedores de login social ativos. Não exige sessão.
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
         *     Cada evento tem três campos SSE: `id` (inteiro crescente por usuário), `event` (o nome) e
         *     `data` (um objeto JSON numa linha). No fio:
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
         *     - `ping` é enviado a cada 25 s, com `data: {}` e sem `id` (não altera o `Last-Event-ID`).
         *     - Na reconexão, `Last-Event-ID` faz a API reenviar o que foi perdido nos últimos 5 minutos;
         *       além disso, a interface recarrega as listas.
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
         * @description Envelope de listagem paginada por cursor. Cada listagem o compõe com `allOf`,
         *     definindo o esquema dos itens.
         */
        Page: {
            items: unknown[];
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
        /** @description Erro no formato RFC 9457. Pode trazer campos extras conforme o `code`. */
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
             * @description Identificador estável do erro, para o cliente decidir o que fazer.
             * @example permission_denied
             * @example validation_failed
             * @example database_unavailable
             */
            code: string;
            /** @description Presente em erro de validação (`400`). */
            errors?: components["schemas"]["ProblemFieldError"][];
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
        Meta: {
            /** @description Nome da escola, definido na configuração do admin. */
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
        };
        /**
         * @description Campo `id` do SSE. Inteiro crescente por usuário, em texto.
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
        /** @description Requisição inválida; `errors` lista os campos. */
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
        /** @description Sem permissão para a operação. */
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
        /** @description Conflito de estado (por exemplo, `version` divergente). */
        Conflict: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Regra de negócio impede a operação. */
        UnprocessableEntity: {
            headers: {
                "X-Request-Id": components["headers"]["XRequestId"];
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Limite de taxa atingido. */
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
        /** @description Erro inesperado. */
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
        /** @description Token da sessão, devolvido em `GET /api/v1/session`. Exigido em toda requisição que altera dados. */
        CsrfToken: string;
        /** @description Chave escolhida pelo cliente; a repetição devolve a primeira resposta por 24 h. */
        IdempotencyKey: string;
        /** @description `id` do último evento recebido; o navegador o envia sozinho ao reconectar. */
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
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
    openStream: {
        parameters: {
            query?: never;
            header?: {
                /** @description `id` do último evento recebido; o navegador o envia sozinho ao reconectar. */
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
            401: components["responses"]["Unauthorized"];
            403: components["responses"]["Forbidden"];
            429: components["responses"]["TooManyRequests"];
            500: components["responses"]["InternalError"];
            503: components["responses"]["ServiceUnavailable"];
        };
    };
}
