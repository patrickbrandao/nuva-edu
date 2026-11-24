import { createHash, timingSafeEqual } from 'node:crypto';
import { passwordInvalid } from './errors.ts';

// Senha e e-mail (spec 007, RF-05, RF-06, RNF-01, RNF-04). A senha é guardada e comparada em
// texto legível (ADR 0002): não há hash, cifra nem derivação no armazenamento. O SHA-256 abaixo
// existe só durante a comparação, para ela levar o mesmo tempo qualquer que seja o tamanho.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

/** Minúsculas, sem espaços nas pontas (como `users.email` e `login_attempts.email`). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Formato mínimo de e-mail (o contrato já confere `format: email`). */
export function isValidEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return normalized.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(normalized);
}

/** Tamanho em caracteres, como o `length()` do PostgreSQL (`users_password_length`). */
export function passwordLength(password: string): number {
  return [...password].length;
}

/** Vazia, só de espaços ou ausente (RF-05): nunca autentica, nunca é aceita como senha nova. */
export function isBlankPassword(password: unknown): boolean {
  return typeof password !== 'string' || password.trim() === '';
}

/** Senha aceitável como nova: 8 a 128 caracteres e não em branco (RNF-01, RF-05). */
export function isValidPassword(password: unknown): password is string {
  if (typeof password !== 'string' || isBlankPassword(password)) {
    return false;
  }
  const length = passwordLength(password);
  return length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_LENGTH;
}

/** Lança `400 password_invalid` (com `path` do campo) se a senha nova não é aceitável. */
export function assertValidPassword(
  password: unknown,
  path = 'body.password',
): asserts password is string {
  if (!isValidPassword(password)) {
    throw passwordInvalid(path);
  }
}

/** Comparado quando a conta não existe ou não tem senha, para o tempo ser o mesmo (RNF-04). */
const ABSENT_PASSWORD = '\u0000nuva-edu:sem-senha\u0000';

function digest(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}

/**
 * A senha enviada confere com a guardada? Tempo constante (RNF-04): a comparação roda sempre,
 * também sem conta (`stored` nulo ou ausente), sobre resumos de tamanho fixo. Conta sem senha,
 * senha enviada vazia, só de espaços ou que não é texto: sempre `false` (RF-05).
 */
export function passwordMatches(stored: string | null | undefined, given: unknown): boolean {
  const candidate = typeof given === 'string' ? given : '';
  const same = timingSafeEqual(digest(candidate), digest(stored ?? ABSENT_PASSWORD));
  return typeof stored === 'string' && stored !== '' && !isBlankPassword(given) && same;
}

/** Compara dois textos (token CSRF, por exemplo) em tempo constante. */
export function safeTextEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b)) && a.length === b.length;
}
