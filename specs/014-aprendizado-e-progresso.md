# 014 — Aprendizado e progresso

Status: aprovada
Depende de: 000, 001, 004, 006, 009, 010

## Contexto

É aqui que o aluno passa a maior parte do tempo: abre o curso, assiste à aula, marca como concluída e segue para a próxima. Esta spec cobre a página da aula (player e abas), a regra de conclusão, o progresso por módulo e curso, a estante "Meus cursos", o "continuar de onde parou" e o mapa de atividade.

Os vídeos são externos ([009](009-catalogo-e-conteudo.md)), então o sistema não mede quanto foi assistido: a aula é concluída pelo botão do aluno ou quando o player avisa que o vídeo terminou.

## Requisitos

- RF-01: Página da aula com player, descrição e abas de materiais, notas e comentários.
- RF-02: O aluno marca e desmarca a aula como concluída por botão.
- RF-03: A aula é marcada como concluída automaticamente quando o player informa o fim do vídeo.
- RF-04: Progresso "X de Y aulas" e percentual por módulo e por curso.
- RF-05: Estante "Meus cursos" com filtros todos, em andamento, não iniciados e concluídos, busca, ordenação e modos grade e lista.
- RF-06: "Continuar de onde parou": o sistema lembra a última aula aberta por curso e a posição do vídeo quando o player a informa.
- RF-07: Navegação entre aulas (anterior e próxima) e lista do programa ao lado do player.
- RF-08: Página "Meu progresso" com um quadrado por aula de cada curso e o mapa de atividade dos últimos 12 meses.
- RF-09: Concluir 100% das aulas de um curso dispara a emissão do certificado ([015](015-certificados.md)) e os pontos de gamificação ([020](020-gamificacao.md)).
- RF-10: Seção "Aulas liberadas" com as aulas amostra.
- RNF-01: Página da aula (dados da API) em p95 < 300 ms.
- RNF-02: Estante com 200 cursos em p95 < 300 ms e no máximo 3 consultas.
- RNF-03: Marcar conclusão responde em p95 < 150 ms e a interface atualiza de forma otimista.
- RNF-04: A posição do vídeo é enviada no máximo a cada 15 s e ao sair da página.

## Comportamento

### Página da aula

- Cabeçalho: curso, módulo, título, duração, selo "Aula liberada" quando amostra.
- Player conforme `video_provider` ([009](009-catalogo-e-conteudo.md)): iframe do provedor, vídeo nativo ou botão "Abrir vídeo" para `link`.
- Para vídeo nativo (`file`): controles de reproduzir, voltar e avançar 10 s, volume, velocidade (0,5× a 2×), tela cheia e imagem sobre imagem. Para iframe, valem os controles do provedor.
- Abas:
  - **Sobre**: descrição da aula (Markdown sanitizado).
  - **Materiais**: links de apoio e ebooks vinculados à aula, cada um com "Reportar problema".
  - **Minhas notas**: anotações da aula ([016](016-anotacoes.md)).
  - **Comentários**: o tópico da aula no fórum ([017](017-forum.md)).
- Lateral: programa do curso com o estado de cada aula (concluída, atual, pendente) e o progresso do módulo.
- Rodapé: "Aula anterior", "Marcar como concluída" e "Próxima aula". A última aula do curso mostra "Concluir curso".
- Sem acesso: no lugar do player, o motivo ([010](010-direitos-de-acesso.md)) e a chamada à compra ou à assinatura.
- Vídeo que não carrega: mensagem com "Abrir em nova aba" e "Reportar problema" ([023](023-chamados-de-suporte.md)).

### Conclusão da aula

- **Botão**: alterna entre concluída e não concluída. Desmarcar é permitido a qualquer momento.
- **Fim do vídeo**: para os provedores que informam o fim (`youtube`, `vimeo`, `bunny`, `panda`, `file`), o classroom marca a aula como concluída ao receber o evento e mostra um aviso com "Desfazer" por 8 s. Provedor `link` nunca conclui sozinho.
- A conclusão é registrada uma vez por usuário e aula (`completed_at`); marcar de novo é idempotente.
- Desmarcar uma aula não cancela certificado já emitido nem devolve pontos, mas o curso deixa de contar como concluído na estante.
- Só é possível concluir aula a que o usuário tem acesso no momento. Aula amostra de curso que o aluno não possui pode ser concluída, mas não entra em nenhum cálculo de progresso de curso até ele ter o curso.
- Fonte da conclusão guardada em `completed_via` (`manual` | `video_end`), para análise.

### Progresso

