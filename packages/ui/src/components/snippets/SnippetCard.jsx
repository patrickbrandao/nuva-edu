import '../../styles/tokens.css';
import './snippets.css';
import { cx } from '../../lib/util';
import { ArrowButton } from './ArrowButton';
import { GlowTag } from './GlowTag';

/**
 * Cartão de snippet: uma bandeja elevada (etiqueta, seta e descrição) dentro
 * de um cartão maior, com o ícone da tecnologia e o caminho no rodapé.
 */
export function SnippetCard({
  tag,
  hue,
  description,
  icon,
  path,
  href,
  onOpen,
  width = 260,
  height = 300,
  className,
  style,
}) {
  return (
    <article className={cx('minui-snip', className)} style={{ width, minHeight: height, ...style }}>
      <div className="minui-snip__inset">
        <header className="minui-snip__head">
          <GlowTag label={tag} hue={hue} />
          <ArrowButton href={href} onClick={onOpen} label={path ? `Abrir ${path}` : 'Abrir'} />
        </header>
        {description ? <p className="minui-snip__desc">{description}</p> : null}
      </div>
      <footer className="minui-snip__foot">
        <span className="minui-snip__icon">{icon}</span>
        {path ? <code className="minui-snip__path">{path}</code> : null}
      </footer>
    </article>
  );
}

/** Grade de cartões de snippet que quebra linha sozinha. */
export function SnippetGrid({ min = 240, gap = 26, className, style, children }) {
  return (
    <div
      className={cx('minui-snipgrid', className)}
      style={{ '--minui-snip-min': `${min}px`, gap, ...style }}
    >
      {children}
    </div>
  );
}
