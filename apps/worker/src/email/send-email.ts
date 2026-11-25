import {
  type Database,
  emailTypeDefinition,
  getSettings,
  issueEmailToken,
  type JobHandler,
  type Logger,
  lockEmailTokens,
  PermanentJobError,
  parseEmailData,
  schoolLogoUrl,
} from '@nuva-edu/core';
import { classifySmtpError, type Mailer } from './smtp.ts';
import { isTemplateEmailType, renderEmail, type TemplateEmailType } from './templates.ts';

export interface EmailSendDependencies {
  db: Database;
  logger: Logger;
  mailer: Mailer;
  /** `config.classroomUrl` e `config.adminUrl`: esquema, host e porta públicos (spec 031). */
  classroomUrl: string;
  adminUrl: string;
  /** `config.locale`; idioma sem modelo cai no pt-BR. */
  locale: string;
}

type Outcome = 'sent' | 'skipped' | 'not_queued' | 'missing';

/** Erro do envio já com o resumo sem dado pessoal que vai para `email_outbox.last_error`. */
class SendFailure extends Error {
  readonly permanent: boolean;
  constructor(summary: string, permanent: boolean) {
    super(summary);
    this.name = 'SendFailure';
    this.permanent = permanent;
  }
}

/**
 * Manipulador de `email.send` (specs 005 e 024). Lê a linha de `email_outbox`, monta o e-mail
 * do tipo, cria o token do link quando o tipo tem um, envia e marca `sent`, tudo numa transação:
 * se o envio falha, o token novo não chega ao banco. Idempotente: linha que não está `queued`
 * (já enviada, com falha definitiva, apagada) não é enviada de novo.
 *
 * O token em claro só existe em memória, no corpo enviado: nunca em log, `jobs` ou
 * `email_outbox`. O log leva só os ids e o tipo; o endereço do destinatário também fica de fora.
 */
