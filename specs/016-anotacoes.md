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
- RNF-02: Limites: 20.000 caracteres por nota; título de até 160; 5.000 notas por usuário.
- RNF-03: Salvamento automático no máximo a cada 2 s de inatividade na digitação; perda máxima de 2 s de texto em caso de queda.

## Comportamento

### Nota de aula

- A aba "Minhas notas" lista as notas daquela aula, da mais antiga à mais recente, e tem um campo para escrever uma nova.
- Ao criar, o classroom preenche `video_seconds` com a posição atual do player, quando ele a informa ([014](014-aprendizado-e-progresso.md)); o aluno pode remover o instante.
- Clicar no instante de uma nota leva o player àquele ponto (vídeo nativo e provedores com API); nos demais, o instante é só informativo.
- Só cria nota de aula quem tem acesso à aula no momento ([010](010-direitos-de-acesso.md)).
- Perder o acesso ao curso não apaga as notas: elas seguem na página "Anotações", legíveis e editáveis; o link de volta mostra a tela de "sem acesso" da aula.
- Aula despublicada ou excluída: a nota permanece, mostrando o título da aula guardado em `lesson_title_snapshot` e sem link.

### Nota avulsa

- Criada na página "Anotações" por "Nova anotação"; tem título opcional e corpo.
- Não tem vínculo com curso nem aula.

### Página "Anotações"

- Lista todas as notas, da alteração mais recente à mais antiga, paginada de 30 em 30.
- Cada item: título (ou o início do texto), trecho, data, e — nas de aula — curso, aula e instante, com o link de volta.
- Filtros: todas, de aulas, avulsas, e por curso.
- Busca por texto no título e no corpo (busca textual do Postgres, na configuração de idioma da instalação).
- Estado vazio com os três passos: abrir uma aula, ir à aba "Minhas notas", escrever; e os botões "Ir para meus cursos" e "Escrever uma ideia avulsa".

### Edição

- Corpo em Markdown, com as mesmas regras de sanitização do fórum ([017](017-forum.md)): sem HTML bruto, links com `rel="noopener noreferrer"`.
- Salvamento automático: 2 s após a última tecla e ao sair do campo; indicador "salvando…" e "salvo".
- Conflito entre dois dispositivos: a gravação envia `updated_at` conhecido; se o registro mudou, a API responde `409` com a versão atual e o classroom oferece manter a local, a do servidor, ou copiar a local para uma nota nova.
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
| Criar nota de aula sem acesso à aula | `403` |
| Nota de outro usuário | `404` |
| Acima de 20.000 caracteres ou de 5.000 notas | `422` |
| Gravação com `updated_at` desatualizado | `409` com a versão atual |
| `video_seconds` negativo | `422` |

## Interfaces e contratos

`apps/classroom-api/openapi.yaml`, sob `/api/v1`:

- `GET /notes` (parâmetros: `q`, `kind` = `lesson` | `standalone`, `course_id`, paginação por cursor)
- `GET /lessons/{id}/notes`
- `POST /notes` (`lesson_id` opcional, `title`, `body`, `video_seconds`)
- `GET /notes/{id}`, `PATCH /notes/{id}` (com `updated_at` para o controle de conflito), `DELETE /notes/{id}`

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
- [ ] Limites de tamanho e de quantidade respondem `422`.
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
