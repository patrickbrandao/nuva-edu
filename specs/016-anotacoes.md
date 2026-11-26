# 016 — Anotações

Status: aprovada
Depende de: 000, 001, 004, 009, 014

## Contexto

O aluno anota enquanto assiste. A nota fica presa à aula, com um link de volta para ela, e todas se reúnem numa página só — o "caderno". Também dá para escrever notas avulsas, sem aula, para ideias e resumos. As anotações são privadas: só o dono as vê.

## Requisitos

- RF-01: Criar, editar e excluir nota vinculada a uma aula, na aba "Minhas notas" da página da aula.
- RF-02: Criar, editar e excluir nota avulsa, sem aula.
- RF-03: Página "Anotações" que reúne todas as notas, com busca e filtro por curso.
- RF-04: Nota de aula guarda, opcionalmente, o instante do vídeo em que foi escrita.
- RF-05: Cada nota de aula tem link de volta para a aula (e para o instante, quando houver).
- RF-06: As notas são privadas: nenhum outro usuário, nem a equipe, as lê pela interface ou pela API.
- RF-07: O texto é salvo automaticamente enquanto o aluno escreve.
- RNF-01: Listar as notas de uma aula em p95 < 150 ms; a página "Anotações" com 1.000 notas, paginada de 30 em 30, em p95 < 300 ms.
- RNF-02: Limites: 20.000 caracteres por nota; título de até 160; 5.000 notas por usuário; 100 notas por usuário em cada aula.
- RNF-03: Salvamento automático no máximo a cada 2 s de inatividade na digitação; perda máxima de 2 s de texto em caso de queda.

## Comportamento

### Nota de aula

- A aba "Minhas notas" lista as notas daquela aula, da mais antiga à mais recente, e tem um campo para escrever uma nova.
- A lista da aba não é paginada: vem inteira, com o corpo de cada nota. Para ela ter tamanho limitado, cada usuário tem no máximo 100 notas por aula; a 101ª é recusada (`422` `note_lesson_limit_reached`) e o classroom avisa: "Você chegou ao limite de 100 anotações nesta aula. Junte ou exclua alguma para escrever outra." Nota cuja aula foi excluída deixa de contar para esse teto.
- A lista não exige acesso à aula: quem o perdeu continua lendo ali as próprias notas. Responde `404` só quando o usuário não tem nota na aula e ela não existe ou está despublicada.
- Ao criar, o classroom preenche `video_seconds` com a posição atual do player, quando ele a informa ([014](014-aprendizado-e-progresso.md)); o aluno pode remover o instante.
- O instante é guardado em segundos inteiros (a fração é descartada: `83,9` vira `83`) e só existe em nota de aula.
- Clicar no instante de uma nota leva o player àquele ponto (vídeo nativo e provedores com API); nos demais, o instante é só informativo.
- Só cria nota de aula quem tem acesso à aula no momento ([010](010-direitos-de-acesso.md)).
- Perder o acesso ao curso não apaga as notas: elas seguem na página "Anotações", legíveis e editáveis; o link de volta mostra a tela de "sem acesso" da aula.
- Aula despublicada ou excluída, ou curso despublicado ou arquivado: a nota permanece, sem link, mostrando os títulos da aula e do curso guardados na criação (`lesson_title_snapshot`, `course_title_snapshot`). Enquanto a aula está disponível, a nota mostra os títulos atuais. A nota de aula excluída continua sendo "de aula" nos filtros.

### Nota avulsa

- Criada na página "Anotações" por "Nova anotação"; tem título opcional e corpo.
- Não tem vínculo com curso nem aula, nem instante de vídeo.
- Título: os espaços das pontas são descartados; só espaços vale como sem título.

### Página "Anotações"

- Lista todas as notas, da alteração mais recente à mais antiga, paginada de 30 em 30.
- Cada item: título (ou o início do texto), trecho, data, e — nas de aula — curso, aula e instante, com o link de volta.
- Filtros: todas, de aulas, avulsas, e por curso.
- Busca por texto no título e no corpo, exigindo todas as palavras do termo (até 200 caracteres) (busca textual do Postgres, na configuração de idioma da instalação). Com `NUVA_LOCALE=pt-BR`, o único idioma da versão 1, a configuração é `portuguese`, fixada na migration que cria a coluna `search` (coluna gerada exige configuração constante); outro idioma pede migration.
- Estado vazio com os três passos: abrir uma aula, ir à aba "Minhas notas", escrever; e os botões "Ir para meus cursos" e "Escrever uma ideia avulsa".

### Edição

- Corpo em Markdown, com as mesmas regras de sanitização do fórum ([017](017-forum.md)): sem HTML bruto interpretado e links com `rel="nofollow noopener noreferrer"`. As regras ficam no módulo de `packages/core` e no componente `Markdown` de `packages/ui` ([006](006-sites-e-interface.md), [0027](decisions/0027-markdown-saneado-no-servidor.md)). Notas anteriores continuam sendo lidas do Markdown com segurança; não são reescritas em lote nem exigem persistir HTML nesta fase.
- Salvamento automático: 2 s após a última tecla e ao sair do campo; indicador "salvando…" e "salvo".
- Conflito entre dois dispositivos: a gravação envia `updated_at` conhecido; se o registro mudou, a API responde `409` com a versão atual e o classroom oferece manter a local, a do servidor, ou copiar a local para uma nota nova.
- Toda gravação que altera a nota avança `updated_at` (precisão de milissegundos; duas versões nunca têm o mesmo valor). Gravação que não altera nenhum campo devolve a nota como está, sem nova versão; com `updated_at` desatualizado ela também responde `409`.
- Editar não confere o acesso ao curso nem os tetos de quantidade.
- Excluir pede confirmação e é definitivo (sem lixeira).
- Nota vazia (só espaços) não é salva; ao esvaziar uma nota existente, o classroom pergunta se deve excluí-la.

