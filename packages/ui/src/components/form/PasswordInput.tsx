import { Eye, EyeOff } from 'lucide-react';
import { type InputHTMLAttributes, type ReactNode, type Ref, useId, useState } from 'react';
import '../../styles/tokens.css';
import '../admin/admin.css';
import './form.css';
import { cx } from '../feedback/layer';

/*
 * Campo de senha (spec 007, RNF-01: 8 a 128 caracteres, sem outra regra). Mesmo visual do
 * AdminField; botão de mostrar/ocultar com nome acessível; contador opcional. Nenhum texto é
 * fixo: rótulo, nomes do botão e texto do contador vêm por propriedade.
 */

/** Limites da spec 007 (RNF-01). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordCounterInfo {
  length: number;
  min: number;
  max: number;
  /** Entre `min` e `max`. */
  valid: boolean;
}

export interface PasswordInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'defaultValue' | 'onChange' | 'autoComplete' | 'minLength' | 'maxLength'
  > {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  /** `current-password` no login e na confirmação; `new-password` no cadastro e na troca. */
  autoComplete: 'current-password' | 'new-password';
  /** Nome do botão quando a senha está oculta (ex.: "Mostrar senha"). */
  showLabel: string;
  /** Nome do botão quando a senha está visível (ex.: "Ocultar senha"). */
  hideLabel: string;
  hint?: ReactNode;
  /** Mensagem de erro: borda vermelha, `aria-invalid` e a mensagem no lugar da dica. */
  error?: ReactNode;
  /** Padrão: 8. */
  minLength?: number;
  /** Padrão: 128; o campo não aceita mais que isso. */
  maxLength?: number;
  /** Texto do contador (ex.: `({ length, max }) => \`${length} de ${max}\``). Sem ele, não há contador. */
  counter?: ((info: PasswordCounterInfo) => ReactNode) | undefined;
  /** Mostrar a senha desde o início (ex.: senha gerada que a pessoa vai copiar). */
  defaultVisible?: boolean;
  inputRef?: Ref<HTMLInputElement> | undefined;
  className?: string | undefined;
}

/** Campo de senha com mostrar/ocultar. */
export function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  showLabel,
  hideLabel,
  hint,
  error,
  minLength = PASSWORD_MIN_LENGTH,
  maxLength = PASSWORD_MAX_LENGTH,
  counter,
  defaultVisible = false,
  inputRef,
  className,
  id: idProp,
  disabled,
  ...rest
}: PasswordInputProps) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [visible, setVisible] = useState(defaultVisible);
  const note = error || hint;
  const length = value.length;
  const valid = length >= minLength && length <= maxLength;
  const counterText = counter ? counter({ length, min: minLength, max: maxLength, valid }) : null;
  const described = [note ? `${id}-note` : null, counterText != null ? `${id}-count` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cx(
        'minui-adm-field',
        'minui-password',
        error ? 'minui-adm-field--error' : null,
        className,
      )}
    >
      <label className="minui-adm-field__label" htmlFor={id}>
        {label}
      </label>
      <span className="minui-adm-input minui-password__box">
        <input
          {...rest}
          ref={inputRef}
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          minLength={minLength}
          maxLength={maxLength}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="minui-password__toggle"
          aria-label={visible ? hideLabel : showLabel}
          aria-controls={id}
          disabled={disabled}
          onClick={() => setVisible((shown) => !shown)}
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </span>
      {note || counterText != null ? (
        <span className="minui-password__notes">
          {note ? (
            <span id={`${id}-note`} className="minui-adm-field__hint">
              {note}
            </span>
          ) : (
            <span />
          )}
          {counterText != null ? (
            <span id={`${id}-count`} className="minui-password__count" data-valid={valid}>
              {counterText}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
