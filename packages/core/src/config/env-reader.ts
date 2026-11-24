/** Um problema de configuração: sempre aponta a variável de ambiente responsável. */
export interface ConfigIssue {
  variable: string;
  message: string;
}

/** Configuração inválida. A mensagem cita cada variável com problema. */
export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    const lines = issues.map((issue) => `  - ${issue.variable}: ${issue.message}`);
    super(`Configuração inválida:\n${lines.join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export type Env = Readonly<Record<string, string | undefined>>;

interface IntRange {
  min?: number;
  max?: number;
}

/**
 * Lê variáveis de ambiente acumulando os problemas, para que um único erro liste tudo o que
 * falta. Valor vazio ou só com espaços conta como ausente.
 */
export class EnvReader {
  readonly issues: ConfigIssue[] = [];
  readonly #env: Env;

  constructor(env: Env) {
    this.#env = env;
  }

  fail(variable: string, message: string): void {
    this.issues.push({ variable, message });
  }

  optional(name: string): string | null {
    const value = this.#env[name]?.trim();
    return value ? value : null;
  }

  string(name: string, fallback: string): string {
    return this.optional(name) ?? fallback;
  }

  /** Sem valor padrão: registra o problema quando `required` e a variável falta. */
  secret(name: string, required: boolean): string | null {
    const value = this.optional(name);
    if (value === null && required) {
      this.fail(name, 'obrigatória e não definida (veja .env.example)');
    }
    return value;
  }

  int(name: string, fallback: number, range: IntRange = {}): number {
    const raw = this.optional(name);
    if (raw === null) {
      return fallback;
    }
    return this.parseInt(name, raw, range) ?? fallback;
  }

  parseInt(name: string, raw: string, range: IntRange = {}): number | null {
    const min = range.min ?? 0;
    const max = range.max ?? Number.MAX_SAFE_INTEGER;
    const value = /^-?\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      const limit = range.max === undefined ? `maior ou igual a ${min}` : `entre ${min} e ${max}`;
      this.fail(name, `deve ser um inteiro ${limit}; recebido "${raw}"`);
      return null;
    }
    return value;
  }

  oneOf<const T extends string>(name: string, fallback: T, allowed: readonly T[]): T {
    const raw = this.optional(name);
    if (raw === null) {
      return fallback;
    }
    if (!(allowed as readonly string[]).includes(raw)) {
      this.fail(name, `deve ser um de: ${allowed.join(', ')}; recebido "${raw}"`);
      return fallback;
    }
    return raw as T;
  }

  matching(name: string, fallback: string, pattern: RegExp, expected: string): string {
    const value = this.string(name, fallback);
    if (!pattern.test(value)) {
      this.fail(name, `${expected}; recebido "${value}"`);
    }
    return value;
  }

  throwIfInvalid(): void {
    if (this.issues.length > 0) {
      throw new ConfigError(this.issues);
    }
  }
}
