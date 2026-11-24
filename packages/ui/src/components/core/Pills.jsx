import '../../styles/tokens.css';
import './Txt.css';
import './Pills.css';
import { cx, place } from '../../lib/util';

/** Matiz de cada etiqueta de issue. */
export const LABEL_HUES = { bug: 4, linux: 45, enhancement: 200, question: 280 };

/** Etiqueta colorida de issue ("bug", "linux", "enhancement", "question"…). */
export function LabelPill({ label, hue, x, y, className, style }) {
  const h = hue ?? LABEL_HUES[label] ?? 0;
  return (
    <span
      className={cx('minui-label', 'minui-baseline', className)}
      style={{ '--minui-hue': h, ...place(x, y), ...style }}
    >
      {label}
    </span>
  );
}

/** Botão de ação pequeno (Decline / Accept do convite de calendário). */
export function ActionButton({ tone = 'neutral', x, y, className, style, children }) {
  return (
    <span
      className={cx('minui-action', `minui-action--${tone}`, 'minui-baseline', className)}
      style={{ ...place(x, y), ...style }}
    >
      {children}
    </span>
  );
}

/** Cinco quadradinhos de proporção +/− de um pull request. */
export function DiffBlocks({ added = 1, removed = 3, total = 5 }) {
  return Array.from({ length: total }, (_, i) => (
    <span
      // biome-ignore lint/suspicious/noArrayIndexKey: lista posicional, sem identidade própria
      key={i}
      className="minui-diffblock"
      style={{
        background:
          i < added
            ? 'var(--minui-green)'
            : i < added + removed
              ? 'var(--minui-red)'
              : 'var(--minui-diff-rest)',
        marginLeft: i ? 2 : 8,
      }}
    />
  ));
}
