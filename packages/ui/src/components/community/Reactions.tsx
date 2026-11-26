import type { ReactNode } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import './community.css';

/*
 * Reações do fórum (spec 017, RF-05 e "Tópicos e respostas"): conjunto fixo de seis emojis,
 * uma reação de cada tipo por pessoa e publicação. O componente só reflete o que a API
 * devolveu (`count`, `mine`); quem alterna é o site, por `onToggle`.
 *
 * O emoji é decorativo para o leitor de tela: cada botão tem nome vindo de `labels`
 * ("Curtir", "Coração"…) e o estado em `aria-pressed`; a contagem entra no nome.
 */

export const REACTION_EMOJIS = ['👍', '❤️', '🎉', '😄', '🤔', '👀'] as const;

export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];
export type ReactionKey = 'like' | 'heart' | 'celebrate' | 'laugh' | 'think' | 'eyes';

export const REACTION_KEYS: Record<ReactionEmoji, ReactionKey> = {
  '👍': 'like',
  '❤️': 'heart',
  '🎉': 'celebrate',
  '😄': 'laugh',
  '🤔': 'think',
  '👀': 'eyes',
};

export interface Reaction {
  emoji: ReactionEmoji;
  count: number;
  /** A pessoa atual já reagiu com este emoji. */
  mine?: boolean;
}

export interface ReactionLabels {
  /** Nome do grupo (ex.: "Reações"). */
  region: string;
  /** Nome de cada reação, ex.: { like: "Curtir", heart: "Coração", … }. */
  names: Record<ReactionKey, string>;
  /** Nome acessível do botão, ex.: (name, count, mine) => "Curtir, 3 reações". */
  button: (name: string, count: number, mine: boolean) => string;
}

export interface ReactionsProps {
  reactions: readonly Reaction[];
  labels: ReactionLabels;
  onToggle: (emoji: ReactionEmoji) => void;
  /** Desabilita todos os botões (ex.: enquanto a reação está sendo gravada). */
  disabled?: boolean;
  className?: string | undefined;
}

/** Seis reações fixas, com contagem e estado por pessoa. */
export function Reactions({
  reactions,
  labels,
  onToggle,
  disabled = false,
  className,
}: ReactionsProps) {
  const counts = new Map<ReactionEmoji, Reaction>();
  for (const reaction of reactions) counts.set(reaction.emoji, reaction);

  return (
    <fieldset className={['minui-reactions', className].filter(Boolean).join(' ')}>
      <legend className="minui-sr-only">{labels.region}</legend>
      {REACTION_EMOJIS.map((emoji) => {
        const reaction = counts.get(emoji) ?? { emoji, count: 0 };
        const key = REACTION_KEYS[emoji];
        const name = labels.names[key];
        const mine = reaction.mine === true;
        return (
          <button
            key={emoji}
            type="button"
            className="minui-reactions__button"
            aria-pressed={mine}
            aria-label={labels.button(name, reaction.count, mine)}
            data-reacted={mine ? 'true' : undefined}
            disabled={disabled}
            onClick={() => onToggle(emoji)}
          >
            <span className="minui-reactions__emoji" aria-hidden="true">
              {emoji}
            </span>
            <span className="minui-reactions__count" aria-hidden="true">
              {reaction.count > 0 ? formatCount(reaction.count) : ''}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}

function formatCount(count: number): ReactNode {
  return count > 99 ? '99+' : String(count);
}
