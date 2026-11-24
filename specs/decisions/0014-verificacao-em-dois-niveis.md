# 0014 — Verificação em dois níveis

Status: aceita
Data: 2026-11-24

## Contexto

Com muitos agentes entregando tarefas pequenas, rodar a suíte inteira a cada mudança é lento demais, e não rodar nada é arriscado. O roteiro do projeto propõe dois níveis de verificação.

## Decisão

(F4-01, Q-06, O-02)

- `pnpm verify:quick` é o padrão durante o desenvolvimento e ao concluir cada tarefa. Roda lint só nos arquivos alterados, checagem de tipos dos pacotes afetados e dos que dependem deles, os testes ligados ao que mudou (o arquivo de teste alterado ou o de mesmo nome do fonte) e os testes de banco alterados. Não roda build, e2e nem a suíte inteira. Aceita testes explícitos depois de `--` e `--files <caminhos>` para limitar aos arquivos da tarefa.
- Como o trabalho é direto na `main` ([0013](0013-commit-direto-na-main-diretorio-compartilhado.md)), "o que mudou" é: arquivos alterados e não commitados mais os commits ainda não enviados (`origin/main..HEAD`).
- Nota de 2026-11-24: a [0021](0021-worktree-por-tarefa.md) substituiu a 0013. No worktree da tarefa, "o que mudou" passou a ser tudo desde `git merge-base HEAD main`, mais o que ainda não foi commitado; o restante desta decisão segue valendo.
- `pnpm verify:full` roda lint, tipos, todos os testes, build e todos os testes de banco; `--e2e` acrescenta o Playwright. Roda só sob pedido, antes de release, e sempre no CI.
- Ferramentas: Vitest para unidade e integração, teste de contrato contra os `openapi.yaml`, Playwright para e2e.
- Cobertura mínima de 80% de linhas em `packages/core`; sem meta numérica no restante.
- Banco de testes: no quick, um Postgres local já no ar, ligado por `NUVA_TEST_DB=local`; as migrations ficam num banco modelo, refeito só quando o hash da pasta de migrations muda (hash guardado no `COMMENT` do banco), e cada execução recria o banco de testes com `CREATE DATABASE ... TEMPLATE`. No full, banco isolado por Testcontainers.
- Implementação: `scripts/verify.mjs` com os modos `quick` e `full`, resumo final com ✓, ✗ ou pulado e o tempo de cada passo. O quick roda todos os passos e sai com código diferente de zero se algum falhar; o full para na primeira falha; o quick tenta subir o Postgres local se estiver fora, ou informa o comando.
- Regras para agentes: toda mudança vem com o teste que a cobre; o nível decide só quanto da suíte roda. Ao terminar, o agente informa qual nível rodou e o resultado. Subagentes seguem a mesma regra.

## Alternativas consideradas

- Dois níveis sem meta de cobertura.
- Dois níveis com 80% em tudo: tende a gerar testes de interface escritos só para bater a meta.

## Consequências

- O quick precisa terminar em segundos para ser usado de fato; o banco clonado de modelo existe para isso.
- Como não há PR nem revisor, o CI na `main` é a única execução garantida do nível completo; quebrou, vira prioridade máxima.
- A heurística de testes ligados pode errar; `--` e `--files` são a saída.
- O script e o banco modelo são entregues na Fase 0 do PLAN.
- Detalhado em [032](../032-verificacao-e-ci.md).
