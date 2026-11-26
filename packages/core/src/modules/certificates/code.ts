// Código do certificado (spec 015, RNF-04): 12 caracteres de um alfabeto sem ambiguidades,
// gerados com aleatoriedade criptográfica. Guardado sem hífen e em maiúsculas; exibido como
// `XXXX-XXXX-XXXX` (`formatCertificateCode`, em `template/values.ts`).

import { randomInt } from 'node:crypto';

/** 31 símbolos: dígitos sem `0` e `1`, letras sem `I`, `L` e `O` (o CHECK da migration 0012). */
export const CERTIFICATE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CERTIFICATE_CODE_LENGTH = 12;

const CODE_PATTERN = /^[2-9A-HJKMNP-Z]{12}$/;
/** Entrada maior que isto nem é examinada (o contrato limita o código a 32 caracteres). */
const CODE_INPUT_MAX_LENGTH = 64;

/** Um código novo, sem hífen: 31^12 combinações (cerca de 59 bits). */
export function generateCertificateCode(): string {
  let code = '';
  for (let index = 0; index < CERTIFICATE_CODE_LENGTH; index += 1) {
    code += CERTIFICATE_CODE_ALPHABET[randomInt(CERTIFICATE_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * O código como o banco o guarda: sem hífens nem espaços, em maiúsculas. Entrada que não é um
 * código (tamanho, símbolo fora do alfabeto, não é texto): `null`.
 */
export function normalizeCertificateCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > CODE_INPUT_MAX_LENGTH) return null;
  const compact = input.replace(/[\s-]/g, '').toUpperCase();
  return CODE_PATTERN.test(compact) ? compact : null;
}
