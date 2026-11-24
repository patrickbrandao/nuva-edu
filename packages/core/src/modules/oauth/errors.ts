import { conflict, type DomainError } from '../../errors/domain-error.ts';

// Erros do login social (spec 007, "Casos de erro" e "Fluxo do provedor").

/** `409 identity_in_use`: a identidade do provedor já está vinculada a outra conta. */
export function identityInUse(): DomainError {
  return conflict('identity_in_use', 'Esta conta do provedor já está vinculada a outro usuário.');
}

/** `409 provider_already_linked`: a conta já tem outra identidade deste provedor. */
export function providerAlreadyLinked(): DomainError {
  return conflict(
    'provider_already_linked',
    'A conta já tem este provedor vinculado. Remova o atual para vincular outro.',
  );
}

/**
 * Códigos que o retorno OAuth leva ao site na consulta `erro` (spec 007, "Fluxo do provedor").
 * O retorno nunca responde com corpo de erro: sempre `302` com um destes.
 */
export const OAUTH_CALLBACK_ERRORS = [
  'oauth_state_invalid',
  'oauth_denied',
  'oauth_provider_error',
  'account_suspended',
  'staff_only',
  'identity_in_use',
  'provider_already_linked',
] as const;
export type OAuthCallbackError = (typeof OAUTH_CALLBACK_ERRORS)[number];

export function isOAuthCallbackError(value: unknown): value is OAuthCallbackError {
  return typeof value === 'string' && (OAUTH_CALLBACK_ERRORS as readonly string[]).includes(value);
}

/**
 * Falha na conversa com o provedor: troca do código recusada, `id_token` inválido, provedor
 * fora do ar, resposta fora do formato. Vira `oauth_provider_error` no retorno. A mensagem é
 * para o log e nunca leva código, token nem segredo.
 */
export class OAuthProviderError extends Error {
  override readonly name = 'OAuthProviderError';
}
