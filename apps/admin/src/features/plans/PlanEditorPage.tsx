import { isApiError } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminCard,
  AdminCheckbox,
  AdminDetails,
  AdminField,
  AdminPageHeader,
  AdminSection,
  AdminSwitch,
  AdminTextArea,
  Alert,
  LoadingState,
  TextLink,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import { formatDateTime } from '../../format';
import { usePageCrumb } from '../../shell/crumbs';
import { amountInput, parseAmountCents } from '../sales/format';
import {
  planIntervalLabel,
  planIntervalName,
  productTypeLabel,
  refusedFields,
  usePlansError,
} from './format';
import { usePlanProductOptions } from './productOptions';
import {
  createPlan,
  PLAN_DESCRIPTION_MAX,
  PLAN_INTERVALS,
  PLAN_ITEMS_MAX,
  PLAN_TITLE_MAX,
  PLANS_PATH,
  type Plan,
  type PlanInterval,
  type PlanItemInput,
  planItemInput,
  planItemOptionId,
  planPath,
  plansKeys,
  replacePlanItems,
  SLUG_MAX,
  SLUG_PATTERN,
  updatePlan,
  usePlan,
} from './queries';

/** Os campos do plano que a criação e a edição compartilham (sem `groupKey`, `interval` e `items`). */
type PlanFields = {
  title: string;
  description: string | null;
  priceCents: number;
  includesAll: boolean;
  includesPrivate: boolean;
  active: boolean;
  position: number;
};

interface FormState {
  title: string;
  description: string;
  interval: PlanInterval;
  /** Só na criação: agrupa as periodicidades na vitrine e não muda depois. */
  groupKey: string;
  price: string;
  position: string;
  includesAll: boolean;
  includesPrivate: boolean;
  active: boolean;
  /** `tipo:id` dos itens marcados. */
  items: string[];
}

function formOf(plan: Plan | undefined): FormState {
  return {
    title: plan?.title ?? '',
    description: plan?.description ?? '',
    interval: plan?.interval ?? 'month',
    groupKey: plan?.groupKey ?? '',
    price: plan ? amountInput(plan.priceCents) : '',
    position: String(plan?.position ?? 0),
    includesAll: plan?.includesAll ?? false,
    includesPrivate: plan?.includesPrivate ?? false,
    active: plan?.active ?? true,
    items: (plan?.items ?? []).map((item) => planItemOptionId(item)),
  };
}

type Problems = Partial<Record<keyof FormState, string>>;

/**
 * Editor de plano (spec 012, "Planos"; `POST /plans`, `PATCH /plans/{id}` e
 * `PUT /plans/{id}/items`, `plan.manage`, só admin). Os dados do plano mudam pelo `PATCH`; os
 * itens que ele libera, pelo `PUT` que substitui a lista inteira. `slug`, `groupKey` e
 * `interval` não mudam depois da criação — outro conteúdo ou outra periodicidade é um plano
 * novo. Plano com "tudo" não usa lista; plano com assinaturas só é desativado, nunca excluído.
 */
export function PlanEditorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const plan = usePlan(id);
  usePageCrumb(plan.data ? plan.data.title : id ? null : t('plans.createTitle'));

  if (id && plan.isPending) return <LoadingState label={t('plans.detailLoading')} />;
  if (id && plan.isError && !plan.data) {
    if (isApiError(plan.error) && plan.error.status === 404) {
      return (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="error">{t('plans.notFound')}</Alert>
          <AdminButton href={PLANS_PATH}>{t('plans.backToList')}</AdminButton>
        </div>
      );
    }
    return (
      <QueryErrorState
        error={plan.error}
        title={t('plans.detailErrorTitle')}
        onRetry={() => void plan.refetch()}
        retrying={plan.isFetching}
      />
    );
  }
  return <PlanForm plan={id ? plan.data : undefined} />;
}

