# 010 — Direitos de acesso

Status: aprovada
Depende de: 000, 001, 008, 009

## Contexto

"O aluno pode ver isto?" é a pergunta mais repetida do sistema e a que mais custa se respondida errado. Esta spec define um único modelo — o direito de acesso (`entitlements`) — e um único lugar onde a regra mora: `packages/core`, usado pelas duas APIs e pelo worker ([0004](decisions/0004-duas-apis-um-banco.md)).

Um direito nasce de quatro fontes: pedido pago, assinatura ativa, concessão manual e cascata (um pacote libera seus cursos e ebooks; um curso libera os ebooks vinculados a ele e às suas aulas). Reembolso, fim de plano e revogação manual desfazem a cascata, salvo quando outra fonte ainda cobre o item.

## Requisitos

- RF-01: Todo acesso a conteúdo pago ou privado é decidido por direitos ativos em `entitlements`.
- RF-02: Conceder o direito a um pacote concede, em cascata, o direito a cada curso e ebook do pacote.
- RF-03: Conceder o direito a um curso concede, em cascata, o direito aos ebooks vinculados ao curso e às suas aulas.
- RF-04: Revogar um direito revoga toda a sua cascata, e só ela.
- RF-05: Um item coberto por mais de uma fonte permanece acessível enquanto ao menos um direito seu estiver ativo.
- RF-06: Admin e gerente concedem e revogam acesso manualmente, com motivo obrigatório e validade opcional.
- RF-07: Mudança na composição de pacote, nos vínculos de ebook ou nos itens de plano recalcula a cascata dos direitos existentes.
- RF-08: A função de verificação de acesso é a mesma para `admin-api`, `classroom-api`, `worker` e MCP.
- RF-09: Direito vencido deixa de valer no instante de `expires_at`, sem depender de tarefa agendada.
- RNF-01: Verificar o acesso a uma aula custa no máximo 1 consulta ao banco e responde em p95 < 10 ms.
- RNF-02: Conceder ou revogar um direito com cascata de até 200 itens conclui em uma transação em menos de 500 ms.
- RNF-03: Cobertura de testes de linhas ≥ 80% no módulo de direitos de `packages/core` ([032](032-verificacao-e-ci.md)).

## Comportamento

### Direito ativo

Um direito está ativo quando: `revoked_at` é nulo, `starts_at` ≤ agora e (`expires_at` é nulo ou `expires_at` > agora).

### Fontes

| `source` | `source_id` aponta para | Quem cria | Validade |
| --- | --- | --- | --- |
| `order` | `order_items.id` | worker, ao confirmar o pagamento | `access_days` do produto no momento da compra, ou vitalício |
| `subscription` | `subscriptions.id` | worker, ao ativar ou renovar | fim do período pago + carência ([012](012-assinaturas.md)) |
| `grant` | `users.id` de quem concedeu | admin ou gerente | informada na concessão, ou vitalício |
| `cascade` | igual ao do direito pai | derivado automaticamente | herda a do pai |

Direitos de fonte `order`, `subscription` e `grant` são **raízes**. Direitos `cascade` são **derivados** e sempre têm `parent_entitlement_id`.

### Algoritmo de concessão

`grant(user, product, source, source_id, starts_at, expires_at)`, em uma transação:

1. Criar o direito raiz para o produto.
2. Expandir os filhos do produto:
   - pacote → cada curso e ebook em `bundle_items`;
   - curso → cada ebook em `product_ebooks` com alvo no curso ou em qualquer aula do curso;
   - ebook → nenhum.
3. Para cada filho, criar um direito `cascade` com `parent_entitlement_id` = direito de origem, mesmo `source_id`, mesmo `starts_at` e mesmo `expires_at`; repetir o passo 2 para o filho (um curso vindo de pacote expande seus ebooks).
4. A profundidade máxima é 2 (pacote → curso → ebook). Um ebook alcançado por dois caminhos dentro da mesma raiz gera um único direito derivado (o primeiro caminho encontrado).
5. Publicar a notificação "acesso liberado" ([024](024-notificacoes-e-email.md)) e gravar auditoria quando a fonte for `grant`.

A concessão é idempotente por (`user_id`, `source`, `source_id`, `product_type`, `product_id`): repetir a chamada não duplica direitos (protege contra webhook reprocessado).

### Algoritmo de revogação

`revoke(entitlement, reason)`, em uma transação:

1. Marcar `revoked_at` = agora e `revoke_reason` no direito e em todos os seus descendentes (por `parent_entitlement_id`, recursivamente).
2. Não tocar em nenhum outro direito do usuário.

Como cada raiz tem a própria árvore, a regra "salvo se outro direito ainda cobrir o item" (P-01) sai de graça: se o aluno comprou o curso avulso e também o tem por um pacote, reembolsar o pacote revoga só a árvore do pacote; o direito da compra avulsa segue ativo.

