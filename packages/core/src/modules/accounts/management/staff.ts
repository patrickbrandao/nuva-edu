import { sql } from 'kysely';
import type { Database } from '../../../db/database.ts';
import { conflict, type FieldError, validationFailed } from '../../../errors/domain-error.ts';
import { recordAudit } from '../../audit/record.ts';
import { invalidateEmailTokens } from '../../notifications/email-tokens.ts';
import { enqueueEmail } from '../../notifications/outbox.ts';
import { assertUserManagement } from '../../permissions/management.ts';
import { isRole, type Role } from '../../permissions/roles.ts';
import { assertValidPassword, isValidEmail, normalizeEmail } from '../credentials.ts';
import { emailTaken } from '../errors.ts';
import {
  createAccount,
  findUserIdByEmail,
  lockEmail,
  NAME_MAX_LENGTH,
  normalizeName,
} from '../registration.ts';
import {
  loadTarget,
  type ManagementRequest,
  managementAuditContext,
  requirePermission,
  requireUserManagement,
} from './common.ts';
import { readUserDetail, type UserDetail } from './views.ts';

// Equipe criada pelo admin e edição dos dados de uma conta (spec 007, "Equipe criada pelo
// admin"). Dono: admin-api.

export const FULL_NAME_MAX_LENGTH = 160;

/** `409 version_conflict`: `version` enviada diferente da gravada (spec 003). */
export function versionConflict(): ReturnType<typeof conflict> {
  return conflict('version_conflict', 'A ficha foi alterada por outra pessoa. Recarregue.');
}

export interface CreateUserInput {
  name: unknown;
  email: unknown;
  role: unknown;
  /** Texto legível (ADR 0002); nunca vai para log, auditoria nem fila. */
  password: unknown;
}

/**
 * `POST /users` (só `admin`, `staff.manage`): cria a conta com o papel pedido, o e-mail não
 * confirmado e a senha informada pelo admin; enfileira `account.verify_email` e grava
 * `user.create` (sem a senha). Nome, e-mail ou papel fora do formato: `400 validation_failed`;
 * senha fora de 8 a 128: `400 password_invalid`; e-mail já cadastrado: `409 email_taken`.
 */
export async function createUser(
  db: Database,
  request: ManagementRequest,
  input: CreateUserInput,
): Promise<UserDetail> {
  await requirePermission(db, request, 'staff.manage', { action: 'user.create' });
  const errors: FieldError[] = [];
  const name = normalizeName(input.name);
  if (name === null) {
    errors.push({
      path: 'body.name',
      message: `Informe o nome, até ${NAME_MAX_LENGTH} caracteres.`,
    });
  }
  const email = normalizeEmail(typeof input.email === 'string' ? input.email : '');
  if (!isValidEmail(email)) {
    errors.push({ path: 'body.email', message: 'Informe um e-mail válido.' });
  }
  if (!isRole(input.role)) {
    errors.push({ path: 'body.role', message: 'Papel desconhecido.' });
  }
  if (errors.length > 0) {
    throw validationFailed(errors);
  }
  assertValidPassword(input.password);
  const password = input.password;
  const role = input.role as Role;
  return db.transaction().execute(async (trx) => {
    await lockEmail(trx, email);
    if ((await findUserIdByEmail(trx, email)) !== undefined) {
      throw emailTaken();
    }
    const userId = await createAccount(trx, {
      email,
      name: name as string,
      password,
      role,
      emailVerified: false,
    });
    await enqueueEmail(trx, { userId, type: 'account.verify_email', data: {} });
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'user.create',
      targetType: 'user',
      targetId: userId,
      details: { role },
    });
    return readUserDetail(trx, userId);
  });
}

export interface UpdateUserInput {
  /** Omitido: não muda. */
  name?: unknown;
  /** Omitido: não muda; `null` apaga. */
  fullName?: unknown;
  email?: unknown;
  /** O `version` da ficha lida. */
  version: unknown;
}

type ProfileField = 'name' | 'fullName' | 'email';

/**
 * `PATCH /users/{id}`: nome, nome completo e e-mail. Aluno: `users.edit` (`manager` e `admin`);
 * equipe: `staff.manage` (só `admin`), com a negação gravada na auditoria. `version` diferente
 * da gravada: `409 version_conflict`; e-mail de outra conta: `409 email_taken`. Trocar o e-mail
 * anula a confirmação, invalida os links `verify` e `reset` pendentes e envia
 * `account.verify_email` ao novo endereço. Grava `user.update` com o antes e o depois dos campos
 * alterados; sem alteração, só devolve a ficha.
 */
