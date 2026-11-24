import { randomInt, randomUUID } from 'node:crypto';
import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  createAccount,
  type Database,
  issueEmailToken,
  normalizeEmail,
  type Role,
} from '@nuva-edu/core';
import { createTestDatabase, parseDatabaseUrl } from '@nuva-edu/database';

/**
 * Senha das contas de teste. A varredura procura este texto em toda resposta HTTP e em todo log
 * da suíte: ele só pode aparecer nos corpos das requisições.
 */
export const TEST_PASSWORD = 'Varredura-senha-7Q4kZ!';
/** Outra senha, para trocas e redefinições; também vigiada pela varredura. */
export const OTHER_PASSWORD = 'Varredura-outra-3Xw9P#';

export const COOKIE = 'nuva_classroom_session';

/** E-mail único por chamada: a suíte divide o banco entre os arquivos. */
export function uniqueEmail(prefix = 'aluno'): string {
  return `${prefix}-${randomUUID()}@example.com`;
}

// O bloqueio por IP (5 falhas em 15 min) e o limite por IP valem para o banco inteiro: cada
// cliente de teste usa um IP próprio, do bloco 198.18.0.0/15 (testes de rede, RFC 2544).
let ipSequence = randomInt(0, 60_000);
export function uniqueIp(): string {
  ipSequence = (ipSequence + 1) % 65_536;
  return `198.18.${ipSequence >> 8}.${ipSequence & 255}`;
}

export interface TestUser {
  id: string;
  email: string;
}

export interface CreateUserOptions {
  /** `null`: conta sem senha (só provedor). Padrão: `TEST_PASSWORD`. */
  password?: string | null;
  verified?: boolean;
  role?: Role;
  name?: string;
}

/** Cria a conta direto pelo núcleo (sem passar pelo cadastro). */
export async function createUser(db: Database, options: CreateUserOptions = {}): Promise<TestUser> {
  const email = normalizeEmail(uniqueEmail());
  const id = await db.transaction().execute((trx) =>
    createAccount(trx, {
      email,
      name: options.name ?? 'Aluna de Teste',
      password: options.password === undefined ? TEST_PASSWORD : options.password,
      role: options.role ?? 'student',
      emailVerified: options.verified ?? true,
    }),
  );
  return { id, email };
}

/** Token de link de e-mail, como o worker o geraria ao enviar. */
export function emailToken(db: Database, userId: string, purpose: 'verify' | 'reset') {
  return db
    .transaction()
    .execute((trx) => issueEmailToken(trx, userId, purpose))
    .then((issued) => issued.token);
}

export interface Reply {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  body: string;
  // biome-ignore lint/suspicious/noExplicitAny: corpo lido nos testes, conferido por `toMatchObject`.
  json(): any;
  cookies: Array<{ name: string; value: string; maxAge?: number; [key: string]: unknown }>;
}

export interface RequestOptions {
  payload?: unknown;
  headers?: Record<string, string>;
  /** Manda o `X-CSRF-Token` da sessão. Padrão: `true` nas escritas. */
  csrf?: boolean;
}

/**
 * Um navegador de teste: guarda o cookie da sessão e o token CSRF, e fala sempre do mesmo IP.
 * Toda resposta passa por `onReply` (a varredura da senha).
 */
export class Browser {
  readonly ip = uniqueIp();
  cookie: string | null = null;
  csrfToken: string | null = null;

  private readonly app: FastifyInstance;
  private readonly onReply: (reply: Reply) => void;

  constructor(app: FastifyInstance, onReply: (reply: Reply) => void = () => {}) {
    this.app = app;
    this.onReply = onReply;
  }

  async request(method: string, url: string, options: RequestOptions = {}): Promise<Reply> {
    const write = !['GET', 'HEAD'].includes(method);
    const headers: Record<string, string> = { 'user-agent': TEST_USER_AGENT };
    if (this.cookie !== null) {
      headers.cookie = `${COOKIE}=${this.cookie}`;
    }
    if ((options.csrf ?? write) && this.csrfToken !== null) {
      headers['x-csrf-token'] = this.csrfToken;
    }
    const response = await this.app.inject({
      method: method as 'GET',
      url,
      remoteAddress: this.ip,
      headers: { ...headers, ...options.headers },
      ...(options.payload === undefined
        ? {}
        : { payload: options.payload as Record<string, unknown> }),
    });
    const reply = response as unknown as Reply;
    for (const cookie of reply.cookies) {
      if (cookie.name === COOKIE) {
        this.cookie = cookie.maxAge === 0 || cookie.value === '' ? null : cookie.value;
      }
    }
    this.onReply(reply);
    return reply;
  }

  /** Entra por senha e guarda o token CSRF da sessão. */
  async login(email: string, password: string = TEST_PASSWORD): Promise<Reply> {
    const reply = await this.request('POST', '/api/v1/auth/login', {
      payload: { email, password },
    });
    if (reply.statusCode === 200) {
      this.csrfToken = reply.json().csrfToken;
    }
    return reply;
  }
}

export const TEST_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/**
 * Um banco só para o arquivo de teste, copiado do mesmo modelo do banco da execução. Para os
 * testes que publicam termos: versão publicada não se apaga, e deixaria todas as contas dos
 * outros arquivos com o aceite pendente.
 */
export async function isolatedDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  const runUrl = process.env.DATABASE_URL;
  if (!runUrl) {
    throw new Error('DATABASE_URL ausente: o globalSetup do Vitest não rodou.');
  }
  const config = parseDatabaseUrl(runUrl);
  const baseName = config.database.replace(/_test_.*$/, '');
  const database = await createTestDatabase({ config, baseName });
  return { url: database.url, drop: database.drop };
}
