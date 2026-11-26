# 0026 — Certificado por template HTML, renderizado pelo Chromium no worker

Status: aceita (substitui o item "PDF do certificado" da [0025](0025-bibliotecas-da-fase-2.md); consequência "tamanho da imagem" substituída pela [0029](0029-imagem-do-worker-com-playwright-completo.md))
Data: 2026-11-25

## Contexto

A [0025](0025-bibliotecas-da-fase-2.md) fixou um modelo único de certificado desenhado em código com `pdfkit`, e a [015](../015-certificados.md) proibia navegador embutido. Ao responder às perguntas do planejamento da Fase 2 (tarefa 400), o humano decidiu outra coisa (fato novo): o certificado sai de um **template HTML** com palavras-chave trocadas pelos dados do curso e do aluno; **sem template não há certificado**, e o aluno vê que o certificado ainda não foi liberado; quando o template é cadastrado, quem já concluiu recebe o certificado. Isso substitui a pergunta P1 (confirmação do nome antes da primeira emissão) e a P4 (identidade da escola no certificado), que passam a ser resolvidas pelo próprio template.

HTML livre escrito por instrutor vira PDF dentro do servidor. Os riscos são os de qualquer conteúdo ativo: script, busca de recurso externo (SSRF, rastreamento), consumo de memória e tempo. O PDF fiel ao HTML e ao CSS exige um motor de layout de navegador.

## Decisão

**Escopo do template.** Um template por curso, editado por quem edita o curso (instrutor dono, gerente, admin; ação `certificate.template.edit`), e um template padrão opcional da escola, editado pelo admin (`settings.manage`). O template efetivo de um curso é o dele; sem ele, o padrão da escola; sem nenhum dos dois, o curso não emite certificado. Cada gravação cria uma versão imutável; o certificado guarda a versão com que foi gerado.

**Palavras-chave.** Lista fechada, sintaxe `{{grupo.campo}}` (espaços internos tolerados), todas em pt-BR: `aluno.nome`, `curso.titulo`, `curso.carga_horaria`, `curso.instrutor`, `certificado.data_conclusao`, `certificado.data_conclusao_curta`, `certificado.data_emissao`, `certificado.codigo`, `certificado.url_validacao`, `certificado.qrcode`, `escola.nome`, `assinatura.nome`, `assinatura.cargo`. Todo valor é escapado para HTML (`&`, `<`, `>`, `"`, `'`) antes da troca. A exceção é `certificado.qrcode`, que o sistema troca por um SVG gerado por ele (`qrcode`) e que só é aceito em posição de texto. Palavra-chave desconhecida, `{{` sem fechamento e `certificado.qrcode` dentro de atributo são erros. O template precisa ter `aluno.nome`, `curso.titulo`, `certificado.codigo` e ao menos uma de `certificado.url_validacao` ou `certificado.qrcode`.

**Higienização por lista de permissões, com recusa.** O HTML é analisado ao salvar (`htmlparser2` para o HTML, `css-tree` para o CSS, ambos MIT, em `packages/core`) e **recusado** com a lista de problemas, nunca corrigido em silêncio; o worker repete a mesma validação antes de cada renderização. Regras:

- Sem `script`, `iframe`, `frame`, `object`, `embed`, `applet`, `link`, `base`, `meta` além de `charset`, `form` e controles, `video`, `audio`, `source`, `track`, `canvas`, `template`, `noscript`, nem SVG ativo (`foreignObject`, `use`, `image`, `animate*`, `set`). Elementos de texto, tabela, lista, `img`, `a` e o SVG de desenho (formas, texto, gradientes) são permitidos.
- Sem atributo `on*`, `srcset`, `srcdoc`, `formaction`, `xlink:href` nem `href` em SVG. `a href` só `https:` ou `{{certificado.url_validacao}}`.
- Imagem (`img src`) só `data:image/png|jpeg|webp|gif;base64,` ou uma imagem já enviada à própria instalação, pelo caminho de entrega `/api/v1/images/<id>/<largura>.webp` ([029](../029-imagens.md)); o worker troca esse caminho pelos bytes da variante, em `data:`, antes de renderizar. Nenhum endereço externo.
- CSS só em `<style>` e no atributo `style`. Sem `@import`, sem `url()` que não seja `data:` (imagem ou fonte `woff2`, `woff`, `ttf`, `otf`), sem `expression()`, `behavior` e `-moz-binding`.
- Template até 768 KiB (com as imagens embutidas).

**Renderização.** No worker, com o Chromium headless shell controlado pelo `playwright-core` (Apache-2.0), na mesma versão do `@playwright/test` do e2e. Para cada PDF: contexto novo com JavaScript desligado e modo offline, toda requisição interceptada e abortada, `setContent` do HTML já preenchido, `page.pdf` em A4 paisagem, só a página 1, com fundo impresso; tempo limite de 20 s; um PDF por vez em cada processo do worker; o navegador sobe na primeira renderização e fecha após 5 minutos ocioso. Fonte padrão: Inter (OFL-1.1) instalada na imagem; outras só embutidas no template por `data:`. PDF até 2 MiB; acima disso a renderização falha.

