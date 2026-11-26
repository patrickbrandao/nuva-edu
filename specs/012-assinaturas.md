# 012 — Assinaturas

Status: aprovada
Depende de: 000, 001, 007, 009, 010, 011, 013

## Contexto

Além da compra avulsa, a escola vende planos recorrentes: enquanto o plano está pago, o aluno acessa o conjunto de produtos do plano. O admin cria vários planos e escolhe o que cada um libera, com a opção "tudo, inclusive lançamentos futuros". O acesso por assinatura some quando ela vence; o que foi comprado avulso permanece ([010](010-direitos-de-acesso.md)).

A assinatura não passa pela cesta: tem checkout próprio. A cobrança recorrente é feita pelo provedor de pagamento ([013](013-pagamentos-mercado-pago.md)).

## Requisitos

- RF-01: O admin cria, edita, ativa e desativa planos, com preço e periodicidade mensal ou anual.
- RF-02: Cada plano lista os cursos, pacotes e ebooks que libera, ou é marcado como "tudo, inclusive futuros".
- RF-03: O aluno assina um plano em checkout próprio, fora da cesta.
- RF-04: A assinatura ativa concede direitos de fonte `subscription` aos itens do plano, com cascata.
- RF-05: Cobrança recusada mantém o acesso por 3 dias de carência; sem pagamento nesse prazo, a assinatura é suspensa e o acesso revogado.
- RF-06: O aluno cancela pela própria conta; o acesso segue até o fim do período já pago.
- RF-07: Cupom vale só na primeira cobrança da assinatura.
- RF-08: O aluno vê plano, estado, próxima cobrança e histórico em "Minha assinatura".
- RF-09: Admin e gerente consultam assinaturas; só o admin cancela a assinatura de um aluno e reembolsa cobranças.
- RNF-01: Renovação confirmada estende o acesso em até 10 s após o webhook (p95).
- RNF-02: Nenhuma assinatura fica com estado divergente do provedor por mais de 6 h (reconciliação).
- RNF-03: Publicar um produto novo propaga o acesso aos assinantes de planos "tudo" em até 5 min para 10.000 assinaturas ativas.

## Comportamento

### Planos

| Campo | Regra |
| --- | --- |
| `title`, `description` | texto de vitrine |
| `interval` | `month` ou `year` |
| `price_cents` | preço por período, maior que zero |
| `includes_all` | verdadeiro = todo produto publicado `paid` ou `open`, atual e futuro |
| `includes_private` | só com `includes_all`; inclui também os `private` (padrão falso) |
| `plan_items` | lista de cursos, pacotes e ebooks, usada quando `includes_all` é falso |
| `active` | plano inativo sai da vitrine e não aceita novas assinaturas; as existentes continuam |
| `position` | ordem na vitrine |

- Mesmo conteúdo em duas periodicidades = dois planos (mensal e anual); a vitrine os agrupa por `group_key` para mostrar a alternância mensal/anual.
- Alterar o preço de um plano vale para novas assinaturas; as existentes mantêm o preço contratado (`price_cents` copiado para a assinatura).
- Alterar os itens de um plano recalcula os direitos das assinaturas ativas ([010](010-direitos-de-acesso.md)).
- Plano com assinaturas não pode ser excluído, só desativado.

### Assinar

1. O aluno logado, com e-mail confirmado, escolhe o plano na vitrine.
2. Informa nome e CPF/CNPJ se ainda não tem ([011](011-vendas-e-checkout.md)) e, opcionalmente, um cupom com `applies_to` contendo `subscriptions`.
3. O `classroom-api` cria a assinatura em `pending` e o checkout recorrente no provedor.
4. Com a primeira cobrança aprovada, o worker ativa a assinatura e concede os direitos.

Regras:

- Um usuário pode ter mais de uma assinatura ativa, desde que de planos diferentes; assinar duas vezes o mesmo plano é recusado.
- Trocar de plano no MVP = cancelar o atual e assinar outro; não há cálculo proporcional.
- Assinatura `pending` sem pagamento em 30 min vira `expired`.
- O aluno pode cancelar a própria assinatura `pending` antes dos 30 min: ela vira `expired` e o mesmo plano pode ser assinado de novo.
- `POST /api/v1/subscriptions` aceita `Idempotency-Key` ([004](004-classroom-api.md)): repetir com o mesmo plano e cupom em até 24 h devolve a mesma assinatura e o mesmo `checkoutUrl`, sem segunda adesão no provedor; reutilizar a chave com corpo diferente responde `422` (`idempotency_key_reuse`).

