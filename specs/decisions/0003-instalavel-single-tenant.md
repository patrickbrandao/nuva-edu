# 0003 — Software instalável, uma escola por instalação

Status: aceita
Data: 2026-11-24

## Contexto

O repositório é público e as imagens são publicadas no Docker Hub. Era preciso definir se o nuva-edu serve só à escola do autor, se é instalado por terceiros ou se é um serviço que hospeda várias escolas.

## Decisão

O nuva-edu é um software instalável e single-tenant (F1-01): cada instalação Docker atende uma única escola, com marca, domínio e banco próprios. A identidade da escola (nome, logotipo, textos, integrações) é configuração, não código.

## Alternativas consideradas

- Só a escola do autor: permitiria fixar marca e integrações no código, mas contradiz a distribuição pública.
- SaaS multi-escola (multi-tenant): exigiria isolamento de dados, domínios por escola e cobrança por escola; desproporcional.

## Consequências

- Nenhuma tabela tem coluna de escola; não há isolamento por tenant a testar.
- Tudo o que varia entre escolas vem de variáveis de ambiente ou da tabela `settings`, editável pelo admin.
- A instalação precisa funcionar com um único `docker compose up` (medida de sucesso P-08: até 15 minutos).
- Multi-tenant fica fora de escopo (ver [0017](0017-escopo-do-mvp.md)); atender várias escolas significa várias instalações.
- Especificado em [000](../000-visao-geral.md) e [031](../031-infraestrutura-e-deploy.md).
