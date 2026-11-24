import { type Config, type Database, ensureInitialAdmin, type Logger } from '@nuva-edu/core';

// Admin inicial na subida (spec 007, "Admin inicial"; spec 003 RF-07). `ADMIN_PASSWORD` fora de
// 8 a 128 caracteres já impede a subida em `loadConfigOrExit`, com a variável citada no log.

export type InitialAdminOutcome =
  | Awaited<ReturnType<typeof ensureInitialAdmin>>['status']
  /** O banco não respondeu (fora do ar, sem migrations): a API sobe e o `/readyz` diz o porquê. */
  | 'skipped';

/**
 * Cria ou promove o admin das variáveis quando não há nenhum. Com admin existente, nada muda.
 * Sem as variáveis e sem admin, registra um aviso a cada subida. Nenhuma linha de log leva a
 * senha nem o e-mail: só o id do usuário.
 *
 * Erro de configuração (e-mail que o núcleo recusa) é relançado e impede a subida; erro do banco
 * vai para o log e a subida continua.
 */
export async function ensureInitialAdminOnStartup(
  db: Database,
  config: Pick<Config, 'admin'>,
  logger: Logger,
): Promise<InitialAdminOutcome> {
  let result: Awaited<ReturnType<typeof ensureInitialAdmin>>;
  try {
    result = await ensureInitialAdmin(db, config.admin);
  } catch (error) {
    if (error instanceof TypeError || (error as { code?: unknown }).code === 'password_invalid') {
      throw new Error('ADMIN_EMAIL ou ADMIN_PASSWORD inválido: o admin inicial não foi criado.');
    }
    logger.error(
      { err: { type: (error as Error).name, code: (error as { code?: unknown }).code } },
      'Não foi possível conferir o admin inicial; a API sobe sem ele',
    );
    return 'skipped';
  }
  switch (result.status) {
    case 'created':
      logger.info({ user_id: result.userId }, 'Admin inicial criado a partir de ADMIN_EMAIL');
      break;
    case 'promoted':
      logger.warn(
        { user_id: result.userId },
        'Conta existente de ADMIN_EMAIL promovida a admin inicial, com a senha de ADMIN_PASSWORD',
      );
      break;
    case 'missing_variables':
      logger.warn(
        { variables: ['ADMIN_EMAIL', 'ADMIN_PASSWORD'] },
        'Nenhum admin no banco e ADMIN_EMAIL ou ADMIN_PASSWORD ausente: crie um com create-admin',
      );
      break;
    case 'exists':
      logger.debug({}, 'Admin já existe; ADMIN_EMAIL e ADMIN_PASSWORD ignorados');
      break;
  }
  return result.status;
}
