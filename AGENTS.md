# nuva-edu

Plataforma de cursos online instalável, uma escola por instalação. Tem dois sites: **admin** (`edu-admin.<dominio>`), onde a equipe gere alunos, conteúdo, vendas e suporte e que expõe um servidor MCP; e **classroom** (`classroom.<dominio>`), onde os alunos compram, assistem e participam do fórum e da comunidade.

## Fonte da verdade
As especificações em ./specs/ são a fonte da verdade. Toda mudança de comportamento começa pela spec.
Carregue cada spec sob demanda a partir do índice.

@specs/INDEX.md
@specs/PLAN.md
@specs/002-organizacao-do-trabalho.md

## Antes de propor mudanças
Consulte ./specs/decisions/ (comece pelo HISTORY.md). Não reabra uma decisão aceita sem um fato novo. Para mudá-la, proponha uma nova ADR.

A senha do usuário é guardada em texto legível (ADR 0002). Essa decisão não se discute nem se "corrige": qualquer tarefa que a toque é escalada ao humano.

## Fluxo de trabalho
- Pegue tarefas em ./tasks/ do checkout principal com status "aberta", do seu papel e sem dependências pendentes.
- Comece com `pnpm task:start NNN` (marca "em-andamento" e abre o worktree) e preencha "responsavel".
- Altere apenas os arquivos listados na tarefa e as pastas do seu papel, sempre dentro do worktree da tarefa.
- Commits no padrão Conventional Commits, em português, citando o ID: `feat(api-admin): ... (task 012)`.
- Ao concluir, atenda a Definition of Done e rode `pnpm task:finish NNN`: ele verifica, leva os commits à `main`, envia e remove worktree, branch e arquivo da tarefa.

## Worktree por tarefa
Cada tarefa roda em um worktree próprio (ADR 0021). O checkout principal (este diretório, o primeiro de `git worktree list`) fica sempre na `main` e limpo.
- No checkout principal: `pnpm task:start NNN`. Cria `.worktrees/task-NNN/` no branch `task/NNN` e imprime o caminho.
- Trabalhe só no worktree, pelo caminho absoluto impresso. Edite e commite ali; `git add -A` é permitido ali.
- Nunca edite arquivo versionado no checkout principal. Não faça `git push` nem `git merge` à mão.
- Termine com `pnpm task:finish NNN` (rebase na `main`, `pnpm verify:quick`, fast-forward, push, limpeza). Se a verificação falhar, corrija no worktree e rode de novo.
- Push negado: relate e pare. Não repita, não tente outro caminho, não peça a outro agente.
- A fila `tasks/` e o `tmp/` existem só no checkout principal; do worktree, `pnpm task:path` imprime o caminho dele.
- Banco e Docker são compartilhados: `pnpm dev:up` só no checkout principal, nunca num worktree. Migrations, uma tarefa por vez.
- `pnpm-lock.yaml` em conflito no rebase: refaça `pnpm install` no worktree, nunca à mão. `CHANGELOG.md`: só acrescente linhas.
- Abandonar: `pnpm task:abort NNN`. Com `--force`, só com confirmação do humano.
- Necessidade de mexer em arquivo de outro papel: pare e pergunte ao humano.

## Verificação
- Toda mudança vem com o teste que a cobre.
- Padrão: `pnpm verify:quick`. O `pnpm task:finish` o roda no worktree; rode também à mão durante a tarefa (`-- <teste> -t "<nome>"` para testes explícitos). No worktree ele olha só a mudança da tarefa (desde `git merge-base HEAD main`); `--files <caminhos>` existe, mas não é a forma normal.
- `pnpm verify:full` (com `--e2e` para ponta a ponta) só quando o usuário pedir e antes de release. O CI roda o completo na `main`.
- Ao terminar, diga qual nível rodou e o resultado. Subagentes seguem a mesma regra.

## Comandos
Disponíveis a partir da conclusão da Fase 0 do plano.
- Instalar: `pnpm install`
- Tarefas: `pnpm task:start NNN` · `pnpm task:finish NNN` · `pnpm task:abort NNN` · `pnpm task:path` · `pnpm task:list`
- Rodar (no checkout principal): `pnpm dev:up` (sites em http://edu-admin.localhost:8080 e http://classroom.localhost:8080) · parar: `pnpm dev:down`
- Migrations: `pnpm db:migrate`
- Testar: `pnpm verify:quick` · `pnpm verify:full` · `pnpm verify:full --e2e`
- Lint e formatação: `pnpm lint` · `pnpm format`
- Publicar no servidor de testes: `pnpm deploy:test`

## Estrutura
- ./specs/: especificações (fonte da verdade)
- ./specs/decisions/: registro de decisões (ADRs) e HISTORY.md
- ./tasks/: fila de trabalho (fora do Git, só no checkout principal)
- ./tmp/: arquivos temporários (fora do Git, só no checkout principal)
- ./.worktrees/: um worktree por tarefa em andamento, `task-NNN` (fora do Git)
- ./docs/: documentação derivada
- ./apps/: `admin-api`, `classroom-api`, `worker`, `admin`, `classroom` (cada API com seu `openapi.yaml`)
- ./packages/: `core` (regras e dados), `api-kit` (base HTTP das APIs), `ui` (componentes), `api-client` (cliente gerado)
- ./database/postgres/: compose do banco e migrations
- ./proxy/: `traefik` (compose do proxy reverso) e `nginx` (configuração dos sites)
- ./e2e/: testes de ponta a ponta
- ./scripts/: verificação, tarefas (`task.mjs`), deploy, backup
