# 002 — Organização do trabalho

Status: aprovada
Depende de: 000, 001

## Contexto

Vários agentes (Claude Code e OpenCode) trabalham no mesmo repositório, coordenados por uma pessoa. Cada tarefa roda em um worktree próprio, e a `main` só avança por fast-forward ([0021](decisions/0021-worktree-por-tarefa.md)). Esta spec define quem pode mexer em quê e como o trabalho flui sem conflito.

## Requisitos

- RF-01: Cada papel altera apenas as próprias pastas.
- RF-02: Cada tarefa lista os arquivos que pode alterar; duas tarefas em andamento nunca compartilham arquivo.
- RF-03: Toda mudança de comportamento começa pela spec; contrato e migration vêm antes do código que os usa.
- RF-04: Toda mudança vem com o teste que a cobre.
- RF-05: Mudança de contrato, a rota que a atende e o cliente gerado entram na mesma janela de trabalho ([Janela de contrato](#janela-de-contrato)).
- RF-06: Cada tarefa roda em um worktree e um branch próprios, abertos por `pnpm task:start` e encerrados por `pnpm task:finish`. Nenhum agente edita arquivo versionado no checkout principal.
- RF-07: A `main` só avança por fast-forward, a partir de um branch de tarefa que passou por rebase sobre a `main` e por `pnpm verify:quick`.
- RNF-01: Nenhum commit contém arquivo fora das pastas do papel de quem o fez (verificável pelo histórico).
- RNF-02: O histórico da `main` é linear: sem merge commit (verificável por `git log --merges main`, que deve ser vazio).
- RNF-03: Com nenhuma tarefa em andamento, `git status` no checkout principal não mostra alteração e `git worktree list` mostra só ele.

## Comportamento

### Papéis

| Papel | Responsabilidade | Pastas de propriedade |
| --- | --- | --- |
| `arquiteto` | Specs, ADRs, contratos, plano e criação de tarefas | `specs/`, `apps/*/openapi.yaml`, `AGENTS.md`, `CLAUDE.md`, `.claude/agents/`, `.opencode/agent/` |
| `banco` | Esquema, migrations, sementes de teste | `database/postgres/` |
| `nucleo` | Regras de negócio, acesso a dados, fila | `packages/core/` |
| `api-admin` | API administrativa, MCP e a base HTTP comum às duas APIs | `apps/admin-api/` (exceto `openapi.yaml`), `packages/api-kit/` |
| `api-classroom` | API do aluno e worker | `apps/classroom-api/` (exceto `openapi.yaml`), `apps/worker/` |
| `web-admin` | Site de administração | `apps/admin/` |
| `web-classroom` | Site do aluno | `apps/classroom/` |
| `interface` | Componentes, tokens e cliente gerado das APIs | `packages/ui/`, `packages/api-client/` |
| `infra` | Docker, proxy, CI, scripts, documentação, arquivos da raiz | `docker-compose.yml`, `.env`, `.env.example`, `proxy/`, `.github/`, `scripts/`, `docs/`, `package.json`, `pnpm-workspace.yaml`, configurações da raiz, `apps/*/Dockerfile`, `apps/*/docker-compose.yml` |
| `testador` | Testes de ponta a ponta | `e2e/` |

Regras de propriedade:

- Só o `arquiteto` altera `specs/`, as ADRs e os `openapi.yaml`.
- Só o `banco` cria ou altera migrations. As migrations são numeradas em sequência e criadas uma de cada vez.
- Quem precisar de mudança em spec, contrato ou migration cria uma tarefa para o dono e segue em outra tarefa.
- O `CHANGELOG.md` é alterado por qualquer papel, só acrescentando linhas em `## [Não lançado]`.
- Testes de unidade e de integração ficam junto do código e pertencem ao dono da pasta.

### Git

- A `main` é o único branch permanente e o único enviado ao GitHub. Cada tarefa usa um branch local `task/NNN`, que nunca é enviado e some ao fim da tarefa. Não há PR.
- A `main` só avança por fast-forward (`git merge --ff-only`). Não há merge commit nem squash: os commits da tarefa entram como estão.
- Mensagens no padrão Conventional Commits, em português, citando a tarefa: `feat(api-admin): lista de usuários com filtro (task 012)`.
- O escopo do commit é o nome do papel ou do pacote.
- Quem leva o trabalho à `main` e faz `git push origin main` é o `pnpm task:finish`, não o agente à mão.
- O usuário revisa os commits depois. Não há agente revisor.

### Worktree por tarefa

**Checkout principal.** É o diretório do repositório (o primeiro de `git worktree list`). Fica sempre na `main` e limpo. Ninguém edita código nele. Ali vivem a fila `tasks/`, `tmp/`, o `.env.local` e o ambiente Docker.

**Worktree da tarefa.** Cada tarefa roda em `.worktrees/task-NNN/` (pasta no `.gitignore`), no branch local `task/NNN`, criado a partir da `main`.

| Comando | O que faz |
| --- | --- |
| `pnpm task:start NNN --as <papel>` | Roda no checkout principal. Cria o branch e o worktree, liga o `.env.local` do checkout principal por link simbólico, roda `pnpm install --frozen-lockfile` no worktree, marca a tarefa como `em-andamento`, preenche `responsavel` com o papel e imprime o caminho do worktree. Recusa se a tarefa não está `aberta`, se tem dependência ainda na fila ou se o branch ou o worktree já existem. |
| `pnpm task:finish NNN` | Roda no worktree ou no checkout principal. Leva a tarefa à `main` (passos abaixo). |
| `pnpm task:abort NNN` | Remove worktree e branch e devolve a tarefa a `aberta`. Só com o worktree limpo e sem commit fora da `main`; com alteração pendente ou commit não integrado exige `--force`, que é ação destrutiva e depende de confirmação do humano. |
| `pnpm task:path` | Imprime o caminho do checkout principal. |
| `pnpm task:list` | Lista a fila inteira: status, papel, responsável, dependências pendentes e se há worktree aberto. |

Os cinco comandos são implementados por `scripts/task.mjs`.

Dentro do worktree, o agente:

1. Edita e commita só ali. Usa o caminho absoluto que o `task:start` imprimiu.
2. Altera só os arquivos listados na tarefa e dentro das pastas do seu papel. O worktree isola o trabalho de cada tarefa; a propriedade das pastas não muda.
3. Pode usar `git add -A`: o worktree é só dele.
4. Não sobe nem reconstrói o ambiente Docker a partir do worktree.

`pnpm task:finish NNN` faz, nesta ordem:

1. confere que o worktree está limpo (tudo commitado);
2. `git rebase main` no branch da tarefa. Conflito: para e avisa;
3. `pnpm verify:quick` no worktree. Falha: para;
4. `git merge --ff-only task/NNN` no checkout principal. Se a `main` andou no meio, repete o rebase e a verificação uma vez;
5. `git push origin main`;
6. remove o worktree e o branch;
7. remove o arquivo da tarefa.

Se o push for negado, o script conclui a limpeza local (worktree, branch e arquivo da tarefa removidos), imprime o comando de envio que falta e termina com o código de saída 7; a `main` local fica já avançada. Conflito no rebase (código 4) deixa o rebase em andamento no worktree: o agente o resolve ali quando o conflito é em arquivo da própria tarefa e roda o `task:finish` de novo; conflito em arquivo de outro papel é caso de escalonamento. O agente relata o fato e para: não repete o push, não tenta outro caminho e não pede a outro agente que o faça.

Arquivos com regra própria:

- **`pnpm-lock.yaml`**: cada tarefa commita o lockfile junto com a mudança de dependência. Conflito no rebase se resolve refazendo `pnpm install` no worktree, nunca à mão.
- **`CHANGELOG.md`**: continua editado direto, uma linha por entrega em "Não lançado". O `.gitattributes` declara `CHANGELOG.md merge=union`, para o rebase não conflitar a cada tarefa. Essa junção não avisa quando dois lados mexem na mesma linha, por isso a regra de só acrescentar linhas vale sem exceção.

O que os worktrees **não** isolam:

- **Banco e Docker.** Há um Postgres local e um ambiente Compose para todos. O ambiente Docker é reconstruído a partir do checkout principal (`pnpm dev:up` lá), nunca de um worktree. O e2e roda contra o que está no ar.
- **Fila `tasks/` e `tmp/`.** Estão fora do Git e existem só no checkout principal. Do worktree, o agente os alcança pelo caminho que `pnpm task:path` imprime.

### Fluxo das tarefas

A fila fica em `tasks/` do checkout principal, fora do Git, no formato do template de tarefa.

1. Um problema encontrado por inspeção vira uma tarefa nova (qualquer papel pode criar; o `arquiteto` cria as de cada fase do plano). Tarefa nova é sempre gravada em `tasks/` do checkout principal, mesmo quando quem a cria está num worktree.
2. O agente pega uma tarefa `aberta`, do seu papel, cujas dependências já foram removidas da fila.
3. Para começar, roda `pnpm task:start NNN --as <papel>` no checkout principal. O comando marca a tarefa como `em-andamento` e preenche `responsavel`. Ninguém pega tarefa `em-andamento`.
4. Trabalha e commita no worktree, citando o ID em cada commit.
5. Ao concluir, atende a Definition of Done e roda `pnpm task:finish NNN`, que leva os commits à `main`, envia e remove o worktree, o branch e o arquivo da tarefa.
6. Tarefa abandonada: `pnpm task:abort NNN` remove o worktree e o branch e devolve a tarefa a `aberta`. Tarefa descartada também é removida da fila; se o descarte for uma decisão, o `arquiteto` registra uma ADR.
7. Tarefa que não pode avançar fica `bloqueada`, com o motivo escrito no corpo.

O status `em-revisao` do template não é usado, porque não há revisão antes da `main`.

### Paralelismo

- Cada tarefa em andamento tem o próprio worktree; várias rodam ao mesmo tempo sem enxergar o trabalho pendente umas das outras.
- Duas tarefas rodam em paralelo quando os campos `arquivos` não se cruzam. O worktree não dispensa essa regra: com arquivos cruzados, a segunda a terminar para no rebase com conflito.
- Dentro de um recurso a ordem é fixa: spec → migration → `packages/core` → contrato → APIs e `packages/api-client` → sites → e2e. A spec decide o contrato antes de tudo; o arquivo `openapi.yaml` só muda quando a API pode alcançá-lo em seguida ([Janela de contrato](#janela-de-contrato)).
- Mudança de contrato e migration são sempre sequenciais entre si. Migrations continuam uma tarefa por vez, também porque o Postgres local é compartilhado entre os worktrees.
- O fim das tarefas é serializado: o `task:finish` só avança a `main` por fast-forward, e quem chega depois refaz rebase e verificação.
- As frentes paralelas de cada fase estão no [PLAN](PLAN.md).

### Janela de contrato

As APIs sobem em modo estrito ([003](003-admin-api.md), RF-04): operação do contrato sem rota, ou rota fora do contrato, impede a subida e quebra o teste de contrato. O cliente de `packages/api-client` também é conferido contra o contrato. Como o contrato vem antes do código, uma mudança de contrato deixa a `main` vermelha até a API e o cliente a alcançarem. A regra para manter esse intervalo curto e previsível ([0019](decisions/0019-janela-de-contrato-e-operacoes-pendentes.md)):

1. Antes de alterar o `openapi.yaml`, o `arquiteto` cria as tarefas encadeadas: a da API dona da rota (`api-admin` ou `api-classroom`), a do `interface` para regenerar o cliente e, se houver, as dos sites. A tarefa do contrato e essas tarefas formam uma **janela**.
2. O `arquiteto` só envia o contrato quando a tarefa da API está criada, sem dependência pendente além do próprio contrato, e é a próxima a ser executada pelo papel dono. A tarefa do `interface` roda em paralelo com a da API.
3. Operação **nova** entra no contrato com a extensão `x-nuva-pending: true` no objeto da operação. A conferência do `api-kit` ignora operação pendente sem rota, então a API continua subindo e o teste de contrato continua verde. A tarefa da API registra a rota e pede ao `arquiteto`, no relato, a retirada da marca. Operação pendente que já tem rota não impede a subida (a rota pode chegar antes de a marca sair), mas gera aviso no log e no teste de contrato até a marca ser retirada.
4. Mudança em operação **existente** (campo obrigatório novo, esquema alterado, resposta nova) não tem marca: o contrato e a rota divergem até a tarefa da API terminar. Por isso a janela inteira é executada em sequência, sem outra tarefa do mesmo papel no meio.
5. Enquanto a janela está aberta, as falhas esperadas são só as dela: `pnpm --filter @nuva-edu/api-client check` (gerado desatualizado) e os testes da API que a mudança atinge. Quem roda `verify:quick` em outra área e esbarra nelas relata e segue; ninguém as "corrige" fora da tarefa dona.
6. A janela fecha quando contrato, rota e cliente gerado estão na `main` e `pnpm verify:quick` das três áreas está verde. Os sites só usam a operação depois disso (a tarefa do site depende da da API e da do `interface`).
7. Nenhuma release sai com operação pendente: `check-contract --no-pending` faz parte do `verify:full`.

Mudança de contrato que não altera o cliente gerado nem a validação (hoje, só afrouxar um `pattern`) dispensa a janela, desde que `pnpm --filter @nuva-edu/api-client check` e os testes das duas APIs passem no mesmo commit.

### Verificação

- Padrão: `pnpm verify:quick`. O `pnpm task:finish` o roda no worktree, depois do rebase, antes de avançar a `main`; o agente também pode rodá-lo à mão durante a tarefa.
- No worktree, "o que mudou" é tudo desde `git merge-base HEAD main`, mais o que ainda não foi commitado: só a mudança da tarefa. `--files <caminhos>` continua existindo, mas deixa de ser a forma normal.
- `pnpm verify:full` só quando o usuário pedir e antes de release. O CI roda o nível completo com e2e na `main` a cada push.
- Ao terminar, o agente diz qual nível rodou e o resultado.
- Se o CI da `main` quebrar, a correção vira tarefa de prioridade máxima para o dono do arquivo, e ninguém inicia tarefa nova naquela área até resolver.
- Detalhes em [032](032-verificacao-e-ci.md).

### Definition of Done

Uma tarefa está concluída quando tudo abaixo é verdade:

- o código está implementado;
- os testes do nível acordado foram escritos e estão passando;
- lint, formatação e checagem de tipos estão limpos;
- `pnpm verify:quick` está verde (o `task:finish` o roda), e o nível rodado foi informado no relato final;
- a spec e os contratos estão atualizados, se mudaram (pelo `arquiteto`);
- a documentação em `docs/` está atualizada, quando aplicável;
- o `CHANGELOG.md` recebeu o resumo compactado da entrega;
- todo commit da tarefa cita o ID dela;
- `pnpm task:finish NNN` terminou sem erro: os commits estão na `main` por fast-forward e foram enviados, e o worktree, o branch e o arquivo da tarefa foram removidos. Se o push foi negado, a tarefa só está concluída depois que o humano resolver o envio, e o relato final diz isso.

### Escalonamento ao humano

O agente para e pergunta quando houver:

- conflito entre a spec e o que foi pedido, ou entre duas specs;
- decisão irreversível ou destrutiva: apagar dados, migration sem volta, reescrever histórico;
- mudança em contrato já publicado em uma release;
- qualquer coisa que toque a regra da senha em texto legível ([0002](decisions/0002-senha-em-texto-legivel.md));
- necessidade de credencial ou gasto externo: Mercado Pago, provedores de login, Docker Hub, DNS, SMTP;
- ação no servidor de testes além do `pnpm deploy:test`;
- tarefa que falhou em mais de uma tentativa de correção;
- necessidade de alterar arquivo de outro papel, ou arquivo próprio alterado por outro agente;
- push negado no `pnpm task:finish`: o agente relata e para; não insiste, não tenta outro caminho e não pede a outro agente que envie;
- `pnpm task:abort --force`, que descarta trabalho não commitado ou commits que não chegaram à `main`: exige a confirmação do humano.

## Interfaces e contratos

- Template de tarefa, de spec e de ADR: os definidos no roteiro do projeto e usados nos arquivos existentes.
- Definições de papel para as ferramentas: `.claude/agents/<papel>.md` e `.opencode/agent/<papel>.md`.
- Comandos de tarefa, implementados em `scripts/task.mjs`:

```
pnpm task:start <NNN> --as <papel>
pnpm task:finish <NNN>
pnpm task:abort <NNN> [--force]
pnpm task:path
pnpm task:list
```

- Nomes fixos: pasta `.worktrees/task-NNN/`, branch `task/NNN`.

## Dados

- `tasks/` e `tmp/` ficam fora do Git e só existem no checkout principal. O histórico do Git preserva o registro das tarefas concluídas pelo ID no commit.
- `.worktrees/` fica no `.gitignore`. O `.env.local` de cada worktree é um link simbólico para o do checkout principal.

## Critérios de aceite

- [ ] Existe uma definição por papel nas duas ferramentas.
- [ ] Todo commit de entrega cita uma tarefa.
- [ ] Nenhum commit mistura pastas de papéis diferentes, salvo `CHANGELOG.md`.
- [ ] `pnpm task:start NNN --as <papel>` cria `.worktrees/task-NNN/` no branch `task/NNN` e marca a tarefa como `em-andamento`; repetido, recusa.
- [ ] `pnpm task:finish NNN` com alteração não commitada, conflito no rebase ou `verify:quick` vermelho para sem tocar a `main`.
- [ ] Depois de um `pnpm task:finish NNN` bem-sucedido, a `main` contém os commits da tarefa sem merge commit, e o worktree, o branch e o arquivo da tarefa não existem mais.
- [ ] Push negado no `task:finish` termina com código de saída próprio e a `main` local avançada.
- [ ] `pnpm task:abort NNN` com alteração pendente ou com commit fora da `main` recusa sem `--force`.
- [ ] Duas tarefas que acrescentam linhas ao `CHANGELOG.md` terminam sem conflito de rebase.
- [ ] Toda mudança de `openapi.yaml` que altera o cliente gerado tem, criadas antes do commit, a tarefa da API e a do `interface`.
- [ ] Nenhuma tag de release contém operação com `x-nuva-pending`.

## Fora de escopo

- Pull requests internos e agente revisor.
- Banco de dados ou ambiente Docker por worktree.
- Envio dos branches de tarefa ao GitHub.

## Decisões relacionadas

- [0021 — Um worktree por tarefa](decisions/0021-worktree-por-tarefa.md)
- [0013 — Commit direto na main, diretório compartilhado (substituída por 0021)](decisions/0013-commit-direto-na-main-diretorio-compartilhado.md)
- [0014 — Verificação em dois níveis](decisions/0014-verificacao-em-dois-niveis.md)
- [0019 — Janela de contrato e operações pendentes](decisions/0019-janela-de-contrato-e-operacoes-pendentes.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md)
