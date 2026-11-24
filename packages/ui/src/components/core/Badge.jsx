import '../../styles/tokens.css';
import './Txt.css';
import './Badge.css';
import { fontOf, textWidth, useFontEpoch } from '../../lib/measure';
import { cx } from '../../lib/util';

/**
 * Selo vermelho de contagem (17px de altura, "99+" acima de 99).
 * `cx`/`cy` posicionam pelo CENTRO, como no canvas.
 */
export function Badge({ count = 1, cx: centerX, cy: centerY, ring, className, style }) {
  useFontEpoch();
  const label = count > 99 ? '99+' : String(count);
  const width = Math.max(17, textWidth(label, fontOf(650, 10.5)) + 9);
  const top = (centerY ?? 8.5) - 8.5;
  const pos =
    centerX != null || centerY != null
      ? { position: 'absolute', left: (centerX ?? 0) - width / 2, top, width }
      : null;
  // O texto mora num bloco de topo inteiro; a fração do topo vai para a escora.
  const frac = pos ? top - Math.floor(top) : 0;
  return (
    <span
      className={cx('minui-badge', className)}
      style={{ ...pos, ...(ring ? { '--minui-badge-ring': ring } : null), ...style }}
    >
      <span
        className="minui-badge__text minui-baseline"
        style={{ top: -frac, '--minui-baseline': `${12.156 + frac}px` }}
      >
        {label}
      </span>
    </span>
  );
}

/**
 * Bolinha de estado. `ring` desenha um contorno de 2px centrado na borda
 * (é assim que o canvas faz o ponto verde de "online").
 */
export function Dot({
  color = 'var(--minui-blue)',
  size = 8,
  ring,
  cx: centerX,
  cy: centerY,
  className,
  style,
}) {
  const pos =
    centerX != null || centerY != null
      ? { position: 'absolute', left: (centerX ?? 0) - size / 2, top: (centerY ?? 0) - size / 2 }
      : null;
  return (
    <span
      className={cx('minui-dot', ring && 'minui-dot--ring', className)}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        '--minui-dot': color,
        ...(ring ? { '--minui-dot-ring': ring } : null),
        ...pos,
        ...style,
      }}
    />
  );
}
