import { cx } from '@nuva-edu/ui';
import { useId } from 'react';

interface TextAreaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string | undefined;
  error?: string | undefined;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  className?: string;
}

/**
 * Campo de texto de várias linhas com o visual do `AdminField` (mesmas classes do pacote de
 * interface). Fica no site até `packages/ui` ter o seu (tarefa 191, papel `interface`).
 */
export function TextArea({
  label,
  value,
  onChange,
  hint,
  error,
  rows = 4,
  className,
  ...rest
}: TextAreaProps) {
  const id = useId();
  const note = error || hint;
  return (
    <div className={cx('minui-adm-field', error && 'minui-adm-field--error', className)}>
      <label className="minui-adm-field__label" htmlFor={id}>
        {label}
      </label>
      <span className="minui-adm-input nuva-textarea">
        <textarea
          id={id}
          rows={rows}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? `${id}-note` : undefined}
          onChange={(event) => onChange(event.target.value)}
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
