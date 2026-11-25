import type { ReactNode } from 'react';
import '../../styles/tokens.css';
import './catalog.css';

/*
 * Barra de progresso (spec 014: progresso do curso). `role="progressbar"` com
 * `aria-valuenow` de 0 a 100. A largura do preenchimento vai pelo CSSOM (o React grava em
 * element.style), permitido pela CSP style-src 'self'.
 */

export interface ProgressBarProps {
  /** Porcentagem de 0 a 100; valores fora disso são limitados. */
  value: number;
  /** Nome da barra para o leitor de tela (ex.: "Progresso do curso"). */
  label: string;
  /** Valor por extenso para o leitor de tela (ex.: "3 de 10 aulas concluídas"). */
  valueText?: string | undefined;
  /** Texto visível ao lado da barra (ex.: "30%"). */
  caption?: ReactNode;
  size?: 'sm' | 'md';
  className?: string | undefined;
}

/** Limita a porcentagem a 0–100 e arredonda; valor inválido vira 0. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)));
}

/** Barra de progresso acessível. */
export function ProgressBar({
  value,
  label,
  valueText,
  caption,
  size = 'md',
  className,
}: ProgressBarProps) {
  const percent = clampPercent(value);
  return (
    <div className={['minui-progress', className].filter(Boolean).join(' ')} data-size={size}>
      <div
        className="minui-progress__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={valueText}
      >
        <div className="minui-progress__fill" style={{ width: `${percent}%` }} />
      </div>
      {caption ? <span className="minui-progress__caption">{caption}</span> : null}
    </div>
  );
}
