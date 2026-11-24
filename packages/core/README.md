# packages/core

Núcleo do nuva-edu (`@nuva-edu/core`): a base usada pelas duas APIs e pelo worker, e a única casa das regras de negócio. Dono: papel `nucleo` (specs/002).

Roda direto no Node 26, sem build: os imports levam `.ts` e a sintaxe é só a que o Node apaga.

| Caminho | Conteúdo |
| --- | --- |
| `src/config/` | Configuração lida e validada das variáveis de ambiente (spec 031) |
| `src/db/` | Conexão Kysely e tipos gerados do banco (`generated/`, não edite à mão) |
| `src/logging/` | Logger JSON e máscara de campos proibidos (spec 033) |
| `src/errors/` | Erro de domínio e conversão em problem+json (spec 003) |
| `src/modules/` | Uma pasta por área de negócio (veja o README de lá) |
| `scripts/db-types.ts` | Gera os tipos do Kysely a partir do banco |
| `test/` | Testes (Vitest); os de banco usam um banco clonado do modelo |

## Uso

```ts
import {
  createDatabase,
  createLogger,
  loadConfigOrExit,
  PROBLEM_CONTENT_TYPE,
  resolveRequestId,
  toProblem,
} from '@nuva-edu/core';

// Variável obrigatória ausente ou inválida: uma linha JSON `fatal` citando a variável, e exit 1.
const config = loadConfigOrExit({ service: 'admin-api', required: ['SESSION_SECRET'] });
const logger = createLogger({ service: 'admin-api', level: config.logLevel });
const db = createDatabase({ connectionString: config.databaseUrl, applicationName: 'admin-api', logger });

const log = logger.withRequestId(resolveRequestId(request.headers['x-request-id']));
log.info('Requisição atendida', { route, status, duration_ms });

// No tratador de erros da API:
const problem = toProblem(error, { instance: request.url });
reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
```

## Logs: o que nunca sai

- Campo cujo nome contém `password`, `token`, `secret`, `authorization`, `cookie`, `cpf`, `cnpj`, `document`, `key` (e `senha`, `credential`, `cardnumber`, `cvv`) é trocado por `[REDACTED]`, em qualquer profundidade.
- Em texto livre é mascarado o que tem forma reconhecível: credencial em URL, `Bearer`/`Basic`, pares `senha=valor`, CPF e CNPJ.
- Uma senha solta no meio de uma frase não tem forma: **nunca interpole senha, token ou chave numa mensagem**. Passe como campo, que a máscara cobre.
- O log de consultas traz só o SQL, sem parâmetros; `detail` e `where` dos erros do PostgreSQL são mascarados, porque reproduzem valores das linhas.

## Tipos do banco

```bash
pnpm --filter @nuva-edu/core db:types         # depois de cada migration nova
pnpm --filter @nuva-edu/core db:types:check   # falha se os tipos estiverem desatualizados
```

As colunas `snake_case` aparecem em `camelCase` no código (`CamelCasePlugin`). SQL escrito à mão com `sql` continua em `snake_case`.

## Testes

```bash
pnpm --filter @nuva-edu/core test            # precisa do Postgres local no ar
pnpm --filter @nuva-edu/core test:coverage   # falha abaixo de 80% de linhas
pnpm --filter @nuva-edu/core typecheck
```
