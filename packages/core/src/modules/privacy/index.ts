// Termos, exportação e exclusão de conta (spec 030). Fase 1: versões dos termos (admin-api) e
// aceite (classroom-api). Tarefa 147.

export {
  acceptTerms,
  assertTermsAccepted,
  pendingTermsFor,
  TERMS_UNKNOWN_DOCUMENT,
  termsAcceptanceRequired,
  termsVersionOutdated,
} from './terms-acceptance.ts';
export {
  createTermsDraft,
  currentTermsVersions,
  getLegalDocument,
  isTermsDocument,
  type LegalDocument,
  listTermsVersions,
  publishTermsVersion,
  TERMS_BODY_MAX_LENGTH,
  TERMS_DOCUMENTS,
  type TermsDocument,
  type TermsDraftInput,
  type TermsStatus,
  type TermsVersion,
  type TermsVersionEntry,
  termsAlreadyPublished,
} from './terms-versions.ts';
