# 0016 — Licença AGPL-3.0

Status: aceita
Data: 2026-11-24

## Contexto

O repositório é público e o software é instalável por terceiros ([0003](0003-instalavel-single-tenant.md)). Era preciso escolher a licença.

## Decisão

(F3-07) O nuva-edu é licenciado sob a GNU Affero General Public License, versão 3.0 (AGPL-3.0). O texto fica em `LICENSE`, na raiz.

## Alternativas consideradas

- MIT: permissiva, sem proteção contra fechamento do código.
- Apache-2.0: permissiva, com concessão explícita de patentes.
- Proprietária com código visível: outros poderiam ler, não usar.

## Consequências

- Quem modificar o sistema e oferecê-lo como serviço na rede precisa publicar as modificações.
- Dependências precisam ter licença compatível com a AGPL-3.0; a checagem entra na auditoria de dependências do CI.
- O código copiado do minui-react ([0010](0010-interface-minui-em-packages-ui.md)) é do mesmo autor e passa a ser distribuído sob a AGPL-3.0 dentro deste repositório.
- Cada site exibe um link para o código-fonte, como a licença exige para uso em rede.
