# nuva-edu

Plataforma de cursos online instalável: cada instalação atende uma escola, que vende e entrega conteúdo educacional e dá suporte aos seus alunos.

- **admin** (`edu-admin.<dominio>`): gestão de alunos, conteúdo, vendas, moderação e suporte, com servidor MCP para agentes de IA.
- **classroom** (`classroom.<dominio>`): vitrine, compra, aulas, fórum, comunidade e suporte ao aluno.

## Estado do projeto

Em especificação. O comportamento está definido em [`specs/`](specs/INDEX.md) e a implementação segue o [plano](specs/PLAN.md), que está na Fase 0 (fundação). Ainda não há versão utilizável.

## Onde ler

| O quê | Onde |
| --- | --- |
| Índice das especificações | [specs/INDEX.md](specs/INDEX.md) |
| Visão geral e escopo | [specs/000-visao-geral.md](specs/000-visao-geral.md) |
| Arquitetura | [specs/001-arquitetura.md](specs/001-arquitetura.md) |
| Plano de implementação | [specs/PLAN.md](specs/PLAN.md) |
| Registro de decisões | [specs/decisions/HISTORY.md](specs/decisions/HISTORY.md) |
| Instruções para agentes | [AGENTS.md](AGENTS.md) |

## Desenvolvimento

Requisitos: Docker com Compose e Node 26.

Por enquanto só a base de infraestrutura sobe (PostgreSQL, Traefik e Mailpit):

```bash
cp .env.example .env.local   # preencha POSTGRES_PASSWORD
docker compose --env-file .env --env-file .env.local --profile traefik --profile mailpit up -d
```

Os serviços da aplicação entram ao longo da Fase 0.

## Licença

[AGPL-3.0](LICENSE).
