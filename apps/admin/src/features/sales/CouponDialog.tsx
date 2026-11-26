import {
  AdminButton,
  AdminCheckbox,
  AdminField,
  AdminMenu,
  AdminSwitch,
  Alert,
  Dialog,
} from '@nuva-edu/ui';
import { type FormEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import {
  amountInput,
  couponAppliesToLabel,
  couponKindLabel,
  fromDateTimeInput,
  parseAmountCents,
  refusedFields,
  toDateTimeInput,
  useSalesError,
} from './format';
import { useProductOptions } from './productOptions';
import {
  COUPON_APPLIES_TO,
  COUPON_CODE_MAX,
  COUPON_CODE_MIN,
  COUPON_CODE_PATTERN,
  COUPON_KINDS,
  type Coupon,
  type CouponAppliesTo,
  type CouponInput,
  type CouponKind,
  type CouponProductInput,
  createCoupon,
  updateCoupon,
} from './queries';

interface Props {
  /** Cupom a editar; ausente cria um novo. */
  coupon?: Coupon | undefined;
  onClose: () => void;
  onDone: (coupon: Coupon) => void;
}

interface FormState {
  code: string;
  kind: CouponKind;
  percent: string;
  amount: string;
  appliesTo: CouponAppliesTo;
  startsAt: string;
  endsAt: string;
  maxUses: string;
  maxUsesPerUser: string;
  /** `tipo:id` das opções marcadas; vazio vale para todos os produtos. */
  products: string[];
  active: boolean;
}

function formOf(coupon: Coupon | undefined): FormState {
  return {
    code: coupon?.code ?? '',
    kind: coupon?.kind ?? 'percent',
    percent: coupon?.percentOff != null ? String(coupon.percentOff) : '',
    amount: amountInput(coupon?.amountOffCents),
    appliesTo: coupon?.appliesTo ?? 'orders',
    startsAt: toDateTimeInput(coupon?.startsAt),
    endsAt: toDateTimeInput(coupon?.endsAt),
    maxUses: coupon?.maxUses != null ? String(coupon.maxUses) : '',
    maxUsesPerUser: String(coupon?.maxUsesPerUser ?? 1),
    products: (coupon?.products ?? []).map(
      (product) => `${product.productType}:${product.productId}`,
    ),
    active: coupon?.active ?? true,
  };
}

type Problems = Partial<Record<keyof FormState, string>>;

/**
 * Formulário de cupom (spec 011, "Cupons"; `POST|PATCH /coupons`, `coupon.manage`): código,
 * desconto percentual ou fixo, validade, limites, restrição de produtos e situação. Editar manda
 * a lista inteira de produtos (o contrato substitui, e vazio vale para todos). O código repetido
 * (`409 coupon_code_taken`) e a combinação inválida (`422 coupon_invalid`) aparecem no topo.
 */
export function CouponDialog({ coupon, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const message = useSalesError();
  const formId = useId();
  const products = useProductOptions();
  const [form, setForm] = useState<FormState>(() => formOf(coupon));
  const [problems, setProblems] = useState<Problems>({});
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = useAction(async (): Promise<Coupon> => {
    const code = form.code.trim().toUpperCase();
    const body: CouponInput = {
      code,
      kind: form.kind,
      percentOff: form.kind === 'percent' ? Number(form.percent) : null,
      amountOffCents: form.kind === 'fixed' ? parseAmountCents(form.amount) : null,
      startsAt: fromDateTimeInput(form.startsAt),
      endsAt: fromDateTimeInput(form.endsAt),
      maxUses: form.maxUses.trim() === '' ? null : Number(form.maxUses),
      maxUsesPerUser: Number(form.maxUsesPerUser),
      appliesTo: form.appliesTo,
      products: form.products.flatMap((id) => {
        const product = products.find((option) => option.id === id);
        return product
          ? [
              {
                productType: product.productType,
                productId: product.productId,
              } satisfies CouponProductInput,
            ]
          : [];
      }),
      active: form.active,
    };
    if (coupon) return updateCoupon(api, coupon.id, body);
    return createCoupon(api, body);
  });

  const validate = (): Problems => {
    const found: Problems = {};
    const code = form.code.trim();
    if (code.length < COUPON_CODE_MIN || code.length > COUPON_CODE_MAX) {
      found.code = t('sales.coupons.form.codeLength', {
        min: COUPON_CODE_MIN,
        max: COUPON_CODE_MAX,
      });
    } else if (!COUPON_CODE_PATTERN.test(code)) {
      found.code = t('sales.coupons.form.codePattern');
    }
    if (form.kind === 'percent') {
      const percent = Number(form.percent);
      if (!/^\d+$/.test(form.percent.trim()) || percent < 1 || percent > 100) {
        found.percent = t('sales.coupons.form.percentRange');
      }
    } else {
      const cents = parseAmountCents(form.amount);
      if (cents === null || cents <= 0) found.amount = t('sales.coupons.form.amountPositive');
    }
    if (form.maxUses.trim() !== '' && !/^\d+$/.test(form.maxUses.trim())) {
      found.maxUses = t('sales.coupons.form.maxUsesInvalid');
    }
    if (!/^\d+$/.test(form.maxUsesPerUser.trim()) || Number(form.maxUsesPerUser) < 1) {
      found.maxUsesPerUser = t('sales.coupons.form.perUserInvalid');
    }
    const startsAt = fromDateTimeInput(form.startsAt);
    const endsAt = fromDateTimeInput(form.endsAt);
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      found.endsAt = t('sales.coupons.form.endsAfterStart');
    }
    return found;
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    save.reset();
    const found = validate();
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    const result = await save.run();
    if (result.ok) {
      onDone(result.data);
      return;
    }
    const refused = refusedFields(result.error);
    if (refused.size > 0) {
      setProblems((current) => {
        const next = { ...current };
        for (const field of refused) {
          if (field === 'percentOff') next.percent = t('sales.coupons.form.percentRange');
          else if (field === 'amountOffCents') next.amount = t('sales.coupons.form.amountPositive');
          else if (field === 'code') next.code = t('sales.coupons.form.codePattern');
        }
        return next;
      });
    }
  };

  const kindOptions = COUPON_KINDS.map((id) => ({ id, label: couponKindLabel(t, id) }));
  const appliesOptions = COUPON_APPLIES_TO.map((id) => ({
    id,
    label: couponAppliesToLabel(t, id),
  }));

  const toggleProduct = (id: string, checked: boolean) =>
    setForm((current) => ({
      ...current,
      products: checked
        ? [...current.products, id]
        : current.products.filter((product) => product !== id),
    }));

  return (
    <Dialog
      open
      onClose={onClose}
      title={coupon ? t('sales.coupons.edit') : t('sales.coupons.create')}
      description={t('sales.coupons.form.text')}
      closeLabel={t('common.close')}
      dismissible={!save.busy}
      footer={
        <>
          <AdminButton onClick={onClose} disabled={save.busy}>
            {t('common.cancel')}
          </AdminButton>
          <AdminButton
            variant="primary"
            type="submit"
            form={formId}
            disabled={save.busy}
            aria-busy={save.busy || undefined}
          >
            {save.busy ? t('common.saving') : t('common.save')}
          </AdminButton>
        </>
      }
    >
      {save.error ? (
        <Alert tone="error" className="mb-4">
          {message(save.error)}
        </Alert>
      ) : null}
      <form id={formId} className="flex flex-col gap-4" noValidate onSubmit={onSubmit}>
        <AdminField
          label={t('sales.coupons.form.code')}
          hint={t('sales.coupons.form.codeHint')}
          value={form.code}
          onChange={(value: string) => set('code', value.toUpperCase())}
          maxLength={COUPON_CODE_MAX}
          autoComplete="off"
          error={problems.code}
          required
        />
        <AdminMenu
          options={kindOptions}
          value={form.kind}
          onChange={(id: string) => set('kind', id as CouponKind)}
          aria-label={t('sales.coupons.form.kindLabel', {
            value: couponKindLabel(t, form.kind),
          })}
        />
        {form.kind === 'percent' ? (
          <AdminField
            label={t('sales.coupons.form.percent')}
            hint={t('sales.coupons.form.percentHint')}
            value={form.percent}
            onChange={(value: string) => set('percent', value)}
            inputMode="numeric"
            autoComplete="off"
            error={problems.percent}
            required
          />
        ) : (
          <AdminField
            label={t('sales.coupons.form.amount')}
            hint={t('sales.coupons.form.amountHint')}
            value={form.amount}
            onChange={(value: string) => set('amount', value)}
            inputMode="decimal"
            autoComplete="off"
            error={problems.amount}
            required
          />
        )}
        <AdminMenu
          options={appliesOptions}
          value={form.appliesTo}
          onChange={(id: string) => set('appliesTo', id as CouponAppliesTo)}
          aria-label={t('sales.coupons.form.appliesToLabel', {
            value: couponAppliesToLabel(t, form.appliesTo),
          })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <AdminField
            type="datetime-local"
            label={t('sales.coupons.form.startsAt')}
            hint={t('sales.coupons.form.startsAtHint')}
            value={form.startsAt}
            onChange={(value: string) => set('startsAt', value)}
          />
          <AdminField
            type="datetime-local"
            label={t('sales.coupons.form.endsAt')}
            hint={t('sales.coupons.form.endsAtHint')}
            value={form.endsAt}
            onChange={(value: string) => set('endsAt', value)}
            error={problems.endsAt}
          />
          <AdminField
            label={t('sales.coupons.form.maxUses')}
            hint={t('sales.coupons.form.maxUsesHint')}
            value={form.maxUses}
            onChange={(value: string) => set('maxUses', value)}
            inputMode="numeric"
            autoComplete="off"
            error={problems.maxUses}
          />
          <AdminField
            label={t('sales.coupons.form.maxUsesPerUser')}
            hint={t('sales.coupons.form.maxUsesPerUserHint')}
            value={form.maxUsesPerUser}
            onChange={(value: string) => set('maxUsesPerUser', value)}
            inputMode="numeric"
            autoComplete="off"
            error={problems.maxUsesPerUser}
            required
          />
        </div>
        <fieldset className="flex flex-col gap-2 border-0 p-0">
          <legend className="minui-adm-field__label">{t('sales.coupons.form.products')}</legend>
          <p className="m-0 text-sm text-ink-3">{t('sales.coupons.form.productsHint')}</p>
          {products.length === 0 ? (
            <p className="m-0 text-sm text-ink-3">{t('sales.coupons.form.noProducts')}</p>
          ) : (
            <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
              {products.map((product) => (
                <AdminCheckbox
                  key={product.id}
                  checked={form.products.includes(product.id)}
                  onChange={(checked: boolean) => toggleProduct(product.id, checked)}
                >
                  {product.title}
                </AdminCheckbox>
              ))}
            </div>
          )}
        </fieldset>
        <AdminSwitch checked={form.active} onChange={(checked: boolean) => set('active', checked)}>
          {t('sales.coupons.form.active')}
        </AdminSwitch>
      </form>
    </Dialog>
  );
}
