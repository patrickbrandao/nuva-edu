# 0013 — Commit direto na main, em diretório compartilhado

Status: substituída por 0021
Data: 2026-11-24

## Contexto

Vários agentes trabalham em paralelo, cada um com um papel e pastas próprias. Era preciso definir como isolam o trabalho, como o código chega à `main` e quem revisa.

## Decisão

Escolhida pelo usuário contra as recomendações de worktree por tarefa, PR e revisão antes da entrada.

- (F5-03) Commit direto na `main`, sem PR. Todos os agentes trabalham no mesmo diretório, sem worktree e sem trocar de branch.
- (F5-04) Não há agente revisor; o usuário revisa os commits depois. O CI roda `verify:full --e2e` na `main` após o push. O gatilho de PR no CI existe só para contribuições externas.
- (O-01) Regras do diretório compartilhado:
  - cada agente altera só os arquivos listados na tarefa e as pastas do seu papel;
  - `git add` e `git commit` citam os caminhos; nunca `git add -A`, `git add .` nem `git commit -a`;
  - ninguém usa `stash`, `reset`, `checkout`, `restore` ou `clean` em arquivo alheio;
  - alterações não commitadas de outros agentes são ignoradas, não corrigidas nem commitadas.
- (O-02) `verify:quick` sem argumentos olha os arquivos alterados e não commitados mais os commits ainda não enviados (`origin/main..HEAD`); `--files <caminhos>` limita aos arquivos da tarefa.
- (O-03) `git push origin main` logo após o commit da entrega. Se o CI da `main` quebrar, a correção vira tarefa de prioridade máxima para o papel dono do arquivo, e ninguém inicia tarefa nova na mesma área até corrigir.

## Alternativas consideradas

- Worktree e branch por tarefa, PR com CI verde e merge pelo usuário (recomendada).
- Worktree e PR com merge automático após CI e revisor.
- Worktree por tarefa, rebase e avanço da `main` por fast-forward, sem PR (recomendada depois de escolhido o commit direto).
- Revisão por agente antes do avanço da `main` (recomendada); revisor periódico após o push.

## Consequências

- Vazão máxima e nenhuma gestão de worktree ou PR.
- Risco aceito: um agente pode testar ou commitar junto o trabalho inacabado de outro. A contenção são as regras O-01 e O-02, que dependem de disciplina, não de barreira técnica.
- Risco aceito: um erro só aparece no CI depois do push ou na leitura do usuário.
- A separação de pastas por papel (F5-02) e o campo `arquivos` da tarefa são o que torna o paralelismo viável; duas tarefas com arquivos que se cruzam nunca rodam juntas (O-04).
- O `verify:quick` precisa do modo `--files`, já que a heurística por branch não se aplica (ver [0014](0014-verificacao-em-dois-niveis.md)).
- Gatilho de revisão: commit contendo arquivo de outro papel, ou `main` quebrada por trabalho misturado. A revisão provável é adotar worktree por tarefa.
- Detalhado em [002](../002-organizacao-do-trabalho.md).
