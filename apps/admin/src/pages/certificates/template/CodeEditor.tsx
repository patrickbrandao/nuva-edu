import { type ReactNode, type RefObject, useId, useMemo, useRef } from 'react';

interface CodeEditorProps {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  /** Erro: borda vermelha, `aria-invalid` e a mensagem no lugar da dica. */
  error?: ReactNode;
  /** Texto à direita, abaixo do campo (o tamanho do template). */
  counter?: ReactNode;
  counterInvalid?: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
}

/**
 * Editor de código do template (spec 015): `textarea` monoespaçada, sem quebra de linha, com os
 * números de linha ao lado (decorativos: a posição é anunciada pela lista de problemas). Tab
 * continua levando o foco adiante, para o fluxo ser operável por teclado. Sem biblioteca.
 */
export function CodeEditor({
  label,
  value,
  onChange,
  hint,
  error,
  counter,
  counterInvalid = false,
  textareaRef,
  disabled = false,
}: CodeEditorProps) {
  const id = useId();
  const gutter = useRef<HTMLPreElement>(null);
  const lineCount = useMemo(() => {
    let count = 1;
    for (let index = value.indexOf('\n'); index !== -1; index = value.indexOf('\n', index + 1)) {
      count += 1;
    }
    return count;
  }, [value]);
  const numbers = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1).join('\n'),
    [lineCount],
  );
  const note = error || hint;
  const described = [note ? `${id}-note` : null, counter ? `${id}-count` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`minui-adm-field${error ? ' minui-adm-field--error' : ''}`}>
      <label className="minui-adm-field__label" htmlFor={id}>
        {label}
      </label>
      <div className="nuva-code" data-invalid={error ? 'true' : undefined}>
        <pre ref={gutter} className="nuva-code__gutter" aria-hidden="true">
          {numbers}
        </pre>
        <textarea
          ref={textareaRef}
          id={id}
          className="nuva-code__input"
          value={value}
          rows={22}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={described || undefined}
          onChange={(event) => onChange(event.target.value)}
          onScroll={(event) => {
            if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
          }}
        />
      </div>
      {note || counter ? (
        <span className="flex justify-between gap-4">
          {note ? (
            <span id={`${id}-note`} className="minui-adm-field__hint">
              {note}
            </span>
          ) : (
            <span />
          )}
          {counter ? (
            <span
              id={`${id}-count`}
              className={`minui-adm-field__hint whitespace-nowrap${counterInvalid ? ' nuva-code__count--over' : ''}`}
            >
              {counter}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

/** Leva o cursor à linha e coluna e rola o editor até ela. */
export function moveCaret(textarea: HTMLTextAreaElement, offset: number, line: number): void {
  textarea.focus();
  textarea.setSelectionRange(offset, offset);
  const lineHeight = Number.parseFloat(getComputedStyle(textarea).lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) {
    textarea.scrollTop = Math.max(0, (line - 1) * lineHeight - textarea.clientHeight / 2);
  }
}
