import {
  Accordion,
  AdminButton,
  AdminCard,
  AdminDetails,
  AdminEmpty,
  AdminSection,
  AdminTag,
  ErrorState,
  LoadingState,
  Markdown,
  PageTitle,
  TextLink,
} from '@nuva-edu/ui';
import { Lock, PackageSearch } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router';
import { describeError } from '../api/errors';
import {
  accessValidity,
  formatDuration,
  isFree,
  productPath,
  productTotals,
  useDateFormatter,
  usePriceFormatter,
} from '../catalog/format';
import {
  type AccessState,
  type CatalogBundle,
  type CatalogCourse,
  type CatalogProduct,
  type ProductType,
  useCatalogProduct,
  useProductAccess,
} from '../catalog/queries';
import { usePageMeta } from '../lib/usePageMeta';
import { AddToCart } from '../sales/AddToCart';
import { safeReturnTo, withReturnTo } from '../session/returnTo';
import { useSession } from '../session/session';
import { HOME_PATH, LOGIN_PATH } from '../shell/navigation';

type PriceFormatter = (cents: number) => string | undefined;

/** Programa do curso: um painel por módulo, com título e duração das aulas (sem o conteúdo). */
function Program({ course }: { course: CatalogCourse }) {
  const { t } = useTranslation();
  if (course.program.length === 0) {
    return <p className="m-0 text-sm text-ink-3">{t('product.programEmpty')}</p>;
  }
  const modules = [...course.program].sort((a, b) => a.position - b.position);
  return (
    <Accordion
      headingLevel={3}
      defaultOpen={modules[0] ? [modules[0].id] : []}
      items={modules.map((module) => ({
        id: module.id,
        title: module.title,
        meta: [
          t('product.totals.lessons', { count: module.lessonCount }),
          ...(module.durationSeconds ? [formatDuration(t, module.durationSeconds)] : []),
        ].join(' · '),
        content: (
          <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm text-ink">
            {[...module.lessons]
              .sort((a, b) => a.position - b.position)
              .map((lesson) => (
                <li key={lesson.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 basis-40 break-words">{lesson.title}</span>
                  {lesson.isSample ? <AdminTag>{t('product.sample')}</AdminTag> : null}
                  {lesson.durationSeconds ? (
                    <span className="text-ink-3">{formatDuration(t, lesson.durationSeconds)}</span>
                  ) : null}
                </li>
              ))}
          </ol>
        ),
      }))}
    />
  );
}

/** Itens do pacote; item privado aparece só pelo título, sem link (contrato, `visible`). */
function BundleItems({
  bundle,
  formatPrice,
}: {
  bundle: CatalogBundle;
  formatPrice: PriceFormatter;
}) {
  const { t } = useTranslation();
  if (bundle.items.length === 0) {
    return <p className="m-0 text-sm text-ink-3">{t('product.itemsEmpty')}</p>;
  }
  const saved = bundle.itemsPriceCents - (bundle.priceCents ?? 0);
  const total = formatPrice(bundle.itemsPriceCents);
  const savedText = formatPrice(saved);
  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col gap-3 p-0 text-sm text-ink">
        {bundle.items.map((item) => (
          <li key={`${item.type}-${item.id}`} className="flex flex-col gap-1">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 break-words font-medium">
                {item.visible ? (
                  <TextLink href={productPath(item.type, item.slug)}>{item.title}</TextLink>
                ) : (
                  item.title
                )}
              </span>
              <AdminTag>{t(`product.types.${item.type}`)}</AdminTag>
              {item.accessMode === 'paid' && item.priceCents ? (
                <span className="text-ink-3">{formatPrice(item.priceCents)}</span>
              ) : null}
            </span>
            {item.summary ? <span className="text-ink-2">{item.summary}</span> : null}
          </li>
        ))}
      </ul>
      {bundle.accessMode === 'paid' && saved > 0 && total && savedText ? (
        <p className="m-0 text-sm text-ink-2">
          {t('product.savings', { total, saved: savedText })}
        </p>
      ) : null}
    </div>
  );
}

interface AccessPanelProps {
  product: CatalogProduct;
  access: AccessState | null;
  formatPrice: PriceFormatter;
}

/**
 * Preço e acesso. Produto `paid` sem direito mostra o preço, o bloqueio e a compra (spec 011,
 * Fase 3: a cesta entra no lugar do antigo aviso "liberado pela escola"); o gratuito leva ao
 * login ou ao conteúdo; quem já tem o acesso vê o caminho até ele.
 */
