# 0009 — Stack: TypeScript, Fastify com contrato primeiro, Kysely

Status: aceita
Data: 2026-11-24

## Contexto

Definidas as duas APIs e o worker ([0004](0004-duas-apis-um-banco.md)), era preciso escolher linguagem, framework, relação com o contrato OpenAPI e acesso ao banco. A regra do projeto é que a spec e o contrato vêm antes do código.

## Decisão

- Linguagem (F3-01): TypeScript em Node 26 LTS para `admin-api`, `classroom-api` e `worker`.
- Contrato primeiro (F3-02): o `openapi.yaml` de cada API é escrito à mão e é a referência. O Fastify valida requisições e respostas contra ele; os tipos TypeScript e o cliente usado pelos sites são gerados dele; um teste de contrato falha se rota e contrato divergirem.
- Banco (F3-03): PostgreSQL 18. Migrations em arquivos `.sql` numerados, com `up` e `down`, em `database/postgres/migrations`, aplicadas por comando próprio antes de as APIs subirem. Consultas com Kysely, com tipos gerados do banco.
- Monorepo (S-01): pnpm workspaces, com `apps/{admin-api,classroom-api,worker,admin,classroom}` e `packages/{core,ui,api-client}`.
- Bibliotecas (S-02): Fastify, Kysely com `pg`, SDK oficial de MCP em TypeScript, Nodemailer e SDK do Mercado Pago; nos sites, React Router e TanStack Query, com arquivos de tradução por idioma. O PDF do certificado é gerado no worker.

## Alternativas consideradas

- Linguagem: Go (binário único, mas duas linguagens e tipos gerados em dobro); Python com FastAPI.
- Contrato: código primeiro com Fastify (o contrato viraria derivado, contra a regra do projeto); NestJS (código primeiro, mais cerimônia).
- Banco: Drizzle (o esquema moraria num pacote, não em `database/postgres`); Prisma (mais pesado; `LISTEN/NOTIFY` e fila com `SKIP LOCKED` exigiriam contornar o ORM).

## Consequências

- Uma linguagem só para backend, frontend e agentes; os tipos do contrato são compartilhados por `packages/api-client`.
- Toda mudança de endpoint começa no `openapi.yaml`, alterado só pelo arquiteto (F5-05); o implementador não muda o contrato.
- O esquema do banco mora em `database/postgres/`, com o papel banco como único autor de migrations.
- O SQL fica visível, o que a fila ([0008](0008-fila-e-sse-no-postgres.md)) exige.
- Versões exatas das bibliotecas são fixadas no lockfile na Fase 0 do PLAN.
- Detalhado em [001](../001-arquitetura.md), [003](../003-admin-api.md), [004](../004-classroom-api.md) e [005](../005-worker-e-fila.md).
