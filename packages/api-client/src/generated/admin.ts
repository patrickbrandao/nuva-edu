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
}