- Base do cálculo: aulas publicadas do curso no momento da consulta.
- Progresso do módulo = aulas concluídas ÷ aulas publicadas do módulo; do curso, idem.
- Estado do curso para o aluno:

| Estado | Regra |
| --- | --- |
| Não iniciado | nenhuma aula concluída e nenhuma aula aberta |
| Em andamento | ao menos uma aula aberta ou concluída, e menos de 100% |
| Concluído | 100% das aulas publicadas concluídas |

- Aula nova publicada em curso já concluído: o curso volta a "em andamento" (por exemplo, 45 de 46), sem afetar o certificado já emitido.
- Aula despublicada sai do cálculo; se com isso o aluno chegar a 100%, o curso passa a concluído e o certificado é emitido.
- Ao atingir 100% pela primeira vez, o `classroom-api` enfileira `course.completed` ([005](005-worker-e-fila.md)), que emite o certificado, dá os pontos e notifica.
- "Atingir 100%" é a passagem de menos de 100% a 100% causada pela gravação (`PUT /lessons/{id}/progress`), conferida na mesma transação. A tarefa leva `unique_key = course.completed:<user_id>:<course_id>`; gravar de novo uma aula já concluída não é passagem e não enfileira nada. Desmarcar e marcar de novo a última aula é outra passagem e enfileira outra vez: os manipuladores são idempotentes (um certificado por aluno e curso, [015](015-certificados.md); pontos com chave própria, [020](020-gamificacao.md)).
- Despublicar ou excluir aula de curso publicado pode levar alunos a 100% sem gravação deles: a `admin-api` enfileira `course.completion_check` ([005](005-worker-e-fila.md)), que enfileira `course.completed` para cada um.

### Continuar de onde parou

- Abrir uma aula grava `last_opened_at`; por curso, a "aula atual" é a de `last_opened_at` mais recente.
- O botão "Continuar" do curso leva à aula atual se ela não estiver concluída; se estiver, à próxima não concluída na ordem do programa; se todas estiverem, à primeira aula.
- O envio ao sair da página usa `fetch` com `keepalive: true` e o cabeçalho `X-CSRF-Token`, como qualquer escrita; `navigator.sendBeacon` não serve, porque não envia cabeçalhos.
- `position_seconds` é gravado quando o player informa o tempo (vídeo nativo e provedores com API); ao reabrir, o player começa nessa posição, exceto se faltarem menos de 10 s para o fim.
- O início do classroom mostra "Continue assistindo" com até 3 cursos em andamento, do mais recente ao mais antigo.

### Estante "Meus cursos"

- Lista todo curso a que o aluno tem direito ativo ou já teve (com selo "acesso vencido"), mais os cursos `open` que ele abriu.
- Contadores no topo: total, em andamento, não iniciados, concluídos e horas de aula concluídas.
- Filtros com contagem: Todos, Em andamento, Não iniciados, Concluídos.
- Busca por título; ordenação por acesso mais recente (padrão), mais recentes no catálogo, título e progresso.
- Modos grade e lista; a escolha fica no navegador.
- Cada cartão: capa, título, nível, "X de Y aulas", barra de progresso, validade do acesso quando houver, e a ação ("Começar", "Continuar", "Rever", "Renovar acesso").
- Bloco "Comece por aqui" quando o aluno tem cursos e nenhum iniciado: destaca o de aquisição mais recente.
- Seção "Aulas liberadas": aulas amostra de cursos que o aluno não possui.
- Abas adicionais: "Meus ebooks" (ebooks com direito ativo, com botão de download) e "Certificados" ([015](015-certificados.md)).

### Meu progresso e mapa de atividade

- "Meu progresso": para cada curso iniciado, uma grade com um quadrado por aula (concluída ou não), agrupada por módulo, e o percentual.
- Mapa de atividade: 53 semanas × 7 dias, um quadrado por dia, com 5 intensidades. A contagem do dia soma aulas concluídas, tópicos e respostas no fórum e, quando a comunidade estiver ativa ([019](019-perfil-e-diretorio.md)), cases publicados e comentários.
- Os dias são calculados no fuso do usuário (`profiles.timezone`, declarado em [019](019-perfil-e-diretorio.md); quando nulo vale a configuração `school.timezone`, padrão `America/Sao_Paulo`, [031](031-infraestrutura-e-deploy.md)). Até a Fase 6, que cria `profiles.timezone`, vale `school.timezone` para todos; a função do núcleo que resolve o fuso do usuário é o único ponto que muda.
- O mapa do próprio usuário é sempre visível para ele; no perfil público, segue a preferência de privacidade ([019](019-perfil-e-diretorio.md)).
- A contagem diária é consolidada em `activity_days`, incrementada na mesma transação da ação.

