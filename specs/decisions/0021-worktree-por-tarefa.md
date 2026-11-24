# 0021 — Um worktree por tarefa

Status: aceita
Data: 2026-11-24

Substitui a [0013](0013-commit-direto-na-main-diretorio-compartilhado.md) e, da [0014](0014-verificacao-em-dois-niveis.md), só a definição de "o que mudou" do `verify:quick`.

## Contexto

A 0013 deixou todos os agentes no mesmo diretório, com commit direto na `main`, e dependia de disciplina: `git add` por caminho, nada de `stash` ou `reset`, ignorar o trabalho pendente dos outros. Ela era provisória, com gatilho de revisão declarado: commit contendo arquivo de outro papel, ou `main` quebrada por trabalho misturado. Ainda na Fase 0 o gatilho disparou pelos dois lados, e apareceu um terceiro problema:

- **Commit com arquivo de outro papel.** O `22b3125` (papel `web-classroom`, tarefa 041) levou junto uma edição do `infra` em `apps/classroom/Dockerfile`, que ainda estava pendente no diretório. O `67f80d9` (papel `api-classroom`, tarefa 050) alterou `apps/worker/Dockerfile`, arquivo do `infra`.
- **`main` quebrada por trabalho misturado.** A edição do `Dockerfile` que entrou no `22b3125` dependia de um arquivo que o `infra` ainda não tinha enviado. A `main` do GitHub ficou alguns minutos sem construir a imagem do classroom.
- **Contornos no Git por causa do `CHANGELOG.md`.** Todo papel acrescenta uma linha no mesmo arquivo. Com linhas pendentes de vários agentes ao mesmo tempo, quatro deles recorreram a índice temporário, `git commit-tree` ou `git apply --cached` para commitar só a própria linha. São operações frágeis, fora do que a 0013 previa.

As regras da 0013 não tinham barreira técnica: nada impedia um `git commit` de levar o que estava no índice ou no diretório por obra de outro agente.

## Decisão

Decidida pelo usuário em 2026-11-24. Cada tarefa passa a rodar em um worktree e um branch próprios; a `main` só avança por fast-forward.

1. **Checkout principal.** Fica sempre na `main` e limpo. Ninguém edita código nele. Ali vivem a fila `tasks/`, `tmp/`, o `.env.local` e o ambiente Docker.
2. **Worktree por tarefa.** Cada tarefa roda em `.worktrees/task-NNN/` (pasta no `.gitignore`), no branch local `task/NNN`, criado a partir da `main`.
3. **Início.** `pnpm task:start NNN`, no checkout principal, cria branch e worktree, liga o `.env.local` por link simbólico, roda `pnpm install --frozen-lockfile` no worktree, marca a tarefa como `em-andamento` e imprime o caminho. Recusa se a tarefa já está `em-andamento` ou se o worktree existe.
4. **Trabalho.** O agente edita e commita só dentro do worktree. `git add -A` volta a ser permitido ali. Continuam valendo as pastas do papel, os arquivos da tarefa e os Conventional Commits em português citando a tarefa.
5. **Fim.** `pnpm task:finish NNN` confere o worktree limpo, faz `git rebase main`, roda `pnpm verify:quick` no worktree, faz `git merge --ff-only task/NNN` no checkout principal (se a `main` andou no meio, repete rebase e verificação uma vez), faz `git push origin main`, remove worktree e branch e remove o arquivo da tarefa. Conflito no rebase ou verificação vermelha param o script. Push negado termina com aviso e código de saída próprio, com a `main` local já avançada: o agente relata e não insiste.
6. **Histórico linear.** Só fast-forward. Sem merge commit e sem squash: os commits da tarefa entram como estão.
7. **`pnpm-lock.yaml`.** Cada tarefa commita o lockfile junto com a mudança de dependência. Conflito no rebase se resolve refazendo `pnpm install` no worktree, nunca à mão.
8. **`CHANGELOG.md`.** Continua editado direto, uma linha por entrega. O `.gitattributes` declara `CHANGELOG.md merge=union`, para o rebase não conflitar a cada tarefa.
9. **Fila `tasks/`.** Fica só no checkout principal, porque está fora do Git. Do worktree, o agente a alcança pelo caminho que `pnpm task:path` imprime.
10. **Banco e Docker compartilhados.** Um Postgres local e um ambiente Compose para todos os worktrees. Migrations continuam uma tarefa por vez. O ambiente Docker é reconstruído a partir do checkout principal, nunca de um worktree. O e2e roda contra o que está no ar.
11. **`verify:quick`.** A base da comparação é `git merge-base HEAD main` (branch local), não mais `origin/main`. `--files` continua existindo, mas deixa de ser necessário.
12. **Tarefa abandonada.** `pnpm task:abort NNN` remove worktree e branch e devolve a tarefa a `aberta`, só com o worktree limpo. Com alterações pendentes exige `--force`, que é ação destrutiva e depende de confirmação do humano.
13. **Papéis e pastas não mudam.** Muda que a mistura deixa de ser possível por acidente: cada commit sai de um worktree que só contém uma tarefa.
14. **Revisão.** Continua sem PR e sem agente revisor; o usuário revisa os commits depois. O CI roda na `main` após o push.

