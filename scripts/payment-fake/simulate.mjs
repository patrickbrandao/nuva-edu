const [orderId, option] = process.argv.slice(2);
if (!orderId || !/^[\da-f-]{36}$/i.test(orderId) || (option && option !== '--sem-webhook')) {
  throw new Error('Uso: node scripts/payment-fake/simulate.mjs <id-do-pedido> [--sem-webhook]');
}
const fake = process.env.PAYMENT_FAKE_PUBLIC_URL || 'http://127.0.0.1:8092';
const classroom = process.env.NUVA_CLASSROOM_URL || 'http://classroom.localhost:8080';
const result = await fetch(`${fake}/simulate/approveOrder`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify([orderId]),
});
if (!result.ok) throw new Error(`Simulador recusou a aprovação (${result.status}).`);
if (option === '--sem-webhook') {
  console.log('Pagamento simulado. O worker deve encontrá-lo na próxima reconciliação.');
} else {
  const { headers, rawBody } = await result.json();
  const webhook = await fetch(`${classroom}/api/v1/webhooks/mercadopago`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: rawBody,
  });
  if (!webhook.ok) throw new Error(`Classroom recusou o aviso (${webhook.status}).`);
  console.log('Aviso aceito para processamento pelo worker.');
}
