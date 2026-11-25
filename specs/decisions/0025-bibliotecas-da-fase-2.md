# 0025 — Bibliotecas da Fase 2: certificado, Markdown, lista reordenável e player

Status: aceita (item "PDF do certificado" substituído por [0026](0026-certificado-por-template-html.md))
Data: 2026-11-25

## Contexto

A Fase 2 ([PLAN](../PLAN.md)) traz quatro necessidades que a [0009](0009-stack-typescript-fastify-kysely.md) e a [0010](0010-interface-minui-em-packages-ui.md) não cobrem por nome: o PDF do certificado no worker, "sem navegador embutido" e com código QR ([015](../015-certificados.md)); o Markdown restrito e higienizado das descrições e das notas ([006](../006-sites-e-interface.md), [009](../009-catalogo-e-conteudo.md), [016](../016-anotacoes.md)); a reordenação de módulos e aulas "por arrastar" ([009](../009-catalogo-e-conteudo.md), RF-08), operável por teclado ([006](../006-sites-e-interface.md), RNF-02); e o player de cada provedor, com o evento de fim e a posição do vídeo ([014](../014-aprendizado-e-progresso.md)). Sem uma escolha única, as tarefas de `interface`, `api-classroom` (worker) e `infra` (CSP) escolheriam cada uma a sua, e a política de segurança de conteúdo seria montada às cegas.

Toda dependência nova passa pela conferência de licenças do `verify:quick` ([032](../032-verificacao-e-ci.md)); as escolhidas aqui são MIT ou Apache-2.0, já aceitas na `license-allowlist.json`.

## Decisão

- **PDF do certificado** (substituído pela [0026](0026-certificado-por-template-html.md): template HTML renderizado pelo Chromium headless no worker; o texto abaixo fica só como registro): `pdfkit` no worker, com a fonte Inter em TTF (OFL-1.1) guardada em `apps/worker/src/` junto do arquivo de licença dela; o `pdfkit` embute só os glifos usados, o que mantém o PDF abaixo de 300 KB. Código QR com `qrcode`, desenhado como vetor no PDF (não como imagem). Logotipo: o `pdfkit` não lê WebP, então o worker converte a variante de 256 px do `school_logo` para PNG com o `sharp` do módulo `images` de `packages/core`. Nenhum serviço externo nem navegador.
- **Markdown:** `react-markdown`, sem `rehype-raw` (HTML bruto nunca é interpretado), com `allowedElements` restrito ao que a [006](../006-sites-e-interface.md) lista (parágrafo, negrito, itálico, listas, links, código, citação, quebra de linha), links só `https`, `http` e `mailto`, sempre com `rel="noopener noreferrer"` e `target="_blank"`. Um único componente `Markdown` em `packages/ui`, usado pelos dois sites e, na Fase 4, pelo fórum.
- **Lista reordenável:** `@dnd-kit/core` e `@dnd-kit/sortable`, com o sensor de teclado ligado e os anúncios de leitor de tela em pt-BR; componente `SortableList` em `packages/ui`. Cada reordenação grava a ordem inteira (`PUT .../order`).
- **Player:** componente `VideoPlayer` em `packages/ui`, um adaptador por provedor, todos com a mesma interface (`onEnded`, `onTime(seconds)`, `seek(seconds)`, posição inicial):
  - `youtube`: IFrame Player API, carregada sob demanda só na aula do YouTube (`https://www.youtube.com/iframe_api`), com `youtube-nocookie.com` no `iframe`. É o único script externo, coberto pela exceção do "player incorporado de vídeo" da [006](../006-sites-e-interface.md), RNF-05.
  - `vimeo`: `@vimeo/player`, empacotado no site (sem script externo).
  - `bunny` e `panda`: eventos por `postMessage` do próprio `iframe`, sem script externo; o adaptador segue a documentação de cada provedor (conferida na tarefa).
  - `file`: elemento `<video>` nativo; `.m3u8` com `hls.js` onde o navegador não toca HLS sozinho.
  - `link`: só o botão "Abrir vídeo".
- **Política de segurança de conteúdo do classroom:** é derivada desta lista (tarefa 065): `frame-src` com os domínios dos `iframe` da tabela da [009](../009-catalogo-e-conteudo.md), `script-src` com a origem da IFrame API do YouTube, `media-src` e `connect-src` com o necessário ao vídeo `file` e ao HLS. O admin continua sem origem externa.

## Alternativas consideradas

- PDF com `pdf-lib`: sem manutenção ativa desde 2021 e sem quebra de linha de texto, que o certificado precisa para títulos longos. Com navegador embutido (Puppeteer, Playwright): proibido pela [015](../015-certificados.md) e pesado na imagem.
- Fontes padrão do PDF (Helvetica, sem embutir): PDF menor e sem arquivo de fonte, mas só cobrem Latin-1; nome de aluno com caractere fora dele sairia errado.
- Markdown com `marked` ou `markdown-it` mais `DOMPurify` e `dangerouslySetInnerHTML`: duas bibliotecas e a higienização como etapa separada que alguém pode esquecer; o `react-markdown` não gera HTML bruto.
- Arrastar com a API nativa de HTML5: não funciona por teclado nem em tela de toque sem código próprio.
- Controlar o YouTube só por `postMessage`, sem a IFrame API: tiraria o script externo, mas depende de mensagens não documentadas, que o provedor muda sem aviso.

## Consequências

- Quatro dependências novas nos sites (`react-markdown`, `@dnd-kit/*`, `@vimeo/player`, `hls.js`) e duas no worker (`pdfkit`, `qrcode`), cada uma com a conferência de licenças na tarefa que a instala.
- A CSP do classroom passa a ter origens externas, limitadas às da tabela de provedores; provedor novo exige mudar a tabela da [009](../009-catalogo-e-conteudo.md), o adaptador e a política juntos.
- O adaptador de `bunny` e `panda` depende de mensagens que o provedor pode mudar; o teste do componente cobre o protocolo, e a conferência real com cada provedor fica na tarefa 065.
- A fonte do certificado é a mesma família dos sites, e o PDF não depende de fonte instalada na imagem do worker.
