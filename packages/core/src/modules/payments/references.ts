import { invalidPaymentRequest } from './errors.ts';
import type {
  OrderExternalReference,
  PaymentExternalReference,
  SubscriptionExternalReference,
} from './types.ts';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const REFERENCE = new RegExp(`^(order|subscription):(${UUID})$`, 'i');

/** Elo entre o registro local e o provedor: somente o UUID, sem dados pessoais (spec 013). */
export function orderExternalReference(orderId: string): OrderExternalReference {
  return makeReference('order', orderId);
}

export function subscriptionExternalReference(
  subscriptionId: string,
): SubscriptionExternalReference {
  return makeReference('subscription', subscriptionId);
}

function makeReference(kind: 'order', id: string): OrderExternalReference;
function makeReference(kind: 'subscription', id: string): SubscriptionExternalReference;
function makeReference(kind: 'order' | 'subscription', id: string): PaymentExternalReference {
  const reference = `${kind}:${id.toLowerCase()}`;
  if (!REFERENCE.test(reference)) {
    throw invalidPaymentRequest('A referência externa deve conter o UUID do registro local.');
  }
  return reference as PaymentExternalReference;
}

export function parsePaymentExternalReference(reference: string): {
  kind: 'order' | 'subscription';
  id: string;
  reference: PaymentExternalReference;
} {
  const match = REFERENCE.exec(reference);
  if (match === null) {
    throw invalidPaymentRequest(
      'Referência externa fora do formato order:<uuid> ou subscription:<uuid>.',
    );
  }
  const kind = match[1] as 'order' | 'subscription';
  const id = (match[2] as string).toLowerCase();
  return { kind, id, reference: `${kind}:${id}` };
}
