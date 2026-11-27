import type { Database } from '@nuva-edu/core';

const PERMANENT_RECIPIENT_FAILURE = /^smtp: EENVELOPE 5\d\d \(recusa permanente\)$/;

export const isPermanentRecipientError = (message: string) =>
  PERMANENT_RECIPIENT_FAILURE.test(message);

export async function emailRejectionStreak(
  db: Database,
  userId: string,
  address: string,
): Promise<number> {
  const attempts = await db
    .selectFrom('emailOutbox')
    .select(['status', 'lastError'])
    .where('userId', '=', userId)
    .where('to', '=', address)
    .where('attempts', '>', 0)
    .where((eb) => eb.or([eb('lastError', 'is', null), eb('lastError', 'not like', 'skipped:%')]))
    .orderBy('createdAt', 'desc')
    .orderBy('id', 'desc')
    .limit(4)
    .execute();
  let streak = 0;
  for (const attempt of attempts) {
    if (attempt.status !== 'failed' || !isPermanentRecipientError(attempt.lastError ?? '')) break;
    streak += 1;
  }
  return streak;
}
