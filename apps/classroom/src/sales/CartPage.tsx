import {
  AdminButton,
  AdminCard,
  AdminField,
  Cart,
  CartSummary,
  formatMoney,
  OrderTotals,
  PageTitle,
  useToast,
} from '@nuva-edu/ui';
import type { TFunction } from 'i18next';
import { ShoppingBasket } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError } from '../api/errors';
import { useMeta } from '../api/meta';
import { usePageMeta } from '../lib/usePageMeta';
import { RequireSession } from '../session/RequireSession';
import { CHECKOUT_PATH, HOME_PATH } from '../shell/navigation';
import { cartNotices, cartUnlocks, couponInvalidReason, unsellableNotice } from './format';
import {
  type CartApiItem,
  type Cart as CartData,
  useCart,
  useClearCartCoupon,
  useRemoveCartItem,
  useSetCartCoupon,
} from './queries';

/** Item da API na forma que o componente de cesta desenha (spec 011, "Cesta"). */
function cartItemProps(t: TFunction, item: CartApiItem) {
  const notices = [unsellableNotice(t, item.unsellableReason), ...cartNotices(t, item)].filter(
    (notice): notice is string => notice !== null,
  );
  const unlocks = cartUnlocks(t, item);
  return {
    id: item.id,
    title: item.title,
    kindLabel: t(`product.types.${item.productType}`),
    priceCents: item.unitPriceCents ?? 0,
    discountCents: item.discountCents,
    coverUrl: item.cover?.url ?? null,
    includes: unlocks,
    ...(unlocks.length > 0 ? { includesLabel: t('sales.cart.includes') } : {}),
    ...(notices.length > 0 ? { notices } : {}),
  };
}

interface CouponBoxProps {
  cart: CartData;
}

/** Campo do cupom: aplica, mostra o motivo da recusa e permite tirar o cupom da cesta. */
function CouponBox({ cart }: CouponBoxProps) {
  const { t } = useTranslation();
  const meta = useMeta();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const apply = useSetCartCoupon();
  const clear = useClearCartCoupon();
  const coupon = cart.coupon;
  const reason = coupon ? couponInvalidReason(t, coupon) : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length < 3) {
      setError(t('sales.cart.coupon.short'));
      return;
    }
    setError(null);
    apply.mutate(trimmed, {
      onSuccess: () => setCode(''),
      onError: (failure) =>
        setError(
          describeError(t, failure, { coupon_invalid: t('sales.cart.coupon.invalid') }).message,
        ),
    });
  };

  return (
    <section aria-label={t('sales.cart.coupon.region')} className="flex flex-col gap-2">
      <h2 className="m-0 text-sm font-semibold text-ink">{t('sales.cart.coupon.title')}</h2>
      {coupon ? (
        <div className="flex flex-col gap-2">
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink">
            <span className="font-medium">{coupon.code}</span>
            {coupon.kind === 'percent' ? (
              <span className="text-ink-3">
                {t('sales.cart.coupon.percentOff', { percent: coupon.percentOff })}
              </span>
            ) : (
              <span className="text-ink-3">
                {formatMoney(coupon.amountOffCents ?? 0, {
                  currency: cart.currency,
                  locale: meta.data?.locale,
                })}
              </span>
            )}
          </p>
          {reason ? (
            <p role="alert" className="m-0 text-sm text-ink">
              {reason}
            </p>
          ) : null}
          <span className="flex">
            <AdminButton
              size="sm"
              onClick={() => clear.mutate()}
              disabled={clear.isPending}
              aria-label={t('sales.cart.coupon.removeNamed', { code: coupon.code })}
            >
              {clear.isPending ? t('sales.cart.coupon.removing') : t('sales.cart.coupon.remove')}
            </AdminButton>
          </span>
        </div>
      ) : null}
      <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={submit} noValidate>
        <AdminField
          label={t('sales.cart.coupon.label')}
          value={code}
          onChange={setCode}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1"
          {...(error ? { error } : {})}
        />
        <AdminButton
          type="submit"
          disabled={apply.isPending}
          aria-busy={apply.isPending || undefined}
        >
          {apply.isPending ? t('sales.cart.coupon.applying') : t('sales.cart.coupon.apply')}
        </AdminButton>
      </form>
    </section>
  );
}

