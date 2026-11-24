# 011 — Vendas e checkout

Status: aprovada
Depende de: 000, 001, 007, 008, 009, 010, 013

## Contexto

A venda avulsa é o caminho principal de receita: o aluno põe cursos, pacotes e ebooks numa cesta, paga uma vez e recebe o acesso. Esta spec cobre cesta, pedido, cupons, dados fiscais do comprador, reembolso e a exportação de vendas. Assinaturas têm checkout próprio ([012](012-assinaturas.md)). A conversa com o provedor de pagamento está em [013](013-pagamentos-mercado-pago.md); a liberação do acesso, em [010](010-direitos-de-acesso.md).

## Requisitos

- RF-01: Cesta por usuário logado, só com produtos avulsos `paid` e publicados.
- RF-02: Fechar a cesta gera um pedido com os preços congelados e leva ao checkout do provedor.
- RF-03: O acesso só é liberado quando o pagamento é confirmado.
- RF-04: Cupom com desconto percentual ou de valor fixo, validade, limite de usos e restrição opcional a produtos.
- RF-05: O primeiro checkout pede nome completo e CPF ou CNPJ; os seguintes reutilizam o que foi informado.
- RF-06: Só o admin reembolsa, total ou por item; o reembolso estorna no provedor e revoga o acesso em cascata.
- RF-07: Admin e gerente consultam vendas; o admin exporta em CSV.
- RF-08: O aluno vê seus pedidos, estados e comprovantes em "Minha assinatura".
- RF-09: Pedido de valor final zero é concluído sem passar pelo provedor.
- RNF-01: Do clique em "Finalizar" ao redirecionamento para o provedor: p95 < 1 s.
- RNF-02: Pagamento aprovado libera o acesso em até 10 s após a chegada do webhook (p95).
- RNF-03: Nenhum pedido pago fica sem acesso por mais de 15 min, mesmo com webhook perdido (reconciliação, [013](013-pagamentos-mercado-pago.md)).
- RNF-04: Exportação CSV de 50.000 itens de pedido conclui em menos de 30 s, em fluxo contínuo (sem carregar tudo em memória).

## Comportamento

### Cesta

- Uma cesta aberta por usuário (`carts`), persistida no servidor; sobrevive a troca de dispositivo.
- Acrescentar item é recusado quando: o produto não é `paid` e publicado; o item já está na cesta; o usuário já tem direito ativo e vitalício ao produto; o e-mail da conta não foi confirmado ([007](007-contas-e-autenticacao.md)).
- Aviso, sem bloquear: o usuário já tem um item do pacote; o usuário tem o produto por assinatura; o usuário tem direito com validade (a compra estende o acesso).
- A cesta mostra, para cada item, o que será liberado em cascata (cursos do pacote, ebooks vinculados), como pediu a visão do produto: o vínculo aparece na cesta.
- Preço da cesta é sempre o preço atual do produto; produto despublicado ou com preço alterado é sinalizado na próxima abertura.
- Limite de 50 itens por cesta.

### Cupons

| Campo | Regra |
| --- | --- |
| `code` | 3 a 40 caracteres, letras, números e hífen; único; comparação sem diferenciar maiúsculas |
| `kind` | `percent` (1 a 100) ou `fixed` (valor em centavos) |
| `starts_at`, `ends_at` | janela de validade; ambos opcionais |
| `max_uses` | total de usos; nulo = ilimitado |
| `max_uses_per_user` | padrão 1 |
| `products` | lista opcional de produtos; vazia = vale para todos |
| `applies_to` | `orders`, `subscriptions` ou ambos ([012](012-assinaturas.md)) |
| `active` | o admin liga e desliga |

- Um cupom por pedido.
- Com restrição de produtos, o desconto incide só sobre os itens elegíveis.
- `percent`: aplicado item a item, arredondando cada item para baixo ao centavo.
- `fixed`: rateado entre os itens elegíveis na proporção do preço; o último item recebe o resto do arredondamento. O desconto nunca passa do subtotal elegível.
- O uso só é contabilizado quando o pedido é pago; pedido cancelado ou vencido devolve o uso. A checagem de `max_uses` é feita de novo, com trava, no momento da confirmação: se o limite estourou nesse intervalo, o pedido já pago é honrado e o excesso fica registrado.
- Só o admin cria, edita e desativa cupons ([008](008-papeis-e-permissoes.md)).

### Dados do comprador

- Coletados no primeiro checkout: `full_name`, `tax_id_type` (`cpf` | `cnpj`), `tax_id`. Guardados no usuário e copiados para o pedido.
- CPF e CNPJ validados por dígito verificador; guardados só com dígitos.
- Sem endereço e sem telefone.
- `tax_id` nunca vai para logs ([033](033-observabilidade-retencao-backup.md)) e só aparece para admin e gerente na tela do pedido e, para o admin, no CSV.