Motivos (`revoke_reason`): `refund`, `chargeback`, `subscription_ended`, `manual`, `recalculation`, `account_deleted`.

Revogar não apaga progresso, anotações, certificados já emitidos nem postagens: o aluno perde o acesso ao conteúdo, não o histórico. Se voltar a ter direito, retoma de onde parou.

### Renovação e extensão

- Renovação de assinatura: o worker atualiza `expires_at` do direito raiz e de toda a sua árvore; não cria direitos novos.
- Compra repetida de produto com `access_days`: cria nova raiz com `starts_at` = agora; o acesso efetivo vai até o maior `expires_at` ativo. A cesta avisa quando o aluno já tem acesso vitalício ao item e impede a compra ([011](011-vendas-e-checkout.md)).

### Recalcular a cascata

Disparado pelo `admin-api` como tarefa do worker ([005](005-worker-e-fila.md)) quando muda `bundle_items`, `product_ebooks` ou `plan_items`:

- Item acrescentado: para cada direito ativo do produto pai, criar o derivado que falta.
- Item removido: revogar, com motivo `recalculation`, os derivados daquele item cujo pai é o produto alterado.
- Plano "tudo, inclusive futuros": ver [012](012-assinaturas.md); a publicação de um produto novo dispara o mesmo recálculo para as assinaturas ativas desses planos.

A tarefa é idempotente e processa em lotes de 500 direitos.

### Verificação de acesso

`canAccess(user, target)` em `packages/core`. A ordem de avaliação:

| Alvo | Acesso permitido quando |
| --- | --- |
| Aula | (a) o usuário é da equipe com permissão sobre o curso; ou (b) a aula e o curso estão publicados e: a aula é amostra, ou o curso é `open`, ou há direito ativo ao curso |
| Curso (conteúdo) | equipe; ou curso publicado e (`open` ou direito ativo ao curso) |
| Curso (programa) | curso publicado e não `private`; ou direito ativo; ou equipe |
| Ebook (download) | equipe; ou ebook publicado e (`open` ou direito ativo ao ebook) |
| Pacote | não tem conteúdo próprio; a página mostra os itens e o estado de cada um |

Regras gerais:

- Usuário não logado nunca acessa conteúdo, só a vitrine ([009](009-catalogo-e-conteudo.md)).
- Usuário suspenso ou com e-mail não confirmado segue as regras de [007](007-contas-e-autenticacao.md): suspenso não acessa nada; não confirmado acessa o que já tem, mas não compra nem posta.
- Equipe: admin e gerente acessam tudo; instrutor acessa os cursos e ebooks de sua autoria e, para os demais, vale a regra de aluno.
- Produto despublicado ou arquivado: nega o acesso de aluno, mesmo com direito ativo, até ser republicado.
- "Acesso ativo" (usado por fórum, mensagens diretas e eventos) = o usuário tem ao menos um direito ativo de qualquer fonte, ou é da equipe. Curso `open` não conta como acesso ativo.

A resposta de `canAccess` traz o motivo da negativa (`not_authenticated`, `suspended`, `no_entitlement`, `expired`, `unpublished`), usado pelo classroom para escolher a mensagem e a chamada à compra.

### Concessão manual

- Admin e gerente concedem a qualquer usuário o direito a um curso, pacote ou ebook, com motivo (texto, obrigatório) e `expires_at` opcional.
- Revogação manual só atinge raízes de fonte `grant`. Direito vindo de pedido só é revogado por reembolso ([011](011-vendas-e-checkout.md)); de assinatura, pelo ciclo da assinatura ([012](012-assinaturas.md)).
- Instrutor não concede nem revoga.
- Concessão e revogação manuais gravam auditoria ([028](028-auditoria.md)) e estão disponíveis no MCP ([027](027-mcp.md)).

### Casos de borda

| Caso | Resultado |
| --- | --- |
| Curso comprado avulso e também recebido por pacote; pacote reembolsado | Curso continua acessível pela raiz `order` do curso |
| Ebook vinculado a duas aulas do mesmo curso | Um só direito derivado sob o curso |
| Ebook recebido por curso A e por curso B; curso A revogado | Ebook segue ativo pelo derivado de B |
| Assinatura vence e o aluno tem concessão manual do mesmo curso | Curso segue ativo pela raiz `grant` |
| Ebook removido do vínculo com o curso | Derivados daquele ebook sob o curso são revogados (`recalculation`); quem comprou o ebook avulso não é afetado |
| Direito com `access_days` vence | Deixa de ser ativo no instante de `expires_at`; nada é gravado; a estante mostra "acesso vencido" |
| Compra de pacote por quem já tem um dos cursos vitalício | Permitida; o aluno fica com duas raízes para o curso |
| Reembolso parcial de pedido com dois itens | Revoga só a raiz do item reembolsado |
| Conta excluída (LGPD) | Todos os direitos revogados com `account_deleted` ([030](030-lgpd.md)) |

