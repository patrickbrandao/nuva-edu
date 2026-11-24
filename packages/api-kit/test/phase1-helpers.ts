import { Readable } from 'node:stream';
import { DomainError, unauthenticated } from '@nuva-edu/core';
import type { FastifyInstance } from 'fastify';
import {
  type ApiAppOptions,
  loadContract,
  type OperationOptions,
  readApiCookie,
  type UploadedFile,
} from '../src/index.ts';
import { buildApp } from './helpers.ts';

export const PHASE1_FIXTURE = new URL('./fixtures/phase1.yaml', import.meta.url);

export const CSRF = 'token-csrf-de-teste';
export const SECRET = 'segredo-de-teste-com-pelo-menos-32-caracteres';

/** Sessão de teste: o valor do cookie `nuva_admin_session` é o id do usuário. */
export const security: NonNullable<ApiAppOptions['security']> = {
  sessionCookie: (request) => {
    if (readApiCookie(request, 'admin', 'session') === null) {
      throw unauthenticated();
    }
  },
  csrfToken: (request) => {
    if (request.headers['x-csrf-token'] !== CSRF) {
      throw new DomainError({ code: 'csrf_token_invalid', status: 403, title: 'CSRF' });
    }
  },
};

export type Handlers = Partial<
  Record<string, (app: FastifyInstance) => Parameters<FastifyInstance['operation']>[1]>
>;

/**
 * App sobre o contrato da Fase 1, com todas as operações registradas. Cada teste troca o
 * tratador que quiser em `handlers` e as opções de cada operação em `operationOptions`.
 */
export function buildPhase1App(
  overrides: Partial<ApiAppOptions> & { withoutCookieSecret?: boolean } = {},
  handlers: Handlers = {},
  operationOptions: Record<string, OperationOptions> = {},
) {
  const { withoutCookieSecret, ...options } = overrides;
  const built = buildApp({
    contract: loadContract(PHASE1_FIXTURE),
    security,
    ...(withoutCookieSecret ? {} : { cookieSecret: SECRET }),
    ...options,
  });
  const { app } = built;
  const defaults: Required<Handlers> = {
    getSession: () => (request) => ({
      userId: readApiCookie(request, 'admin', 'session') ?? '',
    }),
    login: () => (_request, reply) => reply.status(204).send(),
    oauthCallback: () => (_request, reply) => reply.redirect('/entrar?erro=oauth_denied', 302),
    oauthCallbackForm: () => (_request, reply) => reply.redirect('/', 302),
    uploadImage: () => (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const file = body.file as UploadedFile;
      reply.status(201);
      return { purpose: body.purpose as string, size: file.size };
    },
    updateUser: () => () => ({}),
    revealUserPassword: () => () => ({ password: 'senha-de-teste' }),
  };
  for (const [operationId, make] of Object.entries({ ...defaults, ...handlers })) {
    if (make) {
      app.operation(operationId, make(app), operationOptions[operationId]);
    }
  }
  return built;
}

/** Cabeçalhos de uma escrita autenticada. */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: 'nuva_admin_session=u1', 'x-csrf-token': CSRF, ...extra };
}

export interface MultipartPart {
  name: string;
  value: string | Buffer;
  filename?: string;
  contentType?: string;
}

export const BOUNDARY = 'nuvaBoundary7MA4YWxkTrZu0gW';

/** Corpo `multipart/form-data` montado à mão, na ordem das partes. */
export function multipart(parts: readonly MultipartPart[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    const disposition =
      part.filename === undefined
        ? `form-data; name="${part.name}"`
        : `form-data; name="${part.name}"; filename="${part.filename}"`;
    const type = part.contentType ? `\r\nContent-Type: ${part.contentType}` : '';
    chunks.push(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: ${disposition}${type}\r\n\r\n`));
    chunks.push(typeof part.value === 'string' ? Buffer.from(part.value) : part.value);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

export const MULTIPART_HEADERS = { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` };

/**
 * Corpo que nunca acaba: o começo de um multipart com arquivo e, depois, bytes sem fim.
 * `pulled()` diz quanto o servidor chegou a pedir.
 */
export function endlessUpload(chunkSize = 16 * 1024): { stream: Readable; pulled: () => number } {
  let pulled = 0;
  let first = true;
  const stream = new Readable({
    read() {
      const chunk = first
        ? Buffer.concat([
            Buffer.from(
              `--${BOUNDARY}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\navatar\r\n` +
                `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n` +
                'Content-Type: image/png\r\n\r\n',
            ),
            Buffer.alloc(chunkSize, 1),
          ])
        : Buffer.alloc(chunkSize, 1);
      first = false;
      pulled += chunk.length;
      setImmediate(() => this.push(chunk));
    },
  });
  return { stream, pulled: () => pulled };
}