### Pedido e seus estados

Ao finalizar, em uma transação: valida a cesta, congela `unit_price_cents`, desconto e total em `orders` e `order_items`, guarda o cupom, esvazia a cesta e cria o checkout no provedor.

```
draft ──> pending ──> paid ──> partially_refunded ──> refunded
             │          └────────────────────────────> refunded
             ├──> canceled   (aluno desistiu ou pagamento recusado em definitivo)
             └──> expired    (sem pagamento no prazo)
paid ──> chargeback          (contestação no provedor)
```

| Estado | Significado | Acesso |
| --- | --- | --- |
| `pending` | aguardando pagamento | não liberado |
| `paid` | pagamento confirmado | liberado |
| `partially_refunded` | parte dos itens reembolsada | itens restantes liberados |
| `refunded` | tudo reembolsado | revogado |
| `canceled` | cancelado antes de pagar | não liberado |
| `expired` | venceu sem pagamento | não liberado |
| `chargeback` | contestado | revogado |

- Prazo de `pending`: 30 min para cartão e Pix, 3 dias para boleto, ajustável por `NUVA_ORDER_PENDING_MINUTES` e `NUVA_ORDER_BOLETO_DAYS`. O worker marca `expired` e pede o cancelamento ao provedor.
- Um aluno pode ter no máximo 3 pedidos `pending` ao mesmo tempo; o quarto exige cancelar um.
- Pagamento confirmado para pedido já `expired` ou `canceled`: o pedido vira `paid` e o acesso é liberado (o dinheiro entrou), com registro de auditoria.
- Confirmação: o worker marca `paid`, cria os direitos via `grant` ([010](010-direitos-de-acesso.md)), contabiliza o cupom, dá os pontos de gamificação ([020](020-gamificacao.md)) e envia notificação e e-mail de compra aprovada ([024](024-notificacoes-e-email.md)).
- Pedido de total zero (cupom de 100% ou produto `paid` de preço 0): vai direto a `paid`, com `provider` = `none`.
- Retorno do checkout: a página "Pedido" consulta o estado e acompanha por SSE até a confirmação; enquanto `pending`, mostra "aguardando pagamento" e, para Pix e boleto, o que o provedor forneceu para pagar.

### Reembolso

- Pedido pelo aluno via chamado de suporte ([023](023-chamados-de-suporte.md)); o prazo legal de 7 dias consta nos termos.
- Só o admin executa, na tela do pedido: escolhe o pedido inteiro ou itens, informa o motivo e confirma. Gerente não reembolsa.
- Fluxo: cria `refunds` em `requested` → pede o estorno ao provedor → com a confirmação, marca `done`, revoga os direitos dos itens (`refund`, [010](010-direitos-de-acesso.md)), ajusta o estado do pedido, retira os pontos dados pela compra e notifica o aluno.
- O valor reembolsado por item é o valor pago por ele (preço menos o desconto rateado).
- Falha no estorno: `refunds` fica em `failed` com a mensagem do provedor, o acesso não é revogado e o admin pode tentar de novo.
- Estorno feito direto no painel do provedor chega por webhook e segue o mesmo caminho a partir da confirmação.
- Contestação (chargeback): pedido vira `chargeback`, direitos revogados com motivo `chargeback`, admin notificado.
- Não há prazo máximo imposto pelo sistema; o provedor recusa o que não puder estornar.

### Consulta e exportação

- Lista de pedidos no admin com filtros por período, estado, produto, cupom e comprador; totais do período (bruto, descontos, reembolsos, líquido).
- CSV (só admin), uma linha por item de pedido: `order_id`, `order_number`, `created_at`, `paid_at`, `status`, `buyer_name`, `buyer_email`, `tax_id_type`, `tax_id`, `product_type`, `product_title`, `unit_price`, `discount`, `paid_amount`, `refunded_amount`, `coupon_code`, `payment_method`, `provider`, `provider_payment_id`. UTF-8 com BOM, separador `;`, valores decimais com vírgula.
- A exportação grava auditoria ([028](028-auditoria.md)).

### Casos de erro

| Situação | Resposta |
| --- | --- |
| Item não vendável ou já possuído em definitivo | `409` com o motivo |
| Cupom inexistente, fora da validade, esgotado ou sem item elegível | `422` com o motivo, sem revelar se o código existe em outro contexto |
| CPF ou CNPJ inválido | `422` |
| E-mail não confirmado | `403` |
| Provedor indisponível ao criar o checkout | `503`; o pedido fica `draft` e a cesta é restaurada |
| Gerente tentando reembolsar ou exportar | `403` |
| Reembolso acima do valor pago do item | `422` |

