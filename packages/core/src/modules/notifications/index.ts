// Notificações e e-mail (spec 024): fila `email_outbox`, tipos de e-mail da Fase 1 e tokens de
// e-mail (spec 007). Tarefa 144. Os textos dos e-mails e o envio por SMTP são do worker.

export * from './email-tokens.ts';
export * from './email-types.ts';
export * from './outbox.ts';
