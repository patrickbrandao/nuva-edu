# Configuração de certificados e vídeos

Guia da escola derivado das specs `015-certificados.md`, `009-catalogo-e-conteudo.md`,
`014-aprendizado-e-progresso.md` e `031-infraestrutura-e-deploy.md`. Em caso de divergência, valem
as specs. Não é preciso criar variável de ambiente, segredo ou volume para estes recursos.

## Certificado

### Habilitar no curso

No admin, abra o curso e confira a opção de certificado. Sem template efetivo não há emissão,
mesmo com o certificado habilitado. A carga horária pode ser deixada no cálculo automático (soma
da duração das aulas publicadas, arredondada para cima em horas inteiras) ou fixada entre 1 e
10.000 horas.

O aluno conclui 100% das aulas publicadas para receber o certificado. O nome usado é o nome
completo informado na área de certificados do classroom; sem ele, é o nome de exibição. Antes de
emitir, o aluno pode conferir e alterar esse nome na página do curso ou em "Meus certificados".

### Definir quem assina

Em **Configurações → Certificado**, o admin informa:

- **Nome de quem assina** e **Cargo de quem assina**: cada um com até 120 caracteres. Entram no
  template por `{{assinatura.nome}}` e `{{assinatura.cargo}}`; em branco, a palavra-chave fica
  vazia.
- O nome da escola aparece para leitura e entra por `{{escola.nome}}`.

No PDF de exemplo, campos de assinatura em branco aparecem como "Nome de quem assina" e "Cargo".
A assinatura é texto do template, não uma assinatura digital ICP-Brasil.

### Escolher o template

Há dois lugares para editar o HTML (documento completo ou fragmento, que o sistema envolve em
`<html><body>`):

- **Configurações → Template padrão do certificado**: o padrão, só pelo admin, usado pelos cursos
  sem template próprio.
- **Editor do curso → aba Template do certificado**: o template próprio, por quem tem permissão de
  editar o certificado; o instrutor alcança só os próprios cursos.

O template do curso tem prioridade sobre o padrão. Excluí-lo faz o curso voltar ao padrão; sem
nenhum dos dois, o aluno que conclui vê que o certificado ainda não foi liberado. Quando um curso
passa a ter template efetivo, o sistema enfileira a emissão para quem já concluiu e ainda tem
acesso. Alterar um template depois não muda os certificados já emitidos: use "Reemitir" se precisar
atualizar um deles, mantendo o código.

Use **Começar do modelo** para obter um HTML inicial e **Gerar PDF de exemplo** para conferir o
resultado antes de salvar. O exemplo usa dados fictícios, é gerado pelo mesmo worker dos
certificados reais e só pode ser visto por quem o pediu. O navegador pode pedir autorização para
abrir a nova aba; o link do PDF também fica na tela. Há até 20 pedidos de exemplo por hora por
usuário, e cada pedido é apagado em 24 horas.

### Palavras-chave

Escreva `{{grupo.campo}}`; espaços internos são aceitos, como `{{ aluno.nome }}`. Todos os valores
de texto são escapados antes de entrar no HTML. Não existe palavra-chave fora desta lista, nem
forma de imprimir `{{` literalmente:

| Palavra-chave | Conteúdo |
| --- | --- |
| `{{aluno.nome}}` | Nome escolhido para o certificado (**obrigatória**) |
| `{{curso.titulo}}` | Título do curso (**obrigatória**) |
| `{{curso.carga_horaria}}` | Carga horária inteira, somente o número |
| `{{curso.instrutor}}` | Nome de exibição do dono; vazio se não houver dono |
| `{{certificado.data_conclusao}}` | Data de conclusão por extenso, no idioma e fuso da escola |
| `{{certificado.data_conclusao_curta}}` | Data curta, por exemplo `25/11/2026` |
| `{{certificado.data_emissao}}` | Data de emissão por extenso |
| `{{certificado.codigo}}` | Código `XXXX-XXXX-XXXX` (**obrigatória**) |
| `{{certificado.url_validacao}}` | URL pública de validação |
| `{{certificado.qrcode}}` | QR em SVG gerado pelo sistema; só em posição de texto, não em atributo |
| `{{escola.nome}}` | Nome da escola |
| `{{assinatura.nome}}` | Nome de quem assina; vazio quando não configurado |
| `{{assinatura.cargo}}` | Cargo de quem assina; vazio quando não configurado |

Use ao menos uma entre `{{certificado.url_validacao}}` e `{{certificado.qrcode}}`, além das três
obrigatórias. Chave desconhecida, vazia ou sem fechamento é recusada. O QR é a única palavra-chave
que produz marcação em vez de texto escapado.

### Regras de higienização do HTML e CSS

