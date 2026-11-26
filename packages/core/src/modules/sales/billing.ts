import type { Database } from '../../db/database.ts';
import { type FieldError, notFound, validationFailed } from '../../errors/domain-error.ts';
import { assertPurchaseAllowed } from './cart.ts';
import { billingRequired, taxIdInvalid } from './errors.ts';
import { validateTaxId } from './tax-id.ts';
import { type BillingView, isTaxIdType, type TaxIdType } from './types.ts';

// Dados do comprador (spec 011, "Dados do comprador"): `full_name`, `tax_id_type` e `tax_id`
// guardados no usuário, copiados para o pedido no fechamento. O documento só aparece para o
// próprio usuário, para a equipe no pedido e no CSV; nunca vai para log.

const FULL_NAME_MAX_LENGTH = 200;

export interface SaveBillingInput {
  fullName: unknown;
  taxIdType: unknown;
  taxId: unknown;
}

export interface BillingRecord extends BillingView {
  userId: string;
}

/** Lê os dados de comprador do usuário; campos ausentes deixam `complete` falso. */
export async function loadBilling(db: Database, userId: string): Promise<BillingRecord> {
  const user = await db
    .selectFrom('users')
    .select(['id', 'fullName', 'taxIdType', 'taxId', 'deletedAt'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user || user.deletedAt !== null) throw notFound('Usuário não encontrado.');
  const taxIdType =
    user.taxIdType !== null && isTaxIdType(user.taxIdType) ? (user.taxIdType as TaxIdType) : null;
  const complete =
    user.fullName !== null &&
    user.fullName.trim() !== '' &&
    taxIdType !== null &&
    user.taxId !== null &&
    validateTaxId(user.taxId, taxIdType) !== null;
  return {
    userId: user.id,
    fullName: user.fullName,
    taxIdType,
    taxId: user.taxId,
    complete,
  };
}

/** Os dados de comprador do próprio aluno (`GET /me/billing`). */
export async function getMyBilling(db: Database, userId: string): Promise<BillingView> {
  await assertPurchaseAllowed(db, userId);
  const billing = await loadBilling(db, userId);
  return {
    fullName: billing.fullName,
    taxIdType: billing.taxIdType,
    taxId: billing.taxId,
    complete: billing.complete,
  };
}

/** Grava nome, tipo e documento do comprador (`PUT /me/billing`). */
export async function saveMyBilling(
  db: Database,
  userId: string,
  input: SaveBillingInput,
): Promise<BillingView> {
  await assertPurchaseAllowed(db, userId);
  const errors: FieldError[] = [];
  const fullName = normalizeFullName(input.fullName, errors);
  let taxIdType: TaxIdType | null = null;
  if (!isTaxIdType(input.taxIdType)) {
    errors.push({ path: 'taxIdType', message: 'deve ser cpf ou cnpj' });
  } else {
    taxIdType = input.taxIdType;
  }
  const rawTaxId = typeof input.taxId === 'string' ? input.taxId : '';
  if (rawTaxId.trim() === '') {
    errors.push({ path: 'taxId', message: 'obrigatório' });
  }
  if (errors.length > 0) throw validationFailed(errors);
  const taxId = validateTaxId(rawTaxId, taxIdType as TaxIdType);
  if (taxId === null) throw taxIdInvalid();

  await db
    .updateTable('users')
    .set({ fullName, taxIdType, taxId })
    .where('id', '=', userId)
    .execute();
  return getMyBilling(db, userId);
}

/** Copia os dados exigidos pela finalização; sem eles, `409 billing_required`. */
export async function requireBilling(
  db: Database,
  userId: string,
): Promise<{ fullName: string; taxIdType: TaxIdType; taxId: string }> {
  const billing = await loadBilling(db, userId);
  if (
    !billing.complete ||
    billing.fullName === null ||
    billing.taxIdType === null ||
    billing.taxId === null
  ) {
    throw billingRequired();
  }
  return {
    fullName: billing.fullName,
    taxIdType: billing.taxIdType,
    taxId: billing.taxId,
  };
}

function normalizeFullName(value: unknown, errors: FieldError[]): string {
  if (typeof value !== 'string') {
    errors.push({ path: 'fullName', message: 'obrigatório' });
    return '';
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized === '' || normalized.length > FULL_NAME_MAX_LENGTH) {
    errors.push({ path: 'fullName', message: 'deve ter de 1 a 200 caracteres' });
  }
  return normalized;
}
