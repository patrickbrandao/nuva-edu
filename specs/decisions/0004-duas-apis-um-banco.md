# 0004 — Duas APIs sobre um único banco

Status: aceita
Data: 2026-11-24

## Contexto

O sistema tem dois sites (admin e classroom) e um servidor MCP administrativo. Era preciso decidir como dividir o backend.

## Decisão

(F2-01, A-01, A-02, A-03) Escolhida pelo usuário contra a recomendação de uma API única modular.

- Duas APIs sobre um único PostgreSQL: `admin-api` (API administrativa e MCP) e `classroom-api` (API do aluno, vitrine, checkout, webhook do Mercado Pago e SSE).
- Um `worker` processa a fila, e-mails, reconciliação de pagamentos, vencimentos e certificados.
- Os sites `admin` e `classroom` são estáticos. Completam o conjunto `postgres` e `traefik`; `mailpit` só no desenvolvimento.
- Imagens: `tmsoftbrasil/nuva-edu-{admin-api,classroom-api,worker,admin,classroom}`.
- Uma biblioteca de domínio compartilhada (`packages/core`) concentra regras de acesso, entidades e acesso a dados; as duas APIs e o worker a usam. Há um único conjunto de migrations em `database/postgres/`.
- Dono dos dados (quem escreve):
  - `admin-api`: configuração da escola, equipe, catálogo (cursos, módulos, aulas, ebooks, pacotes, planos, cupons), eventos, novidades, concessões manuais, moderação, chaves MCP e auditoria.
  - `classroom-api`: cadastro e sessões de aluno, cesta e pedidos, progresso, anotações, fórum, perfil, mensagens, cases, chamados (lado do aluno) e notificações lidas.
  - `worker`: estado de pagamento e de assinatura, direitos de acesso derivados, pontos e medalhas automáticas, certificados e fila de e-mail.

## Alternativas consideradas

- Uma API modular com rotas `/admin` e `/classroom` (recomendada): um dono dos dados, uma camada de autenticação, um contrato. Descartada pelo usuário, que preferiu isolar a superfície administrativa da pública.
- Serviços por domínio conversando por eventos: desproporcional para nó único e uma pessoa com agentes.

## Consequências

- Dois contratos OpenAPI e duas camadas de autenticação para manter; a regra de acesso é escrita uma única vez em `packages/core`.
- A superfície administrativa (inclusive o endpoint que exibe senhas e o MCP) não existe no processo exposto ao público.
- Como as duas APIs compartilham o banco, a tabela de dono dos dados é regra: um serviço não escreve em entidade de outro; precisa passar por função de `packages/core` do dono ou por tarefa na fila.
- Migrations são únicas e sequenciais, criadas só pelo papel banco (F5-05).
- Detalhado em [001](../001-arquitetura.md), [003](../003-admin-api.md), [004](../004-classroom-api.md) e [005](../005-worker-e-fila.md).
