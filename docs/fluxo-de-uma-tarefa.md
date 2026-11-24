# Fluxo de uma tarefa

Derivado de `specs/002-organizacao-do-trabalho.md` ("Worktree por tarefa" e "Janela de contrato")
e das ADRs 0021 e 0022. Em caso de divergência, vale a spec.

Cada tarefa roda num worktree próprio. O checkout principal (o primeiro de `git worktree list`)
fica sempre na `main` e limpo; nele vivem a fila `tasks/`, o `tmp/`, o `.env.local` e o ambiente
Docker.

## Passo a passo

```bash
# 1. No checkout principal: abre .worktrees/task-042 no branch task/042, a partir da main.
pnpm task:start 042 --as infra
#    A última linha da saída é WORKTREE=<caminho absoluto>.

# 2. No worktree: editar, testar e commitar (aqui `git add -A` pode).
cd .worktrees/task-042
pnpm verify:quick            # olha só a tarefa: tudo desde `git merge-base HEAD main`
git commit -m "feat(infra): ... (task 042)"

# 3. No worktree ou no checkout principal: leva a tarefa à main.
pnpm task:finish 042
```

O `task:start` liga o `.env.local` do checkout principal por link simbólico e roda
`pnpm install --frozen-lockfile` (poucos segundos: os pacotes vêm do armazém local do pnpm).
Ele recusa tarefa que não está `aberta`, tarefa com dependência (`depende-de`) ainda na fila e
branch ou worktree já existentes.

O `task:finish` faz, nesta ordem: confere o worktree limpo; `git rebase main`; `pnpm verify:quick`
no worktree; `git merge --ff-only task/042` no checkout principal (se a `main` andou no meio,
repete rebase e verificação uma vez); `git push origin main`; remove worktree, branch e o arquivo
da tarefa. Se o rebase trouxer mudança no `pnpm-lock.yaml`, ele reinstala antes de verificar.
O checkout principal precisa estar na `main` e limpo; senão o comando para sem tocar em nada.

Outros comandos:

| Comando | O que faz |
| --- | --- |
| `pnpm task:list` | Fila `tasks/`: status, papel, responsável, dependências pendentes e se há worktree. Com tarefa de janela na fila, ganha a coluna `JANELA` |
| `pnpm -s task:path` | Caminho do checkout principal (o `-s` tira o cabeçalho do pnpm, para capturar) |
| `pnpm task:abort 042` | Remove worktree e branch e devolve a tarefa a `aberta`; só com o worktree limpo e sem commits fora da `main` |
| `pnpm task:abort 042 --force` | Descarta também o que não foi commitado e os commits fora da `main`; pede confirmação digitada num terminal (uso do humano) |

## Quando o `task:finish` para

| Código | Situação | O que fazer |
| --- | --- | --- |
| 0 | Concluída e enviada | Nada |
| 1 | Uso errado ou erro inesperado do Git | Ler a mensagem |
| 2 | Pré-condição: tarefa sem worktree, checkout principal sujo ou fora da `main`; na janela de contrato, falta de commit ou de relato, ou tarefa da janela que não está `pronta` | Nada foi alterado; resolver e repetir |
| 3 | Worktree com alterações não commitadas | Commitar ou descartar e repetir |
| 4 | Conflito no rebase (fica em andamento no worktree) | Resolver, `git add`, `git rebase --continue` e repetir |
| 5 | `verify:quick` falhou | Corrigir, commitar e repetir; a `main` não mudou |
| 6 | Fast-forward impossível depois da nova tentativa | Repetir o `task:finish`; a `main` não recebeu a tarefa |
| 7 | Push falhou | A `main` local já avançou e a limpeza local foi feita. Não insistir: relatar ao humano, que roda `git push origin main` no checkout principal |
| 8 | `pnpm install` falhou no worktree | Ler a saída do pnpm |

O `task:start` usa os códigos 1, 2 e 8 (com 8, desfaz worktree e branch e a tarefa continua
`aberta`); o `task:abort`, 1, 2 e 3.

## Janela de contrato

Resumo do que o `scripts/task.mjs` faz; as regras de trabalho dentro da janela estão na spec 002
("Janela de contrato"). A janela `NNN` é a tarefa do contrato, aberta com o `task:start` normal.
As tarefas com `janela: NNN` no cabeçalho não têm worktree nem branch: trabalham em
`.worktrees/task-NNN/`, que é compartilhado (ali `git add -A` não pode).

```bash
# No checkout principal: entra na janela 029. Não cria worktree nem branch e não instala nada.
pnpm task:start 032 --as interface --join 029
#    A última linha da saída é WORKTREE=<caminho de .worktrees/task-029>.

# No worktree da janela: commits com caminhos explícitos, citando a própria tarefa.
git add packages/api-client && git commit -m "feat(interface): ... (task 032)" -- packages/api-client

# Acrescente "## Relato" ao arquivo da tarefa e, no checkout principal, marque-a como pronta.
pnpm task:finish 032

# Com todas as tarefas da janela prontas e o CHANGELOG.md commitado (task 029): fecha a janela.
pnpm task:finish 029
```

| Comando | Na janela |
| --- | --- |
| `task:start MMM --as <papel> --join NNN` | Só marca `MMM` como `em-andamento`. Recusa (código 2) se `MMM` não está `aberta`, se o cabeçalho não traz `janela: NNN`, se a janela não tem worktree e branch ou a tarefa `NNN` não está `em-andamento`, se `MMM` é a própria `NNN`, ou se há dependência na fila que não seja a `NNN` nem tarefa da janela já `pronta` |
| `task:start MMM --as <papel>` | Recusa (código 2) tarefa que tem `janela:`: é com `--join` |
| `task:finish MMM` | Exige `MMM` `em-andamento`, a janela aberta, um commit em `main..task/NNN` com o título terminando em `(task MMM)` e a seção `## Relato` no arquivo da tarefa. Marca `pronta` e lista as tarefas da janela. Não faz rebase, não verifica, não toca a `main`, não envia e não remove nada |
| `task:finish NNN` | Recusa (código 2) enquanto alguma tarefa da janela não estiver `pronta`, dizendo quais. Depois é o `task:finish` de sempre, e a limpeza remove também os arquivos das tarefas da janela (inclusive com o push negado, código 7) |
| `task:abort MMM` | Só devolve `MMM` a `aberta`. Recusa (código 2) se já há commit `(task MMM)` no branch da janela |
| `task:abort NNN` | As regras de sempre; devolve a `aberta` também as tarefas da janela `em-andamento` ou `prontas` |

Tarefa `pronta` ainda não está na `main`: quem depende dela de fora da janela continua esperando,
e o `task:list` a mostra em `DEPENDE DE` com o sufixo `(pronta)`.

## O que não é isolado

- `CHANGELOG.md` usa `merge=union` (`.gitattributes`): duas tarefas que acrescentam linha no mesmo
  ponto não conflitam no rebase. Só acrescente linhas; edição de linha existente pode duplicá-la.
- Conflito em `pnpm-lock.yaml` se resolve refazendo `pnpm install` no worktree, nunca à mão.
- Banco e Docker são um só para todos os worktrees: `pnpm dev:up` só no checkout principal, e
  migrations continuam uma tarefa por vez.
- `tasks/` e `tmp/` existem só no checkout principal.

A janela foi provada no próprio repositório em 2026-11-24, com duas tarefas descartáveis (990 e 991).
