# 0019 — Janela de contrato e operações pendentes

Status: aceita (complementada por [0022](0022-janela-de-contrato-num-so-branch.md), que substitui o envio do contrato sozinho à `main` e a janela em sequência)
Data: 2026-11-24

## Contexto

O contrato OpenAPI vem antes do código ([0009](0009-stack-typescript-fastify-kysely.md)), e só o `arquiteto` o altera. Os esqueletos da Fase 0 tornaram a conferência estrita: a API não sobe se uma operação do contrato não tiver rota ou se uma rota estiver fora do contrato, o teste de contrato falha no CI pelo mesmo motivo, e `packages/api-client` falha quando o código gerado difere do contrato. Com isso, "contrato primeiro" passou a significar "`main` quebrada até a API e o cliente alcançarem o contrato", sem regra para o intervalo.

## Decisão

- Contrato, rota e cliente gerado entram na mesma **janela de trabalho**. Antes de alterar o `openapi.yaml`, o `arquiteto` cria as tarefas encadeadas (API dona da rota, `interface` para regenerar o cliente, sites). Ele só envia o contrato quando a tarefa da API é a próxima a ser executada pelo papel dono.
- Operação nova entra com a extensão `x-nuva-pending: true`. A conferência do `api-kit` não trata operação pendente como divergência: sem rota, é o caso normal; com rota, gera aviso até a marca sair. A tarefa da API termina pedindo ao `arquiteto` a retirada da marca.
- Mudança em operação existente não tem marca: a janela é executada em sequência, e as falhas esperadas no intervalo são só as dela.
- Nenhuma release sai com operação pendente (`check-contract --no-pending` no `verify:full`).
- A decisão de comportamento continua começando pela spec: ela é escrita e aprovada antes, e o `openapi.yaml` só muda quando a API pode alcançá-lo.

## Alternativas consideradas

- Afrouxar a subida (operação sem rota vira aviso): o contrato deixaria de ser garantia; uma rota esquecida só apareceria em produção como `404`.
- Só a marca de pendente, sem janela: resolve operação nova, mas não mudança em operação existente nem o cliente gerado desatualizado.
- Só a janela, sem marca: toda operação nova derrubaria a API entre dois commits, mesmo sem ninguém usá-la.
- Um papel único alterar contrato, rota e cliente no mesmo commit: quebra a separação de pastas por papel ([0013](0013-commit-direto-na-main-diretorio-compartilhado.md)).

## Consequências

- O contrato deixa de ser alterado em lote no começo da fase: ele avança recurso a recurso, junto da API.
- O cliente gerado continua sendo um segundo ponto estrito sem marca equivalente: toda mudança de contrato que altere tipos ou descrições o deixa desatualizado até a tarefa do `interface`. Enquanto isso, `pnpm --filter @nuva-edu/api-client check` falha, e é a falha esperada da janela.
- O `api-kit` passa a conhecer `x-nuva-pending`, e o cliente gerado expõe operações que ainda respondem `404`; os sites só as usam depois que a tarefa da API termina.
- Detalhado em [002](../002-organizacao-do-trabalho.md) ("Janela de contrato") e [003](../003-admin-api.md) ("Subida estrita").
