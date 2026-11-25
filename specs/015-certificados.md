# 015 — Certificados

Status: aprovada
Depende de: 000, 001, 005, 009, 014

## Contexto

O certificado de conclusão é argumento de venda e prova para o aluno. Ao concluir 100% das aulas de um curso, o aluno recebe um PDF com nome, curso, carga horária e um código. Qualquer pessoa confere a autenticidade numa página pública, sem login.

O desenho do certificado é um **template HTML** cadastrado pela escola, com palavras-chave trocadas pelos dados do curso e do aluno ([0026](decisions/0026-certificado-por-template-html.md)). Sem template, o certificado não é emitido.

Não há provas no MVP: a única regra é concluir todas as aulas ([014](014-aprendizado-e-progresso.md)).

## Requisitos

- RF-01: Emitir o certificado automaticamente quando o aluno conclui 100% das aulas publicadas de um curso com certificado habilitado e com template efetivo.
- RF-02: O certificado é um PDF gerado a partir do template efetivo do curso, com as palavras-chave trocadas pelos dados congelados na emissão.
- RF-03: Página pública de validação por código, sem login.
- RF-04: O aluno baixa seus certificados na estante e na página do curso.
- RF-05: O admin habilita ou desabilita o certificado por curso e define o signatário da escola.
- RF-06: Só o admin revoga um certificado, com motivo ([008](008-papeis-e-permissoes.md)); a validação passa a indicar a revogação.
- RF-07: Admin e gerente emitem manualmente um certificado para um aluno, com motivo.
- RF-08: Um certificado por aluno e curso; emitir de novo devolve o existente.
- RF-09: Cada curso tem um template próprio, editado por quem edita o curso (instrutor dono, gerente, admin); a escola tem um template padrão opcional, editado pelo admin. O template efetivo é o do curso; sem ele, o padrão; sem os dois, nenhum.
- RF-10: O template é validado ao salvar (palavras-chave e higienização) e recusado com a lista de problemas; nunca é corrigido em silêncio.
- RF-11: Quem edita o template pede um PDF de exemplo, com dados fictícios, antes de salvar.
- RF-12: Aluno que concluiu um curso sem template efetivo vê o aviso "certificado ainda não liberado pelo instrutor"; quando o curso passa a ter template efetivo, quem já concluiu recebe o certificado.
- RF-13: A equipe com acesso à lista de certificados baixa o PDF de cada um, para conferir o que o aluno recebeu.
- RNF-01: Certificado disponível em até 60 s após a conclusão (p95), com template efetivo.
- RNF-02: Página de validação em p95 < 300 ms.
- RNF-03: PDF de uma página A4 paisagem, com no máximo 2 MiB; template de no máximo 768 KiB, com as imagens embutidas.
- RNF-04: Código com 12 caracteres de um alfabeto sem ambiguidades (sem `0`, `O`, `1`, `I`, `L`), gerado com aleatoriedade criptográfica; formato `XXXX-XXXX-XXXX`.
- RNF-05: Validação limitada a 30 consultas por minuto por IP.
- RNF-06: PDF de exemplo pronto em até 15 s (p95); no máximo 20 pedidos de exemplo por hora por usuário.
- RNF-07: A renderização não executa JavaScript nem faz requisição de rede; cada PDF tem tempo limite de 20 s.

## Comportamento

### Emissão

1. Ao atingir 100%, o `classroom-api` enfileira `course.completed` ([014](014-aprendizado-e-progresso.md)).
2. O worker confere, na hora da emissão, que: o curso tem `certificate_enabled`; o curso tem template efetivo; o aluno tem 100% das aulas publicadas concluídas; ainda não existe certificado para (usuário, curso). Sem template efetivo, a tarefa termina sem criar nada (não é falha): o aluno vê o aviso de RF-12.
3. Cria o registro em `certificates` com os dados congelados (nome, título do curso, instrutor, carga horária, data, escola, signatário e cargo), a versão do template efetivo e o código.
4. Enfileira `certificate.render`, que gera o PDF e o guarda no registro.
5. Notifica o aluno e envia e-mail com o link ([024](024-notificacoes-e-email.md)); credita os pontos ([020](020-gamificacao.md)).

