# 0005 — Modelo de venda e Mercado Pago

Status: aceita
Data: 2026-11-24

## Contexto

O sistema vende cursos, pacotes e ebooks. Era preciso definir como o aluno paga, por qual meio, e o que acontece em cupom, reembolso e falha de pagamento.

## Decisão

- Modelo (F1-02): compra avulsa de curso, pacote ou ebook e assinatura recorrente, ambas no MVP. Escolhido contra a recomendação de começar só com avulsa de validade opcional.
- Assinatura (F1-05): vários planos; cada plano lista cursos, pacotes e ebooks, ou "tudo, inclusive lançamentos futuros". O acesso por assinatura some quando ela vence; o que foi comprado avulso permanece.
- Cesta (P-02): só para itens avulsos; a assinatura tem checkout próprio.
- Pagamento (F1-04): interface interna plugável de provedor de pagamento, com checkout próprio; o primeiro provedor é o Mercado Pago. Escolhido contra a recomendação de começar pelo Stripe.
- Cupons (F1-16): código com desconto percentual ou de valor fixo, validade, limite de usos e restrição opcional a produtos; na assinatura vale só na primeira cobrança.
- Reembolso (F1-17): só o admin aciona, no painel; o sistema estorna no Mercado Pago e revoga o acesso em cascata. Gerente não reembolsa. O aluno pede por chamado.
- Falhas (F2-12): o pedido fica "aguardando pagamento" até a confirmação; o webhook tem assinatura validada e processamento idempotente; o worker reconcilia periodicamente pedidos pendentes e assinaturas; cobrança de assinatura recusada mantém o acesso por 3 dias de carência e depois suspende; checkout indisponível mostra aviso e não derruba o resto do site.

## Alternativas consideradas

- Modelo: avulsa com validade opcional (recomendada); só assinatura; só avulsa vitalícia.
- Assinatura: plano único que libera tudo.
- Provedor: Stripe primeiro (recomendada, por checkout hospedado e assinatura madura); Asaas primeiro; plataforma externa por webhook (Hotmart, Kiwify), que eliminaria a cesta própria.
- Cupons: nenhum no MVP.
- Reembolso: autosserviço em 7 dias; feito só no painel do Mercado Pago, com o sistema reagindo ao webhook.
- Falhas: só webhook, sem reconciliação.

## Consequências

- Cobrança recorrente, inadimplência, carência e cancelamento precisam existir desde a Fase 3 do PLAN.
- A API de assinatura do Mercado Pago é mais limitada que a de outros provedores; a interface plugável isola essa limitação e permite outro provedor depois sem mexer em vendas e direitos.
- Dados de cartão nunca passam pelo nuva-edu; o Mercado Pago exige CPF/CNPJ para Pix e boleto (F1-19).
- Webhook forjado é uma das ameaças principais (Q-03): validação de assinatura e idempotência têm teste obrigatório.
- É necessária conta de teste do Mercado Pago antes da Fase 3 (credencial externa: escalonar ao humano).
- Detalhado em [011](../011-vendas-e-checkout.md), [012](../012-assinaturas.md), [013](../013-pagamentos-mercado-pago.md) e [010](../010-direitos-de-acesso.md).
