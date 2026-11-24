import { X } from 'lucide-react';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import '../../styles/tokens.css';
import '../admin/admin.css';
import '../flow/flow.css';
import './feedback.css';
import type { Loose } from '../../index';
import { AdminButton as RawAdminButton } from '../admin/AdminControls.jsx';
import { cx, focusableIn, layerTarget } from './layer';

/*
 * Diálogo modal (spec 006, "Casca comum"): foco preso dentro dele, Esc fecha, o foco volta
 * a quem o abriu e a página atrás não rola. Montado num portal com o escopo .minui-adm, para
 * os tokens --adm-* valerem em qualquer lugar; a cor de destaque (--minui-accent no <html>)
 * chega por herança. Nenhum texto é fixo: rótulos vêm por propriedade.
 */

const AdminButton = RawAdminButton as Loose<typeof RawAdminButton>;

/** Diálogos abertos, do mais antigo ao do topo: só o do topo reage a Esc e prende o foco. */
const openStack: symbol[] = [];
let scrollLocks = 0;

function lockScroll(): () => void {
  scrollLocks += 1;
  document.documentElement.classList.add('minui-scroll-locked');
  return () => {
    scrollLocks -= 1;
    if (scrollLocks === 0) document.documentElement.classList.remove('minui-scroll-locked');
  };
}

export interface DialogProps {
  /** Aberto ou fechado: o estado é de quem usa. */
  open: boolean;
  /** Pedido de fechar (Esc, botão de fechar, clique fora). Quem usa decide e muda `open`. */
  onClose: () => void;
  /** Título, que também dá nome ao diálogo. */
  title: ReactNode;
  /** Frase abaixo do título, ligada por `aria-describedby`. */
  description?: ReactNode;
  children?: ReactNode;
  /** Botões do rodapé. */
  footer?: ReactNode;
  /** Nome acessível do botão de fechar (o "x"). Sem ele, o botão não aparece. */
  closeLabel?: string | undefined;
  /** `alertdialog` para pedir confirmação; `dialog` nos demais casos. */
  role?: 'dialog' | 'alertdialog';
  size?: 'sm' | 'md' | 'lg';
  /** Elemento que recebe o foco ao abrir. Sem ele, o primeiro campo ou botão do corpo. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** Falso enquanto algo está em andamento: Esc e clique fora não fecham. */
  dismissible?: boolean;
  /** Clique no fundo escurecido fecha (padrão: sim). */
  closeOnBackdrop?: boolean;
  /** Onde montar o portal (padrão: `<body>`). */
  container?: Element | null | undefined;
  /** Classes a mais no escopo, ex.: `minui-adm--warm`. */
  scopeClassName?: string | undefined;
  className?: string | undefined;
}

