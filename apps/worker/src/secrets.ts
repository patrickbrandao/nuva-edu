import type { SecretVariable } from '@nuva-edu/core';

/**
 * Segredos que o worker exige na subida (spec 031, "Segredos exigidos"). `SMTP_PASSWORD` só
 * quando `SMTP_USER` está definido (spec 024): sem usuário, o envio é sem autenticação.
 */
export function workerRequiredSecrets(
  env: Readonly<Record<string, string | undefined>>,
): SecretVariable[] {
  return env.SMTP_USER?.trim() ? ['SMTP_PASSWORD'] : [];
}
