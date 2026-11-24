import { type SqlBool, sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { rateLimited } from '../../errors/domain-error.ts';
import { consumeEmailToken, tokenExpired } from '../notifications/email-tokens.ts';
import { enqueueEmail } from '../notifications/outbox.ts';

// Confirmação de e-mail (spec 007, "Confirmação de e-mail"). Dono do uso do token: classroom-api.

/** Reenvios de `account.verify_email` por usuário por hora (o do cadastro conta). */
export const EMAIL_RESEND_LIMIT_PER_HOUR = 3;
const ONE_HOUR_SECONDS = 3600;

/**
 * `POST /auth/email/verify`: usa o token `verify` e confirma o e-mail. Token vencido, usado,
 * desconhecido, ou de conta excluída: `410 token_expired`.
 */
export async function verifyEmail(db: Database, token: string): Promise<{ userId: string }> {
  return db.transaction().execute(async (trx) => {
    const { userId } = await consumeEmailToken(trx, token, 'verify');
    const updated = await trx
      .updateTable('users')
      .set({ emailVerifiedAt: sql<Date>`coalesce(email_verified_at, now())` })
      .where('id', '=', userId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (updated.numUpdatedRows === 0n) {
      throw tokenExpired();
    }
    return { userId };
  });
}

export interface ResendResult {
  /** `false` quando o e-mail já estava confirmado (`204` sem envio). */
  sent: boolean;
}

/**
 * `POST /auth/email/resend` (com sessão): enfileira um novo link, até 3 por hora por usuário
 * (`429 rate_limited`, com `retryAfterSeconds`). E-mail já confirmado: nada a enviar.
 */
export async function resendVerificationEmail(db: Database, userId: string): Promise<ResendResult> {
  return db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`email_resend:${userId}`}, 0))`.execute(
      trx,
    );
    const user = await trx
      .selectFrom('users')
      .select('emailVerifiedAt')
      .where('id', '=', userId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
    if (!user || user.emailVerifiedAt !== null) {
      return { sent: false };
    }
    const recent = await trx
      .selectFrom('emailOutbox')
      .select([
        sql<number>`count(*)::int`.as('count'),
        sql<
          number | null
        >`ceil(extract(epoch FROM min(created_at) + interval '1 hour' - now()))::int`.as(
          'retryAfter',
        ),
      ])
      .where('userId', '=', userId)
      .where('type', '=', 'account.verify_email')
      .where(sql<SqlBool>`created_at > now() - interval '1 hour'`)
      .executeTakeFirstOrThrow();
    if (recent.count >= EMAIL_RESEND_LIMIT_PER_HOUR) {
      const retryAfter = Math.min(
        ONE_HOUR_SECONDS,
        Math.max(1, recent.retryAfter ?? ONE_HOUR_SECONDS),
      );
      throw rateLimited(retryAfter, 'Limite de 3 envios por hora atingido.');
    }
    await enqueueEmail(trx, { userId, type: 'account.verify_email', data: {} });
    return { sent: true };
  });
}
