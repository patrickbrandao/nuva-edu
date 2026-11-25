import {
  AdminButton,
  AdminField,
  AdminMenu,
  AdminSearch,
  AdminStatus,
  AdminTextArea,
  Alert,
  Dialog,
} from '@nuva-edu/ui';
import { type FormEvent, type KeyboardEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  type EntitlementNode,
  endOfDay,
  PRODUCT_TYPES,
  type ProductOption,
  type ProductType,
  REASON_MAX,
  useProductSearch,
} from '../../api/access';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import { QueryErrorState } from '../../api/problems';
import { refusedAccessFields, useAccessError } from './errors';

interface Props {
  user: { id: string; name: string };
  onClose: () => void;
  /** `created` é falso quando a mesma concessão já existia (`200` no lugar de `201`). */
  onDone: (entitlement: EntitlementNode, created: boolean) => void;
}

interface Problems {
  product?: string;
  reason?: string;
  expiresAt?: string;
}

/**
 * Concessão manual (`POST /api/v1/users/{id}/entitlements`; spec 010, RF-06): produto, motivo
 * obrigatório e validade opcional. A API responde `201` quando cria e `200` com o direito
 * existente quando a mesma concessão ainda está ativa.
 */
export function GrantDialog({ user, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const formId = useId();
  const message = useAccessError();
  const [type, setType] = useState<ProductType>('course');
  const [product, setProduct] = useState<ProductOption | null>(null);
  const [reason, setReason] = useState('');
  const [expires, setExpires] = useState('');
  const [problems, setProblems] = useState<Problems>({});

  const grant = useAction(async (productId: string, expiresAt: Date | null) => {
    const { data, response } = await api.POST('/api/v1/users/{id}/entitlements', {
      params: { path: { id: user.id } },
      body: {
        productType: type,
        productId,
        reason: reason.trim(),
        ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
      },
    });
    if (!data) throw new Error('POST /api/v1/users/{id}/entitlements respondeu sem corpo');
    return { entitlement: data, created: response.status === 201 };
  });
  const refused = refusedAccessFields(grant.error);
  const refusal = (field: string) =>
    refused.has(field)
      ? field === 'expiresAt'
        ? t('access.errors.expires_at_in_past')
        : t('forms.invalid')
      : undefined;
  const general =
    Boolean(grant.error) && !['productId', 'reason', 'expiresAt'].some((f) => refused.has(f));

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const found: Problems = {};
    if (!product) found.product = t('access.grant.productRequired');
    if (reason.trim() === '') found.reason = t('forms.required');
    let expiresAt: Date | null = null;
    if (expires !== '') {
      const end = endOfDay(expires);
      if (!end) found.expiresAt = t('access.grant.expiresInvalid');
      else if (end.getTime() <= Date.now()) found.expiresAt = t('access.errors.expires_at_in_past');
      else expiresAt = end;
    }
    setProblems(found);
    grant.reset();
    if (!product || Object.keys(found).length > 0) return;
    const result = await grant.run(product.id, expiresAt);
    if (result.ok) onDone(result.data.entitlement, result.data.created);
  };

  const typeOptions = PRODUCT_TYPES.map((id) => ({ id, label: t(`access.types.${id}`) }));
  const productError = problems.product ?? refusal('productId');

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('access.grant.title', { name: user.name })}
      description={t('access.grant.description')}
      closeLabel={t('common.close')}
      dismissible={!grant.busy}
      footer={
        <>
          <AdminButton onClick={onClose}>{t('common.cancel')}</AdminButton>
          <AdminButton variant="primary" type="submit" form={formId} disabled={grant.busy}>
            {grant.busy ? t('access.grant.busy') : t('access.grant.submit')}
          </AdminButton>
        </>
      }
    >
      {general ? (
        <Alert tone="error" className="mb-4">
          {message(grant.error)}
        </Alert>
      ) : null}
      <form
        id={formId}
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
      >
        <div className="flex flex-col items-start gap-2">
          <span className="text-sm font-medium text-ink">{t('access.grant.product')}</span>
          {product ? (
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {t('access.grant.chosen', {
                  type: t(`access.types.${type}`),
                  title: product.title,
                })}
              </span>
              <AdminButton size="sm" onClick={() => setProduct(null)}>
                {t('access.grant.change')}
              </AdminButton>
            </div>
          ) : (
            <>
              <AdminMenu
                options={typeOptions}
                value={type}
                onChange={(id: ProductType) => setType(id)}
                aria-label={t('access.grant.typeLabel', { value: t(`access.types.${type}`) })}
              />
              <ProductPicker type={type} onPick={setProduct} />
            </>
          )}
          {productError ? (
            <span role="alert" className="text-sm text-ink">
              {productError}
            </span>
          ) : null}
        </div>
        <AdminTextArea
          label={t('access.grant.reason')}
          hint={t('access.grant.reasonHint')}
          value={reason}
          onChange={setReason}
          maxLength={REASON_MAX}
          rows={3}
          error={problems.reason ?? refusal('reason')}
        />
        <AdminField
          type="date"
          label={t('access.grant.expires')}
          hint={t('access.grant.expiresHint')}
          value={expires}
          onChange={(value: string) => setExpires(value)}
          error={problems.expiresAt ?? refusal('expiresAt')}
        />
      </form>
    </Dialog>
  );
}

/** Busca e escolha do produto: os primeiros por título, do tipo escolhido. */
function ProductPicker({
  type,
  onPick,
}: {
  type: ProductType;
  onPick: (product: ProductOption) => void;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState<string | undefined>(undefined);
  const list = useProductSearch(type, q);

  const apply = () => setQ(search.trim() || undefined);
  // o campo está dentro do formulário da concessão: Enter busca, não envia
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    apply();
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <AdminSearch
          value={search}
          onChange={setSearch}
          onKeyDown={onKeyDown}
          label={t('access.grant.search')}
          placeholder={t('courses.filters.searchPlaceholder')}
          maxLength={200}
        />
        <AdminButton onClick={apply}>{t('courses.filters.searchButton')}</AdminButton>
      </div>
      {list.isPending ? (
        <p role="status" className="m-0 text-sm text-ink-3">
          {t('access.grant.loading')}
        </p>
      ) : list.isError ? (
        <QueryErrorState
          error={list.error}
          title={t('access.grant.searchError')}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : list.data.length === 0 ? (
        <p className="m-0 text-sm text-ink-2">{t('access.grant.noResults')}</p>
      ) : (
        <ul
          aria-label={t('access.grant.resultsLabel')}
          className="m-0 flex list-none flex-col gap-2 p-0"
        >
          {list.data.map((item) => {
            const state = item.archivedAt ? 'archived' : item.status;
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2"
              >
                <span>{item.title}</span>
                <AdminStatus
                  tone={state === 'published' ? 'green' : state === 'archived' ? 'red' : 'gray'}
                >
                  {t(`courses.status.${state}`)}
                </AdminStatus>
                <span className="ml-auto">
                  <AdminButton
                    size="sm"
                    aria-label={t('access.grant.chooseOf', { title: item.title })}
                    onClick={() => onPick(item)}
                  >
                    {t('access.grant.choose')}
                  </AdminButton>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
