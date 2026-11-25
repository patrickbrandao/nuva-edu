import { ImageOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { Children, isValidElement } from 'react';
import '../../styles/tokens.css';
import './catalog.css';
import { type LinkComponent, useLinkComponent } from '../link/link';
import { ProgressBar } from './ProgressBar';

/*
 * Cartão de produto (spec 009, vitrine; spec 014, estante): capa 16:9, título, resumo, nível,
 * totais, preço ou "Gratuito", selo, validade, progresso opcional e uma ação. Modos grade e
 * lista (`layout`). O título é o link do cartão; a área clicável cobre o cartão inteiro por
 * um pseudo-elemento, e a ação (`action`) fica por cima dela, clicável à parte.
 * Nenhum texto é fixo: preço, "Gratuito", nível e totais chegam já traduzidos.
 */

export type ProductCardLayout = 'grid' | 'list';

/** Proporção 16:9 declarada na `<img>` da capa, para reservar o espaço antes do carregamento. */
const COVER_WIDTH = 640;
const COVER_HEIGHT = 360;

export interface ProductCardProgress {
  /** Porcentagem de 0 a 100. */
  value: number;
  /** Nome da barra para o leitor de tela (ex.: "Progresso do curso"). */
  label: string;
  /** Valor por extenso (ex.: "3 de 10 aulas concluídas"). */
  valueText?: string | undefined;
  /** Texto visível ao lado da barra (ex.: "3 de 10 aulas"). */
  caption?: ReactNode;
}

export interface ProductCardProps {
  title: string;
  /** Destino do cartão (página do produto ou do curso). */
  href: string;
  /** Endereço da capa (16:9). Sem capa, um fundo neutro com ícone. */
  coverUrl?: string | null | undefined;
  /** Texto alternativo da capa; vazio (padrão) quando a capa só decora. */
  coverAlt?: string | undefined;
  /**
   * Capa acima da dobra (candidata a LCP): pede a imagem já, com prioridade alta, em vez de
   * `loading="lazy"`. Use só nos primeiros cartões da página.
   */
  coverPriority?: boolean | undefined;
  summary?: ReactNode;
  /** Nível já traduzido (ex.: "Iniciante"). */
  level?: ReactNode;
  /** Totais já formatados (ex.: ["4 módulos", "12 aulas", "3 h 20 min"]). */
  totals?: readonly ReactNode[] | undefined;
  /** Preço já formatado (ex.: "R$ 97,00"). Ignorado quando `free`. */
  price?: ReactNode;
  /** Produto gratuito: mostra `freeLabel` no lugar do preço. */
  free?: boolean;
  /** Texto do produto gratuito (ex.: "Gratuito"). */
  freeLabel?: string | undefined;
  /** Selo sobre a capa (ex.: "Pacote", "Acesso vencido"). */
  badge?: ReactNode;
  badgeTone?: 'neutral' | 'accent' | 'warning';
  /** Linha extra (ex.: "Acesso até 12/03/2027"). */
  meta?: ReactNode;
  progress?: ProductCardProgress | undefined;
  /** Ação do cartão (ex.: botão "Continuar"), fora do link do título. */
  action?: ReactNode;
  layout?: ProductCardLayout;
  /** Nível do cabeçalho do título, conforme a página. */
  headingLevel?: 2 | 3 | 4;
  linkComponent?: LinkComponent | undefined;
  className?: string | undefined;
}

/** Cartão de curso, pacote ou ebook, em grade ou em lista. */
export function ProductCard({
  title,
  href,
  coverUrl,
  coverAlt = '',
  coverPriority = false,
  summary,
  level,
  totals,
  price,
  free = false,
  freeLabel,
  badge,
  badgeTone = 'neutral',
  meta,
  progress,
  action,
  layout = 'grid',
  headingLevel = 3,
  linkComponent,
  className,
}: ProductCardProps) {
  const Link = useLinkComponent(linkComponent, { href });
  const Heading = `h${headingLevel}` as const;
  const priceText = free ? freeLabel : price;
  const facts = [level, ...(totals ?? [])].filter(
    (fact) => fact !== undefined && fact !== null && fact !== '',
  );
  return (
    <article
      className={['minui-product-card', className].filter(Boolean).join(' ')}
      data-layout={layout}
    >
      <div className="minui-product-card__cover">
        {coverUrl ? (
          // largura e altura só dão a proporção 16:9 ao navegador; o tamanho vem do CSS
          <img
            src={coverUrl}
            alt={coverAlt}
            width={COVER_WIDTH}
            height={COVER_HEIGHT}
            loading={coverPriority ? 'eager' : 'lazy'}
            fetchPriority={coverPriority ? 'high' : undefined}
            decoding="async"
          />
        ) : (
          <span className="minui-product-card__placeholder">
            <ImageOff size={22} aria-hidden="true" />
          </span>
        )}
        {badge ? (
          <span className="minui-product-card__badge" data-tone={badgeTone}>
            {badge}
          </span>
        ) : null}
      </div>
      <div className="minui-product-card__body">
        <Heading className="minui-product-card__title">
          <Link href={href} className="minui-product-card__link">
            {title}
          </Link>
        </Heading>
        {summary ? <p className="minui-product-card__summary">{summary}</p> : null}
        {facts.length > 0 ? (
          <ul className="minui-product-card__facts">
            {facts.map((fact, index) => (
              // os fatos não têm identificador; a ordem é fixa a cada desenho
              // biome-ignore lint/suspicious/noArrayIndexKey: lista estática
              <li key={index}>{fact}</li>
            ))}
          </ul>
        ) : null}
        {meta ? <p className="minui-product-card__meta">{meta}</p> : null}
        {progress ? (
          <ProgressBar
            size="sm"
            value={progress.value}
            label={progress.label}
            valueText={progress.valueText}
            caption={progress.caption}
          />
        ) : null}
        {priceText || action ? (
          <div className="minui-product-card__footer">
            {priceText ? (
              <span className="minui-product-card__price" data-free={free ? 'true' : undefined}>
                {priceText}
              </span>
            ) : null}
            {action ? <span className="minui-product-card__action">{action}</span> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export interface ProductCardListProps {
  layout?: ProductCardLayout;
  /** Nome da lista para o leitor de tela (ex.: "Cursos"). */
  'aria-label'?: string | undefined;
  /** Um `ProductCard` por item. */
  children: ReactNode;
  className?: string | undefined;
}

/** Lista de cartões: grade responsiva ou uma coluna, conforme `layout`. */
export function ProductCardList({
  layout = 'grid',
  'aria-label': ariaLabel,
  children,
  className,
}: ProductCardListProps) {
  return (
    <ul
      className={['minui-product-list', className].filter(Boolean).join(' ')}
      data-layout={layout}
      aria-label={ariaLabel}
    >
      {Children.toArray(children).map((child) => (
        <li key={isValidElement(child) ? child.key : String(child)}>{child}</li>
      ))}
    </ul>
  );
}
