# 013 — Pagamentos e Mercado Pago

Status: aprovada
Depende de: 000, 001, 004, 005, 011, 012

## Contexto

O nuva-edu nunca recebe dados de cartão: o pagamento acontece no checkout hospedado do provedor, e o sistema só cria a cobrança, recebe o aviso e consulta o estado. Para não prender o produto a um fornecedor, o resto do sistema conversa com uma interface interna de provedor de pagamento; o MVP traz uma implementação, a do Mercado Pago ([0005](decisions/0005-modelo-de-venda-e-mercado-pago.md)).

O Mercado Pago avisa por webhook, que pode atrasar, repetir ou se perder. Por isso o acesso só é liberado com confirmação, o webhook é validado e idempotente, e o worker reconcilia periodicamente.

## Requisitos

- RF-01: Interface `PaymentProvider` em `packages/core`; pedidos e assinaturas não conhecem o Mercado Pago.
- RF-02: Checkout hospedado para pedido avulso, com cartão, Pix e boleto conforme a conta do vendedor.
- RF-03: Assinatura recorrente criada no provedor, com cobrança automática por período.
- RF-04: Webhook com assinatura validada; evento com assinatura inválida é recusado com `401` e registrado como `rejected`, sem corpo e sem processamento.
- RF-05: Processamento idempotente: o mesmo evento, recebido várias vezes, produz um único efeito.
- RF-06: Reconciliação periódica de pedidos pendentes e de assinaturas contra o provedor.
- RF-07: Estorno total e parcial pelo provedor, acionado pelo fluxo de reembolso.
- RF-08: Modo de teste com credenciais de teste nos ambientes `dev` e `teste`.
- RF-09: Indisponibilidade do provedor afeta só o checkout; o restante do site segue funcionando.
- RNF-01: O endpoint de webhook responde em p95 < 200 ms: valida e grava a recepção; só enfileira evento com assinatura válida.
- RNF-02: Evento gravado é processado em até 10 s (p95).
- RNF-03: Chamadas ao provedor têm tempo limite de 10 s e até 3 tentativas com espera crescente (1 s, 4 s, 16 s) para erros de rede e respostas 5xx.
- RNF-04: Token de acesso e segredo do webhook nunca aparecem em logs, respostas ou mensagens de erro.

## Comportamento

### Interface `PaymentProvider`

| Operação | Entrada | Saída |
| --- | --- | --- |
| `createCheckout` | pedido (itens, total, comprador, URLs de retorno, referência externa) | `checkout_url`, `provider_checkout_id` |
| `getPayment` | `provider_payment_id` | estado normalizado, valor, método, referência externa |
| `findPaymentsByReference` | referência externa | lista de pagamentos |
| `cancelCheckout` | `provider_checkout_id` | confirmação |
| `ensurePlan` | plano (título, preço, periodicidade) | `provider_plan_id` |
| `createSubscription` | assinatura (plano, comprador, desconto da primeira cobrança, URLs de retorno, referência externa) | `checkout_url`, `provider_subscription_id` |
| `getSubscription` | `provider_subscription_id` | estado normalizado, período atual, próxima cobrança |
| `cancelSubscription` | `provider_subscription_id` | confirmação |
| `refund` | `provider_payment_id`, valor (nulo = total) | `provider_refund_id`, estado |
| `parseWebhook` | cabeçalhos e corpo bruto | evento normalizado, ou erro de assinatura |

Estados normalizados de pagamento: `pending`, `approved`, `rejected`, `canceled`, `refunded`, `partially_refunded`, `charged_back`.

Estados normalizados de assinatura: `pending`, `authorized`, `paused`, `canceled`.

O provedor em uso vem de `NUVA_PAYMENT_PROVIDER` (padrão `mercadopago`). Um provedor `fake`, determinístico e em memória, existe só para testes ([032](032-verificacao-e-ci.md)).

Referência externa: `order:<orders.id>` ou `subscription:<subscriptions.id>`; é o elo entre o registro local e o do provedor e nunca contém dado pessoal.

