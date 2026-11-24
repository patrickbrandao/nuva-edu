import { isIP } from 'node:net';
import type { Database } from '../../db/database.ts';
import { DomainError, type FieldError } from '../../errors/domain-error.ts';
import {
  currentTermsVersions,
  isTermsDocument,
  isUuid,
  lockTermsDocument,
  TERMS_DOCUMENTS,
  type TermsVersion,
} from './terms-versions.ts';

// Aceite dos termos (spec 030, "Termos na Fase 1"; spec 007, "Termos no cadastro e aceite
// pendente"). Dono de `terms_acceptances`: classroom-api. O banco não confere que a versão
// aceita é publicada (migration 0007): a regra "só a vigente" vive aqui.

const USER_AGENT_MAX_LENGTH = 1024;

/** `errors[].message` quando o `id` não é de nenhuma versão conhecida. */
export const TERMS_UNKNOWN_DOCUMENT = 'unknown';

/**
 * `422 terms_acceptance_required` do cadastro: `errors[]` traz um item por documento cuja
 * vigente falta, com `message` igual ao documento (`terms` ou `privacy`).
 */
export function termsAcceptanceRequired(errors: readonly FieldError[]): DomainError {
  return new DomainError({
    code: 'terms_acceptance_required',
    status: 422,
    title: 'Aceite dos termos necessário',
    detail: 'Aceite as versões vigentes dos Termos de Uso e da Política de Privacidade.',
    errors,
  });
}

/** `422 terms_version_outdated`: a versão aceita não é a vigente do documento. */
export function termsVersionOutdated(errors: readonly FieldError[]): DomainError {
  return new DomainError({
    code: 'terms_version_outdated',
    status: 422,
    title: 'Versão dos termos desatualizada',
    detail: 'Há uma versão mais nova dos termos. Leia e aceite a versão vigente.',
    errors,
  });
}

