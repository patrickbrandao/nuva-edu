// Sondagem do ambiente: quais serviços respondem e a mensagem para quando algum não responde.
import { ADMIN_URL, CLASSROOM_URL, UP_COMMAND } from './env.ts';

export interface Probe {
  /** Nome do serviço no Compose. */
  service: string;
  url: string;
  /** Confere o corpo de uma resposta 200; devolve o motivo da recusa ou `null`. */
  check: (body: string, contentType: string) => string | null;
}

const isHealth = (body: string): string | null =>
  /"status"\s*:\s*"ok"/.test(body) ? null : 'o corpo não traz {"status":"ok"}';

const isPage = (_body: string, contentType: string): string | null =>
  contentType.includes('text/html') ? null : `veio ${contentType || 'sem Content-Type'}, não HTML`;

export const PROBES: readonly Probe[] = [
  { service: 'admin', url: `${ADMIN_URL}/`, check: isPage },
  { service: 'admin-api', url: `${ADMIN_URL}/healthz`, check: isHealth },
  { service: 'classroom', url: `${CLASSROOM_URL}/`, check: isPage },
  { service: 'classroom-api', url: `${CLASSROOM_URL}/healthz`, check: isHealth },
];

export interface Failure {
  service: string;
  url: string;
  reason: string;
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  if (error.name === 'TimeoutError') {
    return 'sem resposta em 5 s';
  }
  const cause = error.cause instanceof Error ? error.cause : null;
  const code = cause && 'code' in cause ? String(cause.code) : '';
  if (code === 'ECONNREFUSED') {
    return 'conexão recusada (o proxy está no ar?)';
  }
  return cause?.message || error.message;
}

async function probe({ service, url, check }: Probe): Promise<Failure | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'manual' });
    const body = await response.text();
    if (response.status !== 200) {
      return { service, url, reason: `respondeu ${response.status}` };
    }
    const refusal = check(body, response.headers.get('content-type') ?? '');
    return refusal ? { service, url, reason: refusal } : null;
  } catch (error) {
    return { service, url, reason: describeError(error) };
  }
}

/** Sonda todos os serviços de uma vez e devolve os que falharam. */
export async function findFailures(probes: readonly Probe[] = PROBES): Promise<Failure[]> {
  const results = await Promise.all(probes.map(probe));
  return results.filter((result) => result !== null);
}

/** Texto do erro mostrado quando o ambiente não está inteiro. */
export function formatFailures(failures: readonly Failure[], context = ''): string {
  const lines = failures.map(
    ({ service, url, reason }) => `  - ${service}: GET ${url} → ${reason}`,
  );
  return [
    `Ambiente do nuva-edu fora do ar${context ? ` (${context})` : ''}:`,
    ...lines,
    `Para subir: ${UP_COMMAND}`,
    `Para ver o motivo: pnpm compose ps · pnpm compose logs ${failures[0]?.service ?? '<serviço>'}`,
    'Outro endereço: NUVA_E2E_ADMIN_URL e NUVA_E2E_CLASSROOM_URL (com NUVA_E2E_COMPOSE=0 se não for o Compose local).',
  ].join('\n');
}
