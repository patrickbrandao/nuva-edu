import { businessRule, conflict, DomainError } from '../../errors/domain-error.ts';

// Erros próprios de contas e autenticação (spec 007, "Casos de erro"). Os genéricos
// (`unauthenticated`, `validationFailed`, `rateLimited`...) vêm de `errors/domain-error.ts`.

/** `401 invalid_credentials`: resposta única para qualquer falha de credencial (spec 007). */
export function invalidCredentials(): DomainError {
  return new DomainError({
    code: 'invalid_credentials',
    status: 401,
    title: 'E-mail ou senha incorretos',
  });
}

/** `403 account_suspended`: conta com suspensão `full`, só depois de a senha conferir. */
export function accountSuspended(): DomainError {
  return new DomainError({
    code: 'account_suspended',
    status: 403,
    title: 'Conta suspensa',
    detail: 'A conta está suspensa. Fale com a escola.',
  });
}

/** `403 staff_only`: login certo de `student` no site admin. */
export function staffOnly(): DomainError {
  return new DomainError({
    code: 'staff_only',
    status: 403,
    title: 'Acesso só da equipe',
    detail: 'O painel administrativo é só para a equipe da escola.',
  });
}

/** `429 too_many_attempts`, com `Retry-After` (`retryAfterSeconds`). */
export function tooManyAttempts(retryAfterSeconds: number): DomainError {
  return new DomainError({
    code: 'too_many_attempts',
    status: 429,
    title: 'Muitas tentativas',
    detail: 'Tentativas erradas demais. Espere alguns minutos ou redefina a senha.',
    extras: { retryAfterSeconds },
  });
}

/** `400 password_invalid`: senha fora de 8 a 128 caracteres, vazia ou só de espaços. */
export function passwordInvalid(path = 'body.password'): DomainError {
  return new DomainError({
    code: 'password_invalid',
    status: 400,
    title: 'Senha inválida',
    detail: 'A senha precisa ter de 8 a 128 caracteres.',
    errors: [{ path, message: 'A senha precisa ter de 8 a 128 caracteres.' }],
  });
}

/** `422 current_password_invalid`: senha atual errada ao trocar (conta no bloqueio). */
export function currentPasswordInvalid(): DomainError {
  return businessRule('current_password_invalid', 'A senha atual não confere.');
}

/** `422 password_confirmation_invalid`: senha do admin errada ao exibir senha (conta no bloqueio). */
export function passwordConfirmationInvalid(): DomainError {
  return businessRule('password_confirmation_invalid', 'A sua senha não confere.');
}

/** `403 terms_acceptance_pending`: escrita no classroom com termos pendentes. */
export function termsAcceptancePending(): DomainError {
  return new DomainError({
    code: 'terms_acceptance_pending',
    status: 403,
    title: 'Aceite dos termos pendente',
    detail: 'Aceite as versões vigentes dos termos para continuar.',
  });
}

/** `403 email_not_verified`: comprar, publicar ou enviar mensagem sem e-mail confirmado. */
export function emailNotVerified(): DomainError {
  return new DomainError({
    code: 'email_not_verified',
    status: 403,
    title: 'E-mail não confirmado',
    detail: 'Confirme o seu e-mail pelo link que enviamos.',
  });
}

/** `403 csrf_token_invalid`: escrita sem o `X-CSRF-Token` da sessão, ou com outro valor. */
export function csrfTokenInvalid(): DomainError {
  return new DomainError({
    code: 'csrf_token_invalid',
    status: 403,
    title: 'Token CSRF inválido',
    detail: 'Recarregue a página e tente de novo.',
  });
}

/** `422 last_login_method`: remover o último método de acesso da conta. */
export function lastLoginMethod(): DomainError {
  return businessRule(
    'last_login_method',
    'A conta precisa manter uma senha ou um provedor vinculado.',
  );
}

/** `422 last_admin`: rebaixar, suspender ou excluir o último admin ativo. */
export function lastAdmin(): DomainError {
  return businessRule('last_admin', 'Precisa existir ao menos um admin ativo.');
}

/** `422 image_purpose_mismatch`: imagem de outra finalidade usada como avatar. */
export function imagePurposeMismatch(): DomainError {
  return businessRule('image_purpose_mismatch', 'A imagem não foi enviada como avatar.');
}

/** `409 email_taken`: e-mail já cadastrado (equipe, edição, cadastro social com e-mail digitado). */
export function emailTaken(): DomainError {
  return conflict('email_taken', 'Já existe uma conta com este e-mail.');
}