function AccessPanel({ product, access, formatPrice }: AccessPanelProps) {
  const { t } = useTranslation();
  const { session } = useSession();
  const { pathname, search } = useLocation();
  const formatDate = useDateFormatter();

  const free = isFree(product);
  const granted = access?.allowed === true;
  const locked = product.accessMode === 'paid' && !granted;
  const price = free
    ? t('product.free')
    : product.priceCents === null
      ? undefined
      : formatPrice(product.priceCents);
  const contentHref =
    product.type === 'course'
      ? `/meus-cursos/${encodeURIComponent(product.slug)}`
      : product.type === 'ebook'
        ? '/meus-ebooks'
        : null;
  const contentLabel =
    product.type === 'course' ? t('product.access.openCourse') : t('product.access.openEbook');

  let action: ReactNode = null;
  if (!locked && contentHref) {
    action = session ? (
      <AdminButton href={contentHref} variant="primary">
        {contentLabel}
      </AdminButton>
    ) : (
      <AdminButton
        href={withReturnTo(LOGIN_PATH, safeReturnTo(pathname + search))}
        variant="primary"
      >
        {t('product.access.signIn')}
      </AdminButton>
    );
  }

  return (
    <AdminCard pad as="section" aria-label={t('product.access.title')}>
      <div className="flex flex-col gap-3">
        {price ? <p className="m-0 text-2xl font-semibold text-ink">{price}</p> : null}
        {granted ? (
          <p className="m-0 text-sm font-medium text-ink">
            {access?.expiresAt
              ? t('product.access.grantedUntil', { date: formatDate(access.expiresAt) })
              : t('product.access.granted')}
          </p>
        ) : locked ? (
          <>
            <p className="m-0 flex items-center gap-2 text-sm font-medium text-ink">
              <Lock size={14} aria-hidden="true" />
              {t('product.locked')}
            </p>
            <p className="m-0 text-sm text-ink-2">{t('product.lockedHint')}</p>
            <p className="m-0 text-sm text-ink-3">{accessValidity(t, product.accessDays)}</p>
            <span className="flex">
              <AddToCart productType={product.type} productId={product.id} title={product.title} />
            </span>
          </>
        ) : (
          <p className="m-0 text-sm text-ink-2">{t('product.access.openText')}</p>
        )}
        {action ? <span className="flex">{action}</span> : null}
      </div>
    </AdminCard>
  );
}

function ProductView({ product, access }: { product: CatalogProduct; access: AccessState | null }) {
  const { t } = useTranslation();
  const formatPrice = usePriceFormatter();
  const formatDate = useDateFormatter();

  const details: { label: string; value: ReactNode }[] = [
    { label: t('product.details.type'), value: t(`product.types.${product.type}`) },
  ];
  if (product.type === 'course') {
    if (product.level) {
      details.push({
        label: t('product.details.level'),
        value: t(`product.levels.${product.level}`),
      });
    }
    details.push({
      label: t('product.details.content'),
      value: productTotals(t, product).join(' · '),
    });
    if (product.instructorName) {
      details.push({ label: t('product.details.instructor'), value: product.instructorName });
    }
  } else if (product.type === 'bundle') {
    details.push({
      label: t('product.details.content'),
      value: t('product.totals.items', { count: product.items.length }),
    });
  } else {
    if (product.authorName) {
      details.push({ label: t('product.details.author'), value: product.authorName });
    }
    if (product.pages) {
      details.push({
        label: t('product.details.content'),
        value: t('product.totals.pages', { count: product.pages }),
      });
    }
  }
  details.push({ label: t('product.details.updatedAt'), value: formatDate(product.updatedAt) });

  return (
    <article className="flex flex-col gap-6">
      <PageTitle subtitle={product.summary ?? undefined}>{product.title}</PageTitle>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {product.cover ? (
            // a capa é a maior imagem da página: carrega já, com prioridade (LCP)
            <img
              src={product.cover.largeUrl}
              alt=""
              width={1280}
              height={720}
              fetchPriority="high"
              decoding="async"
              className="block aspect-video h-auto w-full rounded-lg bg-hover object-cover"
            />
          ) : null}

          {product.description ? (
            <AdminSection title={t('product.about')}>
              <AdminCard pad>
                <Markdown newTabLabel={t('common.newTab')}>{product.description}</Markdown>
              </AdminCard>
            </AdminSection>
          ) : null}

          {product.type === 'course' ? (
            <AdminSection title={t('product.program')}>
              <Program course={product} />
            </AdminSection>
          ) : null}

          {product.type === 'bundle' ? (
            <AdminSection title={t('product.items')}>
              <AdminCard pad>
                <BundleItems bundle={product} formatPrice={formatPrice} />
              </AdminCard>
            </AdminSection>
          ) : null}
        </div>

        <aside className="flex flex-col gap-4" aria-label={t('product.details.title')}>
          <AccessPanel product={product} access={access} formatPrice={formatPrice} />
          <AdminCard pad>
            <AdminDetails wrap items={details} />
          </AdminCard>
        </aside>
      </div>
    </article>
  );
}

/** `/cursos/:slug`, `/pacotes/:slug` e `/ebooks/:slug`: página pública do produto (spec 009). */
export function ProductPage({ type }: { type: ProductType }) {
  const { t } = useTranslation();
  const { slug = '' } = useParams();
  const query = useCatalogProduct(type, slug);
  const product = query.data ?? null;
  const access = useProductAccess(type, slug, product !== null);

  const typeName = t(`product.types.${type}`);
  usePageMeta(
    product ? product.title : query.isSuccess ? t('product.notFoundTitle') : typeName,
    product
      ? product.summary?.trim() ||
          t(`product.descriptionFallback.${type}`, { title: product.title })
      : t('product.notFoundText'),
    { image: product?.cover?.largeUrl },
  );

  let body: ReactNode;
  if (query.isPending) {
    body = (
      <AdminCard pad aria-busy="true">
        <LoadingState label={t('product.loading')} />
      </AdminCard>
    );
  } else if (query.isError) {
    const failure = describeError(t, query.error);
    body = (
      <AdminCard pad>
        <ErrorState
          title={t('product.errorTitle')}
          text={failure.message}
          detail={failure.detail}
          retryLabel={t('common.retry')}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      </AdminCard>
    );
  } else if (!product) {
    body = (
      <>
        <PageTitle align="center">{t('product.notFoundTitle')}</PageTitle>
        <AdminEmpty icon={<PackageSearch aria-hidden="true" />} text={t('product.notFoundText')}>
          <span className="mt-3 flex">
            <AdminButton href={HOME_PATH}>{t('common.backHome')}</AdminButton>
          </span>
        </AdminEmpty>
      </>
    );
  } else {
    body = <ProductView product={product} access={access.data ?? null} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6">{body}</div>
  );
}
