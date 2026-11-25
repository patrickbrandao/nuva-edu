import { type AdminSchemas, uploadAdminImage } from '@nuva-edu/api-client/admin';
import {
  AdminButton,
  AdminDetails,
  AdminField,
  AdminMenu,
  AdminSection,
  AdminTextArea,
  Alert,
  ImagePicker,
  Markdown,
  useToast,
} from '@nuva-edu/ui';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAction } from '../../api/action';
import { useApi } from '../../api/client';
import {
  ACCESS_MODES,
  type AccessMode,
  DESCRIPTION_MAX,
  SUMMARY_MAX,
  TITLE_MAX,
  URL_MAX,
} from '../../api/courses';
import { useMeta } from '../../api/meta';
import {
  isEbook,
  PAGES_MAX,
  type ProductDetail,
  type ProductKind,
  productChanged,
} from '../../api/products';
import { formatPrice, isContentUrl, parsePrice, parseWhole, priceInput } from '../courses/format';

import { useProductError, useProductRefusal } from './errors';

type ProductUpdate = AdminSchemas['EbookUpdate'];

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ACCESS_DAYS_MAX = 36500;

interface FormState {
  title: string;
  slug: string;
  summary: string;
  description: string;
  authorName: string;
  fileUrl: string;
  pages: string;
  accessMode: AccessMode;
  price: string;
  accessDays: string;
}

function formOf(product: ProductDetail): FormState {
  const ebook = isEbook(product) ? product : null;
  return {
    title: product.title,
    slug: product.slug,
    summary: product.summary ?? '',
    description: product.description ?? '',
    authorName: ebook?.authorName ?? '',
    fileUrl: ebook?.fileUrl ?? '',
    pages: ebook?.pages == null ? '' : String(ebook.pages),
    accessMode: product.accessMode,
    price: priceInput(product.priceCents),
    accessDays: product.accessDays === null ? '' : String(product.accessDays),
  };
}

interface Props {
  kind: ProductKind;
  product: ProductDetail;
  /** Modo de acesso e validade: gerente e admin (`product.set_access`, spec 009, RF-12). */
  canSetAccess: boolean;
  /** Preço: só o admin (`product.set_price`). */
  canSetPrice: boolean;
}

/**
 * Dados e capa de um ebook ou pacote (`PATCH /api/v1/ebooks/{id}`, `PATCH /api/v1/bundles/{id}`),
 * como no editor de curso: só os campos alterados são enviados, e os de acesso e de preço nem
 * aparecem para quem não tem a ação. O ebook tem a mais o autor, o arquivo e as páginas.
 */
