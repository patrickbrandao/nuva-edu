# 0022 — Janela de contrato num só branch

Status: aceita
Data: 2026-11-24

Complementa a [0019](0019-janela-de-contrato-e-operacoes-pendentes.md) e substitui dela dois pontos: o envio do contrato sozinho à `main` e a janela "executada em sequência" com falhas esperadas na `main`. Abre, na [0021](0021-worktree-por-tarefa.md), a única exceção à regra de um worktree por tarefa.

## Contexto

A 0019 foi escrita quando todos commitavam direto na `main` ([0013](0013-commit-direto-na-main-diretorio-compartilhado.md)): o contrato ia primeiro, a `main` ficava vermelha, e a regra só encurtava o intervalo. A 0021 mudou o terreno: a `main` só avança por `pnpm task:finish`, que roda o `pnpm verify:quick` antes do fast-forward. As duas regras juntas não fecham. Um `openapi.yaml` alterado deixa o cliente gerado de `packages/api-client` desatualizado, o passo `cliente` falha, e a tarefa do contrato não consegue chegar à `main` sozinha.

Foi o que aconteceu na janela da tarefa 029 (a marca da escola no `Meta`; histórico em `168fc78..49fb013`):

- O contrato (`8d161ca`) ficou commitado no branch `task/029`. O `task:finish` parou com o código 5, só pelo passo `cliente`.
- No mesmo worktree entraram, por agentes de papéis diferentes, cada um commitando só as próprias pastas e citando a própria tarefa: `a122c23` (`interface`, tarefa 032, cliente regenerado), `80fac42` e `2f63ce7` (`api-admin`, tarefa 030, incluindo a rota `/meta` comum no `api-kit`), `60c28b2` (`web-classroom`, tarefa 034), `3205cf1` (`web-admin`, tarefa 033) e `3d9de6c` (`api-classroom` e worker, tarefa 031).
- O orquestrador da sessão acrescentou a linha do `CHANGELOG.md` (`49fb013`) e fechou tudo com um único `pnpm task:finish 029`: fast-forward de oito commits. Depois removeu à mão os arquivos das tarefas 030 a 034, que o script não conhece.
- A `main` não ficou vermelha em nenhum momento.

Dois fatos apareceram no caminho:

- **Os sites entram na janela.** O esquema alterado (`Meta`) aparecia em dados de teste dos dois sites; com o cliente regenerado, a checagem de tipos deles quebrou. A 0019 deixava os sites para depois do fechamento.
- **O teste de contrato não acusa resposta divergente.** Os testes de `test/contract` conferem rota × operação, `csrfToken` e respostas de erro declaradas. Uma rota que devolve o corpo antigo só falha na suíte completa da API, onde a validação de resposta roda de verdade.

## Decisão

1. **A janela é uma unidade de integração e usa um branch só.** O contrato, o cliente gerado, as rotas e tudo o que quebraria com eles chegam à `main` num único fast-forward, pelo branch da tarefa do contrato (`task/NNN`, worktree `.worktrees/task-NNN/`). O número da tarefa do contrato é o número da janela.
2. **O contrato não vai sozinho à `main`.** O `arquiteto` abre a janela (`pnpm task:start NNN --as arquiteto`), commita o contrato e não roda o `task:finish`: a tarefa dele fica `em-andamento` até o fechamento.
3. **As tarefas da janela não abrem worktree próprio.** Cada uma traz `janela: NNN` no cabeçalho e trabalha no worktree da janela. É a única exceção ao "um worktree por tarefa" da 0021.
4. **No worktree da janela valem as regras de diretório compartilhado**, porque ali trabalham vários agentes ao mesmo tempo: só as pastas do próprio papel; `git add` e `git commit` com caminhos explícitos; nada de `git add -A`, `commit -a`, `stash`, `reset` ou `rebase`; alteração pendente de outro agente é ignorada; `CHANGELOG.md` só no fechamento. Cada commit cita a tarefa de quem o fez, não a da janela.
5. **Tarefa da janela concluída fica `pronta`**, não é removida: o arquivo continua na fila até o fechamento, com o relato (commits, verificação, linha sugerida para o changelog) no corpo. Tarefa de fora da janela que dependa dela continua esperando, porque o trabalho ainda não está na `main`.
6. **Quem fecha a janela é quem conclui a última tarefa dela.** Fechar é: conferir que todas as tarefas da janela estão `prontas`, acrescentar as linhas do `CHANGELOG.md` num commit que cita a tarefa da janela, rodar `pnpm task:finish NNN` e remover os arquivos de todas as tarefas da janela. Numa sessão com orquestrador, ele pode fechar no lugar do agente. A regra não depende dele.
7. **A janela inclui todo pacote que ficaria vermelho** com o contrato novo e o cliente regenerado: a API dona da rota, o `interface`, a outra API quando compartilha o esquema, e os sites quando o esquema alterado aparece no código ou nos dados de teste deles.
8. **A tarefa de API da janela roda a suíte inteira do pacote**, não só o teste de contrato.
9. **As duas formas de o contrato chegar continuam valendo:**
   - Mudança em operação **existente**: sempre a janela num só branch. Não há marca que a adie.
   - Operação **nova**: a janela num só branch é a forma normal quando a tarefa da API pode ser executada em seguida. A marca `x-nuva-pending` fica para quando o contrato precisa chegar antes da rota: a API depende de migration ou de `packages/core` que ainda não existem, ou o contrato de um recurso inteiro é publicado para os papéis seguintes planejarem. Mesmo assim o contrato não vai sozinho: a janela mínima é contrato + cliente regenerado (tarefa do `interface`), e a tarefa da API roda depois, no worktree dela.
