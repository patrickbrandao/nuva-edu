import type { FastifyInstance } from '@nuva-edu/api-kit';
import {
  conflict,
  type Database,
  enqueue,
  managementAuditContext,
  notFound,
  recordAudit,
  validationFailed,
} from '@nuva-edu/core';
import { managementRequest } from '../session.ts';

// E-mails na tela "Operação" (specs 024, "E-mail", e 033, "Tela Operação"): só o `admin`
// (`ops.manage`, conferida pelo tratador de `sessionCookie`). Lista pendentes e com falha com o
// destinatário mascarado e o motivo do SMTP; "reenviar" devolve `failed` a `queued` e enfileira
// `email.send` de novo. O corpo do e-mail não é guardado e não aparece aqui.

export interface EmailOperationsRoutesOptions {
  db: Database;
}

type OpsEmailStatus = 'queued' | 'failed';

const PAGE_DEFAULT_LIMIT = 25;
const PAGE_MAX_LIMIT = 100;
const CURSOR_PREFIX = 'ops-emails:';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OutboxRow {
  id: string;
  type: string;
  to: string;
  subject: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
}

/** `OpsEmail` do contrato, com o destinatário mascarado (spec 033). */
function emailBody(row: OutboxRow) {
  return {
    id: row.id,
    type: row.type,
    to: maskEmail(row.to),
    subject: row.subject,
    status: row.status as OpsEmailStatus,
    attempts: row.attempts,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * `a***@exemplo.com`: a primeira letra e o domínio, para a equipe reconhecer o destinatário sem
 * expor o endereço inteiro. Endereço fora do formato (não deveria existir) fica todo mascarado.
 */
export function maskEmail(value: string): string {
  const at = value.lastIndexOf('@');
  if (at <= 0) {
    return value.length <= 1 ? '***' : `${value[0]}***`;
  }
  return `${value[0]}***${value.slice(at)}`;
}

/** Cursor opaco com o id do último item: a data é lida do banco, sem perder microssegundos. */
function encodeCursor(id: string): string {
  return Buffer.from(`${CURSOR_PREFIX}${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): string | null {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!text.startsWith(CURSOR_PREFIX)) {
    return null;
  }
  const id = text.slice(CURSOR_PREFIX.length);
  return UUID_PATTERN.test(id) ? id.toLowerCase() : null;
}

export function registerEmailOperationsRoutes(
  app: FastifyInstance,
  options: EmailOperationsRoutesOptions,
): void {
  const { db } = options;

  app.operation('listOpsEmails', async (request) => {
    const query = request.query as {
      status?: OpsEmailStatus;
      type?: string;
      limit?: number;
      cursor?: string;
    };
    const limit = query.limit ?? PAGE_DEFAULT_LIMIT;
    if (limit < 1 || limit > PAGE_MAX_LIMIT) {
      throw validationFailed([{ path: 'query.limit', message: `Use de 1 a ${PAGE_MAX_LIMIT}.` }]);
    }
    const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);
    if (query.cursor !== undefined && cursor === null) {
      throw validationFailed([{ path: 'query.cursor', message: 'Cursor inválido.' }]);
    }
    const statuses: OpsEmailStatus[] =
      query.status === undefined ? ['queued', 'failed'] : [query.status];
    let list = db
      .selectFrom('emailOutbox')
      .select(['id', 'type', 'to', 'subject', 'status', 'attempts', 'lastError', 'createdAt'])
      .where('status', 'in', statuses)
      .orderBy('createdAt', 'asc')
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (query.type !== undefined) {
      list = list.where('type', '=', query.type);
    }
    if (cursor !== null) {
      list = list.where((eb) => {
        const cursorAt = eb
          .selectFrom('emailOutbox as c')
          .select('c.createdAt')
          .where('c.id', '=', cursor);
        return eb.or([
          eb('emailOutbox.createdAt', '>', cursorAt),
          eb.and([eb('emailOutbox.createdAt', '=', cursorAt), eb('emailOutbox.id', '>', cursor)]),
        ]);
      });
    }
    const rows = await list.execute();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      items: page.map(emailBody),
      nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    };
  });

  app.operation('retryOpsEmail', async (request, reply) => {
    const { id } = request.params as { id: string };
    const context = managementAuditContext(managementRequest(request));
    const saved = await db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('emailOutbox')
        .select(['id', 'type', 'to', 'subject', 'status', 'attempts', 'lastError', 'createdAt'])
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined) {
        throw notFound('E-mail não encontrado.');
      }
      if (row.status !== 'failed') {
        throw conflict('email_not_failed', 'Só um e-mail com falha pode ser reenviado.');
      }
      const updated = await trx
        .updateTable('emailOutbox')
        .set({ status: 'queued', attempts: 0, sentAt: null })
        .where('id', '=', id)
        .where('status', '=', 'failed')
        .returning(['id', 'type', 'to', 'subject', 'status', 'attempts', 'lastError', 'createdAt'])
        .executeTakeFirstOrThrow();
      // As tentativas da RNF-02 voltam com uma tarefa nova; `last_error` fica como registro.
      await enqueue(trx, 'email.send', { outboxId: id });
      await recordAudit(trx, {
        context,
        action: 'email.retry',
        targetType: 'email',
        targetId: id,
        details: { type: row.type },
      });
      return updated;
    });
    return reply.status(202).send(emailBody(saved));
  });
}