O template é validado no PDF de exemplo, ao salvar e de novo pelo worker antes de cada
renderização. Qualquer item fora da lista de permissões recusa o documento inteiro; nada é
corrigido em silêncio. O editor mostra os problemas com regra, mensagem, linha e coluna (no máximo
200 na resposta).

- **Tamanho:** até 768 KiB em UTF-8, imagens embutidas incluídas. O PDF final fica numa página A4
  paisagem e tem no máximo 2 MiB.
- **HTML:** são aceitos os elementos de estrutura, texto, blocos, listas, tabelas, `img`, `a` e o
  SVG de desenho listados na spec 015. `script`, `iframe`, `object`, `embed`, formulários,
  controles, mídia, `canvas`, `template`, `link`, `base` e elementos de SVG que carregam ou animam
  conteúdo são recusados, entre outros fora da lista.
- **Atributos:** somente os globais, de tabela, de imagem, de link e de apresentação do SVG
  permitidos pela spec. Todo `on*`, `srcset`, `srcdoc`, `formaction`, `xlink:href` e `href` em SVG
  é recusado. `meta` só aceita `charset="utf-8"`.
- **Links:** `a href` só usa `https:` ou exatamente `{{certificado.url_validacao}}`.
- **Imagens:** `img src` só aceita PNG, JPEG, WebP ou GIF embutido em base64 (`data:`), ou uma
  imagem existente e pública da instalação no caminho `/api/v1/images/<id>/<largura>.webp`. O
  botão **Inserir imagem** converte o arquivo escolhido para `data:`. Não há imagem externa nem
  envio de logotipo próprio para o template nesta fase.
- **CSS:** só no atributo `style` e em `<style>`. São recusados `@import`, recursos externos e as
  funções e propriedades que carregam conteúdo ou leem valor de fora. `@font-face` só com fonte
  WOFF2, WOFF, TTF ou OTF embutida em `data:`. A Inter já está instalada no worker e é a fonte
  padrão.
- **Renderização isolada:** o Chromium roda sem JavaScript e com toda requisição de rede bloqueada.
  Por isso, o visual não pode depender de script, fonte, imagem, folha de estilo ou outro recurso
  da internet.

### Emissão, validação e e-mail

O certificado fica normalmente disponível em até 60 segundos após a conclusão. O aluno baixa o PDF
na página do curso e na estante; a equipe confere e baixa os arquivos em **Certificados** no admin.
A validação pública fica em `/certificados` e `/certificados/<código>` no classroom, sem login e
sem oferecer download do PDF.

A emissão envia o e-mail `certificate.issued` com o link do certificado. Enquanto a instalação usar
o Mailpit, como no ambiente de teste, a mensagem fica retida nele e não chega à caixa de e-mail do
aluno; veja [ambiente-de-teste.md](ambiente-de-teste.md#e-mail). Para entrega externa, a escola
precisa configurar um SMTP real.

## Vídeos das aulas

No editor da aula, informe uma URL `https` válida. O nuva-edu não hospeda nem baixa o vídeo: o
provedor é reconhecido pelo endereço, e o navegador do aluno fala diretamente com ele. A política
de segurança de conteúdo (CSP) do classroom já contempla estes provedores; não há configuração de
CSP separada por aula.

| Provedor | Padrões aceitos | Exibição e conclusão automática |
| --- | --- | --- |
| YouTube | `youtube.com/watch?v=…`, `youtu.be/…`, `youtube.com/embed/…`, `youtube.com/live/…` | Iframe com API do player; o fim do vídeo conclui a aula |
| Vimeo | `vimeo.com/<id>`, `player.vimeo.com/video/<id>` | Iframe com API do player; o fim conclui |
| Bunny | `iframe.mediadelivery.net/embed/…`, `*.b-cdn.net/….m3u8` | Iframe ou HLS; o fim conclui |
| Panda | `player-vz-*.tv.pandavideo.com.br/embed/…` | Iframe; o fim conclui |
| Arquivo | URL terminada em `.mp4` ou `.webm`, em qualquer host `https` | Player nativo; o fim conclui |
| Link externo | Qualquer outra URL `https`, inclusive `.m3u8` fora de `*.b-cdn.net` | Botão "Abrir vídeo"; **não** conclui automaticamente |

O aluno sempre pode usar o botão de concluir. Quando o player avisa o fim, a conclusão automática
pode ser desfeita no aviso mostrado por 8 segundos. A posição é retomada nos players que informam o
tempo.

Para conferir uma aula no servidor, abra-a no classroom com uma conta que tenha acesso e verifique
o console do navegador: não deve haver recusa de frame, script, conexão ou mídia pela CSP. Teste um
endereço de cada provedor que a escola realmente usa; o fato de uma URL ser aceita no cadastro não
garante que o vídeo esteja publicado, permita incorporação ou continue disponível no serviço de
origem. URL quebrada ou vídeo com incorporação bloqueada deve ser corrigida no provedor ou trocada
na aula.
