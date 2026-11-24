import '../../styles/tokens.css';
import './Resolved.css';
import { cx } from '../../lib/util';
import { Txt } from './Txt';

/** Texto padrão da faixa verde conforme o tipo de cartão. */
export function resolvedLabel(kind, version = '2.3.1') {
  return (
    { issue: `Closed · fixed in ${version}`, tweet: `Fixed in ${version}`, review: 'Merged' }[
      kind
    ] ?? `Fixed in ${version}`
  );
}

/**
 * Sobreposição de "resolvido": aro verde no cartão e faixa verde com ✓
 * cobrindo o campo de resposta. `tone="issue"` usa o círculo roxo do GitHub.
 * Deve ser o último filho de um <Surface>.
 */
export function Resolved({ text = 'Fixed', tone = 'default', className }) {
  return (
    <div className={cx('minui-resolved', className)}>
      <svg className="minui-resolved__ring" aria-hidden="true">
        <rect x="0.5" y="0.5" rx="14" />
      </svg>
      <div className="minui-resolved__bar">
        <svg
          className="minui-resolved__check"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="8" fill={tone === 'issue' ? '#8957e5' : '#2fb66b'} />
          <path
            d="M4.5 8 7 10.6 11.8 5.2"
            fill="none"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <Txt x={34} mid={14.5} size={12} weight={600} color="var(--minui-mint-text)">
          {text}
        </Txt>
      </div>
    </div>
  );
}
