# 0027 — Markdown saneado no servidor

Status: aceita (substitui o item "Markdown" da [0025](0025-bibliotecas-da-fase-2.md))
Data: 2026-11-26

## Contexto

A [0025](0025-bibliotecas-da-fase-2.md) decidiu Markdown apenas no navegador, com `react-markdown`, um conjunto sem imagens e links `noopener noreferrer`. A [017](../017-forum.md) exige, além disso, imagens externas, links `nofollow noopener` e HTML saneado persistido junto do Markdown, para que a mesma publicação possa ser lida por API, sites e busca sem cada consumidor aplicar uma política diferente.

No planejamento das Fases 3 e 4 (tarefa 500), o humano escolheu seguir integralmente a [017](../017-forum.md) para fórum, chamados, eventos e novidades. Esse requisito novo, junto com a persistência do HTML, é o fato que substitui somente o item Markdown da 0025. Certificado, lista reordenável e players continuam regidos pelas ADRs anteriores.

## Decisão

- **Pipeline único e isomórfico:** módulo `markdown` de `packages/core`, executável em Node e no navegador. Usa `unified`, `remark-parse` e `remark-rehype`, já trazidos pelo `react-markdown`, acrescentando `rehype-sanitize` e `rehype-stringify` como dependências diretas, nas versões fixadas pela tarefa 573. As duas bibliotecas novas são MIT e passam pela conferência de licenças.
- **Sem HTML bruto:** o parse usa somente a sintaxe Markdown, sem plugin de HTML bruto e sem `rehype-raw`. Assim, marcação HTML escrita pelo usuário não entra na árvore de HTML. A saída final é uma string de HTML seguro; atributos de evento, `script`, estilos, formulários e elementos fora da lista não podem sobreviver ao saneamento.
- **Lista comum:** parágrafo, negrito, itálico, listas ordenadas/não ordenadas, citação, código inline e em bloco, quebra de linha, links e imagens. Títulos, tabelas, linha horizontal e demais construções não são adicionados sem outra mudança de spec. O saneador usa lista explícita de elementos e atributos, não o perfil padrão sozinho.
- **URLs:** links aceitam somente `https`, `http` e `mailto`; imagens aceitam somente URL absoluta `https`. Endereço relativo, protocolo relativo, `javascript:`, `data:` ou outro esquema é removido da função ativa: o link perde `href` e a imagem é descartada, preservando-se texto/alt quando seguro. Links recebem `target="_blank"` e `rel="nofollow noopener noreferrer"`; `noreferrer` complementa o par exigido pela 017 sem alterar a decisão comercial. Imagens têm `loading="lazy"` e `referrerpolicy="no-referrer"`; texto alternativo é obrigatório no editor, podendo ser vazio só quando a pessoa marcar a imagem como decorativa.
- **Servidor é autoridade:** em toda gravação ou edição de fórum, chamado, evento e novidade, a API chama o módulo comum, valida o limite de caracteres do Markdown e persiste `body_md`/equivalente e `body_html` na mesma transação. O HTML salvo é o que a API devolve. Uma importação ou correção futura que grave HTML sem passar pelo módulo é inválida.
- **Exibição segura:** o componente `Markdown` de `packages/ui` aceita o HTML saneado e o transforma em elementos React pela árvore, sem `dangerouslySetInnerHTML` nem `innerHTML`. A higienização é repetida na exibição, inclusive para HTML persistido. O parse desse HTML usa `rehype-parse` e a conversão da árvore usa `hast-util-to-jsx-runtime`, com componentes explícitos de link/imagem e textos acessíveis nos dois sites; nenhuma propriedade ou elemento chega ao React sem a lista comum. A prévia do editor usa o mesmo conversor do núcleo; divergência entre prévia e conteúdo salvo é defeito testado.
- **Conteúdo anterior:** descrições e notas gravadas antes desta ADR não são reescritas em lote nem ganham imagens externas retroativamente. Enquanto só houver Markdown, continuam renderizadas do Markdown pela política segura comum, sem imagem externa e com o HTML escrito pelo usuário aparecendo como texto, nunca como elemento. Na primeira edição por rota que adote a nova persistência, grava-se também o HTML saneado. Não se mistura HTML antigo não saneado com o novo formato.
- **CSP:** a exibição de imagens externas exige `img-src https:` no classroom e no admin; imagens enviadas à instalação continuam nas rotas e limites da [029](../029-imagens.md). Nenhuma origem de script, frame ou conexão é liberada por esta decisão. A política de referência continua restrita e as imagens Markdown não são buscadas ou regravadas pelo servidor.
- **Testes obrigatórios:** o núcleo e a interface compartilham um conjunto de casos de XSS, URLs, HTML bruto, imagens, atributos e limites. Testes verificam paridade do HTML/árvore, conteúdo antigo, ausência de `dangerouslySetInnerHTML` e CSP; o e2e confirma que cargas conhecidas permanecem inertes e que imagem `https` permitida aparece.

## Alternativas consideradas

- Manter apenas `react-markdown` no navegador: não produz o HTML persistido exigido pela 017 nem dá uma única representação saneada para os consumidores.
- `marked` ou `markdown-it` com `DOMPurify`: troca todo o ecossistema já adotado e exigiria duas políticas de parser/saneamento, sem vantagem sobre o pipeline `remark`/`rehype`.
- Interpretar o HTML com `dangerouslySetInnerHTML` após sanitizar só no servidor: uma resposta adulterada ou um consumidor que pule a gravação comum viraria XSS; a conversão em React evita esse sumidouro.
- Regravar todas as descrições/notas na implantação: migração de conteúdo desnecessária e com risco de alterar texto antigo; a compatibilidade de leitura resolve sem tocar dados existentes.

## Consequências

- A tarefa 573 instala as dependências do núcleo e implementa o módulo isomórfico; a tarefa 627 fixa `rehype-parse`/`hast-util-to-jsx-runtime` na UI e adapta o componente existente e seus usos, antes das telas da Fase 4 que dependem da prévia e do HTML salvo. As quatro bibliotecas são MIT; suas versões exatas ficam nos manifestos e no lockfile das tarefas que as instalam.
- As migrations da Fase 4 criam os campos Markdown/HTML previstos; o conteúdo anterior não exige migration de reescrita.
- `infra` ajusta `img-src` nos dois sites e testa a CSP. O admin deixa de ser totalmente fechado a origens externas de **imagem**, mas não a scripts, frames ou conexões.
- O Markdown externo faz o navegador contatar o host indicado pelo autor, que pode observar o pedido da imagem; `Referrer-Policy` e `referrerpolicy="no-referrer"` reduzem os dados enviados, sem eliminar essa exposição. Não há proxy de imagens nesta fase.
- Toda rota nova que persiste Markdown usa o módulo comum. HTML de certificado segue a política própria e mais restrita da [0026](0026-certificado-por-template-html.md); esta ADR não o libera.
