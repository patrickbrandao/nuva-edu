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
- Pegue tarefas em ./tasks/ com status "aberta", do seu papel e sem dependências pendentes.
- Marque a tarefa como "em-andamento" e preencha "responsavel" antes de começar.
- Altere apenas os arquivos listados na tarefa e as pastas do seu papel.
- Ao concluir, atenda a Definition of Done, remova o arquivo da tarefa, faça o commit da entrega citando o ID e envie à `main`.

## Diretório compartilhado
Todos os agentes trabalham neste mesmo diretório, direto na `main`.
- `git add` e `git commit` sempre com os caminhos dos seus arquivos. Nunca `git add -A`, `git add .` ou `git commit -a`.
- Nunca use `stash`, `reset`, `checkout`, `restore`, `clean` ou `rebase` sobre arquivos que não são seus. Não troque de branch.
- Ignore alterações não commitadas de outros agentes: não corrija, não commite, não desfaça.
- Arquivo seu alterado por outro, ou necessidade de mexer em arquivo de outro papel: pare e pergunte ao humano.

## Verificação
- Toda mudança vem com o teste que a cobre.
- Padrão, ao concluir cada tarefa: `pnpm verify:quick` (use `--files <caminhos>` para limitar aos seus arquivos e `-- <teste> -t "<nome>"` para testes explícitos).
- `pnpm verify:full` (com `--e2e` para ponta a ponta) só quando o usuário pedir e antes de release. O CI roda o completo na `main`.
- Ao terminar, diga qual nível rodou e o resultado. Subagentes seguem a mesma regra.

## Comandos
Disponíveis a partir da conclusão da Fase 0 do plano.
- Instalar: `pnpm install`
- Rodar: `pnpm dev:up` (sites em http://edu-admin.localhost:8080 e http://classroom.localhost:8080) · parar: `pnpm dev:down`
- Migrations: `pnpm db:migrate`
- Testar: `pnpm verify:quick` · `pnpm verify:full` · `pnpm verify:full --e2e`
- Lint e formatação: `pnpm lint` · `pnpm format`
- Publicar no servidor de testes: `pnpm deploy:test`

## Estrutura
- ./specs/: especificações (fonte da verdade)
- ./specs/decisions/: registro de decisões (ADRs) e HISTORY.md
- ./tasks/: fila de trabalho (fora do Git)
- ./tmp/: arquivos temporários (fora do Git)
- ./docs/: documentação derivada
- ./apps/: `admin-api`, `classroom-api`, `worker`, `admin`, `classroom` (cada API com seu `openapi.yaml`)
- ./packages/: `core` (regras e dados), `ui` (componentes), `api-client` (cliente gerado)
- ./database/postgres/: compose do banco e migrations
- ./proxy/traefik/: compose do proxy reverso
- ./e2e/: testes de ponta a ponta
- ./scripts/: verificação, deploy, backup
