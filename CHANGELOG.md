# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões: [SemVer](https://semver.org/lang/pt-BR/).
Detalhe das decisões em `specs/decisions/`.

## [Não lançado]

### Adicionado
- Specs 000 a 033, plano em 8 fases, ADRs 0001 a 0018.
- Definições de papel para Claude Code e OpenCode.
- Compose base: Postgres 18, Traefik opcional, Mailpit.
- Contratos OpenAPI 3.1 iniciais das duas APIs: componentes comuns, saúde, `/api/v1/meta` e SSE.
- Monorepo pnpm 12, TypeScript 7, Biome, lefthook (lint no pre-commit, commit validado).
- `pnpm db:migrate` (`up`, `down`, `status`, `template`), migration 0001 (`settings`) e banco modelo dos testes.
- `packages/ui` (`@nuva-edu/ui`): tokens, Inter, primitivos, painel admin, preços e tema Sistema/Claro/Escuro do minui; catálogo e testes de renderização.
- `packages/api-client` (`@nuva-edu/api-client`): clientes tipados da admin-api e da classroom-api gerados dos contratos, erro problem+json (`ApiError`), fluxo SSE tipado e verificação de gerado desatualizado.
- `packages/core` (`@nuva-edu/core`): configuração validada por variável de ambiente, conexão Kysely com tipos gerados do banco, logger JSON com máscara de campos proibidos e erro de domínio em problem+json.
- `pnpm verify:quick` e `pnpm verify:full` (`scripts/verify.mjs`): lint, tipos e testes só do que mudou no rápido; suíte inteira com Postgres isolado por Testcontainers no completo; `scripts/test-db.mjs` como setup global do banco dos testes (`NUVA_TEST_DB=local`).

### Decisões
- Instalável, uma escola por instalação; AGPL-3.0.
- `admin-api` (com MCP) e `classroom-api` sobre um Postgres; worker com fila no banco; SSE.
- Senha em texto legível, exibida só ao admin.
- Venda avulsa e assinatura via Mercado Pago; conteúdo por link externo.
- TypeScript, Node 26, Fastify contrato primeiro, Kysely, React 19, minui em `packages/ui`.
- Commit direto na `main`, diretório compartilhado; `verify:quick` e `verify:full`.
