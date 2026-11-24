import '../../styles/tokens.css';
import './Avatar.css';
import { cx, hueOf, place } from '../../lib/util';
import { Txt } from './Txt';

/*
 * Adaptado do minui-react: a folha de retratos de demonstração (people.webp) não
 * foi trazida. Com `src` o avatar mostra a imagem; sem, as iniciais sobre um
 * degradê cuja cor nasce do próprio nome.
 */
export function initialsOf(name = '') {
  const parts = String(name).split(' ');
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
}

/**
 * Avatar quadrado-arredondado (24% do tamanho) ou redondo.
 * `radius` permite forçar um raio (ex.: 3px nos selos pequenos).
 */
export function Avatar({
  name = '',
  size = 30,
  round = false,
  radius,
  src,
  x,
  y,
  className,
  style,
}) {
  const r = radius ?? (round ? size / 2 : size * 0.24);
  const base = { width: size, height: size, borderRadius: r, ...place(x, y), ...style };
  const label = name || undefined;

  if (src) {
    return (
      <span
        className={cx('minui-avatar', className)}
        role="img"
        aria-label={label}
        style={{ ...base, backgroundImage: `url(${src})`, backgroundSize: 'cover' }}
      />
    );
  }

  const hue = hueOf(name);
  const fontSize = Math.round(size * 0.38);
  return (
    <span
      className={cx('minui-avatar', 'minui-avatar--initials', className)}
      role="img"
      aria-label={label}
      style={{
        ...base,
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 62% 58%), hsl(${(hue + 40) % 360} 58% 38%))`,
      }}
    >
      <Txt
        as="span"
        x={0}
        width={size}
        align="center"
        mid={size / 2 + 0.5}
        size={fontSize}
        weight={600}
        color="rgba(255,255,255,0.95)"
        offsetY={y ? y - Math.floor(y) : 0}
      >
        {initialsOf(name)}
      </Txt>
    </span>
  );
}
