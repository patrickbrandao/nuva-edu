import { ExternalLink, RotateCw, TriangleAlert } from 'lucide-react';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import './flow.css';
import type { Loose } from '../../index';
import { AdminButton as RawAdminButton } from '../admin/AdminControls.jsx';
import { AdminEmpty as RawAdminEmpty } from '../admin/AdminData.jsx';
import { type LinkComponent, useLinkComponent } from '../link/link';

/*
 * Primitivos de fluxo: título de página, link de texto e os estados "carregando" e
 * "erro" de uma área da tela. Usam os tokens --adm-*: ficam dentro de um AdminScope
 * (ou de uma das cascas). Nenhum texto é fixo: os sites passam os das suas traduções.
 */

const AdminButton = RawAdminButton as Loose<typeof RawAdminButton>;
const AdminEmpty = RawAdminEmpty as Loose<typeof RawAdminEmpty>;

const cx = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter(Boolean).join(' ');

export interface PageTitleProps {
  /** O título da página. */
  children: ReactNode;
  /** Frase de apoio, abaixo do título. */
  subtitle?: ReactNode;
  /** Nível do cabeçalho; uma página tem um só `h1`. */
  as?: 'h1' | 'h2';
  align?: 'start' | 'center';
  className?: string | undefined;
}

/** Título de página fora do painel (no painel use AdminPageHeader). */
export function PageTitle({
  children,
  subtitle,
  as: Tag = 'h1',
  align = 'start',
  className,
}: PageTitleProps) {
  return (
    <header className={cx('minui-page-title', className)} data-align={align}>
      <Tag>{children}</Tag>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  );
}

export interface TextLinkProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'> {
  href: string;
  /** Abre em outra aba, com `rel="noreferrer"` e o ícone de link externo. */
  external?: boolean;
  /** Texto lido depois do link externo (ex.: "abre em nova aba"). */
  newTabLabel?: string | undefined;
  /** Sem sublinhado até passar o ponteiro. */
  quiet?: boolean;
  linkComponent?: LinkComponent | undefined;
}

/** Link de texto. Endereço interno passa pelo componente de link do site. */
export function TextLink({
  href,
  external = false,
  newTabLabel,
  quiet = false,
  linkComponent,
  className,
  children,
  ...rest
}: TextLinkProps) {
  const Link = useLinkComponent(linkComponent, { href, target: external ? '_blank' : undefined });
  const classes = cx('minui-text-link', quiet && 'minui-text-link--quiet', className);
  if (external) {
    return (
      <a {...rest} href={href} target="_blank" rel="noreferrer" className={classes}>
        {children}
        <ExternalLink size={12} aria-hidden="true" />
        {newTabLabel ? <span className="minui-sr-only"> {newTabLabel}</span> : null}
      </a>
    );
  }
  return (
    <Link {...rest} href={href} className={classes}>
      {children}
    </Link>
  );
}

export interface LoadingStateProps {
  /** O que está carregando (ex.: "Carregando os cursos…"). Sempre anunciado. */
  label: string;
  /** Em linha, sem o respiro de uma área vazia. */
  inline?: boolean;
  className?: string | undefined;
}

/** Estado "carregando" de uma área: indicador e texto, anunciado como `status`. */
export function LoadingState({ label, inline = false, className }: LoadingStateProps) {
  return (
    <div
      role="status"
      className={cx(
        'minui-state',
        'minui-state--loading',
        inline && 'minui-state--inline',
        className,
      )}
    >
      <span className="minui-state__spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

interface ErrorStateBase {
  /** O que deu errado, em poucas palavras. */
  title?: ReactNode;
  /** O que a pessoa pode fazer. */
  text?: ReactNode;
  /** Informação para o suporte (ex.: o identificador da requisição). */
  detail?: ReactNode;
  /** Ícone no lugar do triângulo de alerta. */
  icon?: ReactNode;
  /** Outras ações, depois do botão. */
  children?: ReactNode;
  className?: string | undefined;
}

interface ErrorStateWithRetry extends ErrorStateBase {
  /** Chamado pelo botão "tentar de novo". */
  onRetry: () => void;
  /** Texto do botão. */
  retryLabel: string;
  /** Nova tentativa em andamento: o botão fica desabilitado. */
  retrying?: boolean;
}

interface ErrorStateWithoutRetry extends ErrorStateBase {
  onRetry?: undefined;
  retryLabel?: undefined;
  retrying?: undefined;
}

export type ErrorStateProps = ErrorStateWithRetry | ErrorStateWithoutRetry;

/** Estado de erro de uma área, anunciado como `alert`, com o botão "tentar de novo". */
export function ErrorState({
  title,
  text,
  detail,
  icon,
  onRetry,
  retryLabel,
  retrying = false,
  children,
  className,
}: ErrorStateProps) {
  return (
    <div role="alert" className={cx('minui-state', 'minui-state--error', className)}>
      <AdminEmpty icon={icon ?? <TriangleAlert aria-hidden="true" />} title={title} text={text}>
        {detail ? <span className="minui-state__detail">{detail}</span> : null}
        {onRetry || children ? (
          <span className="minui-state__actions">
            {onRetry ? (
              <AdminButton
                icon={<RotateCw aria-hidden="true" />}
                disabled={retrying}
                onClick={onRetry}
              >
                {retryLabel}
              </AdminButton>
            ) : null}
            {children}
          </span>
        ) : null}
      </AdminEmpty>
    </div>
  );
}
