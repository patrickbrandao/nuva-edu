# 0010 — Interface: componentes do minui-react em packages/ui

Status: aceita
Data: 2026-11-24

## Contexto

O usuário determinou que a interface use os templates do projeto `minui-react` (repositório local do autor, sem remoto). Esse projeto é um showcase em React 19, Vite 8 e Tailwind 4, escrito em JSX, sem repositório remoto e sem pacote npm publicado. Tem `AdminShell`, `AdminKit`, `CasesBoard`, `ClientOverview`, `PricingPage`, primitivos e tokens `--minui-*` com tema Sistema, Claro e Escuro.

## Decisão

(F3-04) Os componentes e tokens necessários são copiados para o pacote interno `packages/ui` do nuva-edu e evoluem ali, convertidos para TypeScript aos poucos. Os sites `admin` e `classroom` são SPAs em React 19, Vite e Tailwind 4, como o minui.

## Alternativas consideradas

- Publicar o minui-react como pacote npm e depender dele: exigiria empacotar e publicar antes de começar e sincronizar versões.
- Submódulo Git: o minui-react não tem remoto, então o build público não conseguiria baixá-lo.

## Consequências

- O repositório público é autossuficiente; o build não depende da máquina do autor.
- `packages/ui` passa a divergir do minui-react; melhorias de lá são trazidas manualmente, por tarefa do papel interface.
- Os códigos de referência do showcase (`CasesBoard.screen02`, por exemplo) servem para indicar, nas tarefas, qual tela ou peça usar de modelo.
- O tema Sistema, Claro e Escuro e os tokens `--minui-*` são mantidos.
- Detalhado em [006](../006-sites-e-interface.md).