/** Documento de cada `id` informado (publicada ou rascunho), para apontar o erro. */
async function documentsOf(db: Database, ids: readonly string[]): Promise<Map<string, string>> {
  const valid = ids.filter(isUuid);
  if (valid.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectFrom('termsVersions')
    .select(['id', 'document'])
    .where('id', 'in', valid)
    .execute();
  return new Map(rows.map((row) => [row.id, row.document]));
}

/**
 * Validação do cadastro, por senha e por provedor (`acceptedTerms`). Com versão publicada de
 * um documento, a vigente dele precisa estar na lista; sem nenhuma publicada, a lista vai vazia.
 * Faltando a vigente, ou com `id` que não é vigente de nenhum documento: `422`
 * `terms_acceptance_required`, com `errors[]` indicando o documento. Devolve as vigentes
 * aceitas, para gravar o aceite (`acceptTerms`) depois de criada a conta.
 */
export async function assertTermsAccepted(
  db: Database,
  acceptedIds: readonly string[],
): Promise<TermsVersion[]> {
  const current = await currentTermsVersions(db);
  const accepted = new Set(acceptedIds.map((id) => id.toLowerCase()));
  const currentIds = new Set<string>();
  const failed = new Set<string>();
  const result: TermsVersion[] = [];
  for (const document of TERMS_DOCUMENTS) {
    const version = current[document];
    if (version === null) {
      continue;
    }
    currentIds.add(version.id);
    if (accepted.has(version.id)) {
      result.push(version);
    } else {
      failed.add(document);
    }
  }
  const extras = [...accepted].filter((id) => !currentIds.has(id));
  if (extras.length > 0) {
    const known = await documentsOf(db, extras);
    for (const id of extras) {
      failed.add(known.get(id) ?? TERMS_UNKNOWN_DOCUMENT);
    }
  }
  if (failed.size > 0) {
    throw termsAcceptanceRequired(
      [...failed].map((document) => ({ path: 'body.acceptedTerms', message: document })),
    );
  }
  return result;
}

/**
 * Grava um aceite por versão (`POST /api/v1/me/terms-acceptance` e o cadastro), com IP e
 * navegador. Cada `id` precisa ser a vigente do seu documento; senão, `422`
 * `terms_version_outdated`, com `errors[]` indicando o documento (ou `unknown`). Aceitar de novo
 * a mesma versão não duplica. Exige transação: a trava compartilhada do documento impede que
 * uma publicação troque a vigente entre a conferência e a gravação.
 */
export async function acceptTerms(
  trx: Database,
  userId: string,
  ids: readonly string[],
  ip: string | null,
  userAgent: string | null,
): Promise<TermsVersion[]> {
  if (!trx.isTransaction) {
    throw new TypeError('acceptTerms exige uma transação aberta (db.transaction()).');
  }
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
  if (unique.length === 0) {
    return [];
  }
  const known = await documentsOf(trx, unique);
  const documents = [...new Set(known.values())].filter(isTermsDocument).sort();
  for (const document of documents) {
    await lockTermsDocument(trx, document, 'shared');
  }
  const current = await currentTermsVersions(trx);
  const accepted: TermsVersion[] = [];
  const errors: FieldError[] = [];
  for (const id of unique) {
    const document = known.get(id);
    const version = isTermsDocument(document) ? current[document] : null;
    if (version !== null && version.id === id) {
      accepted.push(version);
    } else {
      errors.push({ path: 'body.termsVersionIds', message: document ?? TERMS_UNKNOWN_DOCUMENT });
    }
  }
  if (errors.length > 0) {
    throw termsVersionOutdated(errors);
  }
  await trx
    .insertInto('termsAcceptances')
    .values(
      accepted.map((version) => ({
        userId,
        termsVersionId: version.id,
        ip: ip !== null && isIP(ip) !== 0 ? ip : null,
        userAgent: userAgent === null ? null : userAgent.slice(0, USER_AGENT_MAX_LENGTH),
      })),
    )
    .onConflict((oc) => oc.columns(['userId', 'termsVersionId']).doNothing())
    .execute();
  return accepted;
}

/**
 * Vigentes que o usuário ainda precisa aceitar (`termsPending` da sessão do classroom; com a
 * lista não vazia, as escritas respondem `403 terms_acceptance_pending`).
 *
 * Regra da spec 030: vigente sem aceite dele, quando é a primeira versão publicada do documento
 * ou tem `requires_reacceptance`. Aplicada pela última "barreira" do documento (a versão 1 ou a
 * mais nova com `requires_reacceptance`): fica pendente quem não aceitou nenhuma versão igual ou
 * posterior a ela. Assim, quem se cadastrou antes da primeira publicação continua pendente
 * mesmo que uma versão 2 sem novo aceite saia antes do seu próximo acesso, e uma versão sem
 * `requires_reacceptance` não apaga a pendência de uma anterior que o exigia. Quem aceitou uma
 * versão a partir da barreira não fica pendente com versão nova sem `requires_reacceptance`.
 */
export async function pendingTermsFor(db: Database, userId: string): Promise<TermsVersion[]> {
  const current = await currentTermsVersions(db);
  const barriers = await db
    .selectFrom('termsVersions')
    .select(['document', (eb) => eb.fn.max('version').as('version')])
    .where('version', 'is not', null)
    .where((eb) => eb.or([eb('version', '=', 1), eb('requiresReacceptance', '=', true)]))
    .groupBy('document')
    .execute();
  const latestAccepted = await db
    .selectFrom('termsAcceptances')
    .innerJoin('termsVersions', 'termsVersions.id', 'termsAcceptances.termsVersionId')
    .select(['termsVersions.document', (eb) => eb.fn.max('termsVersions.version').as('version')])
    .where('termsAcceptances.userId', '=', userId)
    .where('termsVersions.version', 'is not', null)
    .groupBy('termsVersions.document')
    .execute();
  const barrierOf = new Map(barriers.map((row) => [row.document, row.version]));
  const acceptedOf = new Map(latestAccepted.map((row) => [row.document, row.version]));
  const pending: TermsVersion[] = [];
  for (const document of TERMS_DOCUMENTS) {
    const version = current[document];
    if (version === null) {
      continue;
    }
    const barrier = barrierOf.get(document) ?? 1;
    const accepted = acceptedOf.get(document) ?? null;
    if (accepted === null || accepted < barrier) {
      pending.push(version);
    }
  }
  return pending;
}
