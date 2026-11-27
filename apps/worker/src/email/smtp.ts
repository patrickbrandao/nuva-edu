import type { Config } from '@nuva-edu/core';
import nodemailer, { type SMTPTransportOptions } from 'nodemailer';

// Transporte SMTP do worker (spec 024, "E-mail"). Porta 465: TLS desde a conexão; outra porta:
// STARTTLS obrigatório. Só `SMTP_HOST=mailpit` (o Mailpit do Compose) dispensa TLS. Com
// `SMTP_USER`, autentica com `SMTP_PASSWORD` (exigida na subida, em `main.ts`).

/** Host do Mailpit do Compose: o único que dispensa TLS. */
export const INSECURE_SMTP_HOST = 'mailpit';

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}

export interface Mailer {
  send(message: OutgoingEmail): Promise<void>;
  close(): void;
}

export interface MailerOptions {
  /** Opções extras do TLS do Node (testes: certificado autoassinado do servidor local). */
  tls?: SMTPTransportOptions['tls'];
}

export function smtpTransportOptions(
  smtp: Config['smtp'],
  options: MailerOptions = {},
): SMTPTransportOptions {
  const implicitTls = smtp.port === 465;
  const insecureAllowed = smtp.host === INSECURE_SMTP_HOST;
  return {
    host: smtp.host,
    port: smtp.port,
    secure: implicitTls,
    requireTLS: !implicitTls && !insecureAllowed,
    ...(options.tls ? { tls: options.tls } : {}),
    ...(smtp.user === null ? {} : { auth: { user: smtp.user, pass: smtp.password ?? '' } }),
    // SMTP fora do ar não segura a tarefa por minutos: falha cedo e a fila tenta de novo.
    connectionTimeout: 30_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
    // Sem log do Nodemailer: o corpo leva o token do link (spec 007).
    logger: false,
    debug: false,
  };
}

export function createMailer(smtp: Config['smtp'], options: MailerOptions = {}): Mailer {
  const transport = nodemailer.createTransport(smtpTransportOptions(smtp, options));
  return {
    async send(message) {
      await transport.sendMail({
        from: smtp.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        ...(message.headers === undefined ? {} : { headers: message.headers }),
        // O corpo é montado aqui; nada de arquivo ou URL externos embutidos na mensagem.
        disableFileAccess: true,
        disableUrlAccess: true,
      });
    },
    close() {
      transport.close();
    },
  };
}

export interface SmtpFailure {
  /** Repetir não adianta: o servidor recusou o destinatário ou a mensagem (5xx). */
  permanent: boolean;
  /**
   * Resumo sem dado pessoal, para `last_error` e para o log: a resposta do servidor costuma
   * repetir o endereço do destinatário, então fica de fora.
   */
  summary: string;
}

/** `null` quando o erro não veio do Nodemailer (falha no banco, no modelo...). */
export function classifySmtpError(error: unknown): SmtpFailure | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const { code, responseCode } = error as { code?: unknown; responseCode?: unknown };
  if (typeof code !== 'string' && typeof responseCode !== 'number') {
    return null;
  }
  const codeText = typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'SMTP';
  const status = typeof responseCode === 'number' ? responseCode : null;
  const permanent =
    status !== null &&
    status >= 500 &&
    status < 600 &&
    (codeText === 'EENVELOPE' || codeText === 'EMESSAGE');
  return {
    permanent,
    summary: `smtp: ${codeText}${status === null ? '' : ` ${status}`}${permanent ? ' (recusa permanente)' : ''}`,
  };
}
