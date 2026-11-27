# 0030 — Janelas de contrato sem pendências na main

Status: aceita (substitui o envio de operações pendentes à main das ADRs 0019 e 0022)
Data: 2026-11-27

## Contexto

O plano da Fase 4 previa entregar os contratos com `x-nuva-pending` antes das rotas. A janela 590 confirmou que a verificação rápida aceita o contrato pendente, enquanto as duas APIs reprovam as 37 operações novas com `check-contract --no-pending`. O CI usa essa opção na main e nas releases, como prevê a [032](../032-verificacao-e-ci.md). O humano decidiu integrar contrato, cliente e rotas juntos em cada frente e manter a checagem do CI.

## Decisão

- A janela inclui contrato, cliente gerado e todas as novas rotas. Dependências de domínio já integradas entram pelo commit-base da janela. Se a janela já estiver aberta e precisar de código do núcleo, o núcleo entra como membro.
- Marcas `x-nuva-pending` são temporárias no worktree da janela. Depois que as suítes das APIs passam, o arquiteto remove as marcas e o dono do cliente confere a geração. Antes do fechamento, as duas APIs passam com `check-contract --no-pending`.
- As quatro frentes da Fase 4 entram uma por vez. A preparação de domínio pode avançar separadamente quando independer do contrato.
- O CI continua com `verify:full --e2e`, que exige zero operações pendentes inclusive na main. O fluxo de release mantém a mesma condição.

## Consequências

As APIs de fórum, chamados, eventos e novidades fazem parte das respectivas janelas. A retirada das marcas é feita na própria janela. A revisão final da Fase 4 pode conferir os contratos existentes sem reabrir os arquivos OpenAPI.