## Interfaces e contratos

Funções de `packages/core` (única implementação): `grant`, `revoke`, `extend`, `recalculate`, `canAccess`, `hasActiveAccess`, `listEntitlements`.

`apps/admin-api/openapi.yaml`, sob `/api/v1`:

- `GET /users/{id}/entitlements` (árvore de direitos, com fonte e estado)
- `POST /users/{id}/entitlements` (concessão manual: `product_type`, `product_id`, `expires_at`, `reason`)
- `POST /entitlements/{id}/revoke` (só raiz `grant`; `reason`)
- `GET /products/{type}/{id}/entitlements` (quem tem acesso)

`apps/classroom-api/openapi.yaml`, sob `/api/v1`:

- `GET /me/entitlements` (o que o aluno tem, com validade e origem; alimenta "Minha assinatura" e a estante)

## Dados

Dono (escrita): `worker` para as raízes `order` e `subscription`; `admin-api` para a raiz `grant` e para disparar recálculo. Os derivados `cascade` são gravados por quem grava a raiz, na mesma transação (passo 3 do algoritmo de concessão), e pelo `worker` no recálculo (`entitlement.recompute`). Toda escrita passa pelas funções de `packages/core`.

`entitlements`:

| Campo | Descrição |
| --- | --- |
| `id` | UUID v7 |
| `user_id` | dono do direito |
| `product_type`, `product_id` | `course` \| `bundle` \| `ebook` e o identificador |
| `source` | `order` \| `subscription` \| `grant` \| `cascade` |
| `source_id` | conforme a tabela de fontes |
| `parent_entitlement_id` | nulo nas raízes |
| `starts_at`, `expires_at` | `expires_at` nulo = vitalício |
| `revoked_at`, `revoke_reason` | preenchidos na revogação |
| `granted_reason` | texto do motivo, só em `grant` |
| `created_at` | criação |

Índices: (`user_id`, `product_type`, `product_id`) para a verificação; (`parent_entitlement_id`); (`source`, `source_id`); único parcial em (`user_id`, `source`, `source_id`, `product_type`, `product_id`, `parent_entitlement_id`) para a idempotência.

Retenção: direitos não são apagados enquanto a conta existir (são o histórico de acesso); na exclusão de conta são apagados ([030](030-lgpd.md)); o registro de quem concedeu ou revogou permanece na auditoria.

### Entrega por fase

- Fase 2: `grant`, `revoke`, `recalculate` (mudança em `bundle_items` e `product_ebooks`), `canAccess`, `hasActiveAccess` e `listEntitlements`; concessão manual pela `admin-api`; `GET /me/entitlements`. A notificação "acesso liberado" sai só por e-mail (`access.granted`, grupo `purchase`, por `enqueueEmail`), até a central de notificações ([024](024-notificacoes-e-email.md), Fase 4).
- Fase 3: fontes `order` e `subscription`, `extend`, `plan_items` e o plano "tudo, inclusive futuros".
- Fase 5: concessão e revogação pelo MCP.

## Critérios de aceite

- [ ] Comprar pacote com 2 cursos e 1 ebook cria 1 raiz e os derivados corretos, incluindo os ebooks vinculados aos cursos.
- [ ] Reembolsar o pacote revoga toda a árvore e nada além dela.
- [ ] Curso com raiz `order` e derivado de pacote permanece acessível após reembolso do pacote.
- [ ] Reprocessar o mesmo webhook de pagamento não duplica direitos.
- [ ] Acrescentar um ebook ao curso libera o ebook a quem já tem o curso; remover revoga só os derivados daquele vínculo.
- [ ] Direito com `expires_at` no passado nega o acesso sem nenhuma tarefa ter rodado.
- [ ] `canAccess` retorna o motivo correto para cada negativa.
- [ ] Instrutor acessa conteúdo do próprio curso e recebe `403` no de outro sem direito.
- [ ] Gerente concede e revoga concessão manual; a tentativa de revogar raiz `order` responde `409`.
- [ ] Verificação de acesso a uma aula usa 1 consulta (teste com contador de consultas).
- [ ] Cobertura ≥ 80% no módulo de direitos.

## Fora de escopo

- Direito por módulo ou por aula avulsa (o direito é sempre ao produto).
- Compartilhamento de acesso entre contas e licenças em lote para empresas.
- Limite de dispositivos ou de sessões simultâneas por direito.
- Pausar um direito e devolver os dias depois.

## Decisões relacionadas

- [0004](decisions/0004-duas-apis-um-banco.md)
- [0005](decisions/0005-modelo-de-venda-e-mercado-pago.md)
- [0001](decisions/0001-decisoes-iniciais.md)
