import { sql } from 'kysely';
import type { Database } from '../../db/database.ts';
import { isDomainError, notFound } from '../../errors/domain-error.ts';
import { enqueuePaymentWebhook } from '../jobs/sales.ts';
import {
  isPaymentCredentialError,
  PAYMENT_CREDENTIAL_ATTEMPTS,
  PAYMENT_ERROR_CODES,
  PaymentWebhookSignatureError,
} from './errors.ts';
import { applyOrderPayment } from './order-transitions.ts';
import { parsePaymentExternalReference } from './references.ts';
import {
  applyProviderSubscriptionState,
  applySubscriptionPayment,
} from './subscription-transitions.ts';
import type {
  PaymentProvider,
  PaymentProviderName,
  PaymentWebhookEvent,
  PaymentWebhookHeaders,
  PaymentWebhookResourceType,
  ProviderPayment,
  ProviderSubscription,
} from './types.ts';

// Ponto único de entrada e processamento dos avisos do provedor (spec 013, "Webhook" e
// "Processamento no worker"). O endpoint do classroom-api só valida, grava a recepção e enfileira;
// o worker chama `processPaymentWebhook`, que sempre relê o estado no provedor e aplica a mesma
// transição usada pela reconciliação. Nada do corpo do aviso é guardado ou executado.

/** Motivo do registro `rejected` (restrição `webhook_events_rejected_reason`). */
export const WEBHOOK_INVALID_SIGNATURE = 'invalid_signature';
/** Motivo do evento `failed` quando o valor pago não bate com o pedido (spec 013, "Falhas"). */
export const WEBHOOK_AMOUNT_MISMATCH = 'amount_mismatch';
/** Mesmo limite da coluna `webhook_events.error`. */
export const WEBHOOK_ERROR_MAX_LENGTH = 2_000;
const WEBHOOK_IDENTIFIER_MAX_LENGTH = 255;

export interface ReceivePaymentWebhookInput {
  provider: PaymentProvider;
  headers: PaymentWebhookHeaders;
  /** Corpo bruto, sem serialização: a assinatura cobre os bytes recebidos. */
  rawBody: string | Uint8Array;
  /** Instante da recepção; padrão: agora. */
  now?: Date;
}

export interface ReceivedPaymentWebhook {
  webhookEventId: string;
  /** `false` quando (`provider`, `event_id`) já existia fora de `rejected`: nada é enfileirado. */
  created: boolean;
  /** O evento normalizado devolvido pelo provedor (só identificadores). */
  event: PaymentWebhookEvent;
}

/**
 * Valida a assinatura, grava o evento em `webhook_events` e, quando é a primeira entrega válida
 * da chave, enfileira `payment.webhook` na mesma transação.
 *
 * Assinatura inválida ou ausente: grava `rejected` (com os identificadores que derem para extrair
 * do corpo, sem confiar neles) e relança o `401`. Um evento válido posterior com o mesmo
 * identificador entra normalmente, porque `rejected` não ocupa a chave única parcial.
 */
export async function receivePaymentWebhook(
  db: Database,
  input: ReceivePaymentWebhookInput,
): Promise<ReceivedPaymentWebhook> {
  const now = input.now ?? new Date();
  let event: PaymentWebhookEvent;
  try {
    event = await input.provider.parseWebhook({
      headers: input.headers,
      rawBody: input.rawBody,
    });
  } catch (error) {
    if (error instanceof PaymentWebhookSignatureError) {
      await recordRejected(db, input.provider.name, input.rawBody, now);
    }
    throw error;
  }

  return db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto('webhookEvents')
      .values({
        provider: input.provider.name,
        eventId: event.eventId,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        status: 'received',
        attempts: 0,
        receivedAt: now,
      })
      // Predicado idêntico ao índice parcial `webhook_events_event_unique`, em texto.
      .onConflict((oc) =>
        oc
          .columns(['provider', 'eventId'])
          .where(sql<boolean>`event_id IS NOT NULL AND status <> 'rejected'`)
          .doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    if (inserted) {
      await enqueuePaymentWebhook(trx, inserted.id);
      return { webhookEventId: inserted.id, created: true, event };
    }
    const existing = await trx
      .selectFrom('webhookEvents')
      .select('id')
      .where('provider', '=', input.provider.name)
      .where('eventId', '=', event.eventId)
      .where('status', '!=', 'rejected')
      .executeTakeFirst();
    if (!existing) throw notFound('Evento de webhook não encontrado.');
    return { webhookEventId: existing.id, created: false, event };
  });
}

export type PaymentWebhookStatus = 'received' | 'rejected' | 'processed' | 'ignored' | 'failed';

