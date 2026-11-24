import type { FastifyInstance } from 'fastify';
import { formatContractReport, formatContractWarnings } from './contract-check.ts';

/** Códigos de saída do `check-contract`. */
export const CHECK_CONTRACT_EXIT = {
  /** Contrato e rotas conferem (avisos não contam). */
  ok: 0,
  /** Há divergência, operação pendente com `--no-pending`, ou o app nem pôde ser montado. */
  mismatch: 1,
  /** Opção desconhecida na linha de comando. */
  usage: 2,
} as const;

export interface CheckContractCommandOptions {
  /** Nome do serviço nas mensagens (`admin-api`, `classroom-api`). */
  service: string;
  /**
   * Monta o app com todas as rotas, como na subida, mas sem escutar em porta. Não precisa de
   * banco no ar: a conferência só lê o contrato e as rotas registradas. Use um logger em
   * `silent`, para a saída ser só o relatório.
   */
  build: () => FastifyInstance | Promise<FastifyInstance>;
  /** `operationId` das escritas sem `csrfToken`: a mesma lista do teste de contrato. */
  csrfExceptions?: readonly string[];
  /** Argumentos do comando. Padrão: `process.argv.slice(2)`. */
  argv?: readonly string[];
  /** Saída normal, uma linha por chamada. Padrão: `stdout`. */
  out?: (line: string) => void;
  /** Saída de erro, uma linha por chamada. Padrão: `stderr`. */
  err?: (line: string) => void;
}

const USAGE = [
  'Uso: check-contract [--no-pending]',
  '',
  'Confere as rotas do serviço com o openapi.yaml nos dois sentidos e a regra do csrfToken.',
  '  --no-pending  falha se o contrato tiver operação com x-nuva-pending, com ou sem rota',
  '  --help        mostra esta ajuda',
  '',
  'Saída: 0 quando confere; 1 com divergência ou operação pendente recusada; 2 em uso inválido.',
];

/**
 * O comando `check-contract` da spec 003 ("Subida estrita"), comum às duas APIs: repete a
 * conferência da subida e do teste de contrato e devolve o código de saída. Sem `--no-pending`,
 * operação pendente só gera aviso; com a opção, qualquer pendente é falha, com a lista.
 *
 * ```ts
 * process.exitCode = await runCheckContract({ service: 'admin-api', build, csrfExceptions });
 * ```
 */
export async function runCheckContract(options: CheckContractCommandOptions): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`));
  // O `--` solto é o separador que `pnpm run check-contract -- --no-pending` repassa.
  const args = (options.argv ?? process.argv.slice(2)).filter((arg) => arg !== '--');
  const prefix = `check-contract ${options.service}`;

  if (args.includes('--help') || args.includes('-h')) {
    for (const line of USAGE) {
      out(line);
    }
    return CHECK_CONTRACT_EXIT.ok;
  }
  const unknown = args.filter((arg) => arg !== '--no-pending');
  if (unknown.length > 0) {
    err(`${prefix}: opção desconhecida: ${unknown.join(' ')}`);
    for (const line of USAGE) {
      err(line);
    }
    return CHECK_CONTRACT_EXIT.usage;
  }
  const noPending = args.includes('--no-pending');

  let app: FastifyInstance;
  try {
    app = await options.build();
  } catch (error) {
    // Contrato ilegível, `operationId` que não existe, esquema de segurança sem tratador.
    err(`${prefix}: não foi possível montar o serviço para conferir o contrato:`);
    err(`  ${error instanceof Error ? error.message : String(error)}`);
    return CHECK_CONTRACT_EXIT.mismatch;
  }

  try {
    const report = app.checkContract({
      ...(options.csrfExceptions ? { csrfExceptions: options.csrfExceptions } : {}),
      allowPending: !noPending,
    });
    const summary = `${app.contract.operations.length} operações em ${app.contract.source}`;
    // Com `--no-pending` as pendentes já saem como divergência: o aviso repetiria a lista.
    for (const warning of noPending ? [] : formatContractWarnings(report)) {
      err(`${prefix}: ${warning}`);
    }
    if (report.ok) {
      out(
        `${prefix}: contrato e rotas conferem (${summary}${noPending ? ', nenhuma pendente' : ''}).`,
      );
      return CHECK_CONTRACT_EXIT.ok;
    }
    const lines = formatContractReport(report).split('\n');
    err(`${prefix}: ${lines.length} divergência(s) (${summary}):`);
    for (const line of lines) {
      err(`  ${line}`);
    }
    if (report.pendingNotAllowed.length > 0) {
      err(
        `${prefix}: --no-pending recusa operação pendente; peça ao arquiteto a retirada de x-nuva-pending do contrato.`,
      );
    }
    return CHECK_CONTRACT_EXIT.mismatch;
  } finally {
    await app.close();
  }
}
