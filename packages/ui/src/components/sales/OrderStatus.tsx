import { CircleCheck, Clock3, RotateCcw, ShieldAlert, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import './sales.css';
import type { Loose } from '../../index';
import { AdminStatus as RawAdminStatus } from '../admin/AdminData.jsx';
import { cx } from '../feedback/layer';

/*
 * Estados de pedido (spec 011) e de assinatura (spec 012), e o resumo do retorno do
 * pagamento (página "Pedido", que acompanha por SSE). O rótulo vem traduzido do site;
 * o tom e o ícone seguem o estado. Pedido de total zero chega como `paid` (provider none):
 * o componente não distingue o caminho, só mostra o estado.
 */

const AdminStatus = RawAdminStatus as Loose<typeof RawAdminStatus>;

export type OrderStatus =
  | 'draft'
  | 'pending'
  | 'paid'
  | 'partially_refunded'
  | 'refunded'
  | 'canceled'
  | 'expired'
  | 'chargeback';

export type SubscriptionStatus =
  | 'pending'
  | 'active'
  | 'past_due'
  | 'suspended'
  | 'canceling'
  | 'ended'
  | 'expired';

type Tone = 'green' | 'amber' | 'red' | 'gray' | 'blue';

const ORDER_TONES: Record<OrderStatus, Tone> = {
  draft: 'gray',
  pending: 'amber',
  paid: 'green',
  partially_refunded: 'blue',
  refunded: 'gray',
  canceled: 'gray',
  expired: 'red',
  chargeback: 'red',
};

const SUBSCRIPTION_TONES: Record<SubscriptionStatus, Tone> = {
  pending: 'amber',
  active: 'green',
  past_due: 'amber',
  suspended: 'red',
  canceling: 'blue',
  ended: 'gray',
  expired: 'red',
};

export interface OrderStatusBadgeProps {
  status: OrderStatus;
  /** Rótulo traduzido (ex.: "Pagamento confirmado"). */
  label: ReactNode;
  className?: string | undefined;
}

/** Selo com o estado do pedido. */
export function OrderStatusBadge({ status, label, className }: OrderStatusBadgeProps) {
  return (
    <AdminStatus dot tone={ORDER_TONES[status]} className={cx('minui-order-status', className)}>
      {label}
    </AdminStatus>
  );
}

export interface SubscriptionStatusBadgeProps {
  status: SubscriptionStatus;
  label: ReactNode;
  className?: string | undefined;
}

/** Selo com o estado da assinatura. */
export function SubscriptionStatusBadge({
  status,
  label,
  className,
}: SubscriptionStatusBadgeProps) {
  return (
    <AdminStatus
      dot
      tone={SUBSCRIPTION_TONES[status]}
      className={cx('minui-subscription-status', className)}
    >
      {label}
    </AdminStatus>
  );
}

export interface PaymentResultLabels {
  /** Nome da região (ex.: "Estado do pagamento"). */
  region: string;
  /** Título de cada situação, já traduzido. */
  title: ReactNode;
  text?: ReactNode;
  /** Enquanto espera: texto anunciado (ex.: "Aguardando pagamento…"). */
  waiting?: string;
}

export interface PaymentResultProps {
  status: OrderStatus;
  labels: PaymentResultLabels;
  /** O que o provedor forneceu para pagar (QR do Pix, linha do boleto), enquanto `pending`. */
  paymentDetails?: ReactNode;
  /** Ações (ex.: "Ir para meus cursos", "Tentar outro pagamento"). */
  actions?: ReactNode;
  className?: string | undefined;
}

const RESULT_ICONS: Partial<Record<OrderStatus, ReactNode>> = {
  pending: <Clock3 aria-hidden="true" />,
  paid: <CircleCheck aria-hidden="true" />,
  canceled: <XCircle aria-hidden="true" />,
  expired: <XCircle aria-hidden="true" />,
  refunded: <RotateCcw aria-hidden="true" />,
  partially_refunded: <RotateCcw aria-hidden="true" />,
  chargeback: <ShieldAlert aria-hidden="true" />,
};

/**
 * Retorno do pagamento: ícone, selo do estado, explicação e, enquanto `pending`, os dados
 * para pagar. Anunciado como `status`, para a confirmação por SSE ser lida sem mudar o foco.
 */
export function PaymentResult({
  status,
  labels,
  paymentDetails,
  actions,
  className,
}: PaymentResultProps) {
  return (
    <section
      aria-label={labels.region}
      className={cx('minui-payment-result', className)}
      data-status={status}
    >
      <div role="status" className="minui-payment-result__head">
        <span className="minui-payment-result__icon">
          {RESULT_ICONS[status] ?? <Clock3 aria-hidden="true" />}
        </span>
        <strong className="minui-payment-result__title">{labels.title}</strong>
        {labels.text ? <p className="minui-payment-result__text">{labels.text}</p> : null}
      </div>
      {status === 'pending' && paymentDetails ? (
        <div className="minui-payment-result__details">{paymentDetails}</div>
      ) : null}
      {actions ? <div className="minui-payment-result__actions">{actions}</div> : null}
    </section>
  );
}
