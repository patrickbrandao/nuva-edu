import { Fragment } from 'react';
import '../../styles/tokens.css';
import './Txt.css';
import './Field.css';
import { fitSize, fontOf, textWidth, useFontEpoch } from '../../lib/measure';
import { cx, fade, heatInk, mix } from '../../lib/util';
import { Txt } from './Txt';

/** Cor do cursor: azul em fala calma, laranja quando o texto está "quente". */
export const caretColor = (heat = 0) =>
  heat > 0.5 ? 'var(--minui-caret-hot)' : 'var(--minui-caret)';

/* Cor de repouso e cor "quente" (recém-pousada) de cada tom de ditado. */
const WORD_TONES = {
  cool: ['var(--minui-text)', 'var(--minui-word-hot)'],
  loud: ['var(--minui-word-loud)', 'var(--minui-word-hot)'],
  white: ['#fff', 'rgb(255, 247, 226)'], // sobre o balão azul, nos dois temas
};

/** Normaliza `words` para [{ text, heat, fade }]. */
export function normalizeWords(words) {
  return (words ?? []).map((w) =>
    typeof w === 'string' ? { text: w, heat: 0, fade: 1 } : { heat: 0, fade: 1, ...w },
  );
}

/**
 * Palavras "faladas" que pousam uma a uma: cada palavra chega branca-quente
 * com um halo laranja e esfria até a cor normal.
 */
export function ReplyWords({ words, tone = 'cool' }) {
  const [rest, hot] = WORD_TONES[tone] ?? WORD_TONES.cool;
  return normalizeWords(words).map((word, i) => {
    const heat = Math.max(0, Math.min(1, word.heat));
    const style = {
      color: mix(rest, hot, heat),
      opacity: Math.max(0, Math.min(1, word.fade)),
      textShadow:
        heat > 0.02
          ? `0 0 ${((1.5 + 9 * heat) / 2).toFixed(2)}px ${fade(mix('var(--minui-word-glow)', 'var(--minui-word-glow-hot)', heat), 0.9 * heat)}`
          : undefined,
    };
    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: lista posicional, sem identidade própria
      <Fragment key={i}>
        {i ? ' ' : null}
        <span className="minui-word" style={style}>
          {word.text}
        </span>
      </Fragment>
    );
  });
}

/** Onde o cursor fica depois da última palavra que já pousou. */
export function replyCaretX(words, font, startX) {
  const list = normalizeWords(words);
  let last = -1;
  list.forEach((w, i) => {
    if (w.fade > 0) last = i;
  });
  if (last < 0) return startX;
  const prefix = list
    .slice(0, last)
    .map((w) => w.text)
    .join(' ');
  const x = startX + (prefix ? textWidth(`${prefix} `, font) : 0);
  return x + textWidth(list[last].text, font) + 2;
}

/**
 * Campo de resposta dos cartões.
 *
 * Estados:
 * - vazio            → mostra `placeholder`
 * - `typing`         → aro aceso + cursor
 * - `value`          → texto digitado (a fonte encolhe até caber)
 * - `loud` / `heat`  → texto em negrito e laranja (fala gritada)
 * - `words`          → modo "ditado": palavras pousando com brilho
 * - `send`           → botão Send à direita (cartão de e-mail)
 */
export function Field({
  x,
  y,
  width = 336,
  height = 26,
  placeholder = '',
  value = '',
  typing = false,
  heat = 0,
  loud = false,
  send = false,
  sendLabel = 'Send',
  radius = 8,
  words,
  className,
  style,
}) {
  useFontEpoch();
  const list = words ? normalizeWords(words) : null;
  const typed = list
    ? list
        .filter((w) => w.fade > 0)
        .map((w) => w.text)
        .join(' ')
    : value || '';
  const filled = typing || !!typed;
  const maxW = width - 20 - (send ? 46 : 0);
  const mid = height / 2;
  const weight = loud ? 750 : 450;
  const start = loud ? 14 : 12.5;

  let text = null;
  let caret = null;

  if (list) {
    const full = list.map((w) => w.text).join(' ');
    const size = fitSize(full, { weight, start, min: 8.5, max: maxW });
    const font = fontOf(weight, size);
    const base = mid + size * 0.36;
    text = (
      <Txt x={8} y={base} size={size} weight={weight}>
        <ReplyWords words={list} tone={loud ? 'loud' : 'cool'} />
      </Txt>
    );
    if (typing) {
      caret = {
        left: replyCaretX(list, font, 10),
        top: base - size * 0.82,
        height: size * 1.1,
        background: loud ? 'var(--minui-reply-caret-loud)' : 'var(--minui-reply-caret)',
      };
    }
  } else if (typed) {
    const size = fitSize(typed, { weight, start, min: 8.5, max: maxW });
    text = (
      <Txt x={8} mid={mid + 0.5} size={size} weight={weight} color={heatInk(heat)}>
        {typed}
      </Txt>
    );
    if (typing) {
      const w = Math.min(maxW, textWidth(typed, fontOf(weight, size)));
      caret = { left: 10 + w + 2, top: mid - 7, height: 14, background: caretColor(heat) };
    }
  } else {
    text = (
      <Txt x={8} mid={mid + 0.5} size={12.5} color="var(--minui-placeholder)">
        {placeholder}
      </Txt>
    );
    if (typing) caret = { left: 10, top: mid - 7, height: 14, background: caretColor(heat) };
  }

  const ring = typing
    ? mix('var(--minui-focus)', 'var(--minui-focus-hot)', heat)
    : 'var(--minui-field-line)';
  const absolute = x != null || y != null;

  return (
    <div
      className={cx('minui-field', filled && 'minui-field--filled', className)}
      style={{
        ...(absolute ? { position: 'absolute', left: x ?? 0, top: y ?? 0 } : null),
        width,
        height,
        '--minui-field-r': `${radius}px`,
        '--minui-field-ring': ring,
        ...style,
      }}
    >
      <div className="minui-field__clip" style={{ width: maxW + 10 }}>
        {text}
      </div>
      {caret ? <span className="minui-caret" style={caret} /> : null}
      {send ? (
        <span
          className={cx(
            'minui-send',
            'minui-baseline',
            typed && (heat > 0.5 ? 'minui-send--hot' : 'minui-send--on'),
          )}
          style={{ height: height - 10, '--minui-baseline': `${mid - 1.193}px` }}
        >
          {sendLabel}
        </span>
      ) : null}
    </div>
  );
}