export async function updateUser(
  db: Database,
  request: ManagementRequest,
  userId: string,
  input: UpdateUserInput,
): Promise<UserDetail> {
  const target = await loadTarget(db, userId);
  await requireUserManagement(db, request, 'edit', target, 'user.update');

  const errors: FieldError[] = [];
  const changes: Partial<Record<ProfileField, string | null>> = {};
  if (input.name !== undefined) {
    const name = normalizeName(input.name);
    if (name === null) {
      errors.push({
        path: 'body.name',
        message: `Informe o nome, até ${NAME_MAX_LENGTH} caracteres.`,
      });
    } else {
      changes.name = name;
    }
  }
  if (input.fullName !== undefined) {
    const fullName = normalizeFullName(input.fullName);
    if (fullName === undefined) {
      errors.push({
        path: 'body.fullName',
        message: `Use de 1 a ${FULL_NAME_MAX_LENGTH} caracteres, ou null.`,
      });
    } else {
      changes.fullName = fullName;
    }
  }
  if (input.email !== undefined) {
    const email = normalizeEmail(typeof input.email === 'string' ? input.email : '');
    if (!isValidEmail(email)) {
      errors.push({ path: 'body.email', message: 'Informe um e-mail válido.' });
    } else {
      changes.email = email;
    }
  }
  const version = input.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    errors.push({ path: 'body.version', message: 'Informe o version da ficha lida.' });
  }
  if (errors.length > 0) {
    throw validationFailed(errors);
  }

  return db.transaction().execute(async (trx) => {
    if (typeof changes.email === 'string' && changes.email !== target.email) {
      await lockEmail(trx, changes.email);
    }
    const current = await loadTarget(trx, target.id, { forUpdate: true });
    // O papel pode ter mudado desde a leitura: a regra vale para o estado travado.
    assertUserManagement(request.actor, 'edit', current);
    if (current.version !== version) {
      throw versionConflict();
    }
    const before: Partial<Record<ProfileField, string | null>> = {};
    const after: Partial<Record<ProfileField, string | null>> = {};
    for (const field of ['name', 'fullName', 'email'] as const) {
      const value = changes[field];
      if (value !== undefined && value !== current[field]) {
        before[field] = current[field];
        after[field] = value;
      }
    }
    if (Object.keys(after).length === 0) {
      return readUserDetail(trx, current.id);
    }
    const emailChanged = after.email !== undefined;
    if (emailChanged) {
      const owner = await findUserIdByEmail(trx, after.email as string);
      if (owner !== undefined && owner !== current.id) {
        throw emailTaken();
      }
    }
    const updated = await trx
      .updateTable('users')
      .set({
        ...(after.name !== undefined ? { name: after.name as string } : {}),
        ...(after.fullName !== undefined ? { fullName: after.fullName } : {}),
        ...(emailChanged ? { email: after.email as string, emailVerifiedAt: null } : {}),
        version: sql<number>`version + 1`,
        updatedAt: sql<Date>`now()`,
      })
      .where('id', '=', current.id)
      .where('version', '=', version)
      .executeTakeFirst();
    if (updated.numUpdatedRows === 0n) {
      throw versionConflict();
    }
    if (emailChanged) {
      // Link enviado ao endereço anterior não confirma o novo nem redefine a senha (spec 007,
      // "Tokens de e-mail"): o `account.verify_email` abaixo gera o link novo.
      await invalidateEmailTokens(trx, current.id);
      // `enqueueEmail` lê o endereço na transação: vai para o novo.
      await enqueueEmail(trx, { userId: current.id, type: 'account.verify_email', data: {} });
    }
    await recordAudit(trx, {
      context: managementAuditContext(request),
      action: 'user.update',
      targetType: 'user',
      targetId: current.id,
      details: { before, after },
    });
    return readUserDetail(trx, current.id);
  });
}

/** `null` apaga; texto de 1 a 160 caracteres sem espaços nas pontas; outro valor: `undefined`. */
function normalizeFullName(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  const length = [...trimmed].length;
  return length >= 1 && length <= FULL_NAME_MAX_LENGTH ? trimmed : undefined;
}