### Ciclo de vida

```
pending ──> active ──> past_due ──> suspended ──> ended
   │           │           └──(pagou)──> active
   │           └──> canceling ──(fim do período)──> ended
   └──> expired
```

| Estado | Significado | Acesso |
| --- | --- | --- |
| `pending` | aguardando a primeira cobrança | não |
| `active` | em dia | sim |
| `past_due` | cobrança recusada, em carência | sim, até o fim da carência |
| `suspended` | carência vencida sem pagamento | não |
| `canceling` | cancelada pelo aluno ou admin, período pago em curso | sim, até `current_period_end` |
| `ended` | encerrada | não |
| `expired` | nunca foi paga, inclusive a `pending` cancelada pelo aluno | não |

Transições e efeitos:

- **Ativação** (`pending` → `active`): define `current_period_start` e `current_period_end`; para cada item do plano, `grant` com fonte `subscription`, `source_id` = assinatura e `expires_at` = `current_period_end` + carência.
- **Renovação** (cobrança aprovada): avança o período; `extend` atualiza `expires_at` de todas as raízes e derivados da assinatura; registra a cobrança em `payments`.
- **Cobrança recusada** (`active` → `past_due`): define `grace_until` = data da recusa + 3 dias (`NUVA_SUBSCRIPTION_GRACE_DAYS`); notifica e envia e-mail com o link para regularizar; o provedor segue tentando conforme a política dele.
- **Regularização** (`past_due` → `active`): como renovação.
- **Fim da carência** (`past_due` → `suspended`): `revoke` de todos os direitos da assinatura com motivo `subscription_ended`; notifica. O worker verifica a cada 15 min.
- **Pagamento após suspensão** (`suspended` → `active`): novo período a partir do pagamento; direitos concedidos de novo.
- **Suspensa há 30 dias** (`suspended` → `ended`): cancela a recorrência no provedor.
- **Cancelamento pelo aluno** (`pending` → `expired`; `active` ou `past_due` → `canceling`): em `pending`, cancela a adesão no provedor na hora e libera assinar o mesmo plano de novo, sem esperar os 30 min; em `active` ou `past_due`, cancela a recorrência no provedor na hora, e o acesso segue até `current_period_end`, sem carência adicional; ao fim, `ended` e direitos expirados naturalmente pelo `expires_at`, ajustado no cancelamento para `current_period_end`. Em `past_due`, o cancelamento encerra a carência. O aluno não cancela `suspended`.
- **Cancelamento pelo admin** (`active` ou `past_due` → `canceling`; `suspended` → `ended`): mesma regra do aluno para as assinaturas em dia ou em carência; em `suspended`, encerra na hora e cancela a recorrência no provedor, sem esperar os 30 dias, com o motivo registrado na assinatura e na auditoria ([028](028-auditoria.md)).
- Desfazer o cancelamento antes do fim do período não é oferecido no MVP: o aluno assina de novo.

Como o `expires_at` do direito é sempre `current_period_end` + carência, o acesso cai sozinho mesmo que o worker esteja parado; o worker só confirma o estado ([010](010-direitos-de-acesso.md), RF-09).

### Planos "tudo, inclusive futuros"

- Na ativação, concede direito a cada produto publicado elegível naquele instante.
- Publicar um produto elegível depois dispara o recálculo, que concede o direito a todas as assinaturas ativas desses planos.
- Despublicar não revoga; o produto só deixa de ser acessível ([010](010-direitos-de-acesso.md)).
- Pacotes entram como pacote (com cascata), além dos cursos e ebooks avulsos.

### Cupom na assinatura

- Aplica-se apenas à primeira cobrança; as seguintes são pelo preço cheio do plano.
- `percent` reduz a primeira cobrança; `fixed` é limitado ao valor dela. Cupom de 100% é aceito: a primeira cobrança é zero e a recorrência começa no período seguinte.
- O uso é contabilizado na ativação.

### Reembolso de cobrança

- Só o admin, na tela da assinatura, por cobrança ([011](011-vendas-e-checkout.md), mesmo fluxo de `refunds`).
- Reembolsar **por inteiro** a cobrança do período em curso encerra a assinatura na hora (`ended`) e revoga os direitos com motivo `refund`.
- Reembolso **parcial** da cobrança do período em curso devolve o valor e não altera o estado: a assinatura segue ativa até o fim do período pago.
- Reembolsar cobrança de período passado não altera o estado atual, qualquer que seja o valor.

### Convivência com compra avulsa

