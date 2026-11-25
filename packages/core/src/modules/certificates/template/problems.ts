// Problemas encontrados na validação do template e a conversão de posição em linha e coluna.

import { DomainError } from '../../../errors/domain-error.ts';
import type { CertificateTemplateRule } from './rules.ts';

/** Um item recusado (spec 015, `details.problems`). `line` e `column` começam em 1. */
export interface CertificateTemplateProblem {
  rule: CertificateTemplateRule;
  message: string;
  line: number;
  column: number;
}

/** Máximo de problemas devolvidos: um template hostil não gera uma resposta de megabytes. */
export const CERTIFICATE_TEMPLATE_MAX_PROBLEMS = 200;

/** Converte a posição (índice no texto) em linha e coluna, contando a partir de 1. */
export class LineMap {
  readonly #starts: number[] = [0];

  constructor(source: string) {
    for (let index = 0; index < source.length; index += 1) {
      if (source.charCodeAt(index) === 10) {
        this.#starts.push(index + 1);
      }
    }
  }

  at(offset: number): { line: number; column: number } {
    const position = Math.max(0, offset);
    let low = 0;
    let high = this.#starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((this.#starts[middle] ?? 0) <= position) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return { line: low + 1, column: position - (this.#starts[low] ?? 0) + 1 };
  }
}

/** Acumula os problemas, até o máximo. */
export class ProblemList {
  readonly items: CertificateTemplateProblem[] = [];
  truncated = false;
  readonly #lines: LineMap;

  constructor(lines: LineMap) {
    this.#lines = lines;
  }

  add(rule: CertificateTemplateRule, message: string, offset: number): void {
    const { line, column } = this.#lines.at(offset);
    this.addAt(rule, message, line, column);
  }

  addAt(rule: CertificateTemplateRule, message: string, line: number, column: number): void {
    if (this.items.length >= CERTIFICATE_TEMPLATE_MAX_PROBLEMS) {
      this.truncated = true;
      return;
    }
    this.items.push({ rule, message, line, column });
  }
}

/** 422 `certificate_template_invalid`, com a lista em `details.problems` (spec 015). */
export function certificateTemplateInvalid(
  problems: readonly CertificateTemplateProblem[],
): DomainError {
  return new DomainError({
    code: 'certificate_template_invalid',
    status: 422,
    title: 'Template do certificado inválido',
    detail: `O template tem ${problems.length} problema(s); nada foi alterado.`,
    extras: { details: { problems } },
  });
}
