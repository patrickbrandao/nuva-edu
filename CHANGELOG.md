# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Versões: [SemVer](https://semver.org/lang/pt-BR/).
Detalhe das decisões em `specs/decisions/`.

## [Não lançado]

### Adicionado
- Specs 000 a 033, plano em 8 fases, ADRs 0001 a 0018.
- Definições de papel para Claude Code e OpenCode.
- Compose base: Postgres 18, Traefik opcional, Mailpit.

### Decisões
- Instalável, uma escola por instalação; AGPL-3.0.
- `admin-api` (com MCP) e `classroom-api` sobre um Postgres; worker com fila no banco; SSE.
- Senha em texto legível, exibida só ao admin.
- Venda avulsa e assinatura via Mercado Pago; conteúdo por link externo.
- TypeScript, Node 26, Fastify contrato primeiro, Kysely, React 19, minui em `packages/ui`.
- Commit direto na `main`, diretório compartilhado; `verify:quick` e `verify:full`.
