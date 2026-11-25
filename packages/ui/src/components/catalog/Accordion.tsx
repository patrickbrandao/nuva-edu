import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import '../../styles/tokens.css';
import './catalog.css';

/*
 * Acordeão (spec 006: programa do curso por módulo). Segue o padrão de acordeão da WAI-ARIA:
 * cada seção é um cabeçalho com um botão (`aria-expanded`, `aria-controls`) e um painel
 * (`section`, papel `region`) ligado a ele. O painel fechado fica `hidden` (fora da leitura e da ordem do Tab).
 */

export interface AccordionItem {
  id: string;
  /** Título da seção (ex.: o nome do módulo). */
  title: ReactNode;
  /** Informação à direita do título (ex.: "4 aulas · 3 de 4 concluídas"). */
  meta?: ReactNode;
  /** Conteúdo do painel (ex.: a lista de aulas). */
  content: ReactNode;
}

export interface AccordionProps {
  items: readonly AccordionItem[];
  /** Seções abertas ao montar (sem controle externo). */
  defaultOpen?: readonly string[];
  /** Seções abertas, com controle externo (use com `onOpenChange`). */
  open?: readonly string[] | undefined;
  onOpenChange?: (open: string[]) => void;
  /** Mais de uma seção aberta ao mesmo tempo (padrão). Desligado, abrir uma fecha as outras. */
  multiple?: boolean;
  /** Nível do cabeçalho de cada seção, conforme a página. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  className?: string | undefined;
}

/** Seções que abrem e fecham, uma por item. */
export function Accordion({
  items,
  defaultOpen = [],
  open,
  onOpenChange,
  multiple = true,
  headingLevel = 3,
  className,
}: AccordionProps) {
  const baseId = useId();
  const [ownOpen, setOwnOpen] = useState<string[]>([...defaultOpen]);
  const current = open ? [...open] : ownOpen;
  const Heading = `h${headingLevel}` as const;

  const toggle = (id: string) => {
    const isOpen = current.includes(id);
    const next = isOpen
      ? current.filter((value) => value !== id)
      : multiple
        ? [...current, id]
        : [id];
    if (!open) setOwnOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div className={['minui-accordion', className].filter(Boolean).join(' ')}>
      {items.map((item) => {
        const isOpen = current.includes(item.id);
        const buttonId = `${baseId}-${item.id}-button`;
        const panelId = `${baseId}-${item.id}-panel`;
        return (
          <div
            key={item.id}
            className="minui-accordion__item"
            data-open={isOpen ? 'true' : 'false'}
          >
            <Heading className="minui-accordion__heading">
              <button
                type="button"
                id={buttonId}
                className="minui-accordion__trigger"
                aria-expanded={isOpen}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
              >
                <span className="minui-accordion__title">{item.title}</span>
                {item.meta ? <span className="minui-accordion__meta">{item.meta}</span> : null}
                <ChevronDown className="minui-accordion__chevron" size={16} aria-hidden="true" />
              </button>
            </Heading>
            <section
              id={panelId}
              aria-labelledby={buttonId}
              className="minui-accordion__panel"
              hidden={!isOpen}
            >
              {item.content}
            </section>
          </div>
        );
      })}
    </div>
  );
}
