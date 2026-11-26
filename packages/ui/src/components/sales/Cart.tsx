import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import '../flow/flow.css';
import './sales.css';
import type { Loose } from '../../index';
import { AdminButton as RawAdminButton } from '../admin/AdminControls.jsx';
import { AdminEmpty as RawAdminEmpty } from '../admin/AdminData.jsx';
import { cx } from '../feedback/layer';
import { ErrorState, LoadingState } from '../flow/flow';
import { type LinkComponent, useLinkComponent } from '../link/link';
import type { MoneyOptions } from './money';
import { PriceTag } from './PriceTag';

/*
 * Cesta de compras (spec 011). Composta, sem HTTP e sem regra de negócio: itens, avisos
 * (já possui por assinatura, preço alterado etc.), o que cada item libera em cascata, cupom,
 * totais e a ação de finalizar vêm do site. Estados vazio/carregando/erro ficam no mesmo
 * componente, com ação sugerida no vazio (spec 006, RF-09). Todo texto vem por propriedade.
 */

const AdminButton = RawAdminButton as Loose<typeof RawAdminButton>;
const AdminEmpty = RawAdminEmpty as Loose<typeof RawAdminEmpty>;

export interface CartItem extends MoneyOptions {
  id: string;
  title: string;
  /** Link para a página do produto. */
  href?: string | undefined;
  linkComponent?: LinkComponent | undefined;
  /** Tipo já traduzido (ex.: "Curso", "Pacote", "Ebook"). */
  kindLabel?: ReactNode;
  /** Preço unitário atual, em centavos. */
  priceCents: number;
  /** Desconto do cupom rateado neste item, em centavos. */
  discountCents?: number | null | undefined;
  coverUrl?: string | null | undefined;
  coverAlt?: string | undefined;
  /** O que a compra libera em cascata (cursos do pacote, ebooks vinculados). */
  includes?: readonly ReactNode[] | undefined;
  /** Rótulo da lista de itens liberados (ex.: "Inclui"). */
  includesLabel?: string | undefined;
  /** Avisos do item (ex.: "Você já tem este curso pela assinatura"; "O preço mudou"). */
  notices?: readonly ReactNode[] | undefined;
}

export interface CartLabels {
  /** Nome da região da cesta (ex.: "Sua cesta"). */
  region: string;
  /** Nome do botão de remover (ex.: (item) => `Remover ${item.title}`). */
  remove: (item: CartItem) => string;
  /** Título do estado vazio (ex.: "Sua cesta está vazia"). */
  emptyTitle: ReactNode;
  emptyText?: ReactNode;
  /** Texto de carregamento (ex.: "Carregando a cesta…"). */
  loading: string;
  errorTitle?: ReactNode;
  errorText?: ReactNode;
  retry?: string;
}

export interface CartSummaryProps extends MoneyOptions {
  /** Subtotal, desconto e total já calculados (componente OrderTotals ou equivalente). */
  children: ReactNode;
  /** Área do cupom (campo e botão), fornecida pelo site. */
  coupon?: ReactNode;
  /** Botão "Finalizar compra" e avisos do fechamento. */
  action?: ReactNode;
  className?: string | undefined;
}

/** Resumo da cesta: cupom, totais e ação de finalizar. */
export function CartSummary({ children, coupon, action, className }: CartSummaryProps) {
  return (
    <aside className={cx('minui-cart__summary', className)}>
      {coupon ? <div className="minui-cart__coupon">{coupon}</div> : null}
      {children}
      {action ? <div className="minui-cart__action">{action}</div> : null}
    </aside>
  );
}

export interface CartProps extends MoneyOptions {
  items: readonly CartItem[];
  labels: CartLabels;
  onRemove?: ((id: string) => void) | undefined;
  /** Item sendo removido: o botão dele fica desabilitado. */
  removingId?: string | null | undefined;
  loading?: boolean;
  error?: boolean;
  onRetry?: (() => void) | undefined;
  /** Ação sugerida no estado vazio (ex.: botão "Ver cursos"). Obrigatória quando vazio. */
  emptyAction?: ReactNode;
  /** Resumo (CartSummary). Sem ele, a cesta ocupa a largura toda. */
  summary?: ReactNode;
  className?: string | undefined;
}

/** Cesta: lista de itens com cascata e avisos, e o resumo ao lado (embaixo no estreito). */
export function Cart({
  items,
  labels,
  onRemove,
  removingId,
  loading = false,
  error = false,
  onRetry,
  emptyAction,
  summary,
  currency,
  locale,
  className,
}: CartProps) {
  return (
    <section aria-label={labels.region} className={cx('minui-cart', className)}>
      {loading ? (
        <LoadingState label={labels.loading} />
      ) : error ? (
        <ErrorState
          title={labels.errorTitle}
          text={labels.errorText}
          {...(onRetry ? { onRetry, retryLabel: labels.retry } : {})}
        />
      ) : items.length === 0 ? (
        <AdminEmpty icon={null} title={labels.emptyTitle} text={labels.emptyText}>
          {emptyAction}
        </AdminEmpty>
      ) : (
        <div className="minui-cart__layout" data-with-summary={summary ? 'true' : undefined}>
          <ul className="minui-cart__items">
            {items.map((item) => (
              <CartRow
                key={item.id}
                item={item}
                currency={item.currency ?? currency}
                locale={item.locale ?? locale}
                removeLabel={labels.remove(item)}
                onRemove={onRemove}
                removing={removingId === item.id}
              />
            ))}
          </ul>
          {summary}
        </div>
      )}
    </section>
  );
}

interface CartRowProps extends MoneyOptions {
  item: CartItem;
  removeLabel: string;
  onRemove?: ((id: string) => void) | undefined;
  removing: boolean;
}

function CartRow({ item, currency, locale, removeLabel, onRemove, removing }: CartRowProps) {
  const Link = useLinkComponent(item.linkComponent, { href: item.href });
  const discount = item.discountCents ?? 0;
  return (
    <li className="minui-cart__item">
      {item.coverUrl ? (
        <img className="minui-cart__cover" src={item.coverUrl} alt={item.coverAlt ?? ''} />
      ) : null}
      <div className="minui-cart__body">
        <div className="minui-cart__head">
          <div className="minui-cart__title">
            {item.kindLabel ? <span className="minui-cart__kind">{item.kindLabel}</span> : null}
            {item.href ? (
              <Link href={item.href} className="minui-cart__link">
                {item.title}
              </Link>
            ) : (
              <span className="minui-cart__name">{item.title}</span>
            )}
          </div>
          <PriceTag
            cents={item.priceCents - discount}
            originalCents={discount > 0 ? item.priceCents : null}
            currency={currency}
            locale={locale}
          />
          {onRemove ? (
            <AdminButton
              variant="ghost"
              size="sm"
              aria-label={removeLabel}
              icon={<Trash2 aria-hidden="true" />}
              disabled={removing}
              onClick={() => onRemove(item.id)}
            />
          ) : null}
        </div>
        {item.includes?.length ? (
          <div className="minui-cart__includes">
            {item.includesLabel ? (
              <span className="minui-cart__includes-label">{item.includesLabel}</span>
            ) : null}
            <ul>
              {item.includes.map((entry, index) => (
                // o site passa os vínculos na ordem em que os mostra
                // biome-ignore lint/suspicious/noArrayIndexKey: lista estática
                <li key={index}>{entry}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {item.notices?.length ? (
          <div className="minui-cart__notices" role="status">
            <ul>
              {item.notices.map((notice, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: lista estática
                <li key={index}>{notice}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </li>
  );
}