function PlanForm({ plan }: { plan: Plan | undefined }) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const navigate = useNavigate();
  const message = usePlansError();
  const queryClient = useQueryClient();
  const options = usePlanProductOptions(plan?.items ?? []);
  const [form, setForm] = useState<FormState>(() => formOf(plan));
  const [problems, setProblems] = useState<Problems>({});

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((state) => ({ ...state, [key]: value }));

  const refresh = (id: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: plansKeys.all() }),
      queryClient.invalidateQueries({ queryKey: plansKeys.detail(id) }),
    ]);

  const selectedInputs = (): PlanItemInput[] =>
    form.items.flatMap((optionId) => {
      const option = options.find((item) => item.id === optionId);
      return option ? [planItemInput(option)] : [];
    });

  /** Campos comuns; o preço vira centavos e "só privados" exige "tudo". */
  const validate = (): { ok: true; body: PlanFields } | { ok: false } => {
    const found: Problems = {};
    const title = form.title.trim();
    if (title === '') found.title = t('forms.required');
    const priceCents = parseAmountCents(form.price);
    if (priceCents === null) found.price = t('plans.form.priceInvalid');
    else if (priceCents < 1) found.price = t('plans.form.priceMinimum');
    const position = Number(form.position.trim() === '' ? '0' : form.position);
    if (!Number.isInteger(position) || position < 0) {
      found.position = t('plans.form.positionInvalid');
    }
    if (!plan) {
      const groupKey = form.groupKey.trim();
      if (groupKey === '') found.groupKey = t('forms.required');
      else if (!SLUG_PATTERN.test(groupKey)) found.groupKey = t('plans.form.groupKeyInvalid');
    }
    if (!form.includesAll && form.items.length > PLAN_ITEMS_MAX) {
      found.items = t('plans.form.itemsTooMany');
    }
    setProblems(found);
    if (Object.keys(found).length > 0) return { ok: false };
    return {
      ok: true,
      body: {
        title,
        description: form.description.trim() === '' ? null : form.description,
        priceCents: priceCents ?? 0,
        includesAll: form.includesAll,
        includesPrivate: form.includesAll && form.includesPrivate,
        active: form.active,
        position,
      },
    };
  };

  const save = useAction(async (): Promise<Plan> => {
    const result = validate();
    if (!result.ok) throw new Error('plans:invalid');
    if (plan) return updatePlan(api, plan.id, result.body);
    return createPlan(api, {
      ...result.body,
      groupKey: form.groupKey.trim(),
      interval: form.interval,
      items: result.body.includesAll ? [] : selectedInputs(),
    });
  });

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    save.reset();
    const result = await save.run();
    if (!result.ok) {
      if (isApiError(result.error)) {
        const fields = refusedFields(result.error);
        if (fields.size > 0) {
          setProblems(
            Object.fromEntries(
              [...fields].map((field) => [field, t('forms.required')]),
            ) as Problems,
          );
        }
      }
      return;
    }
    await refresh(result.data.id);
    if (plan) {
      toast.success(t('plans.saved', { title: result.data.title }));
    } else {
      toast.success(t('plans.created', { title: result.data.title }));
      navigate(planPath(result.data.id), { replace: true });
    }
  };

  const saveItems = useAction(async () => {
    if (!plan) throw new Error('plans:no-plan');
    return replacePlanItems(api, plan.id, selectedInputs());
  });

  const onSaveItems = async () => {
    saveItems.reset();
    const result = await saveItems.run();
    if (result.ok) {
      await refresh(result.data.id);
      toast.success(t('plans.items.saved', { title: result.data.title }));
    }
  };

  const toggleItem = (optionId: string, checked: boolean) =>
    set('items', checked ? [...form.items, optionId] : form.items.filter((id) => id !== optionId));

  const incomplete = save.error instanceof Error && save.error.message === 'plans:invalid';
  const failMessage = save.error && !incomplete ? message(save.error) : null;

  return (
    <>
      <AdminPageHeader
        title={plan ? plan.title : t('plans.createTitle')}
        subtitle={plan ? t('plans.editSubtitle', { slug: plan.slug }) : t('plans.createSubtitle')}
        actions={
          <AdminButton href={PLANS_PATH} icon={<ArrowLeft size={16} aria-hidden="true" />}>
            {t('plans.backToList')}
          </AdminButton>
        }
      />
      {failMessage ? (
        <Alert tone="error" className="mb-4">
          {failMessage}
        </Alert>
      ) : null}
      {plan && plan.subscriptionCount > 0 ? (
        <Alert tone="warning" className="mb-4">
          {t('plans.form.hasSubscriptions', { count: plan.subscriptionCount })}
        </Alert>
      ) : null}

      <form onSubmit={onSubmit} noValidate>
        <AdminSection title={t('plans.form.dataTitle')}>
          <AdminCard pad className="flex flex-col gap-4">
            <AdminField
              label={t('plans.form.title')}
              value={form.title}
              onChange={(value: string) => set('title', value)}
              maxLength={PLAN_TITLE_MAX}
              error={problems.title}
            />
            <AdminTextArea
              label={t('plans.form.description')}
              hint={t('plans.form.descriptionHint')}
              value={form.description}
              onChange={(value: string) => set('description', value)}
              maxLength={PLAN_DESCRIPTION_MAX}
              rows={4}
            />
            {plan ? (
              <AdminDetails
                wrap
                items={[
                  { label: t('plans.form.slug'), value: plan.slug },
                  { label: t('plans.form.groupKey'), value: plan.groupKey },
                  { label: t('plans.form.interval'), value: planIntervalName(t, plan.interval) },
                  { label: t('plans.form.createdAt'), value: formatDateTime(plan.createdAt) },
                  { label: t('plans.form.updatedAt'), value: formatDateTime(plan.updatedAt) },
                  {
                    label: t('plans.form.providerPlanId'),
                    value: plan.providerPlanId ?? t('plans.form.providerPlanIdPending'),
                  },
                ]}
              />
            ) : (
              <div className="flex flex-wrap gap-4">
                <AdminField
                  label={t('plans.form.groupKey')}
                  hint={t('plans.form.groupKeyHint')}
                  value={form.groupKey}
                  onChange={(value: string) => set('groupKey', value)}
                  maxLength={SLUG_MAX}
                  error={problems.groupKey}
                  autoComplete="off"
                />
                <label className="minui-adm-field">
                  <span className="minui-adm-field__label">{t('plans.form.interval')}</span>
                  <select
                    className="minui-adm-input"
                    value={form.interval}
                    onChange={(event) => set('interval', event.target.value as PlanInterval)}
                  >
                    {PLAN_INTERVALS.map((interval) => (
                      <option key={interval} value={interval}>
                        {planIntervalName(t, interval)}
                      </option>
                    ))}
                  </select>
                  <span className="minui-adm-field__hint">{t('plans.form.intervalHint')}</span>
                </label>
              </div>
            )}
            <div className="flex flex-wrap gap-4">
              <AdminField
                label={t('plans.form.price')}
                hint={t('plans.form.priceHint', {
                  period: planIntervalLabel(t, plan?.interval ?? form.interval),
                })}
                value={form.price}
                onChange={(value: string) => set('price', value)}
                inputMode="decimal"
                autoComplete="off"
                error={problems.price}
              />
              <AdminField
                label={t('plans.form.position')}
                hint={t('plans.form.positionHint')}
                value={form.position}
                onChange={(value: string) => set('position', value)}
                inputMode="numeric"
                autoComplete="off"
                error={problems.position}
              />
            </div>
            {plan ? (
              <p className="m-0 text-sm text-ink-3">{t('plans.form.priceContractNote')}</p>
            ) : null}
            <div className="flex flex-col gap-3">
              <AdminSwitch
                checked={form.includesAll}
                onChange={(checked: boolean) => {
                  set('includesAll', checked);
                  if (!checked) set('includesPrivate', false);
                }}
              >
                {t('plans.form.includesAll')}
              </AdminSwitch>
              <span className="text-sm text-ink-3">{t('plans.form.includesAllHint')}</span>
              <AdminSwitch
                checked={form.includesAll && form.includesPrivate}
                disabled={!form.includesAll}
                onChange={(checked: boolean) => set('includesPrivate', checked)}
              >
                {t('plans.form.includesPrivate')}
              </AdminSwitch>
              <span className="text-sm text-ink-3">{t('plans.form.includesPrivateHint')}</span>
              <AdminSwitch
                checked={form.active}
                onChange={(checked: boolean) => set('active', checked)}
              >
                {t('plans.form.active')}
              </AdminSwitch>
              <span className="text-sm text-ink-3">{t('plans.form.activeHint')}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <AdminButton
                variant="primary"
                type="submit"
                icon={<Save size={16} aria-hidden="true" />}
                disabled={save.busy}
                aria-busy={save.busy || undefined}
              >
                {save.busy ? t('common.saving') : t('common.save')}
              </AdminButton>
              {plan ? <span className="text-sm text-ink-3">{t('plans.form.noDelete')}</span> : null}
            </div>
          </AdminCard>
        </AdminSection>
      </form>

      {plan?.includesAll ? (
        <AdminSection title={t('plans.items.title')}>
          <AdminCard pad className="flex flex-col gap-2">
            <strong>
              {plan.includesPrivate ? t('plans.coverage.allPrivate') : t('plans.coverage.all')}
            </strong>
            <span className="text-sm text-ink-3">{t('plans.items.includesAllText')}</span>
          </AdminCard>
        </AdminSection>
      ) : (
        <AdminSection
          title={t('plans.items.title')}
          actions={
            plan ? (
              <AdminButton
                onClick={() => void onSaveItems()}
                disabled={saveItems.busy}
                aria-busy={saveItems.busy || undefined}
              >
                {saveItems.busy ? t('common.saving') : t('plans.items.save')}
              </AdminButton>
            ) : null
          }
        >
          {saveItems.error ? (
            <Alert tone="error" className="mb-4">
              {message(saveItems.error)}
            </Alert>
          ) : null}
          <AdminCard pad className="flex flex-col gap-4">
            <span className="text-sm text-ink-3">
              {plan ? t('plans.items.editHint') : t('plans.items.createHint')}
            </span>
            {problems.items ? <Alert tone="error">{problems.items}</Alert> : null}
            {(['course', 'ebook', 'bundle'] as const).map((type) => {
              const group = options.filter((option) => option.productType === type);
              if (group.length === 0) return null;
              return (
                <fieldset key={type} className="flex flex-col gap-2 border-0 p-0">
                  <legend className="minui-adm-field__label">{productTypeLabel(t, type)}</legend>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {group.map((option) => (
                      <li key={option.id}>
                        <AdminCheckbox
                          checked={form.items.includes(option.id)}
                          onChange={(checked: boolean) => toggleItem(option.id, checked)}
                        >
                          {option.title}
                        </AdminCheckbox>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              );
            })}
            {options.length === 0 ? (
              <span className="text-sm text-ink-3">{t('plans.items.noProducts')}</span>
            ) : null}
          </AdminCard>
        </AdminSection>
      )}
      {plan ? (
        <p className="mt-4 text-sm">
          <TextLink href={PLANS_PATH} quiet>
            {t('plans.backToList')}
          </TextLink>
        </p>
      ) : null}
    </>
  );
}