Regras:

- Dados congelados: mudança posterior no nome do aluno, no título, nas aulas do curso ou no template não altera certificado já emitido. Repetir `certificate.render` usa a versão do template guardada no certificado.
- Nome no certificado: `users.full_name`; se vazio, o nome de exibição, no momento da emissão. Não há espera de confirmação ([0026](decisions/0026-certificado-por-template-html.md)): a página do curso (quando o certificado está habilitado) e a aba Certificados mostram ao aluno o nome que sairá, com "Alterar", que grava `users.full_name` (`PUT /me/certificate-name`).
- Corrigir o nome depois da emissão: o aluno pede por chamado; admin ou gerente usam "reemitir", que congela de novo o nome atual e a versão do template efetivo atual, regenera o PDF, mantém o código e registra auditoria. Reemitir curso sem template efetivo: `422` `certificate_template_missing`.
- Carga horária: soma de `duration_seconds` das aulas publicadas no momento da emissão, arredondada para cima em horas inteiras; o admin pode fixar outro valor por curso (`certificate_hours`).
- Data de conclusão: a da última aula concluída.
- Curso `open` também emite certificado, se habilitado.
- Aula amostra concluída sem o curso não conta; a emissão exige que o aluno tenha tido acesso ao curso.
- Perder o acesso depois (reembolso, fim de plano) não revoga o certificado automaticamente; a revogação é decisão manual. Em reembolso dentro de 7 dias da compra, a tela de reembolso oferece a caixa "revogar certificados deste curso", marcada por padrão.
- Curso concluído antes de o certificado ser habilitado: ao habilitar, o admin escolhe emitir para quem já concluiu (tarefa em lote) ou só para conclusões futuras.
- Emissão retroativa por template: quando o curso passa de "sem template efetivo" a "com template efetivo" (template do curso salvo, ou padrão da escola salvo quando não havia nenhum), o sistema enfileira `certificate.backfill` para o curso; o padrão da escola novo enfileira uma para cada curso com `certificate_enabled` e sem template próprio. O lote emite para quem tem, naquele momento, 100% das aulas publicadas e acesso ao curso, e não emite em curso com certificado desabilitado. Editar um template que já existia não emite nada.
- Excluir o template do curso volta ao padrão da escola; sem padrão, as próximas conclusões ficam aguardando template. Certificados emitidos não mudam.

### Template

Um template é um documento HTML completo ou um fragmento (o sistema envolve o fragmento em `<html><body>`). É editado como código no admin, com a lista de palavras-chave ao lado e o botão "Começar do modelo" (HTML inicial fornecido pelo sistema, em `GET /certificate-templates/reference`).

**Palavras-chave.** Sintaxe `{{grupo.campo}}`, com espaços internos tolerados (`{{ aluno.nome }}`). Lista fechada:

| Palavra-chave | Valor |
| --- | --- |
| `aluno.nome` | Nome do aluno (regra do nome, acima) |
| `curso.titulo` | Título do curso |
| `curso.carga_horaria` | Carga horária em horas inteiras, só o número (`12`) |
| `curso.instrutor` | Nome de exibição do dono do curso; vazio sem dono |
| `certificado.data_conclusao` | Data de conclusão por extenso no `NUVA_LOCALE` (`25 de novembro de 2026`), no fuso da escola |
| `certificado.data_conclusao_curta` | Data de conclusão curta (`25/11/2026`) |
| `certificado.data_emissao` | Data de emissão por extenso |
| `certificado.codigo` | Código com hífens (`XXXX-XXXX-XXXX`) |
| `certificado.url_validacao` | `https://<NUVA_CLASSROOM_HOST>/certificados/<código>` |
| `certificado.qrcode` | Código QR da URL de validação, em SVG gerado pelo sistema |
| `escola.nome` | `school.name` ([031](031-infraestrutura-e-deploy.md)) |
| `assinatura.nome` | `certificate.signer_name`; vazio quando nulo |
| `assinatura.cargo` | `certificate.signer_role`; vazio quando nulo |