export function ProductDataTab({ kind, product, canSetAccess, canSetPrice }: Props) {
  const { t } = useTranslation();
  const api = useApi();
  const toast = useToast();
  const queryClient = useQueryClient();
  const meta = useMeta();
  const message = useProductError();
  const ebook = isEbook(product) ? product : null;
  const [form, setForm] = useState<FormState>(() => formOf(product));
  const [invalid, setInvalid] = useState<Map<string, string>>(new Map());
  const [preview, setPreview] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const patch = async (body: ProductUpdate): Promise<ProductDetail> => {
    const params = { path: { id: product.id } };
    const { data } =
      kind === 'ebook'
        ? await api.PATCH('/api/v1/ebooks/{id}', { params, body })
        : await api.PATCH('/api/v1/bundles/{id}', { params, body });
    if (!data) throw new Error('a edição respondeu sem corpo');
    return data;
  };

  /** O que mudou em relação ao produto gravado, já no formato do contrato. */
  const changes = (): { body: ProductUpdate; problems: Map<string, string> } => {
    const body: ProductUpdate = {};
    const problems = new Map<string, string>();
    const title = form.title.trim();
    if (title === '') problems.set('title', t('forms.required'));
    else if (title !== product.title) body.title = title;

    const slug = form.slug.trim();
    if (!SLUG_PATTERN.test(slug)) problems.set('slug', t('courses.fields.slugInvalid'));
    else if (slug !== product.slug) body.slug = slug;

    const summary = form.summary.trim() === '' ? null : form.summary.trim();
    if (summary !== product.summary) body.summary = summary;
    const description = form.description.trim() === '' ? null : form.description;
    if (description !== product.description) body.description = description;

    if (ebook) {
      const authorName = form.authorName.trim() === '' ? null : form.authorName.trim();
      if (authorName !== ebook.authorName) body.authorName = authorName;
      const fileUrl = form.fileUrl.trim() === '' ? null : form.fileUrl.trim();
      if (fileUrl !== null && !isContentUrl(fileUrl)) {
        problems.set('fileUrl', t('courses.errors.content_url_invalid'));
      } else if (fileUrl !== ebook.fileUrl) body.fileUrl = fileUrl;
      const pages = parseWhole(form.pages, 1, PAGES_MAX);
      if (pages === undefined) problems.set('pages', t('products.fields.pagesInvalid'));
      else if (pages !== ebook.pages) body.pages = pages;
    }

    if (canSetAccess) {
      if (form.accessMode !== product.accessMode) body.accessMode = form.accessMode;
      if (form.accessMode !== 'open') {
        const days = parseWhole(form.accessDays, 1, ACCESS_DAYS_MAX);
        if (days === undefined) problems.set('accessDays', t('courses.fields.accessDaysInvalid'));
        else if (days !== product.accessDays) body.accessDays = days;
      }
    }
    if (canSetPrice && form.accessMode === 'paid') {
      const cents = parsePrice(form.price);
      if (cents === undefined) problems.set('priceCents', t('courses.fields.priceInvalid'));
      else if (cents === null) problems.set('priceCents', t('products.errors.price_required'));
      else if (cents !== product.priceCents) body.priceCents = cents;
    }
    return { body, problems };
  };

  const save = useAction(patch);
  const refusal = useProductRefusal(save.error);
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(product));
  const fieldError = (field: string) => invalid.get(field) ?? refusal.of(field);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const { body, problems } = changes();
    setInvalid(problems);
    save.reset();
    if (problems.size > 0 || Object.keys(body).length === 0) return;
    const result = await save.run(body);
    if (!result.ok) return;
    productChanged(queryClient, kind, result.data);
    setForm(formOf(result.data));
    toast.success(t(`products.${kind}.data.saved`));
  };

  const [pickerKey, setPickerKey] = useState(0);
  const cover = useAction(async (file: File | null) => {
    if (file === null) return patch({ coverImageId: null });
    const { data: image } = await uploadAdminImage(api, file, 'product_cover');
    if (!image) throw new Error('POST /api/v1/images respondeu sem corpo');
    return patch({ coverImageId: image.id });
  });
  const changeCover = async (file: File | null) => {
    const result = await cover.run(file);
    if (result.ok) {
      productChanged(queryClient, kind, result.data);
      toast.success(t(file ? 'courses.cover.saved' : 'courses.cover.removed'));
    }
    // a prévia local some: fica a capa gravada (ou a anterior, se o envio falhou)
    setPickerKey((key) => key + 1);
  };

  const accessOptions = ACCESS_MODES.map((id) => ({ id, label: t(`courses.accessModes.${id}`) }));
  const currency = meta.data?.currency;
  // sem campo de preço à vista, a recusa `price_required` aparece no modo de acesso
  const accessError =
    fieldError('accessMode') ?? (canSetPrice ? undefined : fieldError('priceCents'));
  const known = [
    'title',
    'slug',
    'summary',
    'description',
    'accessDays',
    ...(ebook ? ['authorName', 'fileUrl', 'pages'] : []),
    ...(canSetAccess ? ['accessMode', 'priceCents'] : []),
  ];

  return (
    <>
      <AdminSection title={t('courses.cover.title')}>
        <ImagePicker
          key={pickerKey}
          shape="wide"
          label={t(`products.${kind}.coverLabel`)}
          chooseLabel={t('courses.cover.choose')}
          changeLabel={t('courses.cover.change')}
          removeLabel={t('courses.cover.remove')}
          limitHint={t('courses.cover.hint')}
          errors={{
            tooLarge: t('courses.errors.payload_too_large'),
            wrongType: t('courses.errors.image_type_unsupported'),
          }}
          previewAlt={t('courses.cover.alt', { title: product.title })}
          currentUrl={product.cover?.url ?? null}
          placeholder={t('courses.cover.none')}
          busy={cover.busy}
          error={cover.error ? message(cover.error) : undefined}
          onChange={(file) => {
            if (file) void changeCover(file);
          }}
          onRemove={product.cover ? () => void changeCover(null) : undefined}
        />
      </AdminSection>

      <AdminSection title={t(`products.${kind}.data.title`)}>
        {refusal.general(known) ? (
          <Alert tone="error" className="mb-4">
            {message(save.error)}
          </Alert>
        ) : null}
        <form className="flex max-w-3xl flex-col gap-4" noValidate onSubmit={onSubmit}>
          <AdminField
            label={t('courses.fields.title')}
            value={form.title}
            onChange={(value: string) => set('title', value)}
            maxLength={TITLE_MAX}
            autoComplete="off"
            error={fieldError('title')}
          />
          <AdminField
            label={t('courses.fields.slug')}
            hint={t(`products.${kind}.slugHint`)}
            value={form.slug}
            onChange={(value: string) => set('slug', value)}
            maxLength={TITLE_MAX}
            autoComplete="off"
            spellCheck={false}
            error={fieldError('slug')}
          />
          <AdminTextArea
            label={t('courses.fields.summary')}
            hint={t('courses.fields.summaryHint')}
            value={form.summary}
            onChange={(value) => set('summary', value)}
            rows={2}
            maxLength={SUMMARY_MAX}
            counter={({ length, max }) => t('courses.counter', { length, max })}
            error={fieldError('summary')}
          />
          <AdminTextArea
            label={t('courses.fields.description')}
            hint={t('courses.fields.markdownHint')}
            value={form.description}
            onChange={(value) => set('description', value)}
            rows={8}
            maxLength={DESCRIPTION_MAX}
            counter={({ length, max }) => t('courses.counter', { length, max })}
            error={fieldError('description')}
          />
          <div className="flex flex-col items-start gap-2">
            <AdminButton size="sm" aria-expanded={preview} onClick={() => setPreview((on) => !on)}>
              {preview ? t('courses.data.hidePreview') : t('courses.data.showPreview')}
            </AdminButton>
            {preview ? (
              <section
                aria-label={t('courses.data.preview')}
                className="w-full rounded-md border border-line p-3"
              >
                {form.description.trim() === '' ? (
                  <p className="m-0 text-sm text-ink-3">{t('courses.data.previewEmpty')}</p>
                ) : (
                  <Markdown newTabLabel={t('common.newTab')}>{form.description}</Markdown>
                )}
              </section>
            ) : null}
          </div>

          {ebook ? (
            <>
              <AdminField
                label={t('products.fields.authorName')}
                hint={t('products.fields.authorNameHint')}
                value={form.authorName}
                onChange={(value: string) => set('authorName', value)}
                maxLength={TITLE_MAX}
                autoComplete="off"
                error={fieldError('authorName')}
              />
              <AdminField
                label={t('products.fields.fileUrl')}
                hint={t('products.fields.fileUrlHint')}
                type="url"
                value={form.fileUrl}
                onChange={(value: string) => set('fileUrl', value)}
                maxLength={URL_MAX}
                autoComplete="off"
                error={fieldError('fileUrl')}
              />
              <AdminField
                label={t('products.fields.pages')}
                value={form.pages}
                onChange={(value: string) => set('pages', value)}
                maxLength={6}
                inputMode="numeric"
                autoComplete="off"
                error={fieldError('pages')}
              />
            </>
          ) : null}

          {canSetAccess ? (
            <>
              <div className="flex flex-col items-start gap-1">
                <span className="text-sm font-medium text-ink">
                  {t('courses.fields.accessMode')}
                </span>
                <AdminMenu
                  options={accessOptions}
                  value={form.accessMode}
                  onChange={(id: AccessMode) => set('accessMode', id)}
                  aria-label={t('courses.fields.accessModeLabel', {
                    value: t(`courses.accessModes.${form.accessMode}`),
                  })}
                />
                <span className="text-sm text-ink-3">
                  {t(`courses.accessModeHints.${form.accessMode}`)}
                </span>
                {accessError ? (
                  <span role="alert" className="text-sm text-ink">
                    {accessError}
                  </span>
                ) : null}
              </div>
              {form.accessMode === 'paid' && canSetPrice ? (
                <AdminField
                  label={
                    currency ? t('courses.fields.priceIn', { currency }) : t('courses.fields.price')
                  }
                  hint={t('courses.fields.priceHint')}
                  value={form.price}
                  onChange={(value: string) => set('price', value)}
                  maxLength={14}
                  inputMode="decimal"
                  autoComplete="off"
                  error={fieldError('priceCents')}
                />
              ) : null}
              {form.accessMode !== 'open' ? (
                <AdminField
                  label={t('courses.fields.accessDays')}
                  hint={t('courses.fields.accessDaysHint')}
                  value={form.accessDays}
                  onChange={(value: string) => set('accessDays', value)}
                  maxLength={5}
                  inputMode="numeric"
                  autoComplete="off"
                  error={fieldError('accessDays')}
                />
              ) : null}
            </>
          ) : null}

          {!canSetAccess || (form.accessMode === 'paid' && !canSetPrice) ? (
            <AdminDetails
              wrap
              items={[
                ...(canSetAccess
                  ? []
                  : [
                      {
                        label: t('courses.fields.accessMode'),
                        value: t(`courses.accessModes.${product.accessMode}`),
                      },
                    ]),
                ...(product.accessMode === 'paid' || form.accessMode === 'paid'
                  ? [
                      {
                        label: t('courses.fields.price'),
                        value:
                          product.priceCents !== null && currency
                            ? formatPrice(product.priceCents, currency)
                            : t('courses.data.noPrice'),
                      },
                    ]
                  : []),
                ...(canSetAccess
                  ? []
                  : [
                      {
                        label: t('courses.fields.accessDays'),
                        value:
                          product.accessDays === null
                            ? t('courses.data.lifetime')
                            : t('courses.data.days', { count: product.accessDays }),
                      },
                    ]),
              ]}
            />
          ) : null}
          {!canSetAccess || !canSetPrice ? (
            <p className="m-0 text-sm text-ink-3">
              {canSetAccess ? t('courses.data.priceByAdmin') : t('courses.data.accessByManager')}
            </p>
          ) : null}

          <div>
            <AdminButton variant="primary" type="submit" disabled={save.busy || !dirty}>
              {save.busy ? t('common.saving') : t('common.save')}
            </AdminButton>
          </div>
        </form>
      </AdminSection>
    </>
  );
}
