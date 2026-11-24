import '../../styles/tokens.css';
import './Txt.css';
import { MIDDLE_MONO, MIDDLE_SANS } from '../../lib/measure';
import { cx } from '../../lib/util';

/**
 * Onde colocar a caixa de texto para a linha de base cair exatamente em `baseline`.
 *
 * O navegador arredonda a posição vertical do bloco que contém texto para um
 * pixel inteiro. Por isso o topo da caixa é sempre inteiro e a fração vai para
 * a "escora" (um inline-block invisível cuja altura define a linha de base).
 * `offsetY` é a parte fracionária da posição do elemento pai, quando houver.
 */
export function baselineBox(baseline, size, offsetY = 0) {
  const top = Math.floor(offsetY + baseline - size * 1.5) - offsetY;
  return { top, strut: baseline - top };
}

/**
 * Linha de texto posicionada pela LINHA DE BASE, como ctx.fillText no canvas.
 *
 * - `y`   : linha de base alfabética (textBaseline = "alphabetic")
 * - `mid` : linha de base central   (textBaseline = "middle")
 * - `x` / `right` : âncora horizontal (esquerda ou direita)
 * - `width` + `align="center"` : centraliza dentro de uma caixa de largura fixa
 * - `maxWidth` : corta com reticências, como a função de truncar do canvas
 */
export function Txt({
  as: Tag = 'div',
  x,
  y,
  mid,
  right,
  width,
  align,
  size = 13,
  weight = 400,
  color,
  mono = false,
  maxWidth,
  offsetY = 0,
  className,
  style,
  children,
  ...rest
}) {
  const baseline = y ?? (mid ?? 0) + (mono ? MIDDLE_MONO : MIDDLE_SANS) * size;
  const box = baselineBox(baseline, size, offsetY);
  const css = {
    top: box.top,
    '--minui-strut': `${box.strut}px`,
    fontSize: size,
    fontWeight: weight,
    color,
  };
  if (right != null) css.right = right;
  else css.left = x ?? 0;
  if (width != null) css.width = width;
  if (align) css.textAlign = align;
  if (maxWidth != null) css.maxWidth = Math.max(0, maxWidth);
  return (
    <Tag
      className={cx(
        'minui-txt',
        mono && 'minui-txt--mono',
        maxWidth != null && 'minui-txt--clip',
        className,
      )}
      style={{ ...css, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