Regras das palavras-chave:

- Todo valor é escapado para HTML (`&`, `<`, `>`, `"`, `'`) antes da troca, no texto e nos atributos.
- `certificado.qrcode` é a única que vira marcação (um `<svg>` do sistema) e só é aceita em posição de texto; em atributo é erro.
- Palavra-chave fora da lista, `{{` sem `}}` e chave vazia são erros. Não há forma de escrever `{{` literal.
- Obrigatórias: `aluno.nome`, `curso.titulo`, `certificado.codigo` e ao menos uma de `certificado.url_validacao` e `certificado.qrcode`.

**Higienização** (lista de permissões, [0026](decisions/0026-certificado-por-template-html.md)). Ao salvar e ao pedir exemplo, o `packages/core` analisa o HTML e o CSS e recusa o template inteiro se houver qualquer item fora das regras; o worker repete a validação antes de cada renderização.

| Item | Regra |
| --- | --- |
| Elementos | Permitidos: estrutura (`html`, `head`, `body`, `title`, `meta` só com `charset`, `style`), texto e blocos (`div`, `span`, `p`, `br`, `hr`, `h1`–`h6`, `strong`, `b`, `em`, `i`, `u`, `s`, `small`, `sub`, `sup`, `blockquote`, `section`, `header`, `footer`, `main`, `article`, `figure`, `figcaption`), listas, tabelas (com `caption`, `colgroup`, `col`), `img`, `a` e SVG de desenho (`svg`, `g`, `defs`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `text`, `tspan`, `linearGradient`, `radialGradient`, `stop`, `clipPath`). Qualquer outro é recusado, em especial `script`, `iframe`, `frame`, `object`, `embed`, `applet`, `link`, `base`, `form` e controles, `video`, `audio`, `source`, `track`, `canvas`, `template`, `noscript`, `foreignObject`, `use`, `image`, `animate*` e `set`. |
| Atributos | Globais `class`, `id`, `style`, `title`, `lang`, `dir`; de tabela (`colspan`, `rowspan`, `width`, `height`, `align`, `valign`); `img` com `src`, `alt`, `width`, `height`; `a` com `href`; os de apresentação do SVG. Recusados: todo `on*`, `srcset`, `srcdoc`, `formaction`, `xlink:href`, `href` em SVG e qualquer atributo fora da lista. |
| Links | `a href` só `https:` ou exatamente `{{certificado.url_validacao}}`. |
| Imagens | `img src` só `data:image/png`, `jpeg`, `webp` ou `gif` em base64, ou o caminho de entrega de uma imagem existente e não oculta da própria instalação, `/api/v1/images/<id>/<largura>.webp` ([029](029-imagens.md)). O worker troca o caminho pelos bytes da variante em `data:` antes de renderizar; imagem apagada depois vira um espaço vazio, com aviso no log. |
| CSS | Só em `<style>` e no atributo `style`. Recusados: `@import`, `url()` com algo que não seja `data:` de imagem (os quatro tipos acima) ou de fonte (`font/woff2`, `font/woff`, `font/ttf`, `font/otf`), `expression()`, `behavior`, `-moz-binding`. `@font-face` só com `src` em `data:`. |
| Tamanho | Até 768 KiB em UTF-8. |
| Análise | HTML que o analisador não lê, ou CSS com erro de sintaxe, é recusado. |

Recusa: `422` `certificate_template_invalid`, com `details.problems`: lista de `{ rule, message, line, column }`, em que `rule` é um de `parse_error`, `too_large`, `element_not_allowed`, `attribute_not_allowed`, `url_not_allowed`, `css_not_allowed`, `image_not_found`, `unknown_key`, `unclosed_key`, `key_in_attribute`, `missing_required_key`.

