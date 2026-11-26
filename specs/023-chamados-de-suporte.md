# 023 — Chamados de suporte

Status: aprovada
Depende de: 000, 001, 003, 004, 008, 009, 011, 024, 028

## Contexto

O chamado é o canal oficial entre o aluno e a escola: dúvida, problema de acesso ou de pagamento, pedido de reembolso, bug, sugestão e aviso de link quebrado. Qualquer cadastrado com acesso à conta pode abrir um, inclusive quem não comprou nada e por isso não pode usar mensagens diretas. Suspensão `full` bloqueia também o suporte, como toda rota privada.

## Requisitos

- RF-01: Qualquer usuário logado e sem suspensão `full` abre chamado, com tipo, assunto e descrição; acompanha os próprios chamados e responde neles.
- RF-02: A equipe (`manager`, `admin`) vê todos os chamados, responde, muda o estado, atribui a um membro da equipe e escreve notas internas invisíveis ao aluno.
- RF-03: O `instructor` vê e responde apenas chamados de conteúdo (inclusive "link quebrado") ligados aos próprios cursos; chamados de pagamento, reembolso e conta são só de `manager` e `admin` ([008](008-papeis-e-permissoes.md)).
- RF-04: Botão "Reportar problema" no player e na página do ebook abre um chamado `broken_link` já preenchido com o produto, a aula e o link.
- RF-05: O chamado pode ser ligado a um pedido, a um curso ou a uma aula.
- RF-06: Cada resposta da equipe notifica o aluno na plataforma e por e-mail; cada resposta do aluno notifica o responsável (ou a equipe, se não houver).
- RF-07: A tela do admin lista chamados com filtros por estado, tipo, responsável e curso, e mostra o tempo desde a última resposta do aluno.
- RNF-01: Limite de 5 chamados abertos por dia por usuário e 30 mensagens por hora por chamado.
- RNF-02: Assunto com 5 a 150 caracteres; mensagem com até 10.000 caracteres.
- RNF-03: Chamado `resolved` sem resposta do aluno é fechado automaticamente após 7 dias (ajustável em `settings`).

## Comportamento

### Tipos

| `kind` | Uso |
| --- | --- |
| `question` | Dúvida geral |
| `access` | Não consigo acessar um conteúdo |
| `payment` | Problema com pagamento ou assinatura |
| `refund` | Pedido de reembolso (o estorno em si é feito pelo admin, ver [011](011-vendas-e-checkout.md)) |
| `broken_link` | Vídeo, arquivo ou ebook indisponível |
| `bug` | Erro na plataforma |
| `suggestion` | Sugestão |
| `privacy` | Pedido sobre dados pessoais ([030](030-lgpd.md)) |

### Estados

| Estado | Significado | Transições |
| --- | --- | --- |
| `open` | Aguardando a equipe | → `pending`, `resolved`, `closed` |
| `pending` | Aguardando o aluno | → `open` (ao responder), `resolved`, `closed` |
| `resolved` | Equipe considera resolvido | → `open` (aluno responde em até 7 dias), `closed` (automático ou manual) |
| `closed` | Encerrado; não aceita respostas | o aluno abre novo chamado citando o anterior |

- Resposta da equipe muda `open` → `pending`; resposta do aluno muda `pending` ou `resolved` → `open`.
- O aluno pode marcar o próprio chamado como resolvido.
- Chamados `refund` e `privacy` só podem ser resolvidos pelo `admin`.

### Regras

- Mensagens em texto com Markdown saneado (regras de [017](017-forum.md)); sem anexos enviados, aceitam links.
- Deduplicação de `broken_link`: se já existe chamado desse tipo `open` ou `pending` para a mesma aula ou ebook, o novo relato é somado a ele (contador "N alunos relataram") e o aluno passa a acompanhá-lo, sem ver as mensagens dos outros.
- Notas internas (`internal = true`) nunca saem pela `classroom-api`.
- Atribuição: opcional; sem responsável, todos os `manager` e `admin` são notificados da abertura.
- O chamado mostra à equipe o contexto do aluno: produtos, pedidos recentes e estado da conta, sem a senha.
- Toda mudança de estado e atribuição vai para a auditoria ([028](028-auditoria.md)).
- A tarefa diária `ticket.autoclose` do worker ([005](005-worker-e-fila.md)) fecha os `resolved` vencidos.
- Suspensão `full` derruba a sessão e bloqueia abrir, listar, ler e responder chamados pelo classroom. Não existe link assinado, token anônimo, rota pública ou sessão exclusiva de suporte; um link recebido por e-mail não restaura acesso. Ao fim ou à retirada da suspensão, o acesso normal volta. Suspensão `posting` não impede chamados.

