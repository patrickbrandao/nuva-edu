// Credenciais do admin inicial (spec 007, "Admin inicial"): as mesmas `ADMIN_EMAIL` e
// `ADMIN_PASSWORD` de onde o Compose as leu, o `.env.local` da raiz (no CI, sorteadas no mesmo
// arquivo). O ambiente do processo tem precedência. Os valores nunca vão para log nem relatório.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT_DIR } from './env.ts';

/** Lê `KEY=valor` de um arquivo `.env`, sem interpolação; aspas simples ou duplas são retiradas. */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) {
    return {};
  }
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match?.[1]) {
      continue;
    }
    let value = (match[2] ?? '').trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

export interface Credentials {
  email: string;
  password: string;
}

let cached: Credentials | undefined;

/** E-mail e senha do admin inicial. Falha sem mostrar valor se faltar alguma das duas. */
export function adminCredentials(): Credentials {
  if (cached) {
    return cached;
  }
  const file = readEnvFile(resolve(ROOT_DIR, '.env.local'));
  const email = process.env.ADMIN_EMAIL || file.ADMIN_EMAIL || '';
  const password = process.env.ADMIN_PASSWORD || file.ADMIN_PASSWORD || '';
  if (email === '' || password === '') {
    throw new Error(
      'ADMIN_EMAIL e ADMIN_PASSWORD não encontrados no ambiente nem no .env.local da raiz: são os do admin inicial que o Compose usou.',
    );
  }
  cached = { email, password };
  return cached;
}