/** Diálogo modal com foco preso. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel,
  role = 'dialog',
  size = 'md',
  initialFocus,
  dismissible = true,
  closeOnBackdrop = true,
  container,
  scopeClassName,
  className,
}: DialogProps) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [key] = useState(() => Symbol('dialog'));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openStack.push(key);
    const unlock = lockScroll();
    const panel = panelRef.current;
    const isTop = () => openStack[openStack.length - 1] === key;

    const target =
      initialFocusRef.current?.current ??
      (panel ? (focusableIn(panel).find((el) => !el.dataset.dialogClose) ?? panel) : null);
    target?.focus();

    // foco que escapou (clique fora, leitor de tela) volta para dentro
    const onFocusIn = (event: FocusEvent) => {
      if (!isTop() || !panel || panel.contains(event.target as Node)) return;
      (focusableIn(panel)[0] ?? panel).focus();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTop()) return;
      event.stopPropagation();
      if (dismissibleRef.current) onCloseRef.current();
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDown);
      openStack.splice(openStack.indexOf(key), 1);
      unlock();
      if (opener?.isConnected) opener.focus();
    };
  }, [open, key]);

  const target = layerTarget(container);
  if (!open || !target) return null;

  // Tab e Shift+Tab dão a volta dentro do diálogo
  const trapTab = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab' || !panelRef.current) return;
    const items = focusableIn(panelRef.current);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={cx('minui-adm', 'minui-dialog-layer', scopeClassName)}>
      <div
        className="minui-dialog-backdrop"
        aria-hidden="true"
        data-testid="dialog-backdrop"
        onClick={() => {
          if (closeOnBackdrop && dismissible) onClose();
        }}
      />
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role é sempre dialog ou alertdialog */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: o Tab é tratado no próprio diálogo */}
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        data-size={size}
        className={cx('minui-dialog', className)}
        onKeyDown={trapTab}
      >
        <header className="minui-dialog__head">
          <h2 id={`${id}-title`} className="minui-dialog__title">
            {title}
          </h2>
          {closeLabel ? (
            <AdminButton
              variant="ghost"
              size="sm"
              aria-label={closeLabel}
              data-dialog-close="true"
              disabled={!dismissible}
              icon={<X aria-hidden="true" />}
              onClick={onClose}
            />
          ) : null}
        </header>
        {description ? (
          <p id={`${id}-desc`} className="minui-dialog__desc">
            {description}
          </p>
        ) : null}
        {children ? <div className="minui-dialog__body">{children}</div> : null}
        {footer ? <footer className="minui-dialog__foot">{footer}</footer> : null}
      </div>
    </div>,
    target,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  /** Cancelar, Esc ou fechar. */
  onCancel: () => void;
  /** Confirmar. Pode devolver uma Promise; o estado de espera é de quem usa (`busy`). */
  onConfirm: () => void;
  /** Pergunta, ex.: "Excluir o curso?". */
  title: ReactNode;
  /** Nome do item afetado, mostrado em destaque (spec 006: a confirmação cita o item). */
  itemName: string;
  /** Explicação das consequências, depois do nome do item. */
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  /** Nome acessível do "x"; sem ele, só os dois botões. */
  closeLabel?: string | undefined;
  /** Ação destrutiva: botão de confirmar em vermelho (padrão: sim). */
  destructive?: boolean;
  /** Em andamento: botões desabilitados, Esc não fecha, `busyLabel` no botão. */
  busy?: boolean;
  busyLabel?: string | undefined;
  /**
   * Rótulo do campo em que a pessoa digita o nome do item para liberar o botão
   * (ex.: "Digite o nome do curso para confirmar"). Sem ele, não há campo.
   */
  typeToConfirmLabel?: ReactNode;
  container?: Element | null | undefined;
  scopeClassName?: string | undefined;
}

/** Confirmação de ação, com o nome do item. O foco começa em "cancelar". */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  itemName,
  message,
  confirmLabel,
  cancelLabel,
  closeLabel,
  destructive = true,
  busy = false,
  busyLabel,
  typeToConfirmLabel,
  container,
  scopeClassName,
}: ConfirmDialogProps) {
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!open) setTyped('');
  }, [open]);
  const blocked = typeToConfirmLabel != null && typed.trim() !== itemName.trim();

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      description={
        <>
          <strong className="minui-dialog__item">{itemName}</strong>
          {message ? <> {message}</> : null}
        </>
      }
      closeLabel={closeLabel}
      role="alertdialog"
      size="sm"
      initialFocus={cancelRef}
      dismissible={!busy}
      container={container}
      scopeClassName={scopeClassName}
      footer={
        <>
          <AdminButton ref={cancelRef} disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </AdminButton>
          <AdminButton
            variant="primary"
            className={destructive ? 'minui-adm-btn--danger' : undefined}
            disabled={busy || blocked}
            aria-busy={busy || undefined}
            onClick={onConfirm}
          >
            {busy && busyLabel ? busyLabel : confirmLabel}
          </AdminButton>
        </>
      }
    >
      {typeToConfirmLabel != null ? (
        <div className="minui-adm-field">
          <label className="minui-adm-field__label" htmlFor={`${id}-type`}>
            {typeToConfirmLabel}
          </label>
          <span className="minui-adm-input">
            <input
              id={`${id}-type`}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setTyped(event.target.value)}
            />
          </span>
        </div>
      ) : null}
    </Dialog>
  );
}
