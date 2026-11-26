import type { ReactNode } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import './community.css';
import type { Loose } from '../../index';
import { AdminAvatar as RawAdminAvatar } from '../admin/AdminData.jsx';

/*
 * Menções `@usuario` do fórum (spec 017, RF-05): a lista de sugestões só traz quem pode
 * ler a categoria — a API já filtrou; o componente não decide permissão.
 *
 * `mentionQueryBeforeCaret` diz se o texto antes do cursor abre uma menção e qual trecho
 * o nome substitui; `insertMention` devolve o texto e o cursor novos. O foco fica no
 * textarea: a lista é um conjunto de botões, a opção ativa é marcada por `aria-current`
 * e um trecho `aria-live` anuncia a sugestão destacada. As setas, Enter e Esc são
 * resolvidas por `mentionKey`. (Um `textarea` não pode ter `role="combobox"` — o axe
 * recusa —, então a lista não usa o padrão listbox.)
 */

const AdminAvatar = RawAdminAvatar as Loose<typeof RawAdminAvatar>;

export interface MentionCandidate {
  id: string;
  /** Nome de usuário sem o `@`. */
  username: string;
  /** Nome exibido, quando diferente do usuário. */
  name?: string | undefined;
  avatarUrl?: string | null | undefined;
}

export interface MentionQuery {
  /** Posição do `@` no texto. */
  start: number;
  /** O que foi digitado depois do `@` (pode ser vazio). */
  query: string;
}

/** Menção em construção antes do cursor: `@` no começo ou depois de espaço. */
export function mentionQueryBeforeCaret(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, Math.max(0, Math.min(caret, text.length)));
  const match = /(^|\s)@([\p{L}\p{N}_.-]*)$/u.exec(before);
  if (!match) return null;
  const query = match[2] ?? '';
  return { start: before.length - query.length - 1, query };
}

/** Troca a menção em construção pelo nome escolhido e deixa o cursor depois dele. */
export function insertMention(
  text: string,
  caret: number,
  username: string,
): { value: string; caret: number } {
  const query = mentionQueryBeforeCaret(text, caret);
  const handle = `@${username}`;
  if (!query) {
    return {
      value: `${text.slice(0, caret)}${handle} ${text.slice(caret)}`,
      caret: caret + handle.length + 1,
    };
  }
  const after = text.slice(caret);
  // Sem nada depois, a menção deixa um espaço para a pessoa continuar escrevendo.
  const spacer = after === '' || !/^[ \n]/.test(after) ? ' ' : '';
  const value = `${text.slice(0, query.start)}${handle}${spacer}${after}`;
  return { value, caret: query.start + handle.length + spacer.length };
}

export type MentionKeyAction =
  | { type: 'active'; index: number }
  | { type: 'select' }
  | { type: 'dismiss' }
  | { type: 'none' };

/**
 * Tecla da lista de menções: setas e Home/End mudam a opção ativa; Enter escolhe;
 * Esc fecha. O que não é da lista fica para o textarea (`none`).
 */
export function mentionKey(key: string, activeIndex: number, count: number): MentionKeyAction {
  if (count <= 0) return { type: 'none' };
  switch (key) {
    case 'ArrowDown':
      return { type: 'active', index: (activeIndex + 1 + count) % count };
    case 'ArrowUp':
      return { type: 'active', index: (activeIndex - 1 + count) % count };
    case 'Home':
      return { type: 'active', index: 0 };
    case 'End':
      return { type: 'active', index: count - 1 };
    case 'Enter':
      return activeIndex >= 0 ? { type: 'select' } : { type: 'none' };
    case 'Escape':
      return { type: 'dismiss' };
    default:
      return { type: 'none' };
  }
}

/** Id da opção de uma menção, para o `aria-activedescendant` do textarea. */
export function mentionOptionId(listId: string, candidate: MentionCandidate): string {
  return `${listId}-${candidate.id}`;
}

export interface MentionListLabels {
  /** Nome da lista (ex.: "Sugestões de menção"). */
  region: string;
  /** Texto quando ninguém corresponde ao que foi digitado. */
  empty?: ReactNode;
  /** Nome acessível de uma opção; sem ele, usa o nome ou o usuário. */
  option?: ((candidate: MentionCandidate) => string) | undefined;
  /** Anúncio da opção destacada, ex.: (c, i, total) => "Sugestão 2 de 3: bruno". */
  active?: ((candidate: MentionCandidate, index: number, count: number) => string) | undefined;
}

export interface MentionListProps {
  id: string;
  items: readonly MentionCandidate[];
  activeIndex: number;
  labels: MentionListLabels;
  onSelect: (candidate: MentionCandidate) => void;
  className?: string | undefined;
}

/** Lista de sugestões de menção (botões; o foco permanece no campo de texto). */
export function MentionList({
  id,
  items,
  activeIndex,
  labels,
  onSelect,
  className,
}: MentionListProps) {
  if (items.length === 0) {
    return labels.empty ? (
      <p className={['minui-mentions__empty', className].filter(Boolean).join(' ')} role="status">
        {labels.empty}
      </p>
    ) : null;
  }
  const activeItem = items[activeIndex];
  return (
    <div className={['minui-mentions__wrap', className].filter(Boolean).join(' ')}>
      <ul id={id} aria-label={labels.region} className="minui-mentions">
        {items.map((candidate, index) => {
          const active = index === activeIndex;
          const name = candidate.name ?? candidate.username;
          return (
            <li key={candidate.id}>
              <button
                type="button"
                id={mentionOptionId(id, candidate)}
                className="minui-mentions__option"
                aria-current={active ? 'true' : undefined}
                data-active={active ? 'true' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSelect(candidate)}
              >
                <span aria-hidden="true">
                  <AdminAvatar size={22} name={name} src={candidate.avatarUrl ?? undefined} />
                </span>
                <span className="minui-mentions__name">
                  {name}
                  {name !== candidate.username ? (
                    <span className="minui-mentions__handle">@{candidate.username}</span>
                  ) : null}
                </span>
                {labels.option ? (
                  <span className="minui-sr-only">{labels.option(candidate)}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="minui-sr-only" aria-live="polite" aria-atomic="true">
        {activeItem && labels.active ? labels.active(activeItem, activeIndex, items.length) : ''}
      </p>
    </div>
  );
}