- A cesta avisa quando o item já é coberto por uma assinatura ativa, mas permite comprar (o avulso sobrevive ao fim do plano).
- Progresso, anotações e certificados conquistados durante a assinatura permanecem após o fim dela.
- Para fórum, mensagens e eventos, assinatura `active`, `past_due` ou `canceling` conta como acesso ativo.

### Casos de erro

| Situação | Resposta |
| --- | --- |
| Plano inativo ou inexistente | `404` |
| Já assina o mesmo plano | `409` |
| Cupom sem `subscriptions` em `applies_to` | `422` |
| E-mail não confirmado | `403` |
| Provedor indisponível | `503`; a assinatura não é criada |
| Cancelar assinatura `canceling`, `ended` ou `expired`; aluno cancelando `suspended` | `409` |
| Reembolsar cobrança que não está aprovada ou já reembolsada por inteiro | `409` |
| Reembolso acima do saldo não reembolsado da cobrança | `422` |
| Gerente tentando cancelar assinatura de aluno ou criar plano | `403` |

## Interfaces e contratos

`apps/classroom-api/openapi.yaml`, sob `/api/v1`:

- `GET /plans` (vitrine, sem login)
- `POST /subscriptions` (`plan_id`, `coupon_code`; devolve a URL de checkout)
- `GET /me/subscriptions`, `GET /me/subscriptions/{id}`, `POST /me/subscriptions/{id}/cancel`

`apps/admin-api/openapi.yaml`, sob `/api/v1`:

- `GET|POST /plans`, `GET|PATCH /plans/{id}`, `PUT /plans/{id}/items`
- `GET /subscriptions`, `GET /subscriptions/{id}`, `POST /subscriptions/{id}/cancel` (admin)
- `POST /subscriptions/{id}/payments/{paymentId}/refund` (admin)

## Dados

Dono (escrita): `admin-api` para planos; `classroom-api` para criar e cancelar a assinatura; `worker` para estado, períodos e direitos.

| Tabela | Campos principais |
| --- | --- |
| `plans` | `id`, `slug`, `group_key`, `title`, `description`, `interval`, `price_cents`, `includes_all`, `includes_private`, `active`, `position`, `provider_plan_id`, `created_at`, `updated_at` |
| `plan_items` | `plan_id`, `product_type`, `product_id` |
| `subscriptions` | `id`, `user_id`, `plan_id`, `status`, `price_cents`, `currency`, `coupon_id`, `provider`, `provider_subscription_id`, `current_period_start`, `current_period_end`, `grace_until`, `canceled_at`, `cancel_reason`, `ended_at`, `created_at` |

Cobranças ficam em `payments` com `subscription_id` ([013](013-pagamentos-mercado-pago.md)).

Retenção: assinaturas e cobranças seguem o prazo fiscal de vendas ([011](011-vendas-e-checkout.md)).

## Critérios de aceite

- [ ] Assinar plano com lista de itens libera exatamente esses itens e suas cascatas.
- [ ] Renovação estende `expires_at` sem criar direitos novos.
- [ ] Cobrança recusada: acesso mantido por 3 dias; no quarto, assinatura `suspended` e acesso negado.
- [ ] Com o worker parado, o acesso cai sozinho ao passar de `expires_at`.
- [ ] Cancelar mantém o acesso até o fim do período pago e encerra depois.
- [ ] Cancelar a assinatura `pending` a leva a `expired` e libera assinar o mesmo plano de novo.
- [ ] Admin cancelando `suspended` encerra na hora e cancela a recorrência.
- [ ] Curso comprado avulso continua acessível após o fim da assinatura que também o cobria.
- [ ] Plano "tudo": publicar um curso novo libera-o aos assinantes ativos.
- [ ] Cupom de assinatura reduz só a primeira cobrança.
- [ ] Alterar o preço do plano não muda o valor das assinaturas existentes.
- [ ] Reembolso total da cobrança do período em curso encerra a assinatura e revoga o acesso.
- [ ] Reembolso parcial da cobrança do período em curso devolve o valor sem alterar o estado.
- [ ] Segunda assinatura do mesmo plano responde `409`.

## Fora de escopo

- Troca de plano com cálculo proporcional; pausa de assinatura.
- Período de teste gratuito.
- Assinatura na cesta junto com itens avulsos.
- Planos para grupos ou empresas.
- Reativar assinatura cancelada antes do fim do período.

## Decisões relacionadas

- [0005](decisions/0005-modelo-de-venda-e-mercado-pago.md)
- [0001](decisions/0001-decisoes-iniciais.md)
