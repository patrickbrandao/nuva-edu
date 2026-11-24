import '../../styles/tokens.css';
import './snippets.css';
import { cx } from '../../lib/util';

/** A seta → desenhada em SVG (herda a cor do texto). */
export function ArrowIcon({ size = 16, direction = 'right' }) {
  const turn = { right: 0, down: 90, left: 180, up: 270 }[direction] ?? 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ transform: `rotate(${turn}deg)` }}
    >
      <path
        d="M2.5 8h11M9 3.5 13.5 8 9 12.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Botão redondo com seta. Com `href` vira link; sem ele, um <button>.
 * No hover a seta dá um passo na direção para onde aponta.
 */
export function ArrowButton({
  href,
  onClick,
  label = 'Abrir',
  size = 30,
  direction = 'right',
  className,
  style,
}) {
  const props = {
    className: cx('minui-arrowbtn', `minui-arrowbtn--${direction}`, className),
    style: { '--minui-btn': `${size}px`, ...style },
    'aria-label': label,
    title: label,
  };
  const icon = <ArrowIcon size={Math.round(size * 0.53)} direction={direction} />;
  return href ? (
    <a href={href} onClick={onClick} {...props}>
      {icon}
    </a>
  ) : (
    <button type="button" onClick={onClick} {...props}>
      {icon}
    </button>
  );
}
