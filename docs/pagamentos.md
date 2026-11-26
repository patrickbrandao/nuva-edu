# Pagamentos

Em uma instalação, as APIs e o worker usam a mesma configuração de Mercado Pago.
Defina `NUVA_PAYMENT_PROVIDER=mercadopago` e configure `MP_ACCESS_TOKEN`, `MP_PUBLIC_KEY` e
`MP_WEBHOOK_SECRET` no ambiente local da instalação. Configure a notificação pública em
`https://classroom.<domínio>/api/v1/webhooks/mercadopago`. A chave e os segredos são do
vendedor. O conteúdo do aviso nunca é armazenado.

`pnpm dev:up` em localhost usa `fake` por padrão. As APIs e o worker falam com o mesmo
simulador na rede do Compose. O controle fica em `http://127.0.0.1:8092`, ou na porta
`PAYMENT_FAKE_PORT` quando definida. O estado do simulador fica em memória e se perde se
o serviço for reiniciado. Os números de pedido do banco e os identificadores do simulador
são diferentes.

Com o pedido em aberto, simule a aprovação e o aviso ao classroom.

```sh
node scripts/payment-fake/simulate.mjs <id-do-pedido>
```

Acrescente `--sem-webhook` para conferir a reconciliação de pedidos. Ela ocorre a cada
cinco minutos. Em portas alternativas, informe `PAYMENT_FAKE_PUBLIC_URL` e
`NUVA_CLASSROOM_URL` ao comando.

Para exercitar o sandbox do Mercado Pago, configure o provedor real explicitamente com as
credenciais de teste. O painel mostra o modo de teste para tokens `TEST-`. O simulador
não é aceito em produção.