export interface ProcessPaymentWebhookOptions {
  /** Instante do processamento; padrão: agora. */
  now?: Date;
  /** Dias de carência da instalação (`NUVA_SUBSCRIPTION_GRACE_DAYS`). */
  graceDays?: number;
  /**
   * `true` na última tentativa da fila: uma falha transitória vira `failed` (visível na tela de
   * falhas) em vez de relançar. Nas demais, o erro sobe e a fila repete a tarefa.
   */
  finalAttempt?: boolean;
}

export interface ProcessedPaymentWebhook {
  webhookEventId: string;
  status: PaymentWebhookStatus;
  /** `true` quando esta chamada leu o provedor e aplicou a transição. */
  applied: boolean;
}

/**
 * Processa um evento já gravado (`payment.webhook`), idempotente: só age sobre `received`; um
 * evento `processed`, `ignored`, `failed` ou `rejected` não é tocado. O provedor é sempre
 * consultado pelo identificador do recurso e o estado atual decide a transição — a ordem entre
 * webhook e reconciliação não importa.
 *
 * - sem correspondência local: `ignored`;
 * - valor divergente do pedido: `failed` com `amount_mismatch`, sem liberar acesso;
 * - falha transitória (`payment_provider_unavailable`, provedor ainda sem o recurso): relança
 *   enquanto não é a última tentativa; nela, `failed` com o motivo;
 * - falha definitiva: `failed` na hora, com mensagem sem corpo, assinatura ou segredo.
 */
export async function processPaymentWebhook(
  db: Database,
  provider: PaymentProvider,
  webhookEventId: string,
  options: ProcessPaymentWebhookOptions = {},
): Promise<ProcessedPaymentWebhook> {
  const now = options.now ?? new Date();
  const finalAttempt = options.finalAttempt ?? false;
  const event = await db
    .updateTable('webhookEvents')
    .set({ attempts: sql<number>`attempts + 1` })
    .where('id', '=', webhookEventId)
    .where('status', '=', 'received')
    .returning(['id', 'provider', 'resourceType', 'resourceId', 'attempts'])
    .executeTakeFirst();
  if (!event) {
    const current = await db
      .selectFrom('webhookEvents')
      .select('status')
      .where('id', '=', webhookEventId)
      .executeTakeFirst();
    if (!current) throw notFound('Evento de webhook não encontrado.');
    return {
      webhookEventId,
      status: current.status as PaymentWebhookStatus,
      applied: false,
    };
  }

  if (event.provider !== provider.name) {
    return finishFailed(db, event.id, 'provider_mismatch', now);
  }
  if (event.resourceType === null || event.resourceId === null) {
    return finishFailed(db, event.id, 'invalid_resource', now);
  }

  if (event.resourceType === 'payment') {
    let payment: ProviderPayment;
    try {
      payment = await provider.getPayment(event.resourceId);
    } catch (error) {
      return settleProviderFailure(db, event, error, finalAttempt, now);
    }
    try {
      const reference = parsePaymentExternalReference(payment.externalReference);
      if (reference.kind === 'order') {
        await applyOrderPayment(db, provider.name, payment, { now });
      } else {
        await applySubscriptionPayment(db, provider.name, payment, {
          now,
          ...(options.graceDays === undefined ? {} : { graceDays: options.graceDays }),
        });
      }
    } catch (error) {
      return settleApplyFailure(db, event.id, error, finalAttempt, now);
    }
    return finishProcessed(db, event.id, now);
  }

  let subscription: ProviderSubscription;
  try {
    subscription = await provider.getSubscription(event.resourceId);
  } catch (error) {
    return settleProviderFailure(db, event, error, finalAttempt, now);
  }
  try {
    await applyProviderSubscriptionState(db, subscription, {
      now,
      ...(options.graceDays === undefined ? {} : { graceDays: options.graceDays }),
    });
  } catch (error) {
    return settleApplyFailure(db, event.id, error, finalAttempt, now);
  }
  return finishProcessed(db, event.id, now);
}

async function recordRejected(
  db: Database,
  provider: PaymentProviderName,
  rawBody: string | Uint8Array,
  now: Date,
): Promise<void> {
  const identifiers = extractIdentifiers(rawBody);
  await db
    .insertInto('webhookEvents')
    .values({
      provider,
      eventId: identifiers.eventId,
      resourceType: identifiers.resourceType,
      resourceId: identifiers.resourceId,
      status: 'rejected',
      attempts: 0,
      error: WEBHOOK_INVALID_SIGNATURE,
      receivedAt: now,
    })
    .execute();
}

interface ExtractedIdentifiers {
  eventId: string | null;
  resourceType: PaymentWebhookResourceType | null;
  resourceId: string | null;
}