### Privacidade

- Toda consulta filtra por `user_id` da sessão; identificador de nota alheia responde `404`.
- O `admin-api` e o MCP não têm rota nem ferramenta de leitura de anotações.
- As notas entram na exportação de dados do aluno e são apagadas na exclusão da conta ([030](030-lgpd.md)).
- O texto das notas não é indexado na busca global nem aparece em logs.

### Casos de erro

| Situação | Resposta |
| --- | --- |
| Criar nota de aula sem acesso à aula | `403` `access_denied`, com o motivo |
| Criar nota em aula inexistente ou despublicada | `404` |
| Nota de outro usuário ou inexistente | `404` |
| Notas de aula inexistente ou despublicada, sem nenhuma nota do usuário | `404` |
| Corpo só com espaços | `422` `note_empty` |
| Acima de 20.000 caracteres | `422` `note_too_long` |
| Usuário já com 5.000 notas | `422` `note_limit_reached` |
| Usuário já com 100 notas na aula | `422` `note_lesson_limit_reached` |
| `video_seconds` negativo, não finito, acima de 2.147.483.647, ou em nota avulsa | `422` `note_video_seconds_invalid` |
| Título acima de 160, parâmetro ou cursor fora do formato | `400` |
| Gravação com `updated_at` desatualizado | `409` `version_conflict` com a versão atual |

## Interfaces e contratos

`apps/classroom-api/openapi.yaml`, sob `/api/v1` (no contrato os campos são `camelCase`: `lessonId`, `courseId`, `videoSeconds`, `updatedAt`):

- `GET /notes` (parâmetros: `q`, `kind` = `lesson` | `standalone`, `courseId`, `limit` de 1 a 100, padrão 30, paginação por cursor); devolve o trecho de cada nota (até 300 caracteres, sem Markdown), não o corpo
- `GET /lessons/{id}/notes` (sem paginação; até 100 notas inteiras)
- `POST /notes` (`lessonId` opcional, `title`, `body`, `videoSeconds`)
- `GET /notes/{id}`, `PATCH /notes/{id}` (com `updatedAt` para o controle de conflito), `DELETE /notes/{id}`

Nenhuma rota no `admin-api`.

## Dados

Dono (escrita): `classroom-api`.

`notes`:

| Campo | Descrição |
| --- | --- |
| `id` | UUID v7 |
| `user_id` | dono |
| `lesson_id` | nulo nas avulsas; mantido como nulo se a aula for excluída |
| `course_id` | redundante, para o filtro por curso |
| `lesson_title_snapshot`, `course_title_snapshot` | títulos no momento da criação |
| `video_seconds` | instante do vídeo, opcional |
| `title` | opcional |
| `body` | Markdown |
| `search` | vetor de busca textual, gerado de `title` e `body` |
| `created_at`, `updated_at` | datas |

Índices: (`user_id`, `updated_at` decrescente); (`user_id`, `lesson_id`); GIN em `search`.

Retenção: mantidas enquanto a conta existir; apagadas na exclusão da conta.

## Critérios de aceite

- [ ] Nota criada na aula aparece na aba da aula e na página "Anotações", com o link de volta.
- [ ] O instante do vídeo é preenchido e, ao clicar, o player nativo vai ao ponto.
- [ ] Nota avulsa é criada sem aula e aparece no filtro "avulsas".
- [ ] Busca encontra texto do corpo; filtro por curso funciona.
- [ ] Após perder o acesso ao curso, as notas seguem visíveis e editáveis.
- [ ] Usuário B recebe `404` ao pedir nota do usuário A; admin não tem rota para lê-la.
- [ ] Edição simultânea em dois dispositivos produz `409` e a escolha de versão.
- [ ] Texto com HTML e `javascript:` é sanitizado na exibição.
- [ ] Limites de tamanho e de quantidade (5.000 por usuário, 100 por aula) respondem `422` com o `code` da tabela de erros.
- [ ] `video_seconds` negativo ou em nota avulsa responde `422` `note_video_seconds_invalid`; fração é descartada.
- [ ] Estado vazio mostra os três passos e os dois botões.

## Fora de escopo

- Compartilhar notas com outros alunos ou torná-las públicas.
- Anexos e imagens nas notas.
- Pastas, etiquetas e cadernos múltiplos.
- Exportar as notas em PDF (elas entram só na exportação geral de dados).
- Edição colaborativa em tempo real.
- Lixeira e histórico de versões.

## Decisões relacionadas

- [0017](decisions/0017-escopo-do-mvp.md)
- [0001](decisions/0001-decisoes-iniciais.md)