## Interfaces e contratos

`apps/classroom-api/openapi.yaml`, sob `/api/v1`:

- `GET /cart`, `POST /cart/items`, `DELETE /cart/items/{id}`, `PUT /cart/coupon`, `DELETE /cart/coupon`
- `PUT /me/billing` (nome e CPF/CNPJ)
- `POST /orders` (fecha a cesta; devolve o pedido e a URL de checkout)
- `GET /orders`, `GET /orders/{id}`, `POST /orders/{id}/cancel`

`apps/admin-api/openapi.yaml`, sob `/api/v1`:

- `GET /orders`, `GET /orders/{id}`, `GET /orders/export.csv`
- `POST /orders/{id}/refunds` (admin; itens e motivo), `POST /refunds/{id}/retry`
- `GET|POST /coupons`, `GET|PATCH /coupons/{id}`

Provedor de pagamento: interface em [013](013-pagamentos-mercado-pago.md).

## Dados

Dono (escrita): `classroom-api` para cesta e criação do pedido; `worker` para estado de pagamento e reembolso; `admin-api` para cupons e para o pedido de reembolso.

| Tabela | Campos principais |
| --- | --- |
| `carts` | `id`, `user_id` (único), `coupon_id`, `updated_at` |
| `cart_items` | `id`, `cart_id`, `product_type`, `product_id`, `added_at` |
| `coupons` | conforme a tabela de cupons, mais `uses_count`, `created_by`, `created_at` |
| `orders` | `id`, `number` (sequencial legível), `user_id`, `status`, `subtotal_cents`, `discount_cents`, `total_cents`, `currency`, `coupon_id`, `buyer_name`, `buyer_tax_id_type`, `buyer_tax_id`, `provider`, `expires_at`, `paid_at`, `created_at` |
| `order_items` | `id`, `order_id`, `product_type`, `product_id`, `title_snapshot`, `access_days_snapshot`, `unit_price_cents`, `discount_cents`, `paid_cents`, `refunded_cents` |
| `payments` | ver [013](013-pagamentos-mercado-pago.md) |
| `refunds` | `id`, `order_id`, `items` (itens e valores), `amount_cents`, `reason`, `status` (`requested` \| `done` \| `failed`), `provider_refund_id`, `error`, `requested_by`, `created_at`, `done_at` |

Retenção: pedidos, itens, pagamentos e reembolsos são mantidos por 5 anos (prazo fiscal, ajustável por `NUVA_RETENTION_FISCAL_YEARS`), inclusive após a exclusão da conta ([030](030-lgpd.md)); cestas sem alteração há 30 dias são apagadas (`NUVA_RETENTION_CART_DAYS`).

## Critérios de aceite

- [ ] Cesta com pacote mostra os cursos e ebooks que serão liberados.
- [ ] Produto `open`, `private`, despublicado ou já possuído em definitivo é recusado na cesta.
- [ ] Cupom `percent` e cupom `fixed` com restrição de produtos calculam o desconto conforme as regras de rateio (testes com arredondamento).
- [ ] Pedido criado congela os preços; alterar o preço do produto depois não muda o pedido.
- [ ] Pagamento confirmado libera todos os itens e a cascata em até 10 s.
- [ ] Pedido `pending` vence no prazo e vira `expired`; pagamento tardio ainda libera o acesso.
- [ ] Pedido de total zero conclui sem chamar o provedor.
- [ ] Reembolso de um item entre dois revoga só aquele item e sua cascata; o pedido fica `partially_refunded`.
- [ ] Gerente recebe `403` em reembolso, cupons e CSV.
- [ ] CSV traz uma linha por item, com os campos listados, e não aparece em nenhum log.
- [ ] `tax_id` ausente de todos os logs (teste que varre a saída).

## Fora de escopo

- Emissão de nota fiscal ([0005](decisions/0005-modelo-de-venda-e-mercado-pago.md)).
- Reembolso por autosserviço do aluno.
- Repasse ou divisão de pagamento com instrutor; afiliados.
- Mais de um cupom por pedido; cupom automático sem código; preço promocional agendado.
- Presentear outra pessoa; compra sem conta.
- Endereço, telefone e parcelamento gerido pelo sistema (o parcelamento é o do provedor).

## Decisões relacionadas

- [0005](decisions/0005-modelo-de-venda-e-mercado-pago.md)
- [0001](decisions/0001-decisoes-iniciais.md)
