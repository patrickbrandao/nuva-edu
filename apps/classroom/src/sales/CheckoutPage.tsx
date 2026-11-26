import {
  AdminButton,
  AdminCard,
  AdminEmpty,
  type BuyerData,
  BuyerForm,
  ErrorState,
  formatMoney,
  LoadingState,
  OrderTotals,
  PageTitle,
  PriceTag,
  TextLink,
} from '@nuva-edu/ui';
import { CircleCheck, ShoppingBasket } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { describeError, type ErrorText } from '../api/errors';
import { useMeta } from '../api/meta';
import { browser, isHttpUrl } from '../lib/browser';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';
import { CART_PATH, HOME_PATH, ORDER_PATH, PURCHASES_PATH } from '../shell/navigation';
import {
  type Billing,
  type Cart,
  useBilling,
  useCart,
  useCreateOrder,
  useSaveBilling,
} from './queries';

/** Chave de idempotência da tentativa: 8 a 128 caracteres (contrato, `Idempotency-Key`). */
function newIdempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `cesta-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

type FieldErrors = { fullName?: string; taxId?: string };

interface CheckoutFormProps {
  cart: Cart;
  billing: Billing | null;
}

/**
 * Dados do comprador e finalização (spec 011, RF-02, RF-05 e RF-09). Só nome e CPF/CNPJ: nada de
 * cartão ou segredo passa por esta tela. O valor final zero não chama o provedor e leva direto ao
 * pedido já pago; nos demais, a resposta traz a página de pagamento do provedor.
 */
function CheckoutForm({ cart, billing }: CheckoutFormProps) {
  const { t } = useTranslation();
  const meta = useMeta();
  const navigate = useNavigate();
  const idempotencyKey = useRef(newIdempotencyKey());
  const [buyer, setBuyer] = useState<BuyerData>(() => ({
    fullName: billing?.fullName ?? '',
    taxIdType: billing?.taxIdType ?? 'cpf',
    taxId: billing?.taxId ?? '',
  }));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const [redirect, setRedirect] = useState<string | null>(null);
  const saveBilling = useSaveBilling();
  const createOrder = useCreateOrder();
  const pending = saveBilling.isPending || createOrder.isPending;
  const sellable = cart.items.filter((item) => item.sellable).length;

  const submit = async () => {
    const fullName = buyer.fullName.trim();
    const taxId = buyer.taxId.trim();
    const errors: FieldErrors = {};
    if (!fullName) errors.fullName = t('sales.checkout.errors.requiredName');
    if (!taxId) errors.taxId = t('sales.checkout.errors.requiredTaxId');
    setFieldErrors(errors);
    setFailure(null);
    if (errors.fullName || errors.taxId) return;
    // nada vendável: o caminho é revisar a cesta, sem chamar a API só para receber o 409
    if (sellable === 0) {
      setFailure({ code: 'cart_invalid', message: t('sales.checkout.errors.cartInvalid') });
      return;
    }

    try {
      await saveBilling.mutateAsync({ fullName, taxIdType: buyer.taxIdType, taxId });
      const checkout = await createOrder.mutateAsync(idempotencyKey.current);
      if (checkout.checkoutUrl && isHttpUrl(checkout.checkoutUrl)) {
        setRedirect(checkout.checkoutUrl);
        // o provedor tem o próprio checkout; a tela mantém o link caso a navegação seja barrada
        browser.assign(checkout.checkoutUrl);
        return;
      }
      navigate(`${ORDER_PATH}/${checkout.order.id}`, { replace: true });
    } catch (error) {
      const shown = describeError(t, error, {
        billing_required: t('sales.checkout.errors.billingRequired'),
        cart_empty: t('sales.checkout.errors.cartEmpty'),
        cart_invalid: t('sales.checkout.errors.cartInvalid'),
        order_pending_limit: t('sales.checkout.errors.pendingLimit'),
        email_not_verified: t('sales.checkout.errors.emailNotVerified'),
        coupon_invalid: t('sales.checkout.errors.couponInvalid'),
        payment_provider_unavailable: t('sales.checkout.errors.providerUnavailable'),
        tax_id_invalid: t('sales.checkout.errors.taxIdInvalid'),
      });
      setFailure(shown);
      if (shown.code === 'tax_id_invalid') setFieldErrors({ taxId: shown.message });
    }
  };

  if (redirect) {
    return (
      <AdminCard pad aria-live="polite">
        <div className="flex flex-col gap-3">
          <p className="m-0 flex items-center gap-2 text-sm font-medium text-ink">
            <CircleCheck size={16} aria-hidden="true" />
            {t('sales.checkout.redirecting')}
          </p>
          <p className="m-0 text-sm text-ink-2">{t('sales.checkout.redirectText')}</p>
          <span className="flex">
            <AdminButton href={redirect} variant="primary">
              {t('sales.checkout.redirectAction')}
            </AdminButton>
          </span>
        </div>
      </AdminCard>
    );
  }

  const failureNode: ReactNode = failure ? (
    <>
      <span>{failure.message}</span>
      {failure.code === 'order_pending_limit' ? (
        <span className="mt-1 block">
          <TextLink href={PURCHASES_PATH}>{t('sales.checkout.viewPending')}</TextLink>
        </span>
      ) : null}
      {['cart_invalid', 'cart_empty', 'coupon_invalid'].includes(failure.code) ? (
        <span className="mt-1 block">
          <TextLink href={CART_PATH}>{t('sales.checkout.reviewCart')}</TextLink>
        </span>
      ) : null}
      {failure.detail ? <span className="mt-1 block text-ink-3">{failure.detail}</span> : null}
    </>
  ) : undefined;

  const totals = [
    { id: 'subtotal', label: t('sales.checkout.totals.subtotal'), cents: cart.subtotalCents },
    ...(cart.discountCents > 0
      ? [
          {
            id: 'discount',
            label: t('sales.checkout.totals.discount'),
            text: formatMoney(-cart.discountCents, {
              currency: cart.currency,
              locale: meta.data?.locale,
            }),
          },
        ]
      : []),
    { id: 'total', label: t('sales.checkout.totals.total'), cents: cart.totalCents, strong: true },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <div className="flex min-w-0 flex-col gap-6">
        <AdminCard pad>
          <BuyerForm
            value={buyer}
            onChange={setBuyer}
            onSubmit={() => void submit()}
            labels={{
              legend: t('sales.checkout.buyer.legend'),
              fullName: t('sales.checkout.buyer.fullName'),
              fullNameHint: t('sales.checkout.buyer.fullNameHint'),
              taxIdType: t('sales.checkout.buyer.taxIdType'),
              cpf: t('sales.checkout.buyer.cpf'),
              cnpj: t('sales.checkout.buyer.cnpj'),
              taxId: t('sales.checkout.buyer.taxId'),
              taxIdHint: t('sales.checkout.buyer.taxIdHint'),
              submit: t('sales.checkout.submit'),
              submitting: t('sales.checkout.submitting'),
            }}
            errors={{
              ...(fieldErrors.fullName ? { fullName: fieldErrors.fullName } : {}),
              ...(fieldErrors.taxId ? { taxId: fieldErrors.taxId } : {}),
            }}
            pending={pending}
            {...(failureNode ? { error: failureNode } : {})}
          />
        </AdminCard>
        <p className="m-0 text-sm text-ink-3">{t('sales.checkout.privacy')}</p>
      </div>
      <aside className="flex flex-col gap-3" aria-label={t('sales.checkout.summary')}>
        <AdminCard pad>
          <h2 className="m-0 mb-3 text-sm font-semibold text-ink">
            {t('sales.checkout.itemsTitle')}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
            {cart.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0 flex-1 basis-40 break-words">
                  <span className="text-ink">{item.title}</span>
                  {item.sellable ? null : (
                    <span className="block text-xs text-ink-3">
                      {t('sales.checkout.unsellable')}
                    </span>
                  )}
                </span>
                <PriceTag
                  cents={(item.unitPriceCents ?? 0) - item.discountCents}
                  originalCents={item.discountCents > 0 ? item.unitPriceCents : null}
                  currency={cart.currency}
                  locale={meta.data?.locale}
                />
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <OrderTotals
              rows={totals}
              currency={cart.currency}
              locale={meta.data?.locale}
              aria-label={t('sales.checkout.totals.region')}
            />
          </div>
          {cart.totalCents === 0 ? (
            <p className="m-0 mt-3 text-sm text-ink-2" role="status">
              {t('sales.checkout.zeroTotal')}
            </p>
          ) : null}
          {sellable === 0 ? (
            <p className="m-0 mt-3 text-sm text-ink-2" role="status">
              {t('sales.checkout.noSellable')}
            </p>
          ) : null}
          <span className="mt-4 flex">
            <AdminButton href={CART_PATH} size="sm">
              {t('sales.checkout.backToCart')}
            </AdminButton>
          </span>
        </AdminCard>
      </aside>
    </div>
  );
}

function CheckoutView() {
  const { t } = useTranslation();
  const cartQuery = useCart();
  const billingQuery = useBilling();

  if (cartQuery.isPending || (billingQuery.isPending && !billingQuery.data)) {
    return (
      <AdminCard pad aria-busy="true">
        <LoadingState label={t('sales.checkout.loading')} />
      </AdminCard>
    );
  }

  if (cartQuery.isError) {
    const failure = describeError(t, cartQuery.error);
    return (
      <AdminCard pad>
        <ErrorState
          title={t('sales.checkout.errorTitle')}
          text={failure.message}
          detail={failure.detail}
          retryLabel={t('common.retry')}
          onRetry={() => void cartQuery.refetch()}
          retrying={cartQuery.isFetching}
        />
      </AdminCard>
    );
  }

  const cart = cartQuery.data;
  if (!cart || cart.items.length === 0) {
    return (
      <AdminEmpty
        icon={<ShoppingBasket aria-hidden="true" />}
        title={t('sales.checkout.emptyTitle')}
        text={t('sales.checkout.emptyText')}
      >
        <span className="mt-3 flex">
          <AdminButton href={HOME_PATH}>{t('sales.checkout.emptyAction')}</AdminButton>
        </span>
      </AdminEmpty>
    );
  }

  return <CheckoutForm cart={cart} billing={billingQuery.data ?? null} />;
}

/** `/checkout`: comprador, resumo e finalização (spec 011). */
export function CheckoutPage() {
  const { t } = useTranslation();
  usePageMeta(t('sales.checkout.title'), t('sales.checkout.description'));
  return (
    <RequireSession>
      {() => (
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6">
          <PageTitle subtitle={t('sales.checkout.subtitle')}>{t('sales.checkout.title')}</PageTitle>
          <CheckoutView />
        </div>
      )}
    </RequireSession>
  );
}