### Implementação Mercado Pago

A implementação usa o SDK oficial para Node e deve ser escrita consultando a documentação atual do Mercado Pago, que muda com frequência. O que a spec fixa é o comportamento:

- **Pedido avulso**: Checkout Pro. `createCheckout` cria uma preferência com os itens, o pagador (nome, e-mail, CPF/CNPJ), a referência externa, a URL de notificação e as URLs de retorno (sucesso, pendente, falha) apontando para a página do pedido no classroom. O aluno é redirecionado para a URL de checkout devolvida.
- **Assinatura**: assinaturas do Mercado Pago (plano de assinatura + adesão do pagador). `ensurePlan` cria ou reaproveita o plano no provedor quando o plano local é criado ou muda de preço; `createSubscription` gera a adesão e devolve a URL em que o aluno autoriza a cobrança recorrente. O desconto do cupom na primeira cobrança usa o recurso de desconto/valor inicial do provedor; se a conta não oferecer, a primeira cobrança é feita como pagamento avulso e a recorrência começa no período seguinte.
- **Moeda**: a de `NUVA_CURRENCY`; a conta do Mercado Pago precisa operar nela (BRL por padrão).
- **Meios de pagamento**: os habilitados na conta do vendedor; o sistema não os restringe.

Configuração: `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET`, todos sem valor padrão. A URL de notificação é `https://<NUVA_CLASSROOM_HOST>/api/v1/webhooks/mercadopago`.

### Webhook

Endpoint público `POST /api/v1/webhooks/mercadopago` no `classroom-api`, sem sessão e sem CSRF.

1. Ler o corpo bruto (limite de 64 KB).
2. Validar a assinatura enviada pelo Mercado Pago no cabeçalho `x-signature` (HMAC-SHA256 com `MP_WEBHOOK_SECRET` sobre o manifesto definido pelo provedor, que inclui o identificador do recurso, o `x-request-id` e o carimbo de tempo), em comparação de tempo constante. Carimbo com mais de 5 min de diferença é recusado.
3. Assinatura inválida ou ausente: responder `401`, gravar em `webhook_events` com `status = rejected` e `error = invalid_signature`, contar na métrica `webhooks_total{provider="mercadopago",outcome="rejected"}` e registrar log sem corpo, assinatura ou segredo. Não enfileirar `payment.webhook` nem consultar o provedor.
4. Assinatura válida: gravar em `webhook_events` com chave única (`provider`, `event_id`); se a chave já existe em evento que não está `rejected`, responder `200` sem enfileirar de novo.
5. Enfileirar a tarefa `payment.webhook` ([005](005-worker-e-fila.md)) e responder `200`.

O endpoint nunca confia no conteúdo do aviso: o worker usa só o identificador recebido e busca o estado real no provedor com `getPayment` ou `getSubscription`.

O registro `rejected` é somente trilha de segurança e diagnóstico, retido por 90 dias desde `received_at` e expurgado por `NUVA_RETENTION_WEBHOOK_DAYS` ([033](033-observabilidade-retencao-backup.md)). Guarda `provider`, identificadores do evento/recurso quando foram extraídos sem executar o conteúdo, estado, motivo, tentativas e datas; nunca o corpo bruto, cabeçalhos ou a assinatura. Identificadores ausentes ou malformados ficam nulos. A chave (`provider`, `event_id`) é única apenas para evento com identificador não nulo e estado diferente de `rejected`; rejeições não ocupam essa chave e várias podem guardar o mesmo identificador ainda não autenticado. Quando chega evento válido com esse identificador, ele é gravado e processado normalmente; os registros rejeitados anteriores permanecem inalterados. Um registro `rejected` não aparece na fila de falhas operacionais nem aceita reprocessamento.

Limite de taxa: 300 requisições por minuto por IP, respeitando `TRUSTED_PROXIES` para o IP real. A gravação de rejeição também está sujeita a esse limite, para que a trilha não se torne escrita sem controle.

### Processamento no worker

Tarefa `payment.webhook`, idempotente:

