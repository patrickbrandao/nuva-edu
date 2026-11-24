import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import '../../styles/tokens.css';
import '../admin/admin.css';
import './feedback.css';
import type { Loose } from '../../index';
import { AdminButton as RawAdminButton } from '../admin/AdminControls.jsx';
import { cx, layerTarget } from './layer';

/*
 * Avisos passageiros (spec 006, "Casca comum": avisos por toast). O provedor mantém duas
 * regiões vivas sempre montadas: `status` (educada) para sucesso, informação e aviso, e
 * `alert` (assertiva) para erro. O aviso de erro não some sozinho; os outros somem depois
 * de `duration`, com o tempo parado enquanto o ponteiro ou o foco estão sobre eles.
 */

const AdminButton = RawAdminButton as Loose<typeof RawAdminButton>;

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  tone?: ToastTone;
  title?: ReactNode;
  message: ReactNode;
  /** Em milissegundos; `null` fica até ser dispensado. Padrão: o do provedor (erro: `null`). */
  duration?: number | null;
  action?: ToastAction | undefined;
  /** Repetir o mesmo `id` substitui o aviso em vez de empilhar. */
  id?: string;
}

export interface ToastApi {
  show: (options: ToastOptions) => string;
  success: (message: ReactNode, options?: Omit<ToastOptions, 'message' | 'tone'>) => string;
  error: (message: ReactNode, options?: Omit<ToastOptions, 'message' | 'tone'>) => string;
  warning: (message: ReactNode, options?: Omit<ToastOptions, 'message' | 'tone'>) => string;
  info: (message: ReactNode, options?: Omit<ToastOptions, 'message' | 'tone'>) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

interface ToastEntry extends ToastOptions {
  id: string;
  tone: ToastTone;
  duration: number | null;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Dispara avisos. Só funciona dentro de um `ToastProvider`. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast precisa de um ToastProvider acima.');
  return api;
}

const ICONS: Record<ToastTone, ReactNode> = {
  success: <CircleCheck aria-hidden="true" />,
  error: <CircleAlert aria-hidden="true" />,
  warning: <TriangleAlert aria-hidden="true" />,
  info: <Info aria-hidden="true" />,
};

export interface ToastProps {
  tone?: ToastTone;
  title?: ReactNode;
  message: ReactNode;
  action?: ToastAction | undefined;
  /** Dispensar. Com ele, `dismissLabel` dá nome ao botão "x". */
  onDismiss?: (() => void) | undefined;
  dismissLabel?: string | undefined;
  className?: string | undefined;
}

/**
 * Um aviso, sem região viva própria: dentro do provedor ele é anunciado pela região; solto
 * (catálogo, testes), é só a caixa.
 */
export function Toast({
  tone = 'info',
  title,
  message,
  action,
  onDismiss,
  dismissLabel,
  className,
}: ToastProps) {
  return (
    <div className={cx('minui-toast', className)} data-tone={tone}>
      <span className="minui-toast__icon">{ICONS[tone]}</span>
      <div className="minui-toast__text">
        {title ? <strong className="minui-toast__title">{title}</strong> : null}
        <span className="minui-toast__message">{message}</span>
      </div>
      {action ? (
        <AdminButton size="sm" onClick={action.onClick}>
          {action.label}
        </AdminButton>
      ) : null}
      {onDismiss && dismissLabel ? (
        <AdminButton
          variant="ghost"
          size="sm"
          aria-label={dismissLabel}
          icon={<X aria-hidden="true" />}
          onClick={onDismiss}
        />
      ) : null}
    </div>
  );
}

function TimedToast({
  entry,
  paused,
  dismissLabel,
  onDismiss,
}: {
  entry: ToastEntry;
  paused: boolean;
  dismissLabel: string;
  onDismiss: (id: string) => void;
}) {
  const remaining = useRef(entry.duration);
  useEffect(() => {
    remaining.current = entry.duration;
  }, [entry]);
  useEffect(() => {
    if (paused || remaining.current == null) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(entry.id), remaining.current);
    return () => {
      clearTimeout(timer);
      if (remaining.current != null) {
        remaining.current = Math.max(0, remaining.current - (Date.now() - started));
      }
    };
  }, [paused, entry, onDismiss]);
  return (
    <div className="minui-toast-item">
      <Toast
        tone={entry.tone}
        title={entry.title}
        message={entry.message}
        action={
          entry.action
            ? {
                label: entry.action.label,
                onClick: () => {
                  entry.action?.onClick();
                  onDismiss(entry.id);
                },
              }
            : undefined
        }
        dismissLabel={dismissLabel}
        onDismiss={() => onDismiss(entry.id)}
      />
    </div>
  );
}

export interface ToastProviderProps {
  children?: ReactNode;
  /** Nome acessível do botão "x" de cada aviso. */
  dismissLabel: string;
  /** Nome da região dos avisos (ex.: "Avisos"). */
  regionLabel: string;
  /** Tempo padrão, em milissegundos, dos avisos que não são de erro (padrão: 5000). */
  duration?: number;
  /** Quantos avisos ficam visíveis; o mais antigo sai (padrão: 4). */
  max?: number;
  /** Onde montar a região (padrão: `<body>`). */
  container?: Element | null | undefined;
  scopeClassName?: string | undefined;
}

let sequence = 0;

/** Provedor dos avisos: regiões vivas e a API de `useToast`. */
export function ToastProvider({
  children,
  dismissLabel,
  regionLabel,
  duration = 5000,
  max = 4,
  container,
  scopeClassName,
}: ToastProviderProps) {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: string) => {
    setEntries((list) => list.filter((entry) => entry.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => {
    const show = (options: ToastOptions): string => {
      sequence += 1;
      const id = options.id ?? `toast-${sequence}`;
      const tone = options.tone ?? 'info';
      const entry: ToastEntry = {
        ...options,
        id,
        tone,
        duration:
          options.duration !== undefined ? options.duration : tone === 'error' ? null : duration,
      };
      setEntries((list) => {
        const rest = list.filter((item) => item.id !== id);
        return [...rest, entry].slice(-max);
      });
      return id;
    };
    const shortcut =
      (tone: ToastTone) => (message: ReactNode, options?: Omit<ToastOptions, 'message' | 'tone'>) =>
        show({ ...options, message, tone });
    return {
      show,
      success: shortcut('success'),
      error: shortcut('error'),
      warning: shortcut('warning'),
      info: shortcut('info'),
      dismiss,
      clear: () => setEntries([]),
    };
  }, [dismiss, duration, max]);

  const paused = hovered || focused;
  const polite = entries.filter((entry) => entry.tone !== 'error');
  const assertive = entries.filter((entry) => entry.tone === 'error');
  const target = mounted ? layerTarget(container) : null;
  const list = (items: ToastEntry[]) =>
    items.map((entry) => (
      <TimedToast
        key={entry.id}
        entry={entry}
        paused={paused}
        dismissLabel={dismissLabel}
        onDismiss={dismiss}
      />
    ));

  return (
    <ToastContext.Provider value={api}>
      {children}
      {target
        ? createPortal(
            <section
              aria-label={regionLabel}
              className={cx('minui-adm', 'minui-toast-region', scopeClassName)}
              onPointerEnter={() => setHovered(true)}
              onPointerLeave={() => setHovered(false)}
              onFocus={() => setFocused(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setFocused(false);
                }
              }}
            >
              <div role="alert" className="minui-toast-list">
                {list(assertive)}
              </div>
              <div role="status" aria-live="polite" className="minui-toast-list">
                {list(polite)}
              </div>
            </section>,
            target,
          )
        : null}
    </ToastContext.Provider>
  );
}
