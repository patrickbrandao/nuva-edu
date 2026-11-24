# 002 — Organização do trabalho

Status: aprovada
Depende de: 000, 001

## Contexto

Vários agentes (Claude Code e OpenCode) trabalham no mesmo repositório, coordenados por uma pessoa. Cada tarefa roda em um worktree próprio, e a `main` só avança por fast-forward ([0021](decisions/0021-worktree-por-tarefa.md)); a única exceção são as tarefas de uma janela de contrato, que dividem um worktree ([0022](decisions/0022-janela-de-contrato-num-so-branch.md)). Esta spec define quem pode mexer em quê e como o trabalho flui sem conflito.

## Requisitos

- RF-01: Cada papel altera apenas as próprias pastas.
- RF-02: Cada tarefa lista os arquivos que pode alterar; duas tarefas em andamento nunca compartilham arquivo.
- RF-03: Toda mudança de comportamento começa pela spec; contrato e migration vêm antes do código que os usa.
- RF-04: Toda mudança vem com o teste que a cobre.
- RF-05: Mudança de contrato, a rota que a atende, o cliente gerado e todo pacote que quebraria com eles formam uma janela, que chega à `main` por um único branch ([Janela de contrato](#janela-de-contrato)).
- RF-06: Cada tarefa roda em um worktree e um branch próprios, abertos por `pnpm task:start` e encerrados por `pnpm task:finish`. Nenhum agente edita arquivo versionado no checkout principal. Exceção: as tarefas de uma janela de contrato trabalham no worktree da janela ([Janela de contrato](#janela-de-contrato)).
- RF-07: A `main` só avança por fast-forward, a partir de um branch de tarefa que passou por rebase sobre a `main` e por `pnpm verify:quick`.
- RNF-01: Nenhum commit contém arquivo fora das pastas do papel de quem o fez (verificável pelo histórico). Única exceção: o commit dos tipos gerados do banco, feito pela tarefa de migration ([Regras de propriedade](#papéis)).
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
- **Migration leva os tipos gerados.** O passo `tipos-banco` do `verify:quick` reprova a migration que cria ou altera tabela enquanto os tipos do Kysely não descrevem o banco ([032](032-verificacao-e-ci.md)). Por isso a tarefa de migration do `banco` regenera os tipos (`pnpm --filter @nuva-edu/core db:types`) e commita, no mesmo branch e em commit separado, só o arquivo gerado `packages/core/src/db/generated/database.ts`, com escopo `nucleo`: `chore(nucleo): tipos do banco regenerados com a migration NNNN (task NNN)`. É a única escrita do `banco` fora da própria pasta, e o arquivo é gerado, nunca editado à mão. O `nucleo` não regenera os tipos por conta própria nem espera tarefa para isso; o código que passa a usar a tabela nova continua sendo dele, na tarefa seguinte.
- Quem precisar de mudança em spec, contrato ou migration cria uma tarefa para o dono e segue em outra tarefa.
- O `CHANGELOG.md` é alterado por qualquer papel, só acrescentando linhas em `## [Não lançado]`. Numa janela de contrato, só por quem a fecha.
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
| `pnpm task:start NNN --as <papel>` | Roda no checkout principal. Cria o branch e o worktree, liga o `.env.local` do checkout principal por link simbólico, roda `pnpm install --frozen-lockfile` no worktree, marca a tarefa como `em-andamento`, preenche `responsavel` com o papel e imprime o caminho do worktree. Recusa se a tarefa não está `aberta`, se tem dependência ainda na fila ou se o branch ou o worktree já existem. Com `--join NNN`, entra na janela `NNN` sem criar worktree ([Janela de contrato](#janela-de-contrato)). |
| `pnpm task:finish NNN` | Roda no worktree ou no checkout principal. Leva a tarefa à `main` (passos abaixo). |
| `pnpm task:abort NNN` | Remove worktree e branch e devolve a tarefa a `aberta`. Só com o worktree limpo e sem commit fora da `main`; com alteração pendente ou commit não integrado exige `--force`, que é ação destrutiva e depende de confirmação do humano. |
| `pnpm task:path` | Imprime o caminho do checkout principal. |
| `pnpm task:list` | Lista a fila inteira: status, papel, responsável, dependências pendentes e se há worktree aberto. |

Os cinco comandos são implementados por `scripts/task.mjs`.

Dentro do worktree, o agente:

1. Edita e commita só ali. Usa o caminho absoluto que o `task:start` imprimiu.
2. Altera só os arquivos listados na tarefa e dentro das pastas do seu papel. O worktree isola o trabalho de cada tarefa; a propriedade das pastas não muda.
3. Pode usar `git add -A`: o worktree é só dele. Não vale no worktree de uma janela de contrato, que é compartilhado ([Janela de contrato](#janela-de-contrato)).
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
8. Tarefa com `janela: NNN` no cabeçalho segue a [Janela de contrato](#janela-de-contrato): entra com `--join`, trabalha no worktree da janela e, concluída, fica `pronta` na fila até o fechamento.

Os status são `aberta`, `em-andamento`, `bloqueada` e, só para tarefa de janela, `pronta` (commitada no branch da janela, ainda fora da `main`). O status `em-revisao` do template não é usado, porque não há revisão antes da `main`.

### Paralelismo

- Cada tarefa em andamento tem o próprio worktree; várias rodam ao mesmo tempo sem enxergar o trabalho pendente umas das outras. As tarefas de uma janela de contrato dividem um worktree e se enxergam: ali o paralelismo depende de pastas disjuntas e de commits com caminhos explícitos.
- Duas tarefas rodam em paralelo quando os campos `arquivos` não se cruzam. O worktree não dispensa essa regra: com arquivos cruzados, a segunda a terminar para no rebase com conflito.
- Dentro de um recurso a ordem é fixa: spec → migration (com os tipos gerados, [Regras de propriedade](#papéis)) → `packages/core` → contrato → APIs e `packages/api-client` → sites → e2e. A spec decide o contrato antes de tudo; o arquivo `openapi.yaml` só muda dentro de uma janela, junto de quem o alcança ([Janela de contrato](#janela-de-contrato)).
- Mudança de contrato e migration são sempre sequenciais entre si. Migrations continuam uma tarefa por vez, também porque o Postgres local é compartilhado entre os worktrees.
- O fim das tarefas é serializado: o `task:finish` só avança a `main` por fast-forward, e quem chega depois refaz rebase e verificação.
- As frentes paralelas de cada fase estão no [PLAN](PLAN.md).

### Janela de contrato

As APIs sobem em modo estrito ([003](003-admin-api.md), RF-04): operação do contrato sem rota, ou rota fora do contrato, impede a subida e quebra o teste de contrato. O cliente de `packages/api-client` também é conferido contra o contrato, no passo `cliente` do `verify:quick`. Por isso um `openapi.yaml` alterado não chega à `main` sozinho: o `task:finish` da tarefa do contrato para na verificação. A regra ([0019](decisions/0019-janela-de-contrato-e-operacoes-pendentes.md), [0022](decisions/0022-janela-de-contrato-num-so-branch.md)): o contrato e tudo o que quebraria com ele formam uma **janela**, que é uma unidade de integração e chega à `main` por um único branch, num único fast-forward. A `main` não fica vermelha em nenhum momento.

**O que entra na janela.** A tarefa do contrato (`arquiteto`) e uma tarefa para cada pacote que ficaria vermelho com o contrato novo e o cliente regenerado:

- a do `interface`, para regenerar o cliente (sempre);
- a da API dona da rota (`api-admin` ou `api-classroom`), e a da outra API quando ela compartilha o esquema ou a rota alterada;
- as dos sites, quando o esquema alterado aparece no código ou nos dados de teste deles (a checagem de tipos quebra com o cliente regenerado). Site que só vai *passar a usar* uma operação nova não precisa entrar: a tarefa dele roda depois, no próprio worktree;
- a de cada API cujo contrato ganha operação de escrita sem `csrfToken` (login, callback de OAuth e afins), **mesmo que a operação entre com `x-nuva-pending`**: a conferência do `csrfToken` vale também para as operações pendentes ([003](003-admin-api.md#subida-estrita), "Subida estrita"), e a lista de exceções de CSRF fica no código da API. A tarefa acrescenta a exceção à lista; a rota continua para depois.

O número da tarefa do contrato é o número da janela (`NNN`). As outras tarefas trazem `janela: NNN` no cabeçalho, além do `depende-de` normal entre elas (o site depende da do `interface`). Janela é pequena: um recurso, uma mudança.

**Abertura.** O `arquiteto` cria todas as tarefas da janela antes de alterar o `openapi.yaml`. Depois roda `pnpm task:start NNN --as arquiteto`, commita o contrato no worktree e **não** roda o `task:finish`: a tarefa dele fica `em-andamento` e o worktree `.worktrees/task-NNN/` fica aberto para as demais. Ele só abre a janela quando as tarefas dela podem ser executadas em seguida.

**Trabalho dentro da janela.** As tarefas com `janela: NNN` não abrem worktree próprio: é a única exceção ao RF-06. Cada uma:

1. Entra com `pnpm task:start MMM --as <papel> --join NNN`, no checkout principal. O comando não cria worktree nem branch: marca a tarefa como `em-andamento`, preenche `responsavel` e imprime o caminho do worktree da janela. Dependência que é tarefa da mesma janela conta como atendida quando está `pronta`.
2. Trabalha em `.worktrees/task-NNN/`, onde outros agentes podem estar trabalhando ao mesmo tempo em outras pastas. Ali valem as regras de diretório compartilhado, no lugar das do worktree de uma tarefa só:
   - altera só as pastas do próprio papel e os arquivos da própria tarefa;
   - `git add <caminhos>` e `git commit ... -- <caminhos>`, sempre com caminhos explícitos; nunca `git add -A`, `git commit -a`, `git stash`, `git reset`, `git rebase` nem `git checkout` sobre arquivo alheio;
   - ignora alteração não commitada de outro agente; não a corrige, não a commita e não a desfaz;
   - não edita o `CHANGELOG.md` (ele entra no fechamento);
   - mudança de dependência (`package.json` e `pnpm-lock.yaml`) é feita por uma tarefa de cada vez: roda `pnpm install` no worktree, commita o lockfile junto e avisa no relato.
3. Commita citando a **própria** tarefa (`(task MMM)`), não a da janela. Não faz push.
4. Verifica o que é seu: os testes do pacote (`pnpm --filter <pacote> test`), a checagem de tipos, e `pnpm verify:quick --files <seus caminhos>`. Sem `--files`, o `verify:quick` enxerga a janela inteira, e falha em pacote de outro papel que ainda não alcançou o contrato é esperada ali: a tarefa a lista no relato e não a corrige.
5. A tarefa de API roda a **suíte inteira** do pacote. Os testes de `test/contract` conferem rota × operação, `csrfToken` e respostas declaradas, mas não acusam resposta com corpo divergente do esquema: isso só aparece nos testes que chamam a rota, onde a validação de resposta roda.
6. Ao concluir, acrescenta ao corpo do arquivo da tarefa a seção `## Relato`, com os commits, o que verificou e a linha sugerida para o `CHANGELOG.md`, e roda `pnpm task:finish MMM`. Para tarefa de janela, o comando só confere que há commit citando a tarefa no branch e a marca como `pronta`: não faz rebase, não verifica, não toca a `main` e não remove o arquivo.

Tarefa `pronta` está commitada no branch da janela e ainda não está na `main`. O arquivo fica na fila até o fechamento, e tarefa de fora da janela que dependa dela continua esperando.

**Fechamento.** Fecha a janela quem conclui a última tarefa dela: depois do passo 6, se todas as outras tarefas com `janela: NNN` estão `prontas`, é esse agente, qualquer que seja o papel. Numa sessão com orquestrador, ele pode fechar no lugar do agente; a regra não depende dele. Quem fecha:

1. confere que todas as tarefas da janela estão `prontas` e que o worktree não tem alteração pendente;
2. acrescenta ao `CHANGELOG.md`, em "Não lançado", as linhas da janela (as sugeridas nos relatos, ou um resumo delas) e commita só esse arquivo, citando a tarefa da janela: `docs(<papel>): changelog da janela ... (task NNN)`;
3. roda `pnpm task:finish NNN`, do checkout principal. É o `task:finish` normal sobre o branch inteiro (rebase, `verify:quick`, fast-forward, push), e ao final remove o worktree, o branch e os arquivos da tarefa `NNN` e de todas as tarefas com `janela: NNN`. O comando recusa enquanto houver tarefa da janela que não esteja `pronta`.

Falha no fechamento (código 4 ou 5) em arquivo do papel de quem fecha: ele corrige no worktree e roda de novo. Em arquivo de outro papel: não corrige. Devolve a tarefa do dono a `aberta`, com o motivo no corpo, e a janela continua aberta até o dono resolver e a tarefa voltar a `pronta`. Push negado (código 7) segue a regra geral: relata e para.

Abandonar a janela é `pnpm task:abort NNN --force`: descarta os commits de todos os papéis, devolve a `aberta` todas as tarefas da janela e exige a confirmação do humano.

**Precedente: janela 131 (Fase 1).** A janela que publicou os contratos da Fase 1 foi fechada pelo orquestrador com `--join` das tarefas 132 (`interface`, cliente regenerado), 168 (`api-classroom`) e 169 (`api-admin`). As duas últimas não estavam previstas: nasceram durante a janela porque a conferência cobrava `csrfToken` das operações pendentes de escrita sem CSRF, e sem a exceção no código de cada API o teste de contrato ficava vermelho. A regra para as próximas janelas é a do último item de "O que entra na janela": essas exceções entram na própria janela, pelas tarefas das APIs, criadas pelo `arquiteto` na abertura.

**Sem suporte do script.** Enquanto o `scripts/task.mjs` não aceitar `--join`, o procedimento é o mesmo, feito à mão: a tarefa da janela não roda `task:start` nem `task:finish`, edita o próprio arquivo em `tasks/` (`em-andamento` com `responsavel` ao entrar, `pronta` ao concluir), e quem fecha remove os arquivos das tarefas com `janela: NNN` depois que o `task:finish NNN` terminar sem erro.

**Operação nova e `x-nuva-pending`.** As duas formas de o contrato chegar valem, cada uma no seu caso:

| Caso | Forma |
| --- | --- |
| Mudança em operação **existente** (campo obrigatório novo, esquema alterado, resposta nova) | Sempre a janela num só branch, com todos os pacotes atingidos. Não há marca que a adie. |
| Operação **nova**, com a tarefa da API pronta para ser executada em seguida | Janela num só branch, sem marca: contrato, cliente e rota chegam juntos. É a forma normal. |
| Operação **nova** cujo contrato precisa chegar antes da rota (a API depende de migration ou de `packages/core` que ainda não existem, ou o contrato de um recurso inteiro é publicado para os papéis seguintes) | A operação entra com `x-nuva-pending: true`. A janela mínima é contrato + cliente regenerado (tarefa do `interface`); a tarefa da API roda depois, no worktree dela. |

A conferência do `api-kit` ignora operação pendente sem rota, então a API continua subindo e o teste de contrato continua verde. Operação pendente que já tem rota não impede a subida, mas gera aviso no log e no teste de contrato até a marca sair. A tarefa da API que registra a rota pede ao `arquiteto`, no relato, a retirada da marca; se a retirada alterar o cliente gerado, ela também é uma janela (contrato + `interface`). Nenhuma release sai com operação pendente: `check-contract --no-pending` faz parte do `verify:full`.

Mudança de contrato que não altera o cliente gerado nem a validação (hoje, só afrouxar um `pattern`) dispensa a janela: a tarefa do contrato segue o fluxo normal, e o `verify:quick` do `task:finish` confirma que o cliente está em dia.

### Verificação

- Padrão: `pnpm verify:quick`. O `pnpm task:finish` o roda no worktree, depois do rebase, antes de avançar a `main`; o agente também pode rodá-lo à mão durante a tarefa.
- No worktree, "o que mudou" é tudo desde `git merge-base HEAD main`, mais o que ainda não foi commitado: só a mudança da tarefa. `--files <caminhos>` continua existindo, mas deixa de ser a forma normal, exceto no worktree de uma janela de contrato, onde cada tarefa o usa com os próprios caminhos.
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
- `pnpm task:finish NNN` terminou sem erro: os commits estão na `main` por fast-forward e foram enviados, e o worktree, o branch e o arquivo da tarefa foram removidos. Se o push foi negado, a tarefa só está concluída depois que o humano resolver o envio, e o relato final diz isso. Tarefa de janela de contrato termina `pronta`, com o relato no arquivo; ela só está concluída quando o `pnpm task:finish` da janela termina sem erro, e a linha do `CHANGELOG.md` dela entra no fechamento.

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
- commit, no worktree de uma janela de contrato, que levou arquivo de outro papel: quem percebe para e relata, sem reescrever o histórico;
- push negado no `pnpm task:finish`: o agente relata e para; não insiste, não tenta outro caminho e não pede a outro agente que envie;
- `pnpm task:abort --force`, que descarta trabalho não commitado ou commits que não chegaram à `main`: exige a confirmação do humano.

## Interfaces e contratos

- Template de tarefa, de spec e de ADR: os definidos no roteiro do projeto e usados nos arquivos existentes.
- Definições de papel para as ferramentas: `.claude/agents/<papel>.md` e `.opencode/agent/<papel>.md`.
- Comandos de tarefa, implementados em `scripts/task.mjs`:

```
pnpm task:start <NNN> --as <papel>
pnpm task:start <MMM> --as <papel> --join <NNN>
pnpm task:finish <NNN>
pnpm task:abort <NNN> [--force]
pnpm task:path
pnpm task:list
```

- Nomes fixos: pasta `.worktrees/task-NNN/`, branch `task/NNN`.
- Cabeçalho da tarefa: além dos campos do template, `janela: NNN` nas tarefas de uma janela de contrato (o número é o da tarefa do contrato).

## Dados

- `tasks/` e `tmp/` ficam fora do Git e só existem no checkout principal. O histórico do Git preserva o registro das tarefas concluídas pelo ID no commit.
- `.worktrees/` fica no `.gitignore`. O `.env.local` de cada worktree é um link simbólico para o do checkout principal.

## Critérios de aceite

- [ ] Existe uma definição por papel nas duas ferramentas.
- [ ] Todo commit de entrega cita uma tarefa.
- [ ] Nenhum commit mistura pastas de papéis diferentes, salvo `CHANGELOG.md`. Vale também dentro de uma janela de contrato.
- [ ] `pnpm task:start NNN --as <papel>` cria `.worktrees/task-NNN/` no branch `task/NNN` e marca a tarefa como `em-andamento`; repetido, recusa.
- [ ] `pnpm task:finish NNN` com alteração não commitada, conflito no rebase ou `verify:quick` vermelho para sem tocar a `main`.
- [ ] Depois de um `pnpm task:finish NNN` bem-sucedido, a `main` contém os commits da tarefa sem merge commit, e o worktree, o branch e o arquivo da tarefa não existem mais.
- [ ] Push negado no `task:finish` termina com código de saída próprio e a `main` local avançada.
- [ ] `pnpm task:abort NNN` com alteração pendente ou com commit fora da `main` recusa sem `--force`.
- [ ] Duas tarefas que acrescentam linhas ao `CHANGELOG.md` terminam sem conflito de rebase.
- [ ] Toda mudança de `openapi.yaml` que altera o cliente gerado tem, criadas antes do commit, as tarefas da janela (no mínimo a do `interface`), com `janela: NNN`.
- [ ] O contrato alterado e o cliente regenerado chegam à `main` no mesmo fast-forward; entre dois avanços da `main`, `pnpm --filter @nuva-edu/api-client check` nunca falha.
- [ ] `pnpm task:start MMM --as <papel> --join NNN` não cria worktree nem branch e imprime o caminho do worktree da janela; `pnpm task:finish MMM` deixa a tarefa `pronta` e não toca a `main`.
- [ ] `pnpm task:finish NNN` de uma janela recusa enquanto houver tarefa dela que não esteja `pronta`; bem-sucedido, remove os arquivos de todas as tarefas da janela.
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
- [0022 — Janela de contrato num só branch](decisions/0022-janela-de-contrato-num-so-branch.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md)