/** Só identificadores, no melhor esforço; nada do corpo é guardado. */
function extractIdentifiers(rawBody: string | Uint8Array): ExtractedIdentifiers {
  let parsed: unknown;
  try {
    const body = typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString('utf8');
    parsed = JSON.parse(body);
  } catch {
    return { eventId: null, resourceType: null, resourceId: null };
  }
  if (!isRecord(parsed)) {
    return { eventId: null, resourceType: null, resourceId: null };
  }
  const data = isRecord(parsed.data) ? parsed.data : null;
  return {
    eventId: identifier(parsed.id),
    resourceType: webhookResourceType(parsed.type),
    resourceId: data === null ? null : identifier(data.id),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): string | null {
  let text: string | null = null;
  if (typeof value === 'string' && value.trim() !== '') text = value.trim();
  else if (typeof value === 'number' && Number.isFinite(value)) text = String(value);
  if (text === null) return null;
  return text.length <= WEBHOOK_IDENTIFIER_MAX_LENGTH
    ? text
    : text.slice(0, WEBHOOK_IDENTIFIER_MAX_LENGTH);
}

/** Mesmos tipos de recurso do Mercado Pago e do fake; qualquer outro fica nulo. */
function webhookResourceType(value: unknown): PaymentWebhookResourceType | null {
  switch (value) {
    case 'payment':
    case 'subscription_authorized_payment':
      return 'payment';
    case 'subscription':
    case 'subscription_preapproval':
      return 'subscription';
    default:
      return null;
  }
}

function settleProviderFailure(
  db: Database,
  { id: eventId, attempts }: { id: string; attempts: number },
  error: unknown,
  finalAttempt: boolean,
  now: Date,
): Promise<ProcessedPaymentWebhook> {
  if (attempts >= PAYMENT_CREDENTIAL_ATTEMPTS && isPaymentCredentialError(error)) {
    return finishFailed(db, eventId, 'payment_provider_invalid_credentials', now);
  }
  if (isDomainError(error)) {
    if (error.code === PAYMENT_ERROR_CODES.unavailable || error.code === 'not_found') {
      if (!finalAttempt) throw error;
      return finishFailed(
        db,
        eventId,
        error.code === 'not_found' ? 'provider_not_found' : 'payment_provider_unavailable',
        now,
      );
    }
    return finishFailed(db, eventId, safeReason(error), now);
  }
  if (!finalAttempt) throw error;
  return finishFailed(db, eventId, 'unexpected_error', now);
}

function settleApplyFailure(
  db: Database,
  eventId: string,
  error: unknown,
  finalAttempt: boolean,
  now: Date,
): Promise<ProcessedPaymentWebhook> {
  if (isDomainError(error)) {
    if (error.code === 'not_found') return finishIgnored(db, eventId, now);
    if (error.code === 'payment_amount_mismatch') {
      return finishFailed(db, eventId, WEBHOOK_AMOUNT_MISMATCH, now);
    }
    if (error.code === PAYMENT_ERROR_CODES.unavailable) {
      if (!finalAttempt) throw error;
      return finishFailed(db, eventId, 'payment_provider_unavailable', now);
    }
    return finishFailed(db, eventId, safeReason(error), now);
  }
  if (!finalAttempt) throw error;
  return finishFailed(db, eventId, 'unexpected_error', now);
}

/** Motivo curto e seguro: detalhe do `DomainError`, sem corpo ou segredo do provedor. */
function safeReason(error: {
  readonly detail?: string | undefined;
  readonly code: string;
}): string {
  const value = (error.detail ?? error.code).trim() || error.code;
  return value.length <= WEBHOOK_ERROR_MAX_LENGTH
    ? value
    : `${value.slice(0, WEBHOOK_ERROR_MAX_LENGTH - 1)}…`;
}

async function finishProcessed(
  db: Database,
  eventId: string,
  now: Date,
): Promise<ProcessedPaymentWebhook> {
  await finish(db, eventId, 'processed', null, now);
  return { webhookEventId: eventId, status: 'processed', applied: true };
}

async function finishIgnored(
  db: Database,
  eventId: string,
  now: Date,
): Promise<ProcessedPaymentWebhook> {
  await finish(db, eventId, 'ignored', null, now);
  return { webhookEventId: eventId, status: 'ignored', applied: false };
}

async function finishFailed(
  db: Database,
  eventId: string,
  reason: string,
  now: Date,
): Promise<ProcessedPaymentWebhook> {
  await finish(db, eventId, 'failed', reason, now);
  return { webhookEventId: eventId, status: 'failed', applied: false };
}

async function finish(
  db: Database,
  eventId: string,
  status: 'processed' | 'ignored' | 'failed',
  error: string | null,
  now: Date,
): Promise<void> {
  await db
    .updateTable('webhookEvents')
    .set({
      status,
      error,
      processedAt: status === 'failed' ? null : now,
    })
    .where('id', '=', eventId)
    .where('status', '=', 'received')
    .execute();
}
