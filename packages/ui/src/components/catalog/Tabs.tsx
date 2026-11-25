import type { KeyboardEvent, ReactNode } from 'react';
import { useId, useRef, useState } from 'react';
import '../../styles/tokens.css';
import './catalog.css';

/*
 * Abas do site do aluno (spec 006: abas Notas e Comentários da aula). Segue o padrão de abas
 * da WAI-ARIA com ativação automática: só a aba selecionada entra na ordem do Tab, as setas
 * (e Home e End) passam de aba em aba e selecionam. Só o painel da aba selecionada é
 * montado, para a aba que busca dados (comentários) não carregar antes de ser aberta.
 * O painel administrativo continua com `AdminTabs`.
 */

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Número ao lado do rótulo (ex.: quantos comentários). */
  count?: number | undefined;
  /** Conteúdo do painel da aba. */
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: readonly TabItem[];
  /** Nome do grupo de abas para o leitor de tela (ex.: "Seções da aula"). */
  label: string;
  /** Aba selecionada, com controle externo (use com `onChange`). */
  value?: string | undefined;
  /** Aba selecionada ao montar, sem controle externo; padrão: a primeira habilitada. */
  defaultValue?: string | undefined;
  onChange?: (id: string) => void;
  className?: string | undefined;
}

/** Abas com painel, operáveis por teclado. */
export function Tabs({ tabs, label, value, defaultValue, onChange, className }: TabsProps) {
  const baseId = useId();
  const enabled = tabs.filter((tab) => !tab.disabled);
  const [ownValue, setOwnValue] = useState<string | undefined>(defaultValue ?? enabled[0]?.id);
  const selected = value ?? ownValue;
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const select = (id: string) => {
    if (value === undefined) setOwnValue(id);
    onChange?.(id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const index = enabled.findIndex((tab) => tab.id === id);
    if (index < 0 || enabled.length === 0) return;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % enabled.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + enabled.length) % enabled.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = enabled.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = enabled[next];
    if (!target) return;
    select(target.id);
    refs.current.get(target.id)?.focus();
  };

  const active = tabs.find((tab) => tab.id === selected);

  return (
    <div className={['minui-tabs', className].filter(Boolean).join(' ')}>
      <div className="minui-tabs__list" role="tablist" aria-label={label}>
        {tabs.map((tab) => {
          const isSelected = tab.id === selected;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) refs.current.set(tab.id, node);
                else refs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`${baseId}-${tab.id}-tab`}
              className="minui-tabs__tab"
              aria-selected={isSelected}
              aria-controls={isSelected ? `${baseId}-${tab.id}-panel` : undefined}
              tabIndex={isSelected ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => select(tab.id)}
              onKeyDown={(event) => onKeyDown(event, tab.id)}
            >
              {tab.label}
              {tab.count != null ? <span className="minui-tabs__count">{tab.count}</span> : null}
            </button>
          );
        })}
      </div>
      {active ? (
        <div
          role="tabpanel"
          id={`${baseId}-${active.id}-panel`}
          aria-labelledby={`${baseId}-${active.id}-tab`}
          className="minui-tabs__panel"
        >
          {active.content}
        </div>
      ) : null}
    </div>
  );
}
