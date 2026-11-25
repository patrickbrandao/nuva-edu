// Chamadas às APIs de dentro da rede interna do Compose, cada uma com um IP de cliente próprio.
//
// Por que existe: atrás do Traefik local todo pedido do navegador chega às APIs com o mesmo IP (o
// do gateway do Docker). As regras por IP da spec 007 (5 falhas de senha em 15 minutos bloqueiam
// o IP para qualquer e-mail) e os limites de taxa por IP (spec 004, RNF-04: 10 por minuto em
// login, cadastro e redefinição) passariam a valer para a execução inteira, e para a seguinte.
// Então o que é preparo (criar a conta de um aluno, abrir a sessão dele) e as tentativas que
// precisam falhar (senha errada, senha antiga) saem por aqui: o contêiner do worker chama a API
// direto, como um proxy confiável, com `X-Forwarded-For` de um endereço de documentação
// (2001:db8::/32) sorteado a cada chamada. O comportamento em teste continua sendo o das telas.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { ROOT_DIR, USES_LOCAL_COMPOSE } from './env.ts';

const run = promisify(execFile);

export type Service = 'classroom-api' | 'admin-api';

export interface IsolatedRequest {
  method?: string;
  path: string;
  body?: unknown;
  /** Cookies `nome=valor` a enviar. */
  cookies?: string[];
  headers?: Record<string, string>;
  /** IP do cliente; padrão: um novo a cada chamada. */
  ip?: string;
}

export interface IsolatedResponse {
  status: number;
  /** Corpo já lido como JSON (ou o texto, se não for JSON; `null` sem corpo). */
  body: unknown;
  /** Pares `nome=valor` dos `Set-Cookie` da resposta. */
  cookies: Record<string, string>;
}

/** Endereço novo da faixa de documentação IPv6: não colide com o do navegador nem entre si. */
export function freshIp(): string {
  const hex = randomBytes(8).toString('hex');
  return `2001:db8:${hex.slice(0, 4)}:${hex.slice(4, 8)}::${hex.slice(8, 12)}`;
}

// Roda dentro do worker: lê o pedido do argumento e imprime a resposta em uma linha JSON.
const SCRIPT = `
const r = JSON.parse(process.argv[1]);
const headers = { 'x-forwarded-for': r.ip, accept: 'application/json', ...r.headers };
if (r.body !== undefined) headers['content-type'] = 'application/json';
if (r.cookies.length) headers.cookie = r.cookies.join('; ');
fetch('http://' + r.service + ':3000' + r.path, {
  method: r.method, headers, redirect: 'manual',
  body: r.body === undefined ? undefined : JSON.stringify(r.body),
}).then(async (res) => {
  const text = await res.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  const cookies = {};
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  console.log(JSON.stringify({ status: res.status, body, cookies }));
}).catch((e) => { console.error(String(e)); process.exit(2); });
`;

/** Requisição à API pela rede interna, com IP próprio. Precisa do Compose local. */
export async function isolatedRequest(
  service: Service,
  request: IsolatedRequest,
): Promise<IsolatedResponse> {
  if (!USES_LOCAL_COMPOSE) {
    throw new Error('NUVA_E2E_COMPOSE=0: sem docker compose exec para chamar a API por dentro.');
  }
  const payload = JSON.stringify({
    service,
    method: request.method ?? (request.body === undefined ? 'GET' : 'POST'),
    path: request.path,
    body: request.body,
    cookies: request.cookies ?? [],
    headers: request.headers ?? {},
    ip: request.ip ?? freshIp(),
  });
  const { stdout } = await run(
    process.execPath,
    ['scripts/dev.mjs', 'compose', 'exec', '-T', 'worker', 'node', '-e', SCRIPT, payload],
    { cwd: ROOT_DIR, timeout: 30_000 },
  ).catch((error: Error & { stderr?: string }) => {
    // Sem o pedido na mensagem: ele pode levar senha.
    throw new Error(
      `Chamada interna ${request.method ?? ''} ${request.path} à ${service} falhou (pnpm compose exec worker): ${error.stderr ?? error.message}`.slice(
        0,
        2000,
      ),
    );
  });
  const line = stdout.trim().split('\n').pop() ?? '';
  return JSON.parse(line) as IsolatedResponse;
}
