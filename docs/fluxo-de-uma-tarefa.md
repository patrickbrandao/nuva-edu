# Fluxo de uma tarefa

Derivado de `specs/002-organizacao-do-trabalho.md` ("Worktree por tarefa") e da ADR 0021. Em caso
de divergência, vale a spec.

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
| `pnpm task:list` | Fila `tasks/`: status, papel, responsável, dependências pendentes e se há worktree |
| `pnpm -s task:path` | Caminho do checkout principal (o `-s` tira o cabeçalho do pnpm, para capturar) |
| `pnpm task:abort 042` | Remove worktree e branch e devolve a tarefa a `aberta`; só com o worktree limpo |
| `pnpm task:abort 042 --force` | Descarta também o que não foi commitado; pede confirmação digitada num terminal (uso do humano) |

## Quando o `task:finish` para

| Código | Situação | O que fazer |
| --- | --- | --- |
| 0 | Concluída e enviada | Nada |
| 1 | Uso errado ou erro inesperado do Git | Ler a mensagem |
| 2 | Pré-condição: tarefa sem worktree, checkout principal sujo ou fora da `main` | Nada foi alterado; resolver e repetir |
| 3 | Worktree com alterações não commitadas | Commitar ou descartar e repetir |
| 4 | Conflito no rebase (fica em andamento no worktree) | Resolver, `git add`, `git rebase --continue` e repetir |
| 5 | `verify:quick` falhou | Corrigir, commitar e repetir; a `main` não mudou |
| 6 | Fast-forward impossível depois da nova tentativa | Repetir o `task:finish`; a `main` não recebeu a tarefa |
| 7 | Push falhou | A `main` local já avançou e a limpeza local foi feita. Não insistir: relatar ao humano, que roda `git push origin main` no checkout principal |
| 8 | `pnpm install` falhou no worktree | Ler a saída do pnpm |

O `task:start` usa os códigos 1, 2 e 8 (com 8, desfaz worktree e branch e a tarefa continua
`aberta`); o `task:abort`, 1, 2 e 3.

## O que não é isolado

- `CHANGELOG.md` usa `merge=union` (`.gitattributes`): duas tarefas que acrescentam linha no mesmo
  ponto não conflitam no rebase. Só acrescente linhas; edição de linha existente pode duplicá-la.
- Conflito em `pnpm-lock.yaml` se resolve refazendo `pnpm install` no worktree, nunca à mão.
- Banco e Docker são um só para todos os worktrees: `pnpm dev:up` só no checkout principal, e
  migrations continuam uma tarefa por vez.
- `tasks/` e `tmp/` existem só no checkout principal.
