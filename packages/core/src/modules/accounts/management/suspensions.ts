import { type SqlBool, sql } from 'kysely';
import type { Database } from '../../../db/database.ts';
import { conflict, type FieldError, validationFailed } from '../../../errors/domain-error.ts';
import { type AuditContext, recordAudit } from '../../audit/record.ts';
import { notify } from '../../notifications/central.ts';
import { assertUserManagement } from '../../permissions/management.ts';
import { assertNotLastActiveAdmin } from '../admin.ts';
import { revokeUserSessions } from '../sessions.ts';
import {
  loadTarget,
  type ManagementRequest,
  managementAuditContext,
  requireUserManagement,
} from './common.ts';
import { readUserDetail, type SuspensionKind, type UserDetail } from './views.ts';

// Suspensão e reativação (spec 008, "Suspensão"; spec 026). Cada suspensão é uma linha de
// `user_suspensions`; `users.suspended_*` espelham a vigente. Dono: admin-api; o worker só
// encerra no fim do prazo (`suspension.expire`).

export const SUSPENSION_KINDS = ['posting', 'full'] as const;
/** Prazos aceitos, em dias; `null` é por tempo indeterminado. */
export const SUSPENSION_DURATION_DAYS = [1, 7, 30] as const;
export const SUSPENSION_REASON_MAX_LENGTH = 500;
/** Quantas suspensões vencidas `expireSuspensions` encerra por chamada, no máximo. */
export const SUSPENSION_EXPIRE_BATCH = 500;

/** `409 already_suspended`: para mudar tipo ou prazo, reativa e suspende de novo. */
export function alreadySuspended(): ReturnType<typeof conflict> {
  return conflict(
    'already_suspended',
    'O usuário já está suspenso. Reative antes de suspender de novo.',
  );
}

/** `409 not_suspended`: reativar quem não tem suspensão vigente. */
export function notSuspended(): ReturnType<typeof conflict> {
  return conflict('not_suspended', 'O usuário não está suspenso.');
}

export interface SuspendUserInput {
  kind: unknown;
  /** Motivo interno (1 a 500 caracteres), visível só à equipe; não vai no e-mail. */
  reason: unknown;
  /** 1, 7, 30 ou `null` (indeterminado). */
  durationDays: unknown;
}

/**
 * `POST /users/{id}/suspend`. Aluno: `users.suspend` (`manager` e `admin`); equipe:
 * `staff.manage` (só `admin`; `manager` recebe `403`, gravado na auditoria). A si mesmo: `422
 * self_action_not_allowed`; já suspenso: `409 already_suspended`; último admin ativo: `422
 * last_admin`; corpo fora do formato: `400 validation_failed`.
 *
 * Grava a linha de `user_suspensions` e o espelho em `users`; `full` encerra todas as sessões
 * nos dois sites (a validação da sessão já recusa a conta, e o SSE cai com ela); enfileira
 * `moderation.suspended` com o tipo e o prazo, sem o motivo; grava `user.suspend`.
 */
export async function suspendUser(
  db: Database,
  request: ManagementRequest,
  userId: string,
  input: SuspendUserInput,
): Promise<UserDetail> {
  const target = await loadTarget(db, userId);
  await requireUserManagement(db, request, 'suspend', target, 'user.suspend');
  const { kind, reason, durationDays } = parseSuspension(input);
  return db.transaction().execute(async (trx) => {
    // Trava dos admins antes da linha: a mesma ordem do admin inicial e do `create-admin`. Conta
    // já suspensa não é admin ativo, então passa aqui e recebe `already_suspended` abaixo.
    await assertNotLastActiveAdmin(trx, target.id);
    const current = await loadTarget(trx, target.id, { forUpdate: true });
    assertUserManagement(request.actor, 'suspend', current);
    if (current.suspended) {
      throw alreadySuspended();
    }
    const endsAt =
      durationDays === null ? null : sql<Date>`now() + make_interval(days => ${durationDays})`;
    const suspension = await trx
      .insertInto('userSuspensions')
      .values({
        userId: current.id,
        kind,
        reason,
        endsAt,
        createdBy: request.actor.id,
      })
      .returning(['id', 'startsAt', 'endsAt'])
      .executeTakeFirstOrThrow();
    await trx
      .updateTable('users')
      .set({
        suspendedAt: suspension.startsAt,
        suspendedKind: kind,
        suspendedReason: reason,
        suspendedBy: request.actor.id,
        version: sql<number>`version + 1`,
        updatedAt: sql<Date>`now()`,
      })
      .where('id', '=', current.id)
      .execute();
    const sessionsRevoked = kind === 'full' ? await revokeUserSessions(trx, current.id) : 0;
    await notify(trx, 'moderation.suspended', current.id, {
      actorId: request.actor.id,
      targetType: 'user',
      targetId: current.id,
      data: { kind, endsAt: suspension.endsAt?.toISOString() ?? null },
    });
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'user.suspend',
      targetType: 'user',
      targetId: current.id,
      details: {
        suspensionId: suspension.id,
        kind,
        reason,
        durationDays,
        endsAt: suspension.endsAt,
        sessionsRevoked,
      },
    });
    return readUserDetail(trx, current.id);
  });
}

