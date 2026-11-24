import '../../styles/tokens.css';
import './snippets.css';
import { cx } from '../../lib/util';

/** Matiz de cada tipo de snippet (a primeira palavra da etiqueta). */
export const TAG_HUES = { rsc: 258, route: 176, cron: 28, edge: 330, db: 140 };

/** Matiz da etiqueta: o explícito, o do tipo ("rsc + auth" → rsc) ou violeta. */
export const tagHue = (label = '', hue) => hue ?? TAG_HUES[String(label).split(/[\s+]/)[0]] ?? 258;

/**
 * Etiqueta com brilho: pílula escura com aro na cor do matiz e um filete de
 * luz correndo pela borda de cima ("rsc + auth", "route + ai"…).
 */
export function GlowTag({ label, hue, glow = true, className, style, children }) {
  const h = tagHue(label, hue);
  return (
    <span
      className={cx('minui-glowtag', glow && 'minui-glowtag--glow', className)}
      style={{ '--minui-hue': h, ...style }}
    >
      {children ?? label}
    </span>
  );
}
