import type { TaxIdType } from './types.ts';

// CPF e CNPJ do comprador (spec 011, "Dados do comprador"): validados por dígito verificador e
// guardados só com os caracteres, sem pontuação. O CNPJ alfanumérico da Receita (2026) é aceito:
// as doze primeiras posições podem ser letras ou números, as duas últimas são os dígitos
// verificadores. Cada caractere vale `código ASCII − 48` no cálculo, então "A" vale 17.

const NON_ALPHANUMERIC = /[^0-9A-Za-z]/g;
const CNPJ_LENGTH = 14;

/** Só os caracteres do documento, em maiúsculas (letras do CNPJ alfanumérico). */
export function normalizeTaxId(value: string): string {
  return value.replace(NON_ALPHANUMERIC, '').toUpperCase();
}

export function isValidCpf(value: string): boolean {
  const cpf = normalizeTaxId(value);
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  const digits = [...cpf].map(Number);
  for (const position of [9, 10]) {
    let sum = 0;
    for (let index = 0; index < position; index += 1) {
      sum += (digits[index] as number) * (position + 1 - index);
    }
    const check = ((sum * 10) % 11) % 10;
    if (digits[position] !== check) return false;
  }
  return true;
}

export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeTaxId(value);
  if (cnpj.length !== CNPJ_LENGTH) return false;
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;
  const chars = [...cnpj];
  const characterValue = (char: string): number => char.charCodeAt(0) - 48;
  const weights = [
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  ];
  for (let round = 0; round < 2; round += 1) {
    const roundWeights = weights[round] as number[];
    let sum = 0;
    for (let index = 0; index < roundWeights.length; index += 1) {
      sum += characterValue(chars[index] as string) * (roundWeights[index] as number);
    }
    const remainder = sum % 11;
    const check = remainder < 2 ? 0 : 11 - remainder;
    if (Number(chars[12 + round]) !== check) return false;
  }
  return true;
}

/** Documento normalizado quando válido; `null` quando inválido. */
export function validateTaxId(value: string, type: TaxIdType): string | null {
  if (type === 'cpf') return isValidCpf(value) ? normalizeTaxId(value) : null;
  return isValidCnpj(value) ? normalizeTaxId(value) : null;
}