1. Buscar o recurso no provedor.
2. Localizar o registro local pela referência externa. Sem correspondência: marcar o evento como `ignored`.
3. Gravar ou atualizar `payments` (único por `provider`, `provider_payment_id`).
4. Aplicar a transição, em transação com trava na linha do pedido ou da assinatura:

| Estado no provedor | Pedido avulso | Assinatura |
| --- | --- | --- |
| `approved` | `paid` + concessão de direitos ([011](011-vendas-e-checkout.md)) | ativa ou renova ([012](012-assinaturas.md)) |
| `pending` | permanece `pending` | permanece |
| `rejected` | permanece `pending` até vencer (o aluno pode tentar outro meio) | `past_due` se era renovação |
| `canceled` | `canceled` se não houver outro pagamento aprovado | sem efeito |
| `refunded` / `partially_refunded` | conclui o reembolso | conclui o reembolso da cobrança |
| `charged_back` | `chargeback` + revogação | encerra + revogação |

5. Marcar o evento como `processed`. Erro: a tarefa é repetida pela fila (até 8 tentativas, espera crescente); depois disso o evento fica `failed` e aparece na tela de falhas do admin ([033](033-observabilidade-retencao-backup.md)).

Transição já aplicada não se repete: aprovar um pedido que já está `paid` não concede direitos de novo ([010](010-direitos-de-acesso.md), idempotência da concessão).

### Reconciliação

Tarefas agendadas do worker:

| Tarefa | Frequência | O que faz |
| --- | --- | --- |
| `payment.reconcile_orders` | a cada 5 min | para cada pedido `pending` criado há mais de 2 min, `findPaymentsByReference` e aplica a transição |
| `payment.reconcile_subscriptions` | a cada 6 h | para cada assinatura `active`, `past_due`, `canceling` ou `suspended`, `getSubscription` e corrige estado e período |
| `payment.reconcile_refunds` | a cada 30 min | para cada reembolso `requested` há mais de 5 min, consulta e conclui ou marca falha |

A reconciliação usa o mesmo código de transição do webhook; a ordem de chegada entre os dois não importa.

### Falhas

| Falha | Comportamento |
| --- | --- |
| Provedor fora ao criar checkout | `503` no checkout com mensagem "pagamento indisponível, tente em instantes"; pedido volta a `draft`, cesta preservada; resto do site normal |
| Webhook atrasado ou perdido | reconciliação aplica o estado em até 5 min (pedido) |
| Webhook repetido | chave única em `webhook_events`; sem efeito duplo |
| Webhook fora de ordem (reembolso antes da aprovação) | o worker sempre lê o estado atual no provedor, então aplica o estado final |
| Assinatura do webhook inválida | `401`, evento `rejected` com metadados mínimos, sem fila nem reprocessamento, métrica e log sem o corpo |
| Credenciais inválidas (`401` do provedor) | checkout responde `503`; alerta na tela de falhas do admin; tarefas param de repetir após 3 tentativas |
| Pagamento aprovado com valor diferente do pedido | pedido não é marcado `paid`; evento vai para `failed` com motivo `amount_mismatch` para análise do admin |
| Cobrança de assinatura recusada | `past_due` e carência ([012](012-assinaturas.md)) |

### Modo de teste

- `dev` e `teste` usam credenciais de teste do Mercado Pago e contas de teste de comprador e vendedor; nenhuma cobrança real.
- O admin vê, em Configurações, um indicador "Pagamentos em modo de teste" quando o token é de teste, e um aviso em vermelho se uma instalação com `NUVA_ENV=production` estiver com token de teste.
- Em `dev`, o webhook não alcança `*.localhost`; a reconciliação cobre o caso, e há um comando de desenvolvimento que simula o aviso para um pedido.
- A suíte automatizada usa o provedor `fake`; a integração real com o ambiente de teste do Mercado Pago é exercitada num teste e2e marcado, rodado só quando as credenciais de teste estão presentes.
- Em testes com processos separados, `NUVA_PAYMENT_PROVIDER=fake` e `NUVA_PAYMENT_FAKE_URL` apontam APIs e worker para a mesma instância interna do simulador. Com a URL vazia, o fake funciona em memória para testes no mesmo processo. Em produção, tanto o fake quanto o endereço do simulador são recusados. A porta de controle do simulador é publicada somente no loopback de desenvolvimento e teste.