function parseSuspension(input: SuspendUserInput): {
  kind: SuspensionKind;
  reason: string;
  durationDays: number | null;
} {
  const errors: FieldError[] = [];
  if (!(SUSPENSION_KINDS as readonly unknown[]).includes(input.kind)) {
    errors.push({ path: 'body.kind', message: 'Use posting ou full.' });
  }
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason === '' || [...reason].length > SUSPENSION_REASON_MAX_LENGTH) {
    errors.push({
      path: 'body.reason',
      message: `Informe o motivo, até ${SUSPENSION_REASON_MAX_LENGTH} caracteres.`,
    });
  }
  const { durationDays } = input;
  if (
    durationDays !== null &&
    !(SUSPENSION_DURATION_DAYS as readonly unknown[]).includes(durationDays)
  ) {
    errors.push({ path: 'body.durationDays', message: 'Use 1, 7, 30 ou null.' });
  }
  if (errors.length > 0) {
    throw validationFailed(errors);
  }
  return {
    kind: input.kind as SuspensionKind,
    reason,
    durationDays: durationDays as number | null,
  };
}

/**
 * `POST /users/{id}/reactivate`, com a mesma permissão da suspensão. A si mesmo: `422
 * self_action_not_allowed`; sem suspensão vigente: `409 not_suspended`. Preenche `lifted_at`,
 * limpa o espelho em `users` e grava `user.unsuspend`. Sessões e chaves MCP não voltam sozinhas.
 */
export async function reactivateUser(
  db: Database,
  request: ManagementRequest,
  userId: string,
): Promise<UserDetail> {
  const target = await loadTarget(db, userId);
  await requireUserManagement(db, request, 'reactivate', target, 'user.unsuspend');
  return db.transaction().execute(async (trx) => {
    const current = await loadTarget(trx, target.id, { forUpdate: true });
    assertUserManagement(request.actor, 'reactivate', current);
    if (!current.suspended) {
      throw notSuspended();
    }
    const lifted = await liftSuspension(trx, current.id);
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'user.unsuspend',
      targetType: 'user',
      targetId: current.id,
      details: { suspensionIds: lifted, reason: 'reactivated' },
    });
    return readUserDetail(trx, current.id);
  });
}

/** Encerra as suspensões abertas do usuário e limpa o espelho. Devolve os ids encerrados. */
async function liftSuspension(trx: Database, userId: string): Promise<string[]> {
  const rows = await trx
    .updateTable('userSuspensions')
    .set({ liftedAt: sql<Date>`greatest(now(), starts_at)` })
    .where('userId', '=', userId)
    .where('liftedAt', 'is', null)
    .returning('id')
    .execute();
  await trx
    .updateTable('users')
    .set({
      suspendedAt: null,
      suspendedKind: null,
      suspendedReason: null,
      suspendedBy: null,
      version: sql<number>`version + 1`,
      updatedAt: sql<Date>`now()`,
    })
    .where('id', '=', userId)
    .execute();
  return rows.map((row) => row.id);
}

const WORKER_CONTEXT: AuditContext = { origin: 'worker', actorUserId: null, actorRole: null };

/**
 * Tarefa `suspension.expire` do worker (a cada 15 minutos): encerra as suspensões com prazo
 * vencido, cada uma na própria transação, limpando o espelho em `users` e gravando
 * `user.unsuspend` com `origin = worker`. Suspensão já encerrada no meio (reativação
 * simultânea) é pulada. Devolve quantas encerrou; com `limit` (padrão 500) atingido, o worker
 * pode chamar de novo.
 */
export async function expireSuspensions(
  db: Database,
  options: { limit?: number } = {},
): Promise<number> {
  const limit = options.limit ?? SUSPENSION_EXPIRE_BATCH;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('limit precisa ser um inteiro positivo.');
  }
  const due = await db
    .selectFrom('userSuspensions')
    .select(['id', 'userId'])
    .where('liftedAt', 'is', null)
    .where('endsAt', 'is not', null)
    .where(sql<SqlBool>`ends_at <= now()`)
    .orderBy('endsAt', 'asc')
    .limit(limit)
    .execute();
  let expired = 0;
  for (const suspension of due) {
    const done = await db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('users')
        .select('id')
        .where('id', '=', suspension.userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const row = await trx
        .updateTable('userSuspensions')
        .set({ liftedAt: sql<Date>`now()` })
        .where('id', '=', suspension.id)
        .where('liftedAt', 'is', null)
        .where(sql<SqlBool>`ends_at <= now()`)
        .returning(['id'])
        .executeTakeFirst();
      if (!row) {
        return false;
      }
      const open = await trx
        .selectFrom('userSuspensions')
        .select('id')
        .where('userId', '=', suspension.userId)
        .where('liftedAt', 'is', null)
        .executeTakeFirst();
      if (!open) {
        await trx
          .updateTable('users')
          .set({
            suspendedAt: null,
            suspendedKind: null,
            suspendedReason: null,
            suspendedBy: null,
            version: sql<number>`version + 1`,
            updatedAt: sql<Date>`now()`,
          })
          .where('id', '=', suspension.userId)
          .execute();
      }
      await recordAudit(trx, {
        context: WORKER_CONTEXT,
        action: 'user.unsuspend',
        targetType: 'user',
        targetId: suspension.userId,
        details: { suspensionIds: [row.id], reason: 'expired' },
      });
      return true;
    });
    if (done) {
      expired += 1;
    }
  }
  return expired;
}
