import { isApiError } from '@nuva-edu/api-client/admin';
import { formatMoney } from '@nuva-edu/ui';
import type { TFunction } from 'i18next';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMeta } from '../../api/meta';
import { useProblemText } from '../../api/problems';
import { formatDateTime } from '../../format';
import { planIntervalName } from '../plans/format';
import type {
  PaymentDetail,
  PaymentMethod,
  PaymentStatus,
  RefundStatus,
  SubscriptionPlanRef,
  SubscriptionStatus,
} from './queries';

/*
 * Textos e formatos das telas de assinaturas (spec 012). O que a API manda como código — estado da
 * assinatura, da cobrança e do reembolso, meio de pagamento e periodicidade do plano — vira frase
 * pelas traduções do site; o valor sai na moeda da instalação (`GET /api/v1/meta`, spec 006).
 */

/** Moeda da instalação: centavos → "R$ 97,00". */
export function useSubscriptionsMoney() {
  const meta = useMeta();
  const currency = meta.data?.currency;
  const locale = meta.data?.locale;
  return useCallback(
    (cents: number | null | undefined) => formatMoney(cents, { currency, locale }),
    [currency, locale],
  );
}

export function subscriptionStatusLabel(t: TFunction, status: SubscriptionStatus): string {
  return t(`subscriptions.status.${status}`);
}

/** "Mensal" / "Anual", do plano da assinatura. */
export function subscriptionIntervalLabel(
  t: TFunction,
  plan: Pick<SubscriptionPlanRef, 'interval'>,
): string {
  return planIntervalName(t, plan.interval);
}

/** O plano com a periodicidade: "Curso de Ouro · Mensal". */
export function subscriptionPlanLabel(
  t: TFunction,
  plan: Pick<SubscriptionPlanRef, 'title' | 'interval'>,
): string {
  return t('subscriptions.planWithInterval', {
    title: plan.title,
    interval: subscriptionIntervalLabel(t, plan),
  });
}

export function paymentStatusLabel(t: TFunction, status: PaymentStatus): string {
  return t(`subscriptions.payments.status.${status}`);
}

export function paymentMethodLabel(t: TFunction, method: PaymentMethod): string {
  return t(`subscriptions.payments.method.${method}`);
}

export function refundStatusLabel(t: TFunction, status: RefundStatus): string {
  return t(`subscriptions.refunds.status.${status}`);
}

/**
 * O que o estado atual significa para o acesso (spec 012, "Ciclo de vida"), com as datas que a
 * tela tem. Sem data, a frase fica no estado; nunca inventa prazo.
 */
export function subscriptionAccessNote(
  t: TFunction,
  detail: {
    status: SubscriptionStatus;
    currentPeriodEnd: string | null;
    graceUntil: string | null;
    canceledAt: string | null;
    endedAt: string | null;
  },
): string {
  const periodEnd = detail.currentPeriodEnd ? formatDateTime(detail.currentPeriodEnd) : null;
  const grace = detail.graceUntil ? formatDateTime(detail.graceUntil) : null;
  switch (detail.status) {
    case 'pending':
      return t('subscriptions.access.pending');
    case 'active':
      return periodEnd
        ? t('subscriptions.access.active', { date: periodEnd })
        : t('subscriptions.access.activeNoDate');
    case 'past_due':
      return grace
        ? t('subscriptions.access.pastDue', { date: grace })
        : t('subscriptions.access.pastDueNoDate');
    case 'suspended':
      return t('subscriptions.access.suspended');
    case 'canceling':
      return periodEnd
        ? t('subscriptions.access.canceling', { date: periodEnd })
        : t('subscriptions.access.cancelingNoDate');
    case 'ended':
      return detail.endedAt
        ? t('subscriptions.access.ended', { date: formatDateTime(detail.endedAt) })
        : t('subscriptions.access.endedNoDate');
    case 'expired':
      return t('subscriptions.access.expired');
  }
}

/** Aviso do diálogo de cancelamento: o que acontece com o acesso e com a recorrência. */
export function cancelPreview(
  t: TFunction,
  input: { status: SubscriptionStatus; currentPeriodEnd: string | null },
): string {
  if (input.status === 'suspended') return t('subscriptions.cancel.suspendedWarning');
  const date = input.currentPeriodEnd ? formatDateTime(input.currentPeriodEnd) : null;
  return date
    ? t('subscriptions.cancel.periodWarning', { date })
    : t('subscriptions.cancel.periodWarningNoDate');
}

/** Códigos das operações de assinatura (contrato) com texto próprio. */
const KNOWN_ERRORS = [
  'subscription_not_cancelable',
  'payment_provider_unavailable',
  'payment_not_refundable',
  'refund_exceeds_paid',
  'not_found',
  'validation_failed',
] as const;
type KnownError = (typeof KNOWN_ERRORS)[number];

function isKnownError(code: string): code is KnownError {
  return (KNOWN_ERRORS as readonly string[]).includes(code);
}

/** Texto de uma recusa da API numa ação de assinatura; a genérica leva o código da requisição. */
export function useSubscriptionsError() {
  const { t } = useTranslation();
  const describe = useProblemText();
  return (error: unknown): string => {
    if (isApiError(error) && isKnownError(error.code)) {
      return t(`subscriptions.errors.${error.code}`);
    }
    const { text, detail } = describe(error);
    return detail ? `${text} ${detail}` : text;
  };
}

/** Total já reembolsado de uma cobrança, pelas cobranças do detalhe. */
export function refundedLabel(
  t: TFunction,
  money: (cents: number) => string,
  payment: Pick<PaymentDetail, 'refundedCents'>,
): string {
  return payment.refundedCents > 0
    ? money(payment.refundedCents)
    : t('subscriptions.payments.nothingRefunded');
}

/** Campos recusados na validação (`body.code` → `code`). */
export function refusedFields(error: unknown): Set<string> {
  if (!isApiError(error)) return new Set();
  return new Set(error.fieldErrors.map((field) => field.path.replace(/^body\./, '')));
}