## Interfaces e contratos

`apps/classroom-api/openapi.yaml`, sob `/api/v1`:

- `POST /webhooks/mercadopago` (público; resposta `200` ou `401`)

`apps/admin-api/openapi.yaml`, sob `/api/v1`:

- `GET /payments`, `GET /payments/{id}` (admin e gerente)
- `GET /webhook-events?status=failed`, `POST /webhook-events/{id}/retry` (admin; somente `failed`, nunca `rejected`)
- `GET /settings/payments` (provedor, modo de teste, última reconciliação; nunca os segredos)

Tarefas da fila: `payment.webhook`, `payment.reconcile_orders`, `payment.reconcile_subscriptions`, `payment.reconcile_refunds` ([005](005-worker-e-fila.md)).

## Dados

Dono (escrita): `classroom-api` grava `webhook_events` na chegada; `worker` grava `payments` e o estado dos eventos.

| Tabela | Campos principais |
| --- | --- |
| `payments` | `id`, `order_id` (ou nulo), `subscription_id` (ou nulo), `provider`, `provider_payment_id`, `status`, `method` (`card` \| `pix` \| `boleto` \| `other`), `amount_cents`, `refunded_cents`, `currency`, `paid_at`, `raw_status`, `created_at`, `updated_at` |
| `webhook_events` | `id`, `provider`, `event_id` (nulo se ilegível), `resource_type`, `resource_id` (nulos se ilegíveis), `status` (`received` \| `rejected` \| `processed` \| `ignored` \| `failed`), `attempts`, `error`, `received_at`, `processed_at` |

- `payments` não guarda dado de cartão nem o corpo completo devolvido pelo provedor.
- `webhook_events` guarda só identificadores, não o corpo.
- Retenção: `webhook_events` por 90 dias (`NUVA_RETENTION_WEBHOOK_DAYS`); `payments` pelo prazo fiscal de vendas ([011](011-vendas-e-checkout.md)).

## Critérios de aceite

- [ ] Pedidos e assinaturas funcionam de ponta a ponta com o provedor `fake` sem nenhuma referência ao Mercado Pago fora da implementação dele.
- [ ] Webhook com assinatura inválida responde `401`, grava `rejected` sem corpo/assinatura e não enfileira; evento válido posterior com o mesmo identificador é processado, e o rejeitado não pode ser reprocessado.
- [ ] O mesmo evento enviado 5 vezes gera um único pagamento e uma única concessão de direitos.
- [ ] Com o webhook desligado, um pedido pago é liberado pela reconciliação em até 5 min.
- [ ] Reembolso e aprovação chegando fora de ordem terminam no estado final correto.
- [ ] Pagamento com valor diferente do pedido não libera acesso e aparece nas falhas.
- [ ] Provedor fora do ar: checkout responde `503`, a cesta é preservada e as demais páginas respondem normalmente.
- [ ] Nenhum log contém `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` ou o corpo do webhook (teste que varre a saída).
- [ ] Indicador de modo de teste aparece com credenciais de teste.
- [ ] Teste e2e marcado conclui uma compra no ambiente de teste do Mercado Pago quando as credenciais existem.

## Fora de escopo

- Outros provedores (Stripe, Asaas, plataformas por webhook): a interface os permite, mas não fazem parte do MVP.
- Checkout transparente, com campos de cartão dentro do classroom.
- Divisão de pagamento (split), antecipação e conciliação bancária.
- Mais de uma moeda por instalação.
- Gestão de disputa de chargeback dentro do sistema.

## Decisões relacionadas

- [0005](decisions/0005-modelo-de-venda-e-mercado-pago.md)
- [0008](decisions/0008-fila-e-sse-no-postgres.md)
- [0001](decisions/0001-decisoes-iniciais.md)
