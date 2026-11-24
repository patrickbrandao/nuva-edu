import { type ReactNode, type Ref, type TextareaHTMLAttributes, useId } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import './form.css';
import { cx } from '../feedback/layer';

/*
 * Campo de texto de várias linhas com o visual do AdminField (mesmas classes `minui-adm-field` e
 * `minui-adm-input`). Redimensionável só na vertical. Nenhum texto é fixo: rótulo, dica, erro e
 * texto do contador vêm por propriedade. Usos: motivo da suspensão (até 500, spec 008) e texto
 * em Markdown dos termos (até 100.000, spec 030).
 */

export interface TextAreaCounterInfo {
  /** Caracteres digitados (`value.length`). */
  length: number;
  /** O `maxLength` recebido, ou `undefined` sem limite. */
  max: number | undefined;
  /** `max - length` (nunca negativo), ou `undefined` sem limite. */
  remaining: number | undefined;
  /** Dentro do limite (sempre `true` sem `maxLength`). */
  valid: boolean;
}

export interface AdminTextAreaProps
  extends Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    'value' | 'defaultValue' | 'onChange' | 'maxLength' | 'rows'
  > {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  /** Mensagem de erro: borda vermelha, `aria-invalid` e a mensagem no lugar da dica. */
  error?: ReactNode;
  /** Linhas visíveis no início. Padrão: 4. */
  rows?: number;
  /** Limite de caracteres; o campo não aceita mais que isso. */
  maxLength?: number | undefined;
  /** Texto do contador (ex.: `({ length, max }) => \`${length} de ${max}\``). Sem ele, não há contador. */
  counter?: ((info: TextAreaCounterInfo) => ReactNode) | undefined;
  textareaRef?: Ref<HTMLTextAreaElement> | undefined;
  className?: string | undefined;
}

/** Campo de texto de várias linhas. */
export function AdminTextArea({
  label,
  value,
  onChange,
  hint,
  error,
  rows = 4,
  maxLength,
  counter,
  textareaRef,
  className,
  id: idProp,
  ...rest
}: AdminTextAreaProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const note = error || hint;
  const length = value.length;
  const valid = maxLength === undefined || length <= maxLength;
  const remaining = maxLength === undefined ? undefined : Math.max(0, maxLength - length);
  const counterText = counter ? counter({ length, max: maxLength, remaining, valid }) : null;
  const described = [note ? `${id}-note` : null, counterText != null ? `${id}-count` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cx(
        'minui-adm-field',
        'minui-textarea',
        error ? 'minui-adm-field--error' : null,
        className,
      )}
    >
      <label className="minui-adm-field__label" htmlFor={id}>
        {label}
      </label>
      <span className="minui-adm-input minui-textarea__box">
        <textarea
          {...rest}
          ref={textareaRef}
          id={id}
          rows={rows}
          value={value}
          maxLength={maxLength}
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
      {note || counterText != null ? (
        <span className="minui-textarea__notes">
          {note ? (
            <span id={`${id}-note`} className="minui-adm-field__hint">
              {note}
            </span>
          ) : (
            <span />
          )}
          {counterText != null ? (
            <span id={`${id}-count`} className="minui-textarea__count" data-valid={valid}>
              {counterText}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