### Casos de erro

| Situação | Resposta |
| --- | --- |
| Concluir aula sem acesso | `403` com o motivo |
| Aula despublicada ou inexistente | `404` |
| `position_seconds` negativo ou maior que a duração + 60 s | `422` |
| Curso `private` sem direito | `404` |

## Interfaces e contratos

`apps/classroom-api/openapi.yaml`, sob `/api/v1`:

- `GET /me/courses` (estante, com filtros, busca, ordenação e contadores)
- `GET /me/continue` (até 3 cursos em andamento)
- `GET /courses/{slug}/progress` (por módulo e aula)
- `GET /lessons/{id}` (conteúdo, vizinhas e estado do usuário)
- `PUT /lessons/{id}/progress` (`completed`, `completed_via`, `position_seconds`)
- `GET /me/progress` (grade por curso), `GET /me/activity` (mapa de 12 meses)
- `GET /me/ebooks`

`apps/admin-api/openapi.yaml`, sob `/api/v1`:

- `GET /users/{id}/progress` (admin, gerente; instrutor só nos próprios cursos)
- `GET /courses/{id}/progress-summary` (alunos por faixa de progresso e taxa de conclusão)
- `GET /courses/{id}/students` (alunos com acesso ao curso, com nome, avatar, progresso e última atividade; `progress.view`, instrutor só nos próprios cursos; é o `users.list` do instrutor, [008](008-papeis-e-permissoes.md))

Tarefas da fila: `course.completed`, `course.completion_check`.

## Dados

Dono (escrita): `classroom-api`.

| Tabela | Campos principais |
| --- | --- |
| `lesson_progress` | `user_id`, `lesson_id` (chave composta), `course_id`, `first_opened_at`, `last_opened_at`, `position_seconds`, `completed_at`, `completed_via` |
| `activity_days` | `user_id`, `day` (data no fuso do usuário), `lessons_completed`, `forum_posts`, `community_actions`, `total` |

- `lesson_progress.course_id` é redundante de propósito: permite calcular a estante sem junções com módulos.
- Conclusão do curso é derivada (não há tabela de matrícula): o registro durável da conclusão é o certificado ([015](015-certificados.md)).
- Retenção: progresso e atividade são mantidos enquanto a conta existir, mesmo após o fim do acesso; apagados na exclusão da conta ([030](030-lgpd.md)).

### O que fica para outras fases

- Aba **Comentários** e o tópico da aula: com o fórum ([017](017-forum.md), Fase 4); até lá a aba não aparece.
- "Reportar problema": com os chamados ([023](023-chamados-de-suporte.md), Fase 4).
- Pontos de `course.completed` e de aula concluída: com a gamificação ([020](020-gamificacao.md), Fase 6).
- Mapa de atividade: na Fase 2 conta só aulas concluídas; `forum_posts` passa a contar na Fase 4 e `community_actions` na Fase 6.

## Critérios de aceite

- [ ] Marcar e desmarcar a aula pelo botão atualiza o progresso do módulo e do curso.
- [ ] Vídeo nativo que chega ao fim marca a aula e oferece "Desfazer".
- [ ] Aula com provedor `link` só é concluída pelo botão.
- [ ] Concluir a última aula enfileira `course.completed` exatamente uma vez.
- [ ] Publicar aula nova em curso concluído muda o estado para "em andamento" sem invalidar o certificado.
- [ ] "Continuar" leva à aula certa nos três casos (atual pendente, atual concluída, tudo concluído).
- [ ] Reabrir uma aula retoma o vídeo nativo na posição gravada.
- [ ] Filtros e contadores da estante batem com o progresso real.
- [ ] Curso com acesso vencido aparece na estante com o selo e o progresso preservado.
- [ ] Mapa de atividade conta a ação no dia certo para um usuário em fuso diferente de UTC.
- [ ] Concluir aula sem acesso responde `403`.

## Fora de escopo

- Conclusão por percentual assistido; bloqueio de avanço sem concluir a aula anterior.
- Questionários, provas e notas.
- Legendas e transcrições geridas pelo sistema.
- Download de vídeo e uso sem conexão.
- Relatórios de tempo assistido por aluno.

## Decisões relacionadas

- [0006](decisions/0006-conteudo-por-link-externo.md)
- [0017](decisions/0017-escopo-do-mvp.md)
- [0001](decisions/0001-decisoes-iniciais.md)
