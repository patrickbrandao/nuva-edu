import { cx, place } from '../../lib/util';
import { ICON_PATHS } from './iconPaths';

/**
 * Ícone vetorial solto (X, Slack, GitHub, envelope, balão).
 * No canvas ele é um Path2D escalado de 24 unidades para `size` pixels.
 * `color` aceita qualquer cor CSS, inclusive variáveis (var(--minui-icon)).
 */
export function Glyph({ name, size = 16, color = '#fff', x, y, className, style, title }) {
  const icon = ICON_PATHS[name];
  if (!icon) return null;
  return (
    <svg
      className={cx('minui-glyph', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ display: 'block', overflow: 'visible', flex: 'none', ...place(x, y), ...style }}
    >
      {icon.fill ? (
        <path d={icon.d} style={{ fill: color }} />
      ) : (
        <path
          d={icon.d}
          fill="none"
          style={{ stroke: color }}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
