// Comando de emergência `create-admin` (spec 007, "Admin inicial"; spec 003, "Interfaces e
// contratos"):
//   docker compose exec -it admin-api node src/create-admin.ts --email <e-mail>
// Cria ou promove a conta a `admin`, com a senha pedida duas vezes no terminal, sem eco. Não
// aceita senha por argumento nem por variável. Confirma o e-mail, encerra as sessões da conta e
// grava na auditoria com `origin = cli` (`createOrPromoteAdmin`, do núcleo).
import {
  closeDatabase,
  createDatabase,
  createOrPromoteAdmin,
  type Database,
  isDomainError,
  loadConfigOrExit,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@nuva-edu/core';

export const CREATE_ADMIN_EXIT = {
  ok: 0,
  /** Senhas diferentes, senha ou e-mail recusados, falha do banco. */
  failed: 1,
  /** Uso errado: opção desconhecida, sem `--email`, senha por argumento, sem terminal. */
  usage: 2,
} as const;

const USAGE = 'Uso: node src/create-admin.ts --email <e-mail>';

/** Lê uma linha sem mostrar o que é digitado. */
export type HiddenPrompt = (question: string) => Promise<string>;

export interface CreateAdminCommandOptions {
  argv: readonly string[];
  /** Banco aberto sob demanda: o uso errado sai antes de qualquer conexão. */
  openDatabase: () => Database;
  prompt: HiddenPrompt;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

/** `--email x` ou `--email=x`; qualquer outra opção (inclusive de senha) é recusada. */
export function parseCreateAdminArgs(
  argv: readonly string[],
): { email: string } | { error: string } {
  let email: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (/^--?(p|password|senha|pass)(=|$)/i.test(arg)) {
      return {
        error:
          'A senha não é aceita por argumento: ela é pedida no terminal, sem eco, depois do e-mail.',
      };
    }
    if (arg === '--email') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        return { error: '--email exige um valor.' };
      }
      email = value;
      index += 1;
    } else if (arg.startsWith('--email=')) {
      email = arg.slice('--email='.length);
    } else {
      return { error: `Opção desconhecida: ${arg.startsWith('-') ? arg.split('=')[0] : arg}` };
    }
  }
  if (email === null || email.trim() === '') {
    return { error: '--email é obrigatório.' };
  }
  return { email };
}

/** O comando, com entrada e saída injetáveis (o teste não precisa de terminal). */
export async function runCreateAdmin(options: CreateAdminCommandOptions): Promise<number> {
  const { stdout, stderr } = options;
  const parsed = parseCreateAdminArgs(options.argv);
  if ('error' in parsed) {
    stderr(parsed.error);
    stderr(USAGE);
    return CREATE_ADMIN_EXIT.usage;
  }
  const password = await options.prompt(
    `Senha do admin (${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres): `,
  );
  const confirmation = await options.prompt('Repita a senha: ');
  if (password !== confirmation) {
    stderr('As senhas não conferem. Nada foi alterado.');
    return CREATE_ADMIN_EXIT.failed;
  }
  const db = options.openDatabase();
  try {
    const result = await createOrPromoteAdmin(db, { email: parsed.email, password });
    if (result.created) {
      stdout(`Admin criado (id ${result.userId}).`);
    } else {
      stdout(
        `Conta promovida a admin, com a senha nova (id ${result.userId}); ${result.sessionsRevoked} sessões encerradas.`,
      );
    }
    return CREATE_ADMIN_EXIT.ok;
  } catch (error) {
    if (error instanceof TypeError) {
      stderr('E-mail inválido. Nada foi alterado.');
    } else if (isDomainError(error) && error.code === 'password_invalid') {
      stderr(
        `A senha precisa ter de ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres. Nada foi alterado.`,
      );
    } else {
      // Só o tipo e o código: a mensagem de um erro do banco poderia repetir os parâmetros.
      const code = (error as { code?: unknown }).code;
      stderr(
        `Falha ao gravar o admin (${(error as Error).name}${code === undefined ? '' : ` ${String(code)}`}). Nada foi alterado.`,
      );
    }
    return CREATE_ADMIN_EXIT.failed;
  } finally {
    await closeDatabase(db);
  }
}

/**
 * Pergunta no terminal sem eco: o modo cru do TTY entrega cada tecla e nada é escrito de volta.
 * Enter termina; Backspace apaga; Ctrl+C e Ctrl+D cancelam.
 */
export function ttyHiddenPrompt(
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stderr,
): HiddenPrompt {
  return (question) =>
    new Promise((resolve, reject) => {
      output.write(question);
      input.setRawMode(true);
      input.resume();
      input.setEncoding('utf8');
      let value = '';
      const finish = (error?: Error) => {
        input.off('data', onData);
        input.setRawMode(false);
        input.pause();
        output.write('\n');
        if (error) {
          reject(error);
        } else {
          resolve(value);
        }
      };
      const onData = (chunk: string) => {
        for (const char of chunk) {
          if (char === '\r' || char === '\n') {
            finish();
            return;
          }
          if (char === '\u0003' || char === '\u0004') {
            finish(new Error('cancelado'));
            return;
          }
          if (char === '\u007f' || char === '\b') {
            value = [...value].slice(0, -1).join('');
          } else if (char >= ' ') {
            value += char;
          }
        }
      };
      input.on('data', onData);
    });
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const parsed = parseCreateAdminArgs(argv);
  if ('error' in parsed || !process.stdin.isTTY) {
    if ('error' in parsed) {
      process.stderr.write(`${parsed.error}\n`);
    } else {
      process.stderr.write(
        'create-admin precisa de um terminal interativo para pedir a senha (docker compose exec -it ...).\n',
      );
    }
    process.stderr.write(`${USAGE}\n`);
    process.exit(CREATE_ADMIN_EXIT.usage);
  }
  const config = loadConfigOrExit({ service: 'admin-api', required: [] });
  try {
    process.exitCode = await runCreateAdmin({
      argv,
      openDatabase: () =>
        createDatabase({
          connectionString: config.databaseUrl,
          applicationName: 'admin-api create-admin',
          maxConnections: 1,
        }),
      prompt: ttyHiddenPrompt(),
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
    });
  } catch {
    process.stderr.write('Cancelado. Nada foi alterado.\n');
    process.exitCode = CREATE_ADMIN_EXIT.failed;
  }
}