**Pré-visualização.** O admin pede um PDF de exemplo do template ainda não salvo: a `admin-api` valida e grava um pedido, o worker renderiza com dados de exemplo (tarefa `certificate.preview`) e o admin baixa o PDF. Só quem pediu o vê; o pedido some em 24 horas. Não há pré-visualização em HTML no navegador: o site admin não monta `iframe` (a CSP dele não tem `frame-src`), e só o PDF mostra o corte da página.

**Emissão retroativa.** Quando um curso passa de "sem template efetivo" a "com template efetivo" (template do curso salvo, ou padrão da escola salvo quando não havia), o sistema enfileira `certificate.backfill` para o curso (ou para cada curso com certificado habilitado e sem template próprio). Editar um template que já existia não emite nada e não muda certificado emitido.

**Nome no certificado (antiga P1).** Sem espera de confirmação: o nome é `users.full_name` ou, vazio, o nome de exibição, no momento da emissão. O classroom mostra ao aluno o nome que sairá e deixa corrigi-lo antes (`PUT /me/certificate-name`); depois da emissão, a correção é "reemitir".

**Imagem do worker.** Passa a levar o Chromium headless shell e as bibliotecas de sistema dele (`playwright install --with-deps --only-shell chromium`, no estágio de execução), a fonte Inter e um `tmpfs` em `/tmp` para o perfil do navegador. O limite de memória do worker sobe de 384 MB para 640 MB, e a soma do perfil padrão continua abaixo de 3 GB ([031](../031-infraestrutura-e-deploy.md), RNF-02). O Chromium não é pacote npm e não passa pelo passo `licencas`: suas licenças (BSD-3-Clause e as de terceiros que ele inclui, todas compatíveis com a distribuição sob AGPL-3.0, [0016](0016-licenca-agpl-3.md)) vão dentro da imagem e são citadas em `docs/`.

## Alternativas consideradas

- Manter o `pdfkit` com modelo único: é o que estava decidido; não atende à decisão do humano de cada curso ter seu desenho.
- Template em HTML convertido por biblioteca sem navegador (`pdfmake`, conversores HTML→PDF em JavaScript): suportam um subconjunto pequeno de CSS; o instrutor desenharia no navegador e veria outro resultado no PDF.
- Puppeteer: equivalente ao Playwright, mas o projeto já usa e fixa o Playwright no e2e; uma só ferramenta e uma só versão de Chromium.
- Chromium do pacote do Debian: imagem um pouco menor, mas versão desalinhada da que o Playwright testa.
- Serviço externo de renderização (Gotenberg em outro contêiner, API paga): mais um serviço para operar ou um envio de dados pessoais para fora; a renderização é rara e cabe no worker.
- Higienizar corrigindo em silêncio (remover o que não é permitido): o instrutor veria no PDF algo diferente do que escreveu, sem saber por quê.
- Pré-visualização em HTML num `iframe` isolado do site admin: abriria `frame-src` na CSP do admin e mostraria um layout que não é o do PDF.
- Logotipo da escola como palavra-chave (`school_logo`): depende da regra das variantes de proporção original ([029](../029-imagens.md), "Em aberto") e da tela de marca; o template já aceita imagem embutida.

## Consequências

- A [015](../015-certificados.md) deixa de proibir navegador embutido; o "modelo único" sai do fora de escopo e o editor visual continua fora (o template é editado como código).
- Tabelas novas: `certificate_templates`, `certificate_template_versions` e `certificate_previews`; `certificates` ganha `template_version_id` e `instructor_name` congelado.
- Tipo de fila novo: `certificate.preview`; `certificate.backfill` ganha a origem "template cadastrado".
- `pdfkit` e a conversão do logotipo para PNG com `sharp` saem da Fase 2; `qrcode` continua (SVG). Entram `playwright-core` no worker e `htmlparser2` e `css-tree` em `packages/core`, cada um pela conferência de licenças.
- A imagem do worker cresce e ganha pacotes de sistema que o Trivy passa a varrer. A estimativa de cerca de 300 MB foi substituída pela medição da tarefa 465, aceita na [0029](0029-imagem-do-worker-com-playwright-completo.md): 918 MB em disco e 359 MB compactado no `amd64`, 931 MB e 358 MB no `arm64`, contra 304 MB e 102 MB da base. A instalação continua pelo `--with-deps` do Playwright, com as fontes de reserva.
- Os testes de renderização do worker precisam do Chromium headless shell instalado na máquina e no CI.
- O risco que sobra: HTML escrito por instrutor roda num motor de navegador. Ele é mitigado em camadas (lista de permissões ao salvar e ao renderizar, JavaScript desligado, rede bloqueada, tempo e memória limitados, usuário sem privilégios), e a sandbox própria do Chromium fica desligada, como é o padrão do Playwright em contêiner.
- Certificados emitidos são regeneráveis a partir dos dados congelados e da versão do template, que nunca é apagada enquanto houver certificado que a use.