Nomes fixos: pasta `.worktrees/task-NNN/`, branch `task/NNN`, scripts `task:start`, `task:finish`, `task:abort`, `task:path` e `task:list`, todos em `scripts/task.mjs`.

## Alternativas consideradas

- **Manter o diretório compartilhado com regras mais duras** (gancho de `pre-commit` que recusa arquivo fora das pastas do papel, trava em arquivo para o `CHANGELOG.md`). O gancho não sabe qual papel está commitando sem um dado que o próprio agente informa, então continua sendo disciplina. Também não resolve o caso do `22b3125`: o arquivo pendente de outro agente continua no diretório, visível para o build, para os testes e para o `verify:quick` de todos.
- **Worktree por tarefa com PR no GitHub.** Daria o CI antes da `main` e um ponto de revisão. O usuário manteve a escolha da 0013 de não ter PR nem revisor: cada tarefa esperaria um `verify:full --e2e` e um merge, e o problema a resolver era a mistura de trabalho, que o worktree sozinho já elimina.
- **Fragmentos de changelog** (um arquivo por entrega, reunidos na release) em vez de `merge=union`. Elimina o conflito por construção, mas exige ferramenta de montagem e muda o hábito de todos os papéis. O `merge=union` é uma linha de configuração; se der problema, os fragmentos são o próximo passo.

## Consequências

Boas:

- A mistura de trabalho deixa de depender de disciplina. Um commit só contém o que está no worktree da tarefa, e o `verify:quick` só enxerga a mudança dela.
- Acabam os contornos no Git: no worktree vale `git add -A`, porque nada ali é de outro agente.
- A `main` só recebe trabalho que passou por rebase e `verify:quick` sobre a `main` atual.
- Encerrar a tarefa vira um comando, e a ordem (rebase, verificação, fast-forward, push, limpeza) deixa de ser lembrada por cada agente.

Ruins, aceitas:

- **`pnpm install` por worktree.** Cada `task:start` instala as dependências de novo. O armazenamento do pnpm é compartilhado, então o custo é de tempo e de links, não de download, mas existe em toda tarefa.
- **Banco e Docker continuam compartilhados.** O worktree isola arquivos, não serviços. Uma migration em andamento num worktree altera o Postgres que os outros usam para testar, por isso migrations seguem uma por vez. O ambiente Compose mostra o que está no checkout principal: o e2e não exercita o código de um worktree antes de ele chegar à `main`.
- **`tasks/` só existe no checkout principal.** Está fora do Git, então não aparece no worktree. O agente precisa do caminho de `pnpm task:path` para ler a própria tarefa e para criar outras. O mesmo vale para `tmp/`.
- **`merge=union` não entende o arquivo.** Ele junta as linhas dos dois lados sem conflito. Serve para acréscimos; se duas tarefas editarem a mesma linha existente, as duas versões ficam no arquivo sem aviso. A regra de só acrescentar linhas em "Não lançado" passa a ser necessária, não só recomendada.
- **A serialização fica no fim.** Duas tarefas que terminam ao mesmo tempo disputam o avanço da `main`; a segunda refaz rebase e verificação. Tarefas longas pagam rebase maior.
- **Push negado deixa a `main` local à frente da remota.** Os worktrees seguintes nascem dessa `main` local, e o CI só roda quando o push acontecer.
- O risco de um erro só aparecer no CI depois do push, aceito na 0013, continua: o `task:finish` roda o nível rápido, não o completo.
- A 0014 segue aceita, mas o trecho dela que define "o que mudou" como `origin/main..HEAD` fica substituído pelo item 11.
- Detalhado em [002](../002-organizacao-do-trabalho.md) e [032](../032-verificacao-e-ci.md).