export function createEmailSendHandler(deps: EmailSendDependencies): JobHandler<'email.send'> {
  const { db, logger, mailer } = deps;
  return async (job, { signal }) => {
    const outboxId = job.payload.outboxId;
    const log = logger.child({ job_id: job.id, outbox_id: outboxId });
    let type: string | null = null;
    let outcome: Outcome;
    try {
      outcome = await db.transaction().execute(async (trx) => {
        const row = await trx
          .selectFrom('emailOutbox')
          .select(['id', 'userId', 'to', 'type', 'data', 'status'])
          .where('id', '=', outboxId)
          .forUpdate()
          .executeTakeFirst();
        if (!row) {
          return 'missing';
        }
        type = row.type;
        if (row.status !== 'queued') {
          return 'not_queued';
        }
        if (!isTemplateEmailType(row.type)) {
          throw new SendFailure('Tipo de e-mail desconhecido', true);
        }
        const emailType: TemplateEmailType = row.type;
        const definition = emailTypeDefinition(emailType);
        let data: ReturnType<typeof parseEmailData>;
        try {
          data = parseEmailData(emailType, row.data);
        } catch {
          throw new SendFailure('Dados do e-mail fora do formato do tipo', true);
        }
        const purpose = definition.tokenPurpose;
        // Tipo com link: a trava da emissão vem antes da leitura da conta, para a troca de e-mail
        // pela equipe (que invalida os tokens sob a mesma trava) não passar entre a conferência
        // do endereço e a emissão (spec 007, "Tokens de e-mail").
        if (purpose !== null) {
          await lockEmailTokens(trx, row.userId, purpose);
        }
        const user = await trx
          .selectFrom('users')
          .select(['name', 'email', 'emailVerifiedAt', 'deletedAt', 'suspendedKind'])
          .where('id', '=', row.userId)
          .executeTakeFirst();
        if (!user || user.deletedAt !== null) {
          await markSent(trx, outboxId, { lastError: 'skipped: user_deleted' });
          return 'skipped';
        }
        // Suspensa (`full`) depois do enfileiramento: não recebe o que não pode usar (spec 024,
        // "E-mails da Fase 2"). O `enqueueEmail` já recusa quem está suspenso na hora da ação.
        if (definition.skipFullySuspended && user.suspendedKind === 'full') {
          await markSent(trx, outboxId, { lastError: 'skipped: user_suspended' });
          return 'skipped';
        }
        // Link na fila para o endereço anterior não sai nem gera token (spec 024, "Links com token").
        if (purpose !== null && user.email !== row.to) {
          await markSent(trx, outboxId, { lastError: 'skipped: email_changed' });
          return 'skipped';
        }
        if (emailType === 'account.verify_email' && user.emailVerifiedAt !== null) {
          await markSent(trx, outboxId, { lastError: 'skipped: already_verified' });
          return 'skipped';
        }

        const settings = await getSettings(trx, { logger: log });
        // Vale o último link enviado: emitir aqui invalida os anteriores do mesmo propósito.
        const issued = purpose === null ? null : await issueEmailToken(trx, row.userId, purpose);
        const logoPath = schoolLogoUrl(settings['school.logo_image_id']);
        const message = renderEmail({
          type: emailType,
          data,
          locale: deps.locale,
          recipientName: user.name,
          school: {
            name: settings['school.name'],
            timezone: settings['school.timezone'],
            accentColor: settings['school.accent_color'],
            logoUrl: logoPath === null ? null : new URL(logoPath, deps.classroomUrl).toString(),
          },
          classroomUrl: deps.classroomUrl,
          adminUrl: deps.adminUrl,
          token: issued?.token ?? null,
        });

        // Encerramento antes do envio: a tarefa volta à fila sem efeito (a transação desfaz).
        signal.throwIfAborted();
        try {
          await mailer.send({
            to: row.to,
            subject: message.subject,
            text: message.text,
            html: message.html,
          });
        } catch (error) {
          const smtp = classifySmtpError(error);
          throw new SendFailure(smtp?.summary ?? 'smtp: falha no envio', smtp?.permanent ?? false);
        }
        await markSent(trx, outboxId, { subject: message.subject });
        return 'sent';
      });
    } catch (error) {
      if (signal.aborted && signal.reason === error) {
        throw error;
      }
      const failure =
        error instanceof SendFailure
          ? error
          : new SendFailure(
              `erro interno: ${error instanceof Error ? error.name : 'desconhecido'}`,
              false,
            );
      const final = failure.permanent || job.attempts >= job.maxAttempts;
      await db
        .updateTable('emailOutbox')
        .set((eb) => ({
          attempts: eb('attempts', '+', 1),
          lastError: failure.message,
          status: final ? 'failed' : 'queued',
        }))
        .where('id', '=', outboxId)
        .where('status', '=', 'queued')
        .execute();
      log.warn(
        { email_type: type, permanent: failure.permanent, final, reason: failure.message },
        failure.permanent ? 'E-mail recusado de forma definitiva' : 'Falha ao enviar e-mail',
      );
      if (failure.permanent) {
        throw new PermanentJobError(failure.message);
      }
      // Erro fora do SMTP segue para o worker como veio (o log dele mascara); o do SMTP, só o resumo.
      throw error instanceof SendFailure ? new Error(failure.message) : error;
    }

    if (outcome === 'sent') {
      log.info({ email_type: type }, 'E-mail enviado');
    } else if (outcome === 'skipped') {
      log.info({ email_type: type }, 'E-mail dispensado; marcado como enviado sem envio');
    } else if (outcome === 'not_queued') {
      log.info({ email_type: type }, 'E-mail já tratado; nada a enviar');
    } else {
      log.warn('Linha de email_outbox não existe; nada a enviar');
    }
  };
}

async function markSent(
  trx: Database,
  outboxId: string,
  fields: { subject?: string; lastError?: string },
): Promise<void> {
  await trx
    .updateTable('emailOutbox')
    .set((eb) => ({
      status: 'sent',
      sentAt: new Date(),
      attempts: eb('attempts', '+', 1),
      lastError: fields.lastError ?? null,
      ...(fields.subject === undefined ? {} : { subject: fields.subject }),
    }))
    .where('id', '=', outboxId)
    .execute();
}