10. **O `scripts/task.mjs` passa a conhecer a janela** (`task:start MMM --as <papel> --join NNN`, `task:finish MMM` de tarefa da janela, fechamento que remove todos os arquivos). Enquanto isso não existe, o procedimento é o mesmo, feito à mão. A implementação é do `infra`.

Continuam valendo da 0019: as tarefas da janela criadas antes de o contrato mudar; a marca `x-nuva-pending` e o seu tratamento na conferência do `api-kit`; nenhuma release com operação pendente; a decisão de comportamento começando pela spec.

## Alternativas consideradas

- **Manter a 0019 como estava.** Impossível com a 0021: o `task:finish` do contrato sozinho para no passo `cliente`. Abrir exceção no `verify:quick` para o contrato passar devolveria a `main` vermelha, que é o que a janela existe para evitar.
- **Um branch por tarefa e um merge dos branches no fim.** Exige merge commit ou rebase em cadeia; a 0021 só admite fast-forward e histórico linear. E as tarefas não se enxergariam: o site precisa do cliente regenerado, a API precisa do contrato.
- **Um agente só fazer contrato, rotas, cliente e sites.** Quebra a propriedade de pastas por papel, já recusada na 0019.
- **Só a marca `x-nuva-pending`, para tudo.** Não cobre mudança em operação existente nem o cliente gerado, que não tem marca equivalente.
- **Dono fixo da janela (o `arquiteto` ou o orquestrador).** O `arquiteto` abre a janela, mas normalmente não é quem está em execução quando a última tarefa termina; e nem toda sessão tem orquestrador. Quem conclui a última tarefa está sempre presente e tem o worktree à mão.

## Consequências

Boas:

- A `main` fica verde durante toda a janela. As "falhas esperadas" da 0019 deixam de existir na `main`: só existem dentro do worktree da janela, entre a entrada do contrato e a do último pacote.
- Os papéis seguintes trabalham sobre o que os anteriores já commitaram (o site já enxerga o cliente regenerado), sem esperar a `main`.
- Um `verify:quick` sobre a janela inteira roda antes do fast-forward.

Ruins, aceitas:

- **Volta a disciplina do diretório compartilhado**, só dentro da janela. O risco que motivou a 0021 (commit levando arquivo de outro agente) reaparece ali; os caminhos explícitos são a única barreira, e o histórico continua sendo a conferência (um commit, um papel).
- **Tudo ou nada.** Uma tarefa da janela travada segura as outras fora da `main`. Por isso a janela é pequena: um recurso, uma mudança.
- **Quem fecha pode esbarrar em falha de outro papel.** Ele não corrige: devolve a tarefa do dono a `aberta`, com o motivo, e a janela segue aberta.
- **`verify:quick` sem argumentos, no worktree da janela, enxerga a janela inteira.** Durante o trabalho, cada tarefa usa `--files <seus caminhos>`.
- **Mais um estado na fila** (`pronta`) e mais um campo no cabeçalho da tarefa (`janela`).
- **Até o script ganhar suporte**, quem fecha remove à mão os arquivos das tarefas da janela, e as tarefas da janela mudam o próprio status editando o arquivo.
- Detalhado em [002](../002-organizacao-do-trabalho.md) ("Janela de contrato").
