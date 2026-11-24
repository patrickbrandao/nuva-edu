import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import './feedback.css';
import type { Loose } from '../../index';
import { AdminButton as RawAdminButton } from '../admin/AdminControls.jsx';
import { cx } from './layer';

/*
 * Aviso que fica na tela (ex.: o aviso de termos do admin, spec 030), em linha ou como faixa
 * presa ao topo da área (`banner`). Fica dentro de um AdminScope ou de uma casca (tokens
 * --adm-*). O papel acessível segue o tom: erro é `alert` (anunciado na hora); os outros,
 * `status`. Aviso que já está na página desde o carregamento pode usar `role={null}`.
 */

const AdminButton = RawAdminButton as Loose<typeof RawAdminButton>;

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

const ICONS: Record<AlertTone, ReactNode> = {
  info: <Info aria-hidden="true" />,
  success: <CircleCheck aria-hidden="true" />,
  warning: <TriangleAlert aria-hidden="true" />,
  error: <CircleAlert aria-hidden="true" />,
};

interface AlertBase {
  tone?: AlertTone;
  title?: ReactNode;
  children?: ReactNode;
  /** Ações (botões ou links), à direita no largo e embaixo no estreito. */
  actions?: ReactNode;
  /** `banner`: faixa de largura total, presa ao topo da área que rola. */
  layout?: 'inline' | 'banner';
  /** Papel acessível; padrão: `alert` para erro, `status` para o resto; `null` tira o papel. */
  role?: 'alert' | 'status' | null;
  /** Ícone no lugar do padrão do tom; `null` tira o ícone. */
  icon?: ReactNode;
  className?: string | undefined;
}

interface AlertDismissible extends AlertBase {
  onDismiss: () => void;
  /** Nome acessível do "x". */
  dismissLabel: string;
}

interface AlertFixed extends AlertBase {
  onDismiss?: undefined;
  dismissLabel?: undefined;
}

export type AlertProps = AlertDismissible | AlertFixed;

/** Aviso em linha ou em faixa. */
export function Alert({
  tone = 'info',
  title,
  children,
  actions,
  layout = 'inline',
  role,
  icon,
  onDismiss,
  dismissLabel,
  className,
}: AlertProps) {
  const resolvedRole = role === undefined ? (tone === 'error' ? 'alert' : 'status') : role;
  const shownIcon = icon === undefined ? ICONS[tone] : icon;
  return (
    <div
      role={resolvedRole ?? undefined}
      data-tone={tone}
      data-layout={layout}
      className={cx('minui-alert', className)}
    >
      {shownIcon ? <span className="minui-alert__icon">{shownIcon}</span> : null}
      <div className="minui-alert__text">
        {title ? <strong className="minui-alert__title">{title}</strong> : null}
        {children ? <div className="minui-alert__body">{children}</div> : null}
      </div>
      {actions ? <div className="minui-alert__actions">{actions}</div> : null}
      {onDismiss ? (
        <AdminButton
          variant="ghost"
          size="sm"
          aria-label={dismissLabel}
          icon={<X aria-hidden="true" />}
          onClick={onDismiss}
        />
      ) : null}
    </div>
  );
}
