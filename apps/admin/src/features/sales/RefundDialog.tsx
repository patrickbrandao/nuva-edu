import { AdminButton, AdminCheckbox, AdminField, AdminTextArea, Alert, Dialog } from '@nuva-edu/ui';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { amountInput, parseAmountCents, useSalesError, useSalesMoney } from './format';
import {
  newIdempotencyKey,
  type OrderDetail,
  type OrderItem,
  REFUND_REASON_MAX,
  type Refund,
  type RefundItemInput,
  refundableCents,
  requestOrderRefund,
} from './queries';

interface Props {
  order: OrderDetail;
  onClose: () => void;
  onDone: (refund: Refund) => void;
}

/**
 * Pedido de reembolso (spec 011, "Reembolso"; `POST /orders/{id}/refunds`, só `order.refund`):
 * o pedido inteiro ou itens escolhidos, com motivo. A confirmação cita o pedido e avisa que o
 * acesso é revogado em cascata; o estorno em si é executado em segundo plano.
 */
export function RefundDialog({ order, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const money = useSalesMoney();
  const message = useSalesError();
  const formId = useId();
  const [whole, setWhole] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.items.map((item) => [item.id, amountInput(refundableCents(item))])),
  );
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [reasonMissing, setReasonMissing] = useState(false);
  // A repetição do envio devolve o primeiro reembolso por 24 h (Idempotency-Key do contrato).
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  const refund = useAction(async (items: RefundItemInput[] | null) =>
    requestOrderRefund(api, {
      orderId: order.id,
      reason: reason.trim(),
      items,
      idempotencyKey,
    }),
  );

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    setReasonMissing(false);
    refund.reset();
    if (reason.trim() === '') {
      setReasonMissing(true);
      return;
    }
    let items: RefundItemInput[] | null = null;
    if (!whole) {
      const chosen = order.items.filter((item) => selected[item.id]);
      if (chosen.length === 0) {
        setProblem(t('sales.refunds.noItem'));
        return;
      }
      const built: RefundItemInput[] = [];
      for (const item of chosen) {
        const cents = parseAmountCents(amounts[item.id] ?? '');
        const remaining = refundableCents(item);
        if (cents === null || cents <= 0 || cents > remaining) {
          setProblem(t('sales.refunds.invalidAmount', { title: item.title }));
          return;
        }
        built.push({ orderItemId: item.id, amountCents: cents });
      }
      items = built;
    }
    const result = await refund.run(items);
    if (result.ok) onDone(result.data);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('sales.refunds.open')}
      description={t('sales.refunds.confirm', { number: order.number })}
      closeLabel={t('common.close')}
      dismissible={!refund.busy}
      footer={
        <>
          <AdminButton onClick={onClose} disabled={refund.busy}>
            {t('common.cancel')}
          </AdminButton>
          <AdminButton
            variant="primary"
            type="submit"
            form={formId}
            className="minui-adm-btn--danger"
            disabled={refund.busy}
            aria-busy={refund.busy || undefined}
          >
            {refund.busy ? t('sales.refunds.busy') : t('sales.refunds.submit')}
          </AdminButton>
        </>
      }
    >
      {refund.error ? (
        <Alert tone="error" className="mb-4">
          {message(refund.error)}
        </Alert>
      ) : null}
      {problem ? (
        <Alert tone="error" className="mb-4">
          {problem}
        </Alert>
      ) : null}
      <Alert tone="warning" className="mb-4">
        {t('sales.refunds.warning')}
      </Alert>
      <form id={formId} className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="minui-adm-field__label">{t('sales.refunds.scope')}</legend>
          <label className="minui-adm-check">
            <input
              type="radio"
              name={`${formId}-scope`}
              checked={whole}
              onChange={() => {
                setWhole(true);
                setProblem(null);
              }}
            />
            <span>{t('sales.refunds.whole')}</span>
          </label>
          <label className="minui-adm-check">
            <input
              type="radio"
              name={`${formId}-scope`}
              checked={!whole}
              onChange={() => {
                setWhole(false);
                setProblem(null);
              }}
            />
            <span>{t('sales.refunds.items')}</span>
          </label>
        </fieldset>
        {!whole ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {order.items.map((item: OrderItem) => (
              <li key={item.id} className="flex flex-col gap-2">
                <AdminCheckbox
                  checked={selected[item.id] ?? false}
                  onChange={(checked: boolean) =>
                    setSelected((current) => ({ ...current, [item.id]: checked }))
                  }
                >
                  {item.title}{' '}
                  <span className="text-xs text-ink-3">
                    {t('sales.refunds.remaining', { amount: money(refundableCents(item)) })}
                  </span>
                </AdminCheckbox>
                <AdminField
                  label={t('sales.refunds.amount', { title: item.title })}
                  value={amounts[item.id] ?? ''}
                  inputMode="decimal"
                  autoComplete="off"
                  disabled={!selected[item.id]}
                  onChange={(value: string) =>
                    setAmounts((current) => ({ ...current, [item.id]: value }))
                  }
                />
              </li>
            ))}
          </ul>
        ) : null}
        <AdminTextArea
          label={t('sales.refunds.reason')}
          hint={t('sales.refunds.reasonHint')}
          value={reason}
          onChange={setReason}
          maxLength={REFUND_REASON_MAX}
          rows={3}
          error={reasonMissing ? t('forms.required') : undefined}
        />
      </form>
    </Dialog>
  );
}
