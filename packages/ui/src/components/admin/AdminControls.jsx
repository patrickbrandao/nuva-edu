import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import './admin.css';
import { cx } from '../../lib/util';

/*
 * Controles do AdminUI: botão, busca, menu suspenso, campo de texto, caixa de
 * seleção, chave e abas. Todos têm a mesma altura (--adm-ctl-h) e o mesmo
 * contorno fino com sombra de 1px.
 */

/**
 * Botão. `variant`: 'default' (contorno), 'primary' (cheio), 'ghost' (só o
 * texto). Só com `icon` e sem texto vira um botão quadrado — passe aria-label.
 * Com `href` é um link.
 */
export function AdminButton({
  variant = 'default',
  size = 'md',
  icon,
  iconEnd,
  href,
  className,
  children,
  ...rest
}) {
  const Tag = href ? 'a' : 'button';
  const props = href ? { href } : { type: 'button' };
  return (
    <Tag
      {...props}
      className={cx(
        'minui-adm-btn',
        variant !== 'default' && `minui-adm-btn--${variant}`,
        size === 'sm' && 'minui-adm-btn--sm',
        children == null && 'minui-adm-btn--icon',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
      {iconEnd}
    </Tag>
  );
}

/** Campo de busca com a lupa. `onChange` recebe o texto. */
export function AdminSearch({
  value,
  onChange,
  placeholder = 'Search...',
  label = 'Buscar',
  className,
  style,
  ...rest
}) {
  return (
    <label className={cx('minui-adm-search', className)} style={style}>
      <Search aria-hidden="true" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange?.(event.target.value)}
        {...rest}
      />
    </label>
  );
}

/**
 * Menu suspenso preso a um botão.
 *   options — [{ id, label, icon?, danger? } | 'separator']
 *   value   — id escolhido (modo seleção: marca com ✓ e mostra o rótulo no botão);
 *             sem `value` é um menu de ações.
 *   label   — texto do botão quando nada está escolhido; `icon` vem antes dele.
 */
export function AdminMenu({
  options = [],
  value,
  onChange,
  label,
  icon,
  variant,
  size,
  align = 'start',
  chevron = true,
  showValue = true,
  className,
  ...rest
}) {
  const id = useId();
  const root = useRef(null);
  const [open, setOpen] = useState(false);
  const selecting = value !== undefined;
  const chosen = selecting ? options.find((option) => option?.id === value) : null;
  const text = showValue && chosen ? chosen.label : label;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => !root.current?.contains(event.target) && setOpen(false);
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      root.current?.querySelector('button')?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // setas ↑ ↓ andam pelas opções
  const onListKey = (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll('button')];
    const next = items.indexOf(document.activeElement) + (event.key === 'ArrowDown' ? 1 : -1);
    items[(next + items.length) % items.length]?.focus();
  };

  const pick = (option) => {
    setOpen(false);
    onChange?.(option.id, option);
    root.current?.querySelector('button')?.focus();
  };

  return (
    <div
      ref={root}
      className={cx('minui-adm-menu', align === 'end' && 'minui-adm-menu--end', className)}
    >
      <AdminButton
        variant={variant}
        size={size}
        icon={(showValue && chosen?.icon) || icon}
        iconEnd={
          chevron && text != null ? (
            <ChevronDown className="minui-adm-menu__chev" aria-hidden="true" />
          ) : null
        }
        aria-haspopup={selecting ? 'listbox' : 'menu'}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          setOpen(true);
          requestAnimationFrame(() =>
            root.current?.querySelector('.minui-adm-menu__option')?.focus(),
          );
        }}
        {...rest}
      >
        {text}
      </AdminButton>
      {open ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: o papel é dinâmico (listbox ou menu) e as setas navegam entre as opções
        <div
          id={id}
          className="minui-adm-menu__pop"
          role={selecting ? 'listbox' : 'menu'}
          onKeyDown={onListKey}
        >
          {options.map((option, index) =>
            option === 'separator' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: lista posicional, sem identidade própria
              <hr key={`sep-${index}`} className="minui-adm-menu__sep" />
            ) : (
              // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-selected só é enviado quando o papel é option
              <button
                key={option.id}
                type="button"
                role={selecting ? 'option' : 'menuitem'}
                aria-selected={selecting ? option.id === value : undefined}
                className={cx(
                  'minui-adm-menu__option',
                  option.danger && 'minui-adm-menu__option--danger',
                )}
                onClick={() => pick(option)}
              >
                {option.icon}
                {option.label}
                {selecting && option.id === value ? (
                  <Check className="minui-adm-menu__check" aria-hidden="true" />
                ) : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Campo de texto com rótulo e dica. `error` pinta o contorno e a dica. */
export function AdminField({ label, hint, error, icon, value, onChange, className, ...rest }) {
  const id = useId();
  const note = error || hint;
  return (
    <div className={cx('minui-adm-field', error && 'minui-adm-field--error', className)}>
      {label ? (
        <label className="minui-adm-field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <span className="minui-adm-input">
        {icon}
        <input
          id={id}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? `${id}-note` : undefined}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          {...rest}
        />
      </span>
      {note ? (
        <span id={`${id}-note`} className="minui-adm-field__hint">
          {note}
        </span>
      ) : null}
    </div>
  );
}

/** Caixa de seleção. */
export function AdminCheckbox({ checked, onChange, children, ...rest }) {
  return (
    <label className="minui-adm-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange?.(event.target.checked)}
        {...rest}
      />
      <span className="minui-adm-check__box">
        <Check size={12} strokeWidth={3} aria-hidden="true" />
      </span>
      {children}
    </label>
  );
}

/** Chave liga/desliga. */
export function AdminSwitch({ checked, onChange, children, ...rest }) {
  return (
    <label className="minui-adm-switch">
      <input
        type="checkbox"
        // biome-ignore lint/a11y/useAriaPropsForRole: o checkbox nativo já expõe o estado marcado
        role="switch"
        checked={checked}
        onChange={(event) => onChange?.(event.target.checked)}
        {...rest}
      />
      <span className="minui-adm-switch__track" />
      {children}
    </label>
  );
}

/** Abas: [{ id, label, count? }]. */
export function AdminTabs({ tabs = [], value, onChange, label = 'Abas', className }) {
  return (
    <div className={cx('minui-adm-tabs', className)} role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className="minui-adm-tabs__tab"
          onClick={() => onChange?.(tab.id)}
        >
          {tab.label}
          {tab.count != null ? <span className="minui-adm-tabs__count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
