import '../../styles/tokens.css';
import './Surface.css';
import { cx } from '../../lib/util';

/**
 * A "casca" de todo cartão: degradê escuro, aro de 1px, brilho no topo e sombra.
 *
 * - `tone="card"`  : cartão de notificação padrão
 * - `tone="panel"` : painel preto sem brilho (usado pelo OpenCode)
 * - `ring`         : cor do aro (para estados com brilho colorido)
 *
 * Os filhos usam coordenadas absolutas a partir do canto superior esquerdo,
 * exatamente como o código de desenho do canvas.
 */
export function Surface({
  as: Tag = 'div',
  width,
  height,
  radius = 14,
  tone = 'card',
  ring,
  className,
  style,
  children,
  ...rest
}) {
  return (
    <Tag
      className={cx('minui-surface', `minui-surface--${tone}`, className)}
      style={{
        width,
        height,
        '--minui-r': `${radius}px`,
        ...(ring ? { '--minui-ring': ring } : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
