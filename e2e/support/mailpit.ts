// Leitura dos e-mails enviados em desenvolvimento, pela API HTTP do Mailpit
// (docs/ambiente-local.md). Cada fluxo usa um destinatário único, então a busca é por `to:`.
const MAILPIT_URL = (process.env.NUVA_E2E_MAILPIT_URL ?? 'http://127.0.0.1:8025').replace(
  /\/+$/,
  '',
);

export interface Mail {
  id: string;
  subject: string;
  text: string;
}

interface Summary {
  ID: string;
  Subject: string;
  Created: string;
}

async function search(to: string): Promise<Summary[]> {
  const query = encodeURIComponent(`to:"${to}"`);
  const response = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=50`);
  if (!response.ok) {
    throw new Error(`Mailpit respondeu ${response.status} em ${MAILPIT_URL}/api/v1/search`);
  }
  const { messages } = (await response.json()) as { messages: Summary[] };
  return messages;
}

async function read(id: string): Promise<Mail> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  const message = (await response.json()) as { ID: string; Subject: string; Text: string };
  return { id: message.ID, subject: message.Subject, text: message.Text ?? '' };
}

/**
 * Espera o e-mail para `to` cujo assunto casa com `subject`. Com `count`, espera que haja ao menos
 * essa quantidade e devolve o mais recente.
 */
export async function waitForMail(
  to: string,
  subject: RegExp,
  { count = 1, timeoutMs = 30_000 }: { count?: number; timeoutMs?: number } = {},
): Promise<Mail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = (await search(to))
      .filter((message) => subject.test(message.Subject))
      .sort((a, b) => b.Created.localeCompare(a.Created));
    const newest = found[0];
    if (newest && found.length >= count) {
      return read(newest.ID);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Nenhum e-mail para ${to} com assunto ${subject} em ${timeoutMs / 1000} s (vistos: ${found.length}).`,
      );
    }
    await new Promise((done) => setTimeout(done, 500));
  }
}

/** Quantos e-mails para `to` casam com `subject` agora. */
export async function countMail(to: string, subject: RegExp): Promise<number> {
  return (await search(to)).filter((message) => subject.test(message.Subject)).length;
}

/** O link do e-mail que leva ao caminho `path` (ex.: `/confirmar`), com o token. */
export function linkIn(mail: Mail, path: string): string {
  const escaped = path.replace(/[/.]/g, '\\$&');
  const match = new RegExp(`https?://[^\\s<>"')\\]]+${escaped}\\?token=[A-Za-z0-9_-]+`).exec(
    mail.text,
  );
  if (!match) {
    throw new Error(`O e-mail "${mail.subject}" não tem link para ${path}?token=.`);
  }
  return match[0];
}

export const SUBJECTS = {
  verify: /^Confirme seu e-mail/,
  reset: /^Redefina sua senha/,
  locked: /foi bloqueada temporariamente$/,
} as const;

/** Assunto e texto de todos os e-mails para `to` (para a varredura de segredo). */
export async function mailTexts(to: string): Promise<Mail[]> {
  return Promise.all((await search(to)).map((message) => read(message.ID)));
}