Fontes: a imagem do worker traz a Inter (OFL-1.1), que é a fonte padrão do documento; outras fontes só embutidas por `@font-face` em `data:`.

**Versões.** Cada gravação cria uma linha imutável em `certificate_template_versions`; o template aponta para a versão atual. Gravação concorrente: o `PUT` leva a versão que o editor abriu (`expectedVersionId`); se mudou, `409` `version_conflict`.

### Pré-visualização

1. O editor envia o HTML ainda não salvo (`POST /certificate-templates/previews`, com `courseId` opcional).
2. A `admin-api` valida (mesmas regras e mesmo `422`), grava um pedido em `certificate_previews` e enfileira `certificate.preview`. Responde `202` com o `id`.
3. O worker preenche as palavras-chave com dados de exemplo e renderiza como num certificado real: aluno "Maria Exemplo da Silva", título do curso indicado (ou "Curso de exemplo"), instrutor dele, 12 horas, a data do dia, código `ABCD-EFGH-JKMN`, a URL de validação desse código, e nome da escola, signatário e cargo das configurações (ou "Nome de quem assina" e "Cargo", quando nulos).
4. O site consulta o estado (`pending`, `ready`, `failed` com o motivo) e abre o PDF numa aba nova.

Só quem pediu vê o pedido e o PDF; de outro usuário, `404`. O pedido é apagado em 24 horas ([033](033-observabilidade-retencao-backup.md)). O exemplo de curso alheio segue o alcance do instrutor (`404`).

### PDF

- Gerado no worker a partir do template, sem serviço externo, pelo Chromium headless shell controlado pelo `playwright-core` ([0026](decisions/0026-certificado-por-template-html.md)).
- Passos: validar de novo o template; trocar as palavras-chave; embutir as imagens da instalação; abrir um contexto novo com JavaScript desligado e sem rede (toda requisição abortada); carregar o HTML; gerar o PDF em A4 paisagem, só a primeira página, com fundo impresso e sem margem imposta (as margens são do template).
- Tempo limite de 20 s por PDF; um PDF por vez em cada processo do worker; o navegador sobe na primeira renderização e fecha após 5 minutos ocioso.
- PDF acima de 2 MiB, tempo esgotado ou falha do navegador contam como falha da tarefa (tentativas da [005](005-worker-e-fila.md)).
- Idioma das datas: `NUVA_LOCALE`.
- Guardado em `certificates.pdf` (bytea); com 300 KB típicos por certificado, 10.000 certificados ocupam cerca de 3 GB, dentro do gatilho de revisão de [0007](decisions/0007-imagens-no-postgres.md). Regenerável a partir dos dados congelados e da versão do template.

### Validação pública

