import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import '../../styles/tokens.css';
import './catalog.css';

/*
 * Lista reordenável (spec 009, RF-08; spec 006, RNF-02; ADR 0025): módulos e aulas no
 * editor de curso. Arrasta pela alça com mouse, toque ou teclado (espaço pega, setas movem,
 * espaço solta, Esc cancela), e cada passo é anunciado ao leitor de tela com a posição.
 * Ao soltar numa posição nova, devolve a ordem inteira (o site grava com `PUT .../order`).
 *
 * Os textos (instruções, rótulo da alça e anúncios) vêm todos por `labels`: o pacote não
 * tem texto fixo e os anúncios padrão do dnd-kit, em inglês, nunca aparecem.
 */

export interface SortableListLabels {
  /** Instruções lidas ao focar a alça (ex.: "Para mover, aperte espaço, use as setas…"). */
  instructions: string;
  /** Descrição do papel da alça (ex.: "item reordenável"). */
  roleDescription: string;
  /** Nome da alça de um item (ex.: (nome) => `Mover ${nome}`). */
  handle: (label: string) => string;
  /** Item pego. `position` começa em 1. */
  pickedUp: (label: string, position: number, total: number) => string;
  /** Item passou sobre outra posição. */
  movedTo: (label: string, position: number, total: number) => string;
  /** Item solto. */
  dropped: (label: string, position: number, total: number) => string;
  /** Arrasto cancelado: o item voltou à posição de antes. */
  cancelled: (label: string, position: number, total: number) => string;
}

export interface SortableListProps<T> {
  items: readonly T[];
  /** Identificador único e estável do item. */
  getId: (item: T) => string;
  /** Nome do item, usado na alça e nos anúncios. */
  getLabel: (item: T) => string;
  /** Conteúdo da linha, ao lado da alça. */
  renderItem: (item: T, index: number) => ReactNode;
  /** A ordem nova, inteira, quando um item muda de posição. */
  onReorder: (items: T[]) => void;
  labels: SortableListLabels;
  /** Desliga o arrasto (ex.: enquanto a ordem anterior é gravada). */
  disabled?: boolean;
  /** Nome da lista para o leitor de tela. */
  'aria-label'?: string | undefined;
  className?: string | undefined;
}

interface RowProps {
  id: string;
  handleLabel: string;
  roleDescription: string;
  disabled: boolean;
  children: ReactNode;
}

function SortableRow({ id, handleLabel, roleDescription, disabled, children }: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled, attributes: { roleDescription } });
  // estilo pelo CSSOM (o React grava em element.style), permitido pela CSP style-src 'self'
  const style = { transform: CSS.Translate.toString(transform), transition };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="minui-sortable__item"
      data-dragging={isDragging ? 'true' : undefined}
      data-sortable-id={id}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="minui-sortable__handle"
        {...attributes}
        {...listeners}
        aria-label={handleLabel}
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>
      <div className="minui-sortable__content">{children}</div>
    </li>
  );
}

/** Lista que se reordena por arrastar (mouse, toque e teclado), com anúncios por props. */
export function SortableList<T>({
  items,
  getId,
  getLabel,
  renderItem,
  onReorder,
  labels,
  disabled = false,
  'aria-label': ariaLabel,
  className,
}: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map(getId);
  const total = ids.length;
  const indexOf = (id: UniqueIdentifier | undefined): number =>
    id === undefined ? -1 : ids.indexOf(String(id));
  const labelOf = (id: UniqueIdentifier): string => {
    const item = items[indexOf(id)];
    return item === undefined ? String(id) : getLabel(item);
  };
  const positionOf = (id: UniqueIdentifier | undefined, fallback: UniqueIdentifier): number =>
    (indexOf(id) >= 0 ? indexOf(id) : indexOf(fallback)) + 1;

  // ao pegar, o item já está "sobre" a própria posição: só anuncia quando a posição muda
  const lastOver = useRef<UniqueIdentifier | null>(null);
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      lastOver.current = active.id;
      return labels.pickedUp(labelOf(active.id), positionOf(active.id, active.id), total);
    },
    onDragOver: ({ active, over }) => {
      if (!over || over.id === lastOver.current) return undefined;
      lastOver.current = over.id;
      return labels.movedTo(labelOf(active.id), positionOf(over.id, active.id), total);
    },
    onDragEnd: ({ active, over }) =>
      labels.dropped(labelOf(active.id), positionOf(over?.id, active.id), total),
    onDragCancel: ({ active }) =>
      labels.cancelled(labelOf(active.id), positionOf(active.id, active.id), total),
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = indexOf(active.id);
    const to = indexOf(over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove([...items], from, to));
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: labels.instructions },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy} disabled={disabled}>
        <ol
          className={['minui-sortable', className].filter(Boolean).join(' ')}
          aria-label={ariaLabel}
        >
          {items.map((item, index) => {
            const id = getId(item);
            return (
              <SortableRow
                key={id}
                id={id}
                handleLabel={labels.handle(getLabel(item))}
                roleDescription={labels.roleDescription}
                disabled={disabled}
              >
                {renderItem(item, index)}
              </SortableRow>
            );
          })}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