### Casos de erro

| Situação | Resposta |
| --- | --- |
| Responder em chamado `closed` | 409 `ticket_closed` |
| Ver chamado de terceiros | 404 |
| Instrutor em chamado sem relação com seus cursos | 404 |
| Limite excedido | 429 com `Retry-After` |
| Conta com suspensão `full` | Autenticação/sessão recusada segundo [007](007-contas-e-autenticacao.md), inclusive por link de e-mail |

## Interfaces e contratos

- `apps/classroom-api/openapi.yaml`: `GET /tickets`, `POST /tickets`, `GET /tickets/{id}`, `POST /tickets/{id}/messages`, `POST /tickets/{id}/resolve`, `POST /lessons/{id}/report-link`, `POST /ebooks/{id}/report-link`.
- `apps/admin-api/openapi.yaml`: `GET /tickets`, `GET /tickets/{id}`, `POST /tickets/{id}/messages` (com `internal`), `PATCH /tickets/{id}` (estado, responsável, tipo).
- Ferramentas MCP de leitura e resposta em [027](027-mcp.md).

## Dados

| Tabela | Campos principais | Dono (escrita) |
| --- | --- | --- |
| `tickets` | `number` (sequencial legível), `user_id`, `kind`, `subject`, `status`, `assignee_id`, `order_id`, `course_id`, `lesson_id`, `ebook_id`, `reports_count`, `last_user_message_at`, `resolved_at`, `closed_at` | `classroom-api` (abertura, resolução pelo aluno), `admin-api` (estado, atribuição), `worker` (fechamento automático) |
| `ticket_messages` | `ticket_id`, `author_id`, `body_md`, `body_html`, `internal`, `created_at` | `classroom-api` (aluno), `admin-api` (equipe) |
| `ticket_followers` | `ticket_id`, `user_id` (relatos somados de `broken_link`) | `classroom-api` |

Retenção: permanente enquanto a conta existir. Na exclusão de conta os chamados são anonimizados ([030](030-lgpd.md)); chamados `payment` e `refund` ligados a pedidos seguem o prazo fiscal do pedido.

## Critérios de aceite

- [ ] Usuário sem nenhuma compra consegue abrir e acompanhar um chamado.
- [ ] Resposta da equipe muda o estado para `pending` e gera notificação e e-mail ao aluno.
- [ ] Nota interna não aparece em nenhuma resposta da `classroom-api`.
- [ ] Dois alunos reportando o mesmo link geram um só chamado com contador 2.
- [ ] `manager` não consegue resolver chamado `refund`; `admin` consegue.
- [ ] Instrutor só enxerga chamados dos próprios cursos.
- [ ] Chamado `resolved` há mais de 7 dias é fechado pela tarefa diária.
- [ ] Sexto chamado do dia retorna 429.
- [ ] Suspensão `full` impede abrir e responder chamados, inclusive por link de e-mail; ao fim da suspensão o acesso volta, e `posting` não bloqueia o suporte.

## Fora de escopo

- Anexos enviados, SLA com alertas, pesquisa de satisfação, base de conhecimento, abertura ou resposta por e-mail/link sem sessão, chat ao vivo.

## Decisões relacionadas

- [0017 — Escopo do MVP](decisions/0017-escopo-do-mvp.md)
- [0006 — Conteúdo por link externo](decisions/0006-conteudo-por-link-externo.md)
- [0001 — Decisões iniciais](decisions/0001-decisoes-iniciais.md) (F1-15, F1-17, A-05)