- Endereço: `https://<NUVA_CLASSROOM_HOST>/certificados/<código>` (a rota do classroom em [006](006-sites-e-interface.md)), que o template imprime pelas palavras-chave; há também um formulário para digitar o código, em `/certificados`.
- Código aceito com ou sem hífens e sem diferenciar maiúsculas.
- Certificado válido: mostra nome do aluno, curso, carga horária, data de conclusão, data de emissão e escola.
- Certificado revogado: mostra "certificado revogado" e a data, sem o motivo.
- Titular que excluiu a conta: mostra o código, o curso e a data, com o aviso "titular removeu a conta", sem o nome ([030](030-lgpd.md)).
- Código inexistente: mostra "certificado não encontrado", com a mesma resposta e o mesmo tempo para qualquer código inválido.
- A página não expõe e-mail, foto nem link para o perfil do aluno.
- O PDF só é baixado pelo dono (logado, no classroom) e pela equipe (no admin, [Download pela equipe](#download-pela-equipe)); a página pública não oferece o arquivo.

### Estado do certificado para o aluno

Em cada curso com `certificate_enabled`, o classroom mostra um estado:

| Estado | Quando | O que o aluno vê |
| --- | --- | --- |
| `in_progress` | Menos de 100% e sem certificado | "Certificado ao concluir o curso", com o nome que sairá e "Alterar" |
| `awaiting_template` | 100%, sem certificado e sem template efetivo | "O certificado ainda não foi liberado pelo instrutor. Você o receberá aqui e por e-mail assim que for liberado." |
| `preparing` | Certificado criado, PDF ainda não gerado | "Certificado em preparação" |
| `issued` | Certificado com PDF | Botão de download e o código |
| `revoked` | Certificado revogado | "Certificado revogado" |

Curso com certificado desabilitado não tem estado, e a página não menciona certificado. Certificado emitido manualmente ou já existente vale mesmo que o curso tenha voltado a menos de 100%.

### Revogação e emissão manual

- Revogar: só o admin, com motivo obrigatório; grava `revoked_at`; o aluno é notificado. Desfazer a revogação: só o admin.
- Emissão manual: admin ou gerente emitem para um aluno que não concluiu pelo sistema (por exemplo, turma migrada), com motivo; marca `issued_manually`. Exige template efetivo (`422` `certificate_template_missing`).
- Todas gravam auditoria ([028](028-auditoria.md)) e estão no MCP ([027](027-mcp.md)), assim como gravar e excluir template.

### Download pela equipe

Na lista de certificados do admin, cada certificado com PDF tem a ação "Baixar PDF" (`GET /certificates/{id}/pdf` na `admin-api`), para a equipe conferir o que o aluno recebeu.

- Quem: quem vê a lista (`progress.view`): admin, gerente e o instrutor nos próprios cursos. Certificado de curso alheio responde `404` ao instrutor ([003](003-admin-api.md), "Alcance do instrutor").
- O arquivo é o mesmo que o aluno baixa: `certificates.pdf`, sem nova renderização. Nome sugerido: `certificado-<código>.pdf`; a resposta não é guardada em cache.
- Certificado revogado continua disponível à equipe (o aluno deixa de baixá-lo).
- PDF ainda não gerado (`preparing`): `409` `certificate_preparing`, como no classroom. PDF apagado pela exclusão da conta do titular: `404`; a lista não oferece a ação.
- É leitura comum do painel: não grava auditoria ([028](028-auditoria.md), "Fora de escopo"). O PDF traz só dados que a lista já mostra a quem tem `progress.view`.
- Não entra no catálogo de ferramentas do MCP ([027](027-mcp.md)): a rota devolve um arquivo e existe só para o painel.

### Casos de erro

| Situação | Resposta |
| --- | --- |
| Baixar certificado de outro aluno | `404` |
| Curso com certificado desabilitado | nenhuma emissão; a página do curso não menciona certificado |
| Curso sem template efetivo | nenhuma emissão automática; estado `awaiting_template`; emissão manual e reemissão `422` `certificate_template_missing` |
| Template fora das regras | `422` `certificate_template_invalid` com a lista de problemas |
| Template salvo por outro no meio da edição | `409` `version_conflict` |
| Instrutor editando template de curso alheio | `404` |
| Mais de 20 pedidos de exemplo na hora | `429` |
| Falha ao gerar o PDF | a tarefa repete (até 5 vezes, [005](005-worker-e-fila.md)); o registro existe e a validação já funciona; o download mostra "em preparação" |
| Mais de 30 validações por minuto do mesmo IP | `429` |
| Emissão manual para quem já tem certificado do curso | `409` |
| Equipe baixando PDF ainda não gerado | `409` `certificate_preparing` |
| Instrutor baixando PDF de certificado de curso alheio | `404` |

## Interfaces e contratos

`apps/classroom-api/openapi.yaml`, sob `/api/v1`:

- `GET /me/certificates`: os certificados do aluno e, à parte, os cursos em `awaiting_template`
- `GET /me/certificates/{id}/pdf`
- `PUT /me/certificate-name` (grava o nome completo usado no certificado)
- `GET /certificates/verify/{code}` (público)
- O estado do certificado (tabela acima, ou nulo) vem em `GET /courses/{slug}` e nos cursos da estante ([014](014-aprendizado-e-progresso.md)).

`apps/admin-api/openapi.yaml`, sob `/api/v1`:

- `GET /certificates` (filtros por curso, aluno, estado)
- `GET /certificates/{id}/pdf`: o PDF, para a equipe
- `POST /certificates` (emissão manual), `POST /certificates/{id}/revoke`, `POST /certificates/{id}/restore` (admin), `POST /certificates/{id}/reissue`
- `PATCH /courses/{id}` com `certificate_enabled` e `certificate_hours`
- `POST /courses/{id}/certificates/backfill`
- `GET|PUT|DELETE /courses/{id}/certificate-template`: `GET` devolve o template do curso (ou nulo), a origem do efetivo (`course`, `school` ou `none`), a versão, quem e quando gravou; `PUT` com `html` e `expectedVersionId` devolve o mesmo e `backfillQueued`
- `GET|PUT|DELETE /settings/certificate-template`: o padrão da escola, no mesmo formato
- `GET /certificate-templates/reference`: a lista de palavras-chave (nome, descrição, valor de exemplo, obrigatória) e o HTML do modelo inicial
- `POST /certificate-templates/previews` (`202`), `GET /certificate-templates/previews/{id}`, `GET /certificate-templates/previews/{id}/pdf`
- `GET|PUT /settings/certificates`: grava `certificate.signer_name` e `certificate.signer_role` ([031](031-infraestrutura-e-deploy.md), "Configurações da escola") e devolve também, só para leitura, `school.name`. `settings.manage` (admin).

Permissões ([008](008-papeis-e-permissoes.md)): listar, ver e baixar o PDF, `progress.view` (instrutor só nos próprios cursos); emissão manual e reemissão, `certificate.issue`; revogar e desfazer, `certificate.revoke`; `PATCH /courses/{id}` e `backfill`, `course.edit`; template do curso, referência e exemplo, `certificate.template.edit` (instrutor só nos próprios cursos); padrão da escola, `settings.manage`.

Tarefas da fila: `course.completed`, `certificate.render`, `certificate.backfill`, `certificate.preview` ([005](005-worker-e-fila.md)).

Módulo `certificates` de `packages/core`: validação e preenchimento do template (funções puras, usadas pela `admin-api` e pelo worker), lista das palavras-chave, dados de exemplo e modelo inicial; a renderização com o navegador fica no worker.

## Dados

Dono (escrita): `worker` para emissão, PDF e exemplo; `admin-api` para revogação, emissão manual, templates, pedidos de exemplo e configurações.

`certificates`:

| Campo | Descrição |
| --- | --- |
| `id` | UUID v7 |
| `user_id`, `course_id` | únicos em conjunto |
| `code` | único, 12 caracteres |
| `student_name`, `course_title`, `instructor_name`, `hours`, `completed_at`, `school_name`, `signer_name`, `signer_role` | dados congelados |
| `template_version_id` | versão do template usada (referência a `certificate_template_versions`, sem exclusão em cascata) |
| `issued_at`, `issued_manually`, `issued_by`, `issue_reason` | emissão |
| `revoked_at`, `revoked_by`, `revoke_reason` | revogação |
| `pdf`, `pdf_rendered_at` | arquivo e data da geração |

`certificate_templates`: `id`, `course_id` (nulo = padrão da escola; único, com índice parcial que permite um só padrão), `version_id` (versão atual), `updated_by`, `created_at`, `updated_at`. Excluir o curso exclui o template.

`certificate_template_versions`: `id`, `course_id` (nulo para o padrão), `html` (até 768 KiB), `created_by`, `created_at`. Imutável; nunca é apagada enquanto um certificado ou um template a referenciar.

`certificate_previews`: `id`, `requested_by`, `course_id` (nulo), `html`, `status` (`pending` \| `ready` \| `failed`), `error`, `pdf`, `created_at`, `rendered_at`. Apagado em 24 horas.

Campos em `courses`: `certificate_enabled` (padrão verdadeiro), `certificate_hours` (nulo = calculado).

Retenção: certificados são permanentes enquanto a conta existir. Na exclusão da conta ([030](030-lgpd.md)) o registro permanece sem o nome do titular e o PDF é apagado: a página de validação mostra o código, o curso e a data, com o aviso "titular removeu a conta", e o PDF deixa de ser servido. O aluno é informado disso antes de confirmar a exclusão. Versões de template sem referência e pedidos de exemplo seguem a [033](033-observabilidade-retencao-backup.md).

### Entrega por fase

- Fase 2: tudo acima, com o aviso ao aluno só por e-mail (`certificate.issued`, por `enqueueEmail`, [024](024-notificacoes-e-email.md)). Imagens no template só por `data:` ou por imagens que a instalação já tem (capas); não há envio de imagem própria para template nem logotipo da escola.
- Fase 3: a caixa "revogar certificados deste curso" na tela de reembolso ([011](011-vendas-e-checkout.md)).
- Fase 4: notificação na central; pedido de correção do nome por chamado ([023](023-chamados-de-suporte.md)). Até lá a equipe usa "reemitir" a pedido do aluno.
- Fase 6: pontos da conclusão ([020](020-gamificacao.md)).

## Critérios de aceite

- [ ] Concluir a última aula de curso com template gera o certificado em até 60 s, com e-mail.
- [ ] Concluir curso sem template não gera certificado e mostra o aviso "ainda não liberado"; salvar o template emite para quem já concluiu.
- [ ] Duas tarefas `course.completed` simultâneas geram um único certificado.
- [ ] O PDF traz o texto do template com as palavras-chave trocadas, o código e o QR, numa página A4 paisagem, com até 2 MiB.
- [ ] Valor com `<script>` no nome do aluno sai escapado no PDF.
- [ ] Template com `script`, `on*`, `iframe`, `object`, `embed`, imagem externa, `@import` ou `url()` externo é recusado com o problema e a linha.
- [ ] Template sem `aluno.nome` ou com palavra-chave desconhecida é recusado.
- [ ] A renderização não faz nenhuma requisição de rede (teste conta as requisições interceptadas) e não executa JavaScript.
- [ ] O PDF de exemplo sai com os dados fictícios e só quem pediu o baixa.
- [ ] Editar o template depois não altera o certificado emitido; "reemitir" mantém o código e usa o nome e o template atuais.
- [ ] Curso com template próprio usa o dele; sem ele, o padrão da escola.
- [ ] Instrutor edita o template do próprio curso e recebe `404` no de outro.
- [ ] A página pública valida o código com e sem hífens e em minúsculas.
- [ ] Código inexistente e código revogado mostram as mensagens próprias, sem dados além dos previstos.
- [ ] Renomear o curso depois não altera o certificado emitido.
- [ ] Aluno não baixa o PDF de outro aluno (`404`).
- [ ] Gerente baixa, pelo admin, o PDF de um certificado emitido, sem registro novo na auditoria; o instrutor recebe `404` no de curso alheio.
- [ ] 31ª validação no mesmo minuto responde `429`.
- [ ] Curso com certificado desabilitado não emite.
- [ ] Emissão manual, revogação e gravação de template aparecem na auditoria.

## Fora de escopo

- Provas, nota mínima e frequência como condição.
- Editor visual de template (o template é editado como código) e vários templates por curso.
- Envio de imagem própria para template e logotipo da escola como palavra-chave (dependem da regra de proporção original da [029](029-imagens.md)).
- Assinatura digital com certificado ICP-Brasil.
- Certificado de pacote ou de trilha.
- Envio automático a redes profissionais.

## Decisões relacionadas

- [0026](decisions/0026-certificado-por-template-html.md)
- [0017](decisions/0017-escopo-do-mvp.md)
- [0007](decisions/0007-imagens-no-postgres.md)
- [0001](decisions/0001-decisoes-iniciais.md)