function CartView() {
  const { t } = useTranslation();
  const meta = useMeta();
  const query = useCart();
  const remove = useRemoveCartItem();
  const toast = useToast();
  const cart = query.data;

  const items = cart?.items.map((item) => cartItemProps(t, item)) ?? [];
  const sellable = cart?.items.filter((item) => item.sellable).length ?? 0;

  const onRemove = (id: string) => {
    remove.mutate(id, {
      onError: (error) =>
        toast.error(describeError(t, error).message, { title: t('sales.cart.removeErrorTitle') }),
    });
  };

  const totals = cart
    ? [
        { id: 'subtotal', label: t('sales.cart.totals.subtotal'), cents: cart.subtotalCents },
        ...(cart.discountCents > 0
          ? [
              {
                id: 'discount',
                label: t('sales.cart.totals.discount'),
                text: formatMoney(-cart.discountCents, {
                  currency: cart.currency,
                  locale: meta.data?.locale,
                }),
              },
            ]
          : []),
        { id: 'total', label: t('sales.cart.totals.total'), cents: cart.totalCents, strong: true },
      ]
    : [];

  const summary =
    cart && cart.items.length > 0 ? (
      <CartSummary
        currency={cart.currency}
        locale={meta.data?.locale}
        coupon={<CouponBox cart={cart} />}
        action={
          <div className="flex flex-col gap-2">
            {sellable === 0 ? (
              <p className="m-0 text-sm text-ink-2" role="status">
                {t('sales.cart.checkoutBlocked')}
              </p>
            ) : null}
            <AdminButton
              {...(sellable > 0 ? { href: CHECKOUT_PATH } : { disabled: true })}
              variant="primary"
            >
              {t('sales.cart.checkout')}
            </AdminButton>
          </div>
        }
      >
        <OrderTotals
          rows={totals}
          currency={cart.currency}
          locale={meta.data?.locale}
          aria-label={t('sales.cart.totals.region')}
        />
      </CartSummary>
    ) : undefined;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6">
      <PageTitle subtitle={t('sales.cart.subtitle', { count: cart?.itemCount ?? 0 })}>
        {t('sales.cart.title')}
      </PageTitle>
      {query.isError && cart ? (
        <AdminCard pad>
          <p className="m-0 text-sm text-ink-2">{t('sales.cart.errorText')}</p>
        </AdminCard>
      ) : null}
      <Cart
        items={items}
        labels={{
          region: t('sales.cart.region'),
          remove: (item) => t('sales.cart.remove', { title: item.title }),
          emptyTitle: t('sales.cart.emptyTitle'),
          emptyText: t('sales.cart.emptyText'),
          loading: t('sales.cart.loading'),
          errorTitle: t('sales.cart.errorTitle'),
          errorText: t('sales.cart.errorText'),
          retry: t('common.retry'),
        }}
        onRemove={onRemove}
        removingId={remove.isPending ? (remove.variables ?? null) : null}
        loading={query.isPending}
        error={query.isError && !cart}
        onRetry={() => void query.refetch()}
        emptyAction={
          <span className="mt-3 flex">
            <AdminButton href={HOME_PATH} icon={<ShoppingBasket size={14} aria-hidden="true" />}>
              {t('sales.cart.emptyAction')}
            </AdminButton>
          </span>
        }
        currency={cart?.currency}
        locale={meta.data?.locale}
        {...(summary ? { summary } : {})}
      />
    </div>
  );
}

/** `/cesta`: itens com cascata e avisos, cupom, totais e o caminho para o checkout (spec 011). */
export function CartPage() {
  const { t } = useTranslation();
  usePageMeta(t('sales.cart.title'), t('sales.cart.description'));
  return <RequireSession>{() => <CartView />}</RequireSession>;
}
